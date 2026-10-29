import { Platform } from 'react-native';

/**
 * The automatic per-user knowledge base ("مستودع المعلومات").
 *
 * Background-only: after each exchange, small durable facts the user reveals
 * (their device, preferences, projects, identity) are captured locally and
 * later retrieved to enrich relevant replies — e.g. when the user says
 * "اللعبة دي هتشتغل على جهازي" and mentioned their device weeks ago, that
 * fact comes back into context. Nothing is shown in the chat itself.
 */

export type KnowledgeKind = 'device' | 'preference' | 'identity' | 'project' | 'context';

export interface KnowledgeEntry {
  id: string;
  text: string;
  kind: KnowledgeKind;
  /** How many times this fact resurfaced. */
  hits: number;
  createdAt: string;
  updatedAt: string;
  /** Session the fact was first heard in (traceability, not displayed in chat). */
  sessionId?: string;
}

export const KNOWLEDGE_MAX_ENTRIES = 80;

export interface ExtractedFact {
  text: string;
  kind: KnowledgeKind;
}

// Sentence-level patterns for Arabic and English. Deliberately conservative:
// only clear, reusable, first-person facts — never questions or requests.
const PATTERNS: { kind: KnowledgeKind; re: RegExp }[] = [
  {
    kind: 'device',
    re: /[^.؟!\n]{0,90}(?:مواصفات جهازي|اللابتوب بتاعي|اللاب بتاعي|جهازي|جهازى|هاتفي|لابتوبي|لاب توب|كمبيوتري|بي سي|عندي لابتوب|عندي جهاز|my (?:phone|pc|laptop|computer|device)|i(?:'| a)?(?:m|')? (?:on|using) (?:windows|android|ios|linux|mac))[^.؟!\n]{0,100}/giu,
  },
  {
    kind: 'device',
    re: /[^.؟!\n]{0,70}(?:جهازي|جهازى|لابتوبي|اللابتوب بتاعي|اللاب بتاعي|my (?:laptop|pc|computer|device))[^.؟!\n]{0,150}(?:Lenovo|Legion|LOQ|RTX|GeForce|GTX|Core i[3579]|Ryzen|RAM|VRAM|جيجا رام|ذاكرة|كارت الشاشة|كرت الشاشة|معالج|GPU|CPU|graphics card|laptop|computer)[^.؟!\n]{0,80}/giu,
  },
  {
    kind: 'device',
    re: /[^.؟!\n]{0,50}\b(?:ويندوز|ويندوز \d+|windows(?: \d+| 11| 10)?|لينكس|ubuntu|ماك|macos|أندرويد|اندرويد|android(?: \d+)?|ايفون|آيفون|iphone|سامسونج|جالكسي|galaxy|شاومي|redmi)[^.؟!\n]{0,50}/giu,
  },
  {
    kind: 'preference',
    re: /[^.؟!\n]{0,50}(?:أحب|بحب|أفضل|بفضل|أستخدم|بستخدم|أكره|أفضّل|أنا معجب|I (?:like|love|prefer|hate|use|always))[^.؟!\n]{0,70}/giu,
  },
  {
    kind: 'identity',
    re: /[^.؟!\n]{0,40}(?:اسمي|أنا شغال|أنا مطور|أنا مهندس|أنا مبرمج|أنا طالب|أنا مصمم|أنا طبيب|أنا معلم|my name is|i(?:'| a)?m a[n]? (?:developer|student|engineer|designer|doctor|teacher))[^.؟!\n]{0,60}/giu,
  },
  {
    kind: 'project',
    re: /[^.؟!\n]{0,50}(?:مشروعي|المشروع بتاعي|مشروعي اسمه|بتطوير|بشتغل على|I(?:'| a)?m (?:building|working on)|my project)[^.؟!\n]{0,70}/giu,
  },
];

const NOISE = /(شكرا|شكرًا|thank|please|أرجوك|لو سمحت|ايه رأيك|ماذا|إيه|كيف|ليه|ازاي|؟|\?|\b(?:open|show|tell|find|look|check|can you|could you|please|help me|what is|how to)\b|(?:اعرف|قولي|قول|شوف|افتح|ابحث|هات|هل|ازاي|إزاي|ليه|فين|امتى|ممكن|عايز|عاوز|عاوزك|محتاج|خليني|ساعدني|وريني|جرب|اختبر|حل|عدل|نفذ|نفّذ|تقدر|يشتغل|تشتغل|ينفع|متاح|سعر|كام|ايه|إيه))/iu;

function cleanFact(raw: string): string {
  return raw
    .replace(/[\n]+/g, ' ')
    .replace(/[.،,]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Capture durable first-person facts from a user message (local, instant). */
export function extractFacts(userText: string): ExtractedFact[] {
  if (!userText || userText.length < 12 || userText.length > 700 || /```|https?:\/\/|\b(?:commit|branch|repository|github|error|stack trace|npm|expo)\b/i.test(userText)) return [];
  if (userText.startsWith('/')) return []; // slash commands are not conversation
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(userText)) !== null) {
      const fact = cleanFact(match[0]);
      if (fact.length < 8 || fact.length > 120) continue;
      NOISE.lastIndex = 0;
      if (NOISE.test(fact)) continue;
      // Store only statements that look like durable personal facts, not random page text or requests.
      if (!/^(?:أنا|اسمي|عندي|جهازي|جهازى|اللابتوب بتاعي|اللاب بتاعي|لابتوبي|بحب|أحب|افضل|أفضل|بفضل|بستخدم|أستخدم|أكره|مشروعي|المشروع بتاعي|بشتغل على|انا شغال|انا طالب|my name is|i am|i'm|my laptop|my pc|my computer|i prefer|i like|i use|my project)/iu.test(fact.trim())) continue;
      const key = kind + '::' + fact.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: fact, kind });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

function normalizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[^\\p{L}\\p{N}\\s]/gu, ' ')
    .split(/\\s+/)
    .filter((w) => w.length >= 2);
}

/** Merge new facts into the store: duplicates bump `hits`, new ones are prepended. */
export function mergeFacts(
  existing: KnowledgeEntry[],
  facts: ExtractedFact[],
  sessionId?: string,
): KnowledgeEntry[] {
  if (!facts.length) return existing;
  const nowIso = new Date().toISOString();
  const next = [...existing];
  for (const fact of facts) {
    const key = fact.text.toLowerCase();
    const dupIndex = next.findIndex((e) => e.text.toLowerCase() === key);
    if (dupIndex !== -1) {
      next[dupIndex] = {
        ...next[dupIndex],
        hits: next[dupIndex].hits + 1,
        updatedAt: nowIso,
      };
      // Move recently reaffirmed facts to the front.
      const [entry] = next.splice(dupIndex, 1);
      next.unshift(entry);
      continue;
    }
    next.unshift({
      id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: fact.text,
      kind: fact.kind,
      hits: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      sessionId,
    });
  }
  return next.slice(0, KNOWLEDGE_MAX_ENTRIES);
}

/**
 * Score stored facts against the current message and return the most helpful
 * ones — token-overlap ranking, local and instant (no model call, no delay).
 */
export function retrieveKnowledge(
  entries: KnowledgeEntry[],
  currentText: string,
  limit = 8,
): KnowledgeEntry[] {
  if (!entries.length || !currentText.trim()) return [];
  const normalizedQuery = currentText.toLowerCase();
  const words = new Set(normalizeForMatch(currentText));
  if (!words.size) return [];

  const asksDeviceOrCompatibility =
    /(?:لعبه|لعبة|العاب|ألعاب|game|gaming|تشتغل|تشغل|تشغيل|هتشتغل|تعمل على|يشتغل|fps|فريم|اداء|أداء|متطلبات|requirements|مواصفات|حراره|حرارة|كرت|كارت|gpu|cpu|ram|vram|معالج|جرافيك|graphics|performance|compatible|compatibility|على جهازي|على اللابتوب)/iu.test(normalizedQuery);
  const asksForProfile =
    /(?:فاكرني|تعرف عني|معلوماتي|بياناتي|ملفي الشخصي|عن نفسي|what do you know about me|my profile|my details|ماذا تعرف عني)/iu.test(normalizedQuery);
  const asksPreferences =
    /(?:بحب|احب|افضل|تفضيلاتي|ذوقي|يفضل|recommend|recommendation|ترشيح|ترشح|انصحني|أنصحني)/iu.test(normalizedQuery);
  const asksProjects =
    /(?:مشروعي|المشروع بتاعي|مشاريعي|المشاريع|project|repository|repo|الكود بتاعي)/iu.test(normalizedQuery);

  const newestFirst = (a: KnowledgeEntry, b: KnowledgeEntry) =>
    Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt);
  const scored = entries.map((entry) => {
    const tokens = normalizeForMatch(entry.text);
    const hits = tokens.filter((token) => words.has(token)).length;
    const ratio = tokens.length ? hits / tokens.length : 0;
    const score = hits + (ratio >= 0.6 ? 1.5 : 0) + Math.min(entry.hits, 5) * 0.1;
    return { entry, score, hits };
  });
  const result: KnowledgeEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: KnowledgeEntry) => {
    if (seen.has(entry.id) || result.length >= limit) return;
    seen.add(entry.id);
    result.push(entry);
  };

  // Compatibility questions need saved hardware even when the game name
  // shares no words with the hardware description.
  if (asksDeviceOrCompatibility) {
    entries.filter((entry) => entry.kind === 'device').sort(newestFirst).forEach(add);
  }
  // Profile questions get a balanced recent snapshot rather than only exact
  // word matches.
  if (asksForProfile) {
    (['identity', 'device', 'preference', 'project', 'context'] as KnowledgeKind[])
      .forEach((kind) => entries.filter((entry) => entry.kind === kind).sort(newestFirst).slice(0, 2).forEach(add));
  }
  if (asksPreferences) {
    entries.filter((entry) => entry.kind === 'preference').sort(newestFirst).slice(0, 3).forEach(add);
  }
  if (asksProjects) {
    entries.filter((entry) => entry.kind === 'project').sort(newestFirst).slice(0, 4).forEach(add);
  }
  scored
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.score - a.score || newestFirst(a.entry, b.entry))
    .forEach((item) => add(item.entry));
  return result;
}

/** Format retrieved facts as an invisible-to-eye context block for the model. */
export function knowledgeContextBlock(entries: KnowledgeEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.slice(0, 5).map((e) => `- (${e.kind === 'device' ? 'جهاز' : e.kind === 'preference' ? 'تفضيل' : e.kind === 'identity' ? 'عن المستخدم' : e.kind === 'project' ? 'مشروع' : 'سياق'}) ${e.text}`);
  return '[معلومات شخصية محفوظة؛ استخدم فقط ما يرتبط مباشرة بالطلب ولا تعرض معلومات غير ذات صلة. إذا كانت المعلومة غير مؤكدة أو متناقضة، اسأل سؤال تأكيد واحدًا.]\n' + lines.join('\n');
}

export function isNativePlatform(): boolean {
  return Platform.OS !== 'web';
}
