import type { ChatMessage, ChatSession, ProviderSettings } from './assistant';
import { streamModelChat, type ProviderChatMessage } from './model-provider';

/**
 * Deliberately pessimistic for Arabic text (~2 chars/token in practice, versus ~4 for
 * English). Overestimating keeps the working set inside the model's real window;
 * underestimating here caused silent 400s on long chats.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.6);
}

export const DEFAULT_CONTEXT = 128_000;

export interface ContextPlan {
  /** Messages (not yet summarised) that go to the model. */
  recent: ChatMessage[];
  /** Messages that should be folded into the running summary first. */
  toSummarise: ChatMessage[];
  usedTokens: number;
  budgetTokens: number;
}

export function workingBudget(settings: ProviderSettings, maxWorkingTokens: number): number {
  const ctx = settings.contextLength ?? DEFAULT_CONTEXT;
  // Leave room for the answer and tool output; never bill more than the user's cap.
  return Math.max(4_000, Math.min(Math.floor(ctx * 0.6), maxWorkingTokens));
}

export function planContext(
  session: ChatSession | null,
  extra: ChatMessage[],
  systemTokens: number,
  budget: number,
): ContextPlan {
  const all = [...(session?.messages ?? []), ...extra].filter((m) => m.content.trim());
  const skip = Math.min(session?.summarizedCount ?? 0, all.length);
  let live = all.slice(skip);
  const summaryTokens = estimateTokens(session?.summary ?? '');
  const cost = (msgs: ChatMessage[]) =>
    systemTokens + summaryTokens + msgs.reduce((n, m) => n + estimateTokens(m.content) + 6, 0);

  let used = cost(live);
  if (used <= budget) {
    return { recent: live, toSummarise: [], usedTokens: used, budgetTokens: budget };
  }
  // Fold oldest messages until we are at ~45% of budget, always keeping the last 4.
  const target = budget * 0.45;
  const toSummarise: ChatMessage[] = [];
  while (live.length > 4 && cost(live) > target) {
    toSummarise.push(live[0]);
    live = live.slice(1);
  }
  used = cost(live);
  return { recent: live, toSummarise, usedTokens: used, budgetTokens: budget };
}

const SUMMARY_PROMPT =
  'أنت تضغط محادثة طويلة لتكمل لاحقًا دون فقدان المعنى. اكتب ملخصًا مركّزًا بنفس لغة المحادثة يحفظ: ' +
  'الأهداف، القرارات، الحقائق والأرقام والأسماء والمسارات، ما تم تنفيذه فعلاً وما لم يُنفّذ، التفضيلات، والمهام المعلقة. ' +
  'لا تضف معلومات جديدة ولا تُجمّل. اختصر الحشو فقط.';

export async function summarise({
  settings,
  apiKey,
  previousSummary,
  messages,
  signal,
}: {
  settings: ProviderSettings;
  apiKey: string;
  previousSummary: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'المستخدم' : 'المساعد'}: ${m.content}`)
    .join('\n\n');
  const prompt: ProviderChatMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content:
        (previousSummary ? `الملخص السابق:\n${previousSummary}\n\n` : '') +
        `رسائل جديدة تُدمج في الملخص:\n${transcript}`,
    },
  ];
  let out = '';
  await streamModelChat({
    settings,
    apiKey,
    messages: prompt,
    onChunk: (c) => {
      out += c;
    },
    signal,
  });
  if (!out.trim()) throw new Error('فشل ضغط المحادثة.');
  return out.trim();
}

/** Summarise in chunks so a very long backlog never overflows the summariser itself. */
export async function summariseBacklog({
  settings,
  apiKey,
  previousSummary,
  messages,
  chunkTokens,
  signal,
}: {
  settings: ProviderSettings;
  apiKey: string;
  previousSummary: string;
  messages: ChatMessage[];
  chunkTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  let summary = previousSummary;
  let chunk: ChatMessage[] = [];
  let size = 0;
  const flush = async () => {
    if (!chunk.length) return;
    summary = await summarise({ settings, apiKey, previousSummary: summary, messages: chunk, signal });
    chunk = [];
    size = 0;
  };
  for (const message of messages) {
    // A single giant message is truncated rather than blocking the chat forever.
    const content = message.content.length > chunkTokens * 3 ? message.content.slice(0, chunkTokens * 3) + '…' : message.content;
    const t = estimateTokens(content);
    if (size + t > chunkTokens) await flush();
    chunk.push({ ...message, content });
    size += t;
  }
  await flush();
  return summary;
}
