import type { ChatMessage, ChatSession, ProviderSettings } from './assistant';
import { streamModelChat, type ProviderChatMessage } from './model-provider';

/**
 * Token estimation with language-aware heuristics.
 * Arabic/mixed text: ~3.2 chars/token (more accurate than 2.6)
 * English: ~4 chars/token
 * Code/mixed: ~3 chars/token
 * We use a blended approach: detect script mix and adjust.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Detect Arabic script presence
  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length;
  const totalChars = text.length;
  const arabicRatio = totalChars > 0 ? arabicChars / totalChars : 0;
  
  // Detect code-like content (backticks, common patterns)
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).join('').length;
  const inlineCode = (text.match(/`[^`]+`/g) || []).join('').length;
  const codeRatio = totalChars > 0 ? (codeBlocks + inlineCode) / totalChars : 0;
  
  // Base chars per token by content type
  let charsPerToken: number;
  if (codeRatio > 0.3) {
    charsPerToken = 3.0; // code-heavy
  } else if (arabicRatio > 0.5) {
    charsPerToken = 3.2; // Arabic-heavy
  } else if (arabicRatio > 0.1) {
    charsPerToken = 3.5; // mixed Arabic/English
  } else {
    charsPerToken = 4.0; // English/other
  }
  
  // Add small buffer for tool calls, system messages, etc.
  return Math.ceil(totalChars / charsPerToken) + 2;
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

/**
 * Check if a message contains critical information that should never be summarised:
 * - Tool results (assistant messages with steps)
 * - Error messages
 * - Code blocks
 * - File paths/commands
 * - Explicit user preferences
 */
function isCriticalMessage(m: ChatMessage): boolean {
  const content = m.content;
  
  // Tool results (assistant messages with steps)
  if (m.role === 'assistant' && m.steps && m.steps.length > 0) return true;
  
  // Error messages
  if (content.includes('خطأ') || content.includes('Error') || content.includes('فشل') || content.includes('failed')) return true;
  
  // Code blocks
  if (content.includes('```')) return true;
  
  // File paths (common patterns)
  if (content.match(/(?:[~\/\.][\w\-\.\/]+|[A-Za-z]:\\[\w\\\-]+)/)) return true;
  
  // Commands — only lines starting with a command sigil or a bare command word
  if (content.match(/^(?:[\$\#>]\s*)?\w[\w\-]*(?:\s+[\w\-=\./]+)*$/m)) return true;
  
  // Explicit preferences/settings
  if (content.match(/(?:أفضّل|أريد|أحتاج|prefer|need|want|setting|إعداد)/i)) return true;
  
  return false;
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
  // Fold oldest messages until we are at ~45% of budget.
  // CRITICAL: Never summarise messages marked as critical (tool results, errors, code, etc.)
  // Always keep at least the last 4 messages.
  const target = budget * 0.45;
  const toSummarise: ChatMessage[] = [];
  const preserved: ChatMessage[] = [];
  while (live.length > 4 && cost(live) > target) {
    const candidate = live[0];
    if (isCriticalMessage(candidate)) {
      // Keep critical messages in the recent section instead of summarising
      preserved.push(candidate);
      live = live.slice(1);
      continue;
    }
    toSummarise.push(candidate);
    live = live.slice(1);
  }
  // Prepend preserved critical messages so they stay in the recent context
  const recent = [...preserved, ...live];
  used = cost(recent);
  return { recent, toSummarise, usedTokens: used, budgetTokens: budget };
}

const SUMMARY_PROMPT =
  'أنت تضغط محادثة طويلة لتكمل لاحقًا دون فقدان المعنى الحرج. اكتب ملخصًا مركّزًا بنفس لغة المحادثة يحفظ بدقة: ' +
  '\n1. الأهداف المعلنة والمهام المطلوبة من المستخدم' +
  '\n2. القرارات المتخذة والبدائل المرفوضة مع الأسباب' +
  '\n3. الحقائق والأرقام المحددة: تواريخ، أرقام إصدارات، مسارات ملفات، أسماء دوال/فئات، مفاتيح API (مخفية)، إعدادات، معرّفات' +
  '\n4. ما تم تنفيذه فعلاً (أدوات استُدعيت، نتائج، تغييرات تمت) وما لم يُنفّذ بعد' +
  '\n5. الأخطاء والقيود التقنية المكتشفة والحلول المطبقة' +
  '\n6. التفضيلات الصريحة للمستخدم (لغة، أسلوب، أدوات مفضلة، إعدادات)' +
  '\n7. المهام المعلقة والخطوات التالية المتفق عليها' +
  '\n8. مقتطفات الكود الحرجة (أسماء دوال، مسارات، أوامر) — لا تلخص الكود، انسخه كما هو إن كان قصيراً' +
  '\n\nقواعد صارمة:' +
  '\n- لا تضف معلومات لم ترد في المحادثة.' +
  '\n- لا تُجمّل أو تعيد صياغة بأسلوبك؛ انقل المصطلحات التقنية كما هي.' +
  '\n- إن ورد كود أو مخرجات أداة قصيرة (<200 حرف)، انسخها حرفياً.' +
  '\n- إن كان النص طويلاً، ركز على المعلومات الفريدة والقابلة للتنفيذ.' +
  '\n- احفظ أسماء الأشخاص، المشاريع، الخدمات، والموارد المذكورة.';

/**
 * Extract critical content that must be preserved verbatim:
 * - Code blocks (```...```)
 * - Inline code (`...`)
 * - Tool results (messages with steps)
 * - Error messages
 * - File paths, URLs, commands
 */
function extractCriticalContent(messages: ChatMessage[]): string[] {
  const critical: string[] = [];
  
  for (const m of messages) {
    const content = m.content;
    
    // Code blocks
    const codeBlocks = content.match(/```[\s\S]*?```/g);
    if (codeBlocks) critical.push(...codeBlocks);
    
    // Inline code
    const inlineCode = content.match(/`[^`\n]{1,100}`/g);
    if (inlineCode) critical.push(...inlineCode);
    
    // Tool results (assistant messages with steps)
    if (m.role === 'assistant' && m.steps && m.steps.length > 0) {
      for (const step of m.steps) {
        if (step.result && step.result.length > 0) {
          critical.push(`[أداة: ${step.tool}] ${step.result.slice(0, 500)}`);
        }
      }
    }
    
    // Error messages
    if (content.includes('خطأ') || content.includes('Error') || content.includes('فشل') || content.includes('failed')) {
      const errorLines = content.split('\n').filter(l => 
        l.includes('خطأ') || l.includes('Error') || l.includes('فشل') || l.includes('failed')
      );
      critical.push(...errorLines.slice(0, 3));
    }
    
    // File paths and URLs
    const paths = content.match(/(?:[~\/\.][\w\-\.\/]+|[A-Za-z]:\\[\w\\\-]+)/g);
    if (paths) critical.push(...paths.slice(0, 5));
    
    // Commands (lines starting with common command patterns)
    const commands = content.match(/^(?:[\$\#>]\s*)?\w+(?:\s+\S+)*$/gm);
    if (commands) critical.push(...commands.slice(0, 3));
  }
  
  // Deduplicate while preserving order
  return [...new Set(critical)];
}

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
  // Extract critical content to preserve verbatim
  const criticalContent = extractCriticalContent(messages);
  const criticalSection = criticalContent.length > 0
    ? `\n\n--- محتوى حرفي يجب الحفاظ عليه ---\n${criticalContent.join('\n')}\n--- نهاية المحتوى الحرفي ---\n`
    : '';

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'المستخدم' : 'المساعد'}: ${m.content}`)
    .join('\n\n');
  const prompt: ProviderChatMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    {
      role: 'user',
      content:
        (previousSummary ? `الملخص السابق:\n${previousSummary}\n\n` : '') +
        `رسائل جديدة تُدمج في الملخص:\n${transcript}` +
        criticalSection,
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
  // Accumulate critical content across all chunks to ensure nothing is lost
  const allCriticalContent: string[] = [];

  const flush = async () => {
    if (!chunk.length) return;
    // Extract critical content from this chunk before summarising
    allCriticalContent.push(...extractCriticalContent(chunk));
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
  
  // If we accumulated significant critical content, append it to the final summary
  if (allCriticalContent.length > 0) {
    const uniqueCritical = [...new Set(allCriticalContent)];
    const criticalSection = `\n\n--- محتوى حرفي محفوظ من المحادثة الكاملة ---\n${uniqueCritical.join('\n')}\n--- نهاية المحتوى الحرفي ---\n`;
    summary = summary.trim() + criticalSection;
  }
  
  return summary;
}
