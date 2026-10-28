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
  /** Number of leading messages moved into the summary/preserved prefix. */
  processedCount: number;
  /** IDs of critical messages in that prefix that must remain in recent context. */
  preservedMessageIds: string[];
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

  // Image payloads cannot be reconstructed by the text summariser.
  if (m.imageUri || m.images?.length) return true;
  
  // Tool results (assistant messages with steps)
  if (m.role === 'assistant' && m.steps && m.steps.length > 0) return true;
  
  // Error messages
  if (content.includes('خطأ') || content.includes('Error') || content.includes('فشل') || content.includes('failed')) return true;
  
  // Code blocks
  if (content.includes('```')) return true;
  
  // File paths (common patterns)
  if (content.match(/(?:[~\/\.][\w\-\.\/]+|[A-Za-z]:\\[\w\\\-]+)/)) return true;
  
  // Commands — use shell prompts or known CLI names so ordinary sentences do not match.
  const commandLine = /^(?:\$\s+|PS\s+[A-Z]:\\.*>\s+)\S+/im;
  const knownCommand = /^(?:npm|npx|pnpm|yarn|bun|node|python(?:3)?|pip|git|eas|expo|adb|gradle|gradlew|curl|wget|powershell|pwsh|dotnet|cargo|go|make|Get-ChildItem|Get-Content|Set-Content|Write-Output|Test-Path|Invoke-WebRequest|Copy-Item|Remove-Item)(?:\s|$)/im;
  if (commandLine.test(content) || content.split('\n').some((line) => knownCommand.test(line.trim()))) return true;
  
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
  const all = [...(session?.messages ?? []), ...extra].filter(
    (m) => m.content.trim() || m.imageUri || m.images?.length,
  );
  const skip = Math.min(session?.summarizedCount ?? 0, all.length);
  let live = all.slice(skip);
  const previouslyPreserved = new Set(session?.contextPreservedMessageIds ?? []);
  const preservedPrefix = all.slice(0, skip).filter((message) => previouslyPreserved.has(message.id));
  const summaryTokens = estimateTokens(session?.summary ?? '');
  const messageCost = (message: ChatMessage) => {
    const imageCount = message.images?.length ?? (message.imageUri ? 1 : 0);
    return estimateTokens(message.content) + 6 + imageCount * 1_000;
  };
  const cost = (msgs: ChatMessage[]) =>
    systemTokens + summaryTokens + msgs.reduce((n, m) => n + messageCost(m), 0);

  let used = cost([...preservedPrefix, ...live]);
  if (used <= budget) {
    return {
      recent: [...preservedPrefix, ...live],
      toSummarise: [],
      processedCount: 0,
      preservedMessageIds: preservedPrefix.map((message) => message.id),
      usedTokens: used,
      budgetTokens: budget,
    };
  }
  // Fold oldest messages until we are at ~45% of budget.
  // Keep the last four messages live. Critical messages are also retained
  // verbatim in the current context and copied into the protected summary.
  const target = budget * 0.45;
  const toSummarise: ChatMessage[] = [];
  const preserved = [...preservedPrefix];
  let processedCount = 0;
  while (live.length > 4 && cost([...preserved, ...live]) > target) {
    const candidate = live[0];
    if (isCriticalMessage(candidate)) {
      preserved.push(candidate);
    }
    // Every removed message is recorded, so the cursor advances over one
    // contiguous prefix instead of drifting across skipped critical messages.
    toSummarise.push(candidate);
    processedCount += 1;
    live = live.slice(1);
  }
  const recent = [...preserved, ...live];
  used = cost(recent);
  return {
    recent,
    toSummarise,
    processedCount,
    preservedMessageIds: [...new Set(preserved.map((message) => message.id))],
    usedTokens: used,
    budgetTokens: budget,
  };
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

    if (m.imageUri || m.images?.length) {
      const count = m.images?.length ?? 1;
      critical.push('[مرفق ' + count + ' صورة في الرسالة ' + m.id + '; الصورة الأصلية محفوظة في السياق.]');
    }
    
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
    
    // Capture only explicit shell prompts or recognized command names.
    const commands = content.split('\n').filter((line) => {
      const trimmed = line.trim();
      return /^(?:\$\s+|PS\s+[A-Z]:\\.*>\s+)\S+/i.test(trimmed) ||
        /^(?:npm|npx|pnpm|yarn|bun|node|python(?:3)?|pip|git|eas|expo|adb|gradle|gradlew|curl|wget|powershell|pwsh|dotnet|cargo|go|make|Get-ChildItem|Get-Content|Set-Content|Write-Output|Test-Path|Invoke-WebRequest|Copy-Item|Remove-Item)(?:\s|$)/i.test(trimmed);
    });
    critical.push(...commands.slice(0, 3));
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
  preserveVerbatim = true,
}: {
  settings: ProviderSettings;
  apiKey: string;
  previousSummary: string;
  messages: ChatMessage[];
  chunkTokens: number;
  signal?: AbortSignal;
  /** Keep the verbatim appendix for durable history compaction. */
  preserveVerbatim?: boolean;
}): Promise<string> {
  let summary = previousSummary;
  let chunk: ChatMessage[] = [];
  let size = 0;
  // Accumulate critical content across all chunks to ensure nothing is lost
  const allCriticalContent: string[] = [];

  const flush = async () => {
    if (!chunk.length) return;
    // Extract critical content before summarising. Large one-off prompts can
    // skip the final verbatim appendix to keep the model input compact.
    if (preserveVerbatim) allCriticalContent.push(...extractCriticalContent(chunk));
    summary = await summarise({ settings, apiKey, previousSummary: summary, messages: chunk, signal });
    chunk = [];
    size = 0;
  };
  
  for (const message of messages) {
    // Never truncate a large message during compaction: split it into ordered,
    // explicitly labelled pieces so every original character reaches the summary.
    const maxChars = Math.max(1_200, chunkTokens * 3);
    const parts: string[] = [];
    let offset = 0;
    while (offset < message.content.length) {
      let end = Math.min(offset + maxChars, message.content.length);
      if (end < message.content.length) {
        const boundary = Math.max(
          message.content.lastIndexOf("\n", end),
          message.content.lastIndexOf(" ", end),
        );
        if (boundary > offset + Math.floor(maxChars * 0.65)) end = boundary;
      }
      parts.push(message.content.slice(offset, end));
      offset = end;
    }
    if (!parts.length) parts.push(message.content);

    for (let index = 0; index < parts.length; index += 1) {
      const content = parts.length > 1
        ? `[رسالة واحدة طويلة — الجزء ${index + 1} من ${parts.length}; تابع الأجزاء بالترتيب دون إسقاط التفاصيل.]\n${parts[index]}`
        : parts[index];
      const t = estimateTokens(content);
      if (size + t > chunkTokens) await flush();
      chunk.push({
        ...message,
        id: parts.length > 1 ? `${message.id}-part-${index + 1}` : message.id,
        content,
        // Keep any non-text payload only on the first summary piece.
        imageUri: index === 0 ? message.imageUri : undefined,
        images: index === 0 ? message.images : undefined,
      });
      size += t;
    }
  }
  await flush();
  
  // If we accumulated significant critical content, append it to the final summary
  if (preserveVerbatim && allCriticalContent.length > 0) {
    const uniqueCritical = [...new Set(allCriticalContent)];
    const criticalSection = `\n\n--- محتوى حرفي محفوظ من المحادثة الكاملة ---\n${uniqueCritical.join('\n')}\n--- نهاية المحتوى الحرفي ---\n`;
    summary = summary.trim() + criticalSection;
  }
  
  return summary;
}
