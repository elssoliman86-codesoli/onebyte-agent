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

export const KNOWLEDGE_MAX_ENTRIES = 200;

export interface ExtractedFact {
  text: string;
  kind: KnowledgeKind;
}

// Sentence-level patterns for Arabic and English. Deliberately conservative:
// only clear, reusable, first-person facts — never questions or requests.
const PATTERNS: { kind: KnowledgeKind; re: RegExp }[] = [
  {
    kind: 'device',
    re: /[^.؟!\n]{0,60}(?:جهاز(?:ي|يّ)|هاتفي|لابتوبي|لاب توب|كمبيوتري|بي سي|جهازى|my (?:phone|pc|laptop|computer|device)|i(?:'| a)?(?:m|')? (?:on|using) (?:windows|android|ios|linux|mac))[^.؟!\n]{0,60}/giu,
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

const NOISE = /(شكرا|شكرًا|thank|please|أرجوك|لو سمحت|ايه رأيك|ماذا|إيه|كيف|ليه|ازاي|؟|\?)/iu;

function cleanFact(raw: string): string {
  return raw
    .replace(/[\n]+/g, ' ')
    .replace(/[.،,]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Capture durable first-person facts from a user message (local, instant). */
export function extractFacts(userText: string): ExtractedFact[] {
  if (!userText || userText.length < 12) return [];
  if (userText.startsWith('/')) return []; // slash commands are not conversation
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(userText)) !== null) {
      const fact = cleanFact(match[0]);
      if (fact.length < 8 || fact.length > 160) continue;
      if (NOISE.test(fact)) continue;
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
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
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
  limit = 3,
): KnowledgeEntry[] {
  if (!entries.length || !currentText) return [];
  const words = new Set(normalizeForMatch(currentText));
  if (!words.size) return [];
  const scored = entries
    .map((entry) => {
      const tokens = normalizeForMatch(entry.text);
      const hits = tokens.filter((t) => words.has(t)).length;
      // Bonus for strong signal: most of the entry's words appear now.
      const ratio = tokens.length ? hits / tokens.length : 0;
      const score = hits + (ratio >= 0.6 ? 1.5 : 0) + Math.min(entry.hits, 5) * 0.1;
      return { entry, score, hits };
    })
    .filter((s) => s.hits >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((s) => s.entry);
}

/** Format retrieved facts as an invisible-to-eye context block for the model. */
export function knowledgeContextBlock(entries: KnowledgeEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.map((e) => `- (${e.kind === 'device' ? 'جهاز' : e.kind === 'preference' ? 'تفضيل' : e.kind === 'identity' ? 'عن المستخدم' : e.kind === 'project' ? 'مشروع' : 'سياق'}) ${e.text}`);
  return '[سياق محفوظ من محادثاتك السابقة مع هذا المستخدم — استخدمه فقط إذا يفيد الرد الحالي]\n' + lines.join('\n');
}

export function isNativePlatform(): boolean {
  return Platform.OS !== 'web';
}
