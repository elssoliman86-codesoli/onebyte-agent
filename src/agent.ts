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
}): Promise<{ text: string; toolCalls: ToolCall[] }> {
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
  // Keyless providers (Free OneByte) skip auth entirely.
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetchWithRetry(
    endpointFor(settings.baseUrl),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    {
      // No per-attempt timeout: the model answers whenever it finishes
      // (tool loops and long-context requests can exceed minutes).
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
  const calls = new Map<number, ToolCall>();

  const handle = (payload: string) => {
    let parsed: {
      choices?: {
        delta?: {
          content?: string;
          reasoning_content?: string;
          reasoning?: string;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        message?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
      }[];
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    if (parsed.error?.message) throw new Error('المزود أرسل خطأ أثناء توليد الرد.');
    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    // Reasoning models (DeepSeek-R1 style) stream their thinking separately.
    const think = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof think === 'string' && think) onThinking?.(think);
    if (typeof delta?.content === 'string' && delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const index = tc.index ?? 0;
      const existing = calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name += tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      calls.set(index, existing);
    }
    // Non-streaming fallback shape.
    const msg = choice?.message;
    if (msg) {
      if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
        onThinking?.(msg.reasoning_content);
      }
      if (typeof msg.content === 'string' && msg.content) {
        text += msg.content;
        onText(msg.content);
      }
      (msg.tool_calls ?? []).forEach((tc, i) => {
        calls.set(calls.size + i, {
          id: tc.id ?? '',
          name: tc.function?.name ?? '',
          arguments: tc.function?.arguments ?? '',
        });
      });
    }
  };

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    handle(await response.text());
  } else {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('المزود أرجع استجابة غير قابلة للقراءة.');
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') handle(payload);
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') handle(payload);
    }
  }

  const toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c], i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }))
    .filter((c) => c.name);
  return { text, toolCalls };
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
  let activeSpecs = specs;
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
    activeSpecs = specs.filter((s) => checkpoint.activeSpecsNames.includes(s.name));
    toolsWereUnsupported = checkpoint.toolsWereUnsupported;
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
      let result: { text: string; toolCalls: ToolCall[] };
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
          toolsWereUnsupported = true;
          round -= 1;
          continue;
        }
        throw error;
      }

    if (result.text) finalText += result.text + (result.toolCalls.length ? '\n\n' : '');
    if (!result.toolCalls.length) {
      // If the user explicitly asked us to perform an operation, a plain-text
      // answer is not evidence that it was performed. Surface that distinction.
      const actionIntent = typeof originalUserMessage === 'string' && /\b(scan|inspect|test|check|browse|navigate|open the (?:site|url|page|browser)|capture (?:the )?requests|replay (?:the )?request|send (?:the )?request|crawl|recon|hackerone|bug bounty)\b|(?:افحص(?:ها|ه)?|يفحص(?:ها|ه)?|فحص(?: التارجت| الموقع| الهدف)?|اختبر(?: التارجت| الموقع| الهدف)?|اختبار(?: التارجت| الموقع)?|ابدأ الفحص|نفذ الفحص|نفّذ الفحص|افتح (?:الموقع|الرابط|المتصفح)|اقرأ الصفحة|التقط الطلبات|اعترض الريكويستات|أرسل الطلب|ارسل الطلب|هاكر وان)/i.test(originalUserMessage);
      if (actionIntent && activeSpecs.length > 0 && steps.length === 0) {
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
