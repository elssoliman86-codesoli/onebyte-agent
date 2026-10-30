import { fetchWithRetry } from './fetch-with-retry';
import { storage } from './storage';
import { checkServiceHealth } from './device';
import type { ProviderSettings, ToolStep } from './assistant';
import { endpointFor, type ProviderChatMessage } from './model-provider';
import {
  needsApproval,
  toOpenAITools,
  type ToolSpec,
} from './tools';
import type { AgentCheckpoint } from './storage';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

type WireMessage =
  | ProviderChatMessage
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ApprovalDecision = 'once' | 'turn' | 'always' | 'deny';

export class ToolsUnsupportedError extends Error {}

function httpError(status: number, keyless = false, hasImageInput = false): Error {
  if (status === 401 || status === 403) {
    return new Error(
      keyless
        ? 'الخدمة المجانية رفضت الاتصال بدون مفتاح. قد يكون المزود غيّر شروطه؛ راجع إعدادات المزود.'
        : 'المزود رفض مفتاح API.',
    );
  }
  if (status === 404) return new Error('المسار غير موجود. راجع Base URL.');
  if (status === 429) return new Error('وصلت إلى حد الاستخدام لدى المزود.');
  if (status === 400 && hasImageInput) {
    return new Error(
      'الموديل الحالي رفض الصورة (HTTP 400). اختَر موديلًا يدعم تحليل الصور، أو أعد إرسال السؤال كنص إذا لم يكن لديك موديل Vision.',
    );
  }
  return new Error(`تعذّر الاتصال بالموديل (HTTP ${status}).`);
}

function messagesContainImage(messages: WireMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url'),
  );
}

/** One streamed completion that may end with tool calls. */
export async function streamCompletion({
  settings,
  apiKey,
  messages,
  specs,
  onText,
  onThinking,
  signal,
}: {
  settings: ProviderSettings;
  apiKey: string;
  messages: WireMessage[];
  specs: ToolSpec[];
  onText: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; toolCalls: ToolCall[]; finishReason?: string; streamComplete: boolean }> {
  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    messages,
    stream: true,
  };
  if (specs.length) {
    body.tools = toOpenAITools(specs);
    body.tool_choice = 'auto';
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Do not impose a total generation timeout: large-context models can take
  // several minutes before their first token. We only detect a stalled stream
  // after response headers have arrived, and the caller can always cancel.
  const response = await fetchWithRetry(
    endpointFor(settings.baseUrl),
    { method: 'POST', headers, body: JSON.stringify(body) },
    {
      timeout: 0,
      maxRetries: 2,
      baseDelay: 1_000,
      signal,
      onRetry: (attempt, error, delay) => {
        console.warn(`[streamCompletion] Retry ${attempt}/2 after ${Math.round(delay)}ms:`, error.message);
      },
    },
  );
  if (!response.ok) {
    if (specs.length && (response.status === 400 || response.status === 422)) {
      throw new ToolsUnsupportedError('الموديل أو المزود لا يدعم استدعاء الأدوات.');
    }
    throw httpError(response.status, settings.keyless, messagesContainImage(messages));
  }

  let text = '';
  let finishReason: string | undefined;
  let receivedDone = false;
  const calls = new Map<number, ToolCall>();
  const contentText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text : '').join('');
  };

  const handle = (payload: string) => {
    let parsed: {
      choices?: {
        finish_reason?: string | null;
        delta?: {
          content?: unknown;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        message?: {
          content?: unknown;
          reasoning_content?: string;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
      error?: { message?: string };
    };
    try { parsed = JSON.parse(payload); } catch { return; }
    if (parsed.error?.message) throw new Error(parsed.error.message.slice(0, 500));
    const choice = parsed.choices?.[0];
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    const delta = choice?.delta;
    const think = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof think === 'string' && think) onThinking?.(think);
    const chunk = contentText(delta?.content);
    if (chunk) {
      text += chunk;
      onText(chunk);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const index = tc.index ?? 0;
      const existing = calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name += tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      calls.set(index, existing);
    }

    // Some OpenAI-compatible providers return a JSON message even when stream
    // was requested; accept that shape without pretending it was an SSE stream.
    const message = choice?.message;
    if (message) {
      if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
        onThinking?.(message.reasoning_content);
      }
      const full = contentText(message.content);
      if (full) {
        text += full;
        onText(full);
      }
      (message.tool_calls ?? []).forEach((tc, index) => {
        calls.set(index, {
          id: tc.id ?? `call_${Date.now()}_${index}`,
          name: tc.function?.name ?? '',
          arguments: tc.function?.arguments ?? '',
        });
      });
    }
  };

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    handle(await response.text());
    finishReason = finishReason ?? 'provider-json-response';
    receivedDone = true;
  } else {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('المزود أرجع استجابة غير قابلة للقراءة.');
    const decoder = new TextDecoder();
    let buffer = '';
    const idleTimeoutMs = 120_000;
    try {
      for (;;) {
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              idleTimer = setTimeout(() => reject(new Error('توقف تدفق الموديل لأكثر من دقيقتين. تم حفظ الجزء المستلم؛ أعد المحاولة للمتابعة.')), idleTimeoutMs);
            }),
          ]);
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
        }
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const rawLine of lines) {
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') { receivedDone = true; continue; }
          handle(payload);
        }
      }
      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail.startsWith('data:')) {
        const payload = tail.slice(5).trim();
        if (payload === '[DONE]') receivedDone = true;
        else if (payload) handle(payload);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  const toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call], index) => ({ ...call, id: call.id || `call_${Date.now()}_${index}` }))
    .filter((call) => call.name);

  // Never execute a tool call assembled from a dropped/length-limited stream.
  if (toolCalls.length && (!receivedDone && !finishReason || finishReason === 'length')) {
    throw new Error('انقطع طلب الأداة قبل اكتمال بياناتها؛ لم يتم تنفيذها. أعد المحاولة.');
  }
  return { text, toolCalls, finishReason, streamComplete: receivedDone || !!finishReason };
}

const MAX_TOOL_RESULT = 8000;
const MAX_DEVICE_ACTIONS_PER_RUN = 12;

export interface AgentRunResult {
  text: string;
  thinking: string;
  steps: ToolStep[];
  toolsWereUnsupported: boolean;
}

/**
 * The agent loop: model -> (approval) -> tool -> model ... until the model answers in plain text.
 * Every non-local tool waits for an explicit user decision; "turn" approvals are per-tool
 * and expire when this run ends.
 */
export interface RunAgentOptions {
  settings: ProviderSettings;
  apiKey: string;
  messages: ProviderChatMessage[];
  specs: ToolSpec[];
  /** Provider catalogue explicitly says this model cannot call tools. */
  toolsUnavailableHint?: boolean;
  maxSteps: number;
  /** Run Android device tools without per-step prompts after the user enabled device control. */
  autoApproveDeviceTools?: boolean;
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
  requestApproval: (spec: ToolSpec, args: Record<string, unknown>) => Promise<ApprovalDecision>;
  onText: (fullTextSoFar: string) => void;
  onThinking?: (chunk: string) => void;
  onStep: (steps: ToolStep[]) => void;
  signal?: AbortSignal;
  /** Optional checkpoint to resume from. */
  checkpoint?: AgentCheckpoint | null;
  /** Session ID for checkpoint persistence. */
  sessionId: string;
  /** Original user message that started this run. */
  originalUserMessage: string;
  /** Called when a checkpoint is saved. */
  onCheckpoint?: (checkpoint: AgentCheckpoint) => void;
}

export async function runAgent({
  settings,
  apiKey,
  messages,
  specs,
  toolsUnavailableHint = false,
  maxSteps,
  autoApproveDeviceTools = false,
  execute,
  requestApproval,
  onText,
  onThinking,
  onStep,
  signal,
  checkpoint,
  sessionId,
  originalUserMessage,
  onCheckpoint,
}: RunAgentOptions): Promise<AgentRunResult> {
  // Restore from checkpoint if provided
  let wire: WireMessage[];
  let steps: ToolStep[];
  let finalText = '';
  let finalThinking = '';
  const allowedForTurn = new Set<string>();
  const repeatedDeviceActions = new Set<string>();
  let deviceActionsExecuted = 0;
  let lastScreenSnapshot: string | null = null;
  let screenNeedsRefresh = false;
  let lastScreenReadRound = -1;
  let stopForDeviceActionLimit = false;
  let toolsUnavailable = toolsUnavailableHint;
  let activeSpecs = toolsUnavailable ? [] : specs;
  let toolsWereUnsupported = false;
  let startRound = 0;

  if (checkpoint) {
    // Resume from checkpoint
    wire = [...checkpoint.wire];
    steps = [...checkpoint.steps];
    finalText = checkpoint.finalText;
    finalThinking = checkpoint.finalThinking;
    checkpoint.allowedForTurn.forEach((name) => allowedForTurn.add(name));
    // Restore activeSpecs by matching names
    toolsWereUnsupported = checkpoint.toolsWereUnsupported;
    toolsUnavailable = toolsUnavailable || toolsWereUnsupported;
    activeSpecs = toolsUnavailable ? [] : specs.filter((s) => checkpoint.activeSpecsNames.includes(s.name));
    startRound = checkpoint.round;
    console.log(`[runAgent] Resumed from checkpoint at round ${startRound}`);
  } else {
    wire = [...messages];
    steps = [];
  }

  const saveCheckpoint = async (round: number) => {
    const cp: AgentCheckpoint = {
      version: 1,
      sessionId,
      createdAt: new Date().toISOString(),
      round,
      wire: [...wire],
      steps: [...steps],
      finalText,
      finalThinking,
      allowedForTurn: [...allowedForTurn],
      activeSpecsNames: activeSpecs.map((s) => s.name),
      toolsWereUnsupported,
      maxSteps,
      originalUserMessage,
      provider: settings,
    };
    await storage.saveCheckpoint(cp);
    onCheckpoint?.(cp);
  };

  try {
    for (let round = startRound; round <= maxSteps; round += 1) {
      if (signal?.aborted) throw new Error('تم إيقاف المهمة.');
      let roundText = '';
      let result: { text: string; toolCalls: ToolCall[]; finishReason?: string; streamComplete: boolean };
      try {
        result = await streamCompletion({
          settings,
          apiKey,
          messages: wire,
          specs: round === maxSteps ? [] : activeSpecs,
          onText: (chunk) => {
            roundText += chunk;
            onText(finalText + roundText);
          },
          onThinking: (chunk) => {
            finalThinking += chunk;
            onThinking?.(chunk);
          },
          signal,
        });
      } catch (error) {
        if (error instanceof ToolsUnsupportedError && activeSpecs.length) {
          activeSpecs = [];
          toolsUnavailable = true;
          round -= 1;
          continue;
        }
        throw error;
      }

    if (result.text) finalText += result.text + (result.toolCalls.length ? '\n\n' : '');

    // A provider's length stop is not a complete answer. Continue from the
    // exact last text in a fresh round while preserving the accumulated reply.
    if (!result.toolCalls.length && result.finishReason === 'length' && round < maxSteps) {
      wire.push({ role: 'assistant', content: result.text });
      wire.push({ role: 'user', content: 'أكمل من آخر كلمة توقفت عندها دون إعادة ما سبق. أنهِ الرد كاملًا، وإذا لم يعد هناك المزيد فاكتب الخلاصة النهائية.' });
      await saveCheckpoint(round + 1);
      continue;
    }
    if (!result.toolCalls.length && result.finishReason === 'length' && round >= maxSteps) {
      finalText += '\n\n[تنبيه: وصل الموديل إلى حد طول الرد قبل إكماله. أرسل «أكمل» للمتابعة.]';
      onText(finalText);
    }
    if (!result.toolCalls.length && !result.streamComplete && result.text.trim()) {
      finalText += '\n\n[تنبيه: انتهى الاتصال دون إشارة اكتمال مؤكدة من المزود؛ تم حفظ النص المستلم وقد يكون الرد ناقصًا.]';
      onText(finalText);
    }
    if (!result.toolCalls.length) {
      // If the user explicitly asked us to perform an operation, a plain-text
      // answer is not evidence that it was performed. Surface that distinction.
      const actionIntent = typeof originalUserMessage === 'string' && /\b(scan|inspect|test|check|browse|navigate|open the (?:site|url|page|browser)|capture (?:the )?requests|replay (?:the )?request|send (?:the )?request|crawl|recon|hackerone|bug bounty)\b|(?:افحص(?:ها|ه)?|يفحص(?:ها|ه)?|فحص(?: التارجت| الموقع| الهدف)?|اختبر(?: التارجت| الموقع| الهدف)?|اختبار(?: التارجت| الموقع)?|ابدأ الفحص|نفذ الفحص|نفّذ الفحص|افتح (?:الموقع|الرابط|المتصفح)|اقرأ الصفحة|التقط الطلبات|اعترض الريكويستات|أرسل الطلب|ارسل الطلب|هاكر وان)/i.test(originalUserMessage);
      if (actionIntent && (activeSpecs.length > 0 || toolsUnavailable) && steps.length === 0) {
        toolsWereUnsupported = true;
      }
      await saveCheckpoint(round + 1);
      break;
    }

    wire.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments || '{}' },
      })),
    });

    for (const call of result.toolCalls) {
      if (signal?.aborted) throw new Error('تم إيقاف المهمة.');
      const spec = specs.find((s) => s.name === call.name);
      let args: Record<string, unknown> = {};
      let output = '';
      let status: ToolStep['status'] = 'done';
      try {
        args = call.arguments.trim() ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      const step: ToolStep = { id: call.id, tool: call.name, args, status: 'running', result: '' };
      steps.push(step);
      onStep([...steps]);

      if (!spec) {
        output = `خطأ: الأداة ${call.name} غير متاحة.`;
        status = 'error';
      } else {
        const isDeviceTool = spec.group === 'device_read' || spec.group === 'device_act';
        let allowed =
          !needsApproval(spec) ||
          allowedForTurn.has(spec.name) ||
          (autoApproveDeviceTools && isDeviceTool);
        if (!allowed) {
          const decision = await requestApproval(spec, args);
          if (decision === 'deny') {
            output = 'رفض المستخدم هذا الإجراء. لا تكرره؛ اسأل المستخدم عن البديل.';
            status = 'denied';
          } else {
            // 'always' behaves like 'turn' for this run; the caller persists it.
            if (decision === 'turn' || decision === 'always') allowedForTurn.add(spec.name);
            allowed = true;
          }
        }
        if (allowed && call.name === 'get_screen') {
          if (lastScreenSnapshot && !screenNeedsRefresh && lastScreenReadRound === round) {
            output = `${lastScreenSnapshot}\n\nلم يتغير الجهاز منذ القراءة السابقة في هذه الخطوة.`;
          } else {
            try {
              output = await execute(call.name, args);
              lastScreenSnapshot = output;
              screenNeedsRefresh = false;
              lastScreenReadRound = round;
            } catch (error) {
              output = `خطأ: ${error instanceof Error ? error.message : String(error)}`;
              status = 'error';
            }
          }
        } else if (allowed && spec.group === 'device_act') {
          const actionKey = `${call.name}:${JSON.stringify(args)}:${lastScreenSnapshot ?? 'initial'}`;
          if (screenNeedsRefresh) {
            output = 'لم أنفذ الإجراء لأن الشاشة لم تُقرأ بعد الخطوة السابقة. اقرأ الشاشة الحالية أولًا ثم قرر الخطوة التالية.';
            status = 'denied';
          } else if (repeatedDeviceActions.has(actionKey)) {
            output = 'لم أكرر الإجراء نفسه على الشاشة نفسها. اقرأ الشاشة وتحقق من النتيجة قبل اختيار إجراء مختلف.';
            status = 'denied';
          } else if (deviceActionsExecuted >= MAX_DEVICE_ACTIONS_PER_RUN) {
            output = 'توقفت عند الحد الآمن البالغ 12 إجراءً للجهاز في هذه المهمة.';
            status = 'denied';
            stopForDeviceActionLimit = true;
          } else {
            repeatedDeviceActions.add(actionKey);
            deviceActionsExecuted += 1;
            try {
              output = await execute(call.name, args);
            } catch (error) {
              output = `خطأ: ${error instanceof Error ? error.message : String(error)}`;
              status = 'error';
            } finally {
              screenNeedsRefresh = true;
            }
          }
        } else if (allowed) {
          try {
            output = await execute(call.name, args);
          } catch (error) {
            output = `خطأ: ${error instanceof Error ? error.message : String(error)}`;
            status = 'error';
          }
        }
      }
      step.status = status;
      step.result = output.length > 600 ? `${output.slice(0, 600)}…` : output;
      onStep([...steps]);
      wire.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output.length > MAX_TOOL_RESULT ? `${output.slice(0, MAX_TOOL_RESULT)}\n…(مقتطع)` : output,
      });
      // Save checkpoint after each tool execution
      await saveCheckpoint(round);
    }

    if (stopForDeviceActionLimit) {
      finalText += `${finalText ? '\n\n' : ''}توقفت المهمة بعد 12 إجراءً على الجهاز. راجع ما تم ثم أرسل متابعة لإكمالها.`;
      onText(finalText);
      break;
    }

    // Accessibility service health check (Android only, when device control is enabled)
    // Runs after each round to catch service crashes during long tasks.
    if (specs.some((s) => s.group.startsWith('device_'))) {
      try {
        const health = await checkServiceHealth();
        if (!health.healthy) {
          throw new Error(
            `خدمة إمكانية الوصول توقفت بشكل غير متوقع: ${health.reason ?? 'غير معروف'}. ` +
              `أعد تفعيلها من الإعدادات وأكمل المهمة.`,
          );
        }
      } catch (healthError) {
        // If health check itself fails (e.g., native module not available), log but don't fail
        // unless we're on Android with device control enabled.
        console.warn('[runAgent] Accessibility health check failed:', healthError);
      }
    }
  }
  } finally {
    // Clear checkpoint on completion (success or abort)
    // Don't await to avoid slowing down the response
    storage.clearCheckpoint().catch(() => undefined);
  }
  if (toolsWereUnsupported) {
    const warning = '⚠️ لم تُنفَّذ أدوات فعلية في هذه المحاولة. قد يكون الموديل رفض Tool Calling أو أجاب نصيًا فقط؛ لا تعتبر المهمة مفحوصة ما لم تظهر نتائج أدوات ناجحة.';
    if (!finalText.includes(warning)) {
      finalText = [finalText.trim(), warning].filter(Boolean).join('\n\n');
      onText(finalText);
    }
  }
  return { text: finalText.trim(), thinking: finalThinking.trim(), steps, toolsWereUnsupported };
}
