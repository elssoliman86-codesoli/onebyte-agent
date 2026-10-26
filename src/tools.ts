import { Linking, Platform } from 'react-native';
import { fetch } from 'expo/fetch';
import * as Device from './device';
import type {
  AssistantMemory,
  AssistantSkill,
  ChatSession,
} from './assistant';

/** 'memory' tools run on-device and are always offered, even when device control is off. */
/** 'net' tools reach the public web from the user's device and always ask first. */
export type ToolGroup = 'local' | 'memory' | 'net' | 'device_read' | 'device_act';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  group: ToolGroup;
  /** Short Arabic label shown on the approval sheet. */
  label: string;
}

export interface ToolContext {
  skills: AssistantSkill[];
  memories: AssistantMemory[];
  sessions: ChatSession[];
  createMemory: (input: { title: string; content: string }) => Promise<void>;
  createTask: (input: { title: string; time: string; prompt: string }) => Promise<void>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_skill',
    group: 'local',
    label: 'قراءة مهارة',
    description: 'Load the full instructions of a saved skill by its exact name.',
    parameters: obj({ name: { type: 'string' } }, ['name']),
  },
  {
    name: 'search_history',
    group: 'local',
    label: 'بحث في المحادثات القديمة',
    description:
      'Keyword search across ALL saved chats (including parts already summarised). Use when the user refers to something said earlier.',
    parameters: obj({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'save_memory',
    group: 'memory',
    label: 'حفظ ذكرى',
    description: 'Save a durable fact about the user to local memory.',
    parameters: obj({ title: { type: 'string' }, content: { type: 'string' } }, ['title', 'content']),
  },
  {
    name: 'create_task',
    group: 'memory',
    label: 'إنشاء مهمة يومية',
    description:
      'Create a daily reminder task that opens its prompt in the chat. Use when the user says "اعمل/ضيف مهمة/تذكير ...". time is HH:MM 24h; default "18:00" when unspecified.',
    parameters: obj(
      { title: { type: 'string' }, time: { type: 'string' }, prompt: { type: 'string' } },
      ['title', 'prompt'],
    ),
  },
  {
    name: 'open_url',
    group: 'device_act',
    label: 'فتح رابط في المتصفح',
    description: 'Open a URL in Chrome (default) or the default browser on the phone.',
    parameters: obj(
      { url: { type: 'string' }, browser: { type: 'string', enum: ['chrome', 'default'] } },
      ['url'],
    ),
  },
  {
    name: 'list_apps',
    group: 'device_read',
    label: 'قراءة قائمة التطبيقات المثبتة',
    description: 'List launchable apps installed on the phone (label + package).',
    parameters: obj({}),
  },
  {
    name: 'open_app',
    group: 'device_act',
    label: 'فتح تطبيق',
    description: 'Launch an installed app by package name (preferred) or by its visible name.',
    parameters: obj({ package: { type: 'string' }, name: { type: 'string' } }),
  },
  {
    name: 'get_screen',
    group: 'device_read',
    label: 'قراءة محتوى الشاشة الحالية',
    description:
      'Return the current screen as a numbered list of UI elements (text, type, clickable/editable/scrollable). Always call this before tapping or typing, and again after every action. Password fields are redacted.',
    parameters: obj({}),
  },
  {
    name: 'tap',
    group: 'device_act',
    label: 'ضغط على عنصر',
    description: 'Tap the element with the given index from the latest get_screen result.',
    parameters: obj({ index: { type: 'integer' } }, ['index']),
  },
  {
    name: 'type_text',
    group: 'device_act',
    label: 'كتابة نص في حقل',
    description: 'Type text into the editable element with the given index. Refuses password fields.',
    parameters: obj({ index: { type: 'integer' }, text: { type: 'string' } }, ['index', 'text']),
  },
  {
    name: 'scroll',
    group: 'device_act',
    label: 'تمرير الشاشة',
    description: 'Scroll the main scrollable area.',
    parameters: obj({ direction: { type: 'string', enum: ['down', 'up'] } }, ['direction']),
  },
  {
    name: 'press',
    group: 'device_act',
    label: 'زر نظام',
    description: 'Press a system key.',
    parameters: obj({ key: { type: 'string', enum: ['back', 'home', 'recents', 'notifications'] } }, ['key']),
  },
  {
    name: 'wait',
    group: 'local',
    label: 'انتظار',
    description: 'Wait up to 5000 ms for the screen to settle (e.g. after opening an app).',
    parameters: obj({ ms: { type: 'integer' } }, ['ms']),
  },
  {
    name: 'web_search',
    group: 'net',
    label: 'بحث في الويب',
    description:
      'Search the public web (DuckDuckGo) and return the top results with titles, URLs and snippets. Use for current information.',
    parameters: obj({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'web_fetch',
    group: 'net',
    label: 'قراءة رابط ويب',
    description:
      'Download a web page and return its readable text (HTML stripped). Use after web_search to read a specific result.',
    parameters: obj({ url: { type: 'string' } }, ['url']),
  },
];

export function toolsForRequest(deviceEnabled: boolean): ToolSpec[] {
  return TOOL_SPECS.filter(
    (t) =>
      deviceEnabled || t.group === 'local' || t.group === 'memory' || t.group === 'net',
  );
}

export function toOpenAITools(specs: ToolSpec[]) {
  return specs.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function needsApproval(spec: ToolSpec): boolean {
  return spec.group === 'device_read' || spec.group === 'device_act' || spec.group === 'net';
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`الوسيط ${key} مطلوب.`);
  return v;
}

function int(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`الوسيط ${key} يجب أن يكون رقمًا صحيحًا.`);
  return v;
}

function safeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('الرابط غير صالح.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('مسموح فقط بروابط http/https.');
  }
  return url.toString();
}

const MAX_WEB_TEXT = 6000;
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** DDG wraps result URLs in a redirect; unwrap the real target. */
function unwrapDdgLink(href: string): string {
  if (href.startsWith('//')) href = 'https:' + href;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function parseDdgHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let s: RegExpExecArray | null;
  while ((s = snippetRe.exec(html)) !== null) {
    snippets.push(decodeEntities(s[1].replace(/<[^>]+>/g, '')).trim());
  }
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null) {
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (title) {
      hits.push({ title, url: unwrapDdgLink(m[1]), snippet: snippets[i] ?? '' });
    }
    i += 1;
    if (hits.length >= 6) break;
  }
  return hits;
}

function parseDdgLite(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (title) hits.push({ title, url: unwrapDdgLink(m[1]), snippet: '' });
    if (hits.length >= 6) break;
  }
  return hits;
}

async function webSearch(query: string): Promise<string> {
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  let lastError = '';
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: BROWSER_HEADERS });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const html = await response.text();
      const hits = endpoint.includes('lite') ? parseDdgLite(html) : parseDdgHtml(html);
      if (hits.length) {
        return hits
          .map((h, idx) => `[${idx + 1}] ${h.title}\n${h.url}${h.snippet ? `\n${h.snippet.slice(0, 220)}` : ''}`)
          .join('\n\n');
      }
      lastError = 'لا نتائج';
    } catch {
      lastError = 'فشل الطلب (قيود شبكة أو CORS في نسخة الويب — جرّب داخل التطبيق المثبت)';
    }
  }
  return `تعذّر البحث: ${lastError}`;
}

async function webFetch(rawUrl: string): Promise<string> {
  const url = safeUrl(rawUrl);
  try {
    const response = await fetch(url, { headers: BROWSER_HEADERS });
    if (!response.ok) return `تعذّر جلب الصفحة (HTTP ${response.status}).`;
    const html = await response.text();
    const text = htmlToText(html);
    if (!text) return 'الصفحة ليس بها نص قابل للقراءة.';
    return text.length > MAX_WEB_TEXT
      ? `${text.slice(0, MAX_WEB_TEXT)}\n…(مقتطع)`
      : text;
  } catch {
    return 'فشل جلب الرابط (قيود شبكة أو CORS في نسخة الويب — جرّب داخل التطبيق المثبت).';
  }
}

export function searchHistory(sessions: ChatSession[], query: string, limit = 8): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 'لا توجد كلمات بحث.';
  const hits: { score: number; text: string }[] = [];
  for (const s of sessions) {
    for (const m of s.messages) {
      const lower = m.content.toLowerCase();
      const score = terms.filter((t) => lower.includes(t)).length;
      if (!score) continue;
      const at = Math.max(0, lower.indexOf(terms.find((t) => lower.includes(t))!) - 120);
      hits.push({
        score,
        text: `[${s.title} · ${m.createdAt.slice(0, 10)} · ${m.role}] ${m.content.slice(at, at + 400)}`,
      });
    }
  }
  if (!hits.length) return 'لا نتائج.';
  return hits.sort((a, b) => b.score - a.score).slice(0, limit).map((h) => h.text).join('\n---\n');
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    case 'read_skill': {
      const wanted = str(args, 'name').trim().toLowerCase();
      const skill = ctx.skills.find((s) => s.active && s.name.trim().toLowerCase() === wanted);
      if (!skill) return `لا توجد مهارة نشطة بهذا الاسم. المتاح: ${ctx.skills.filter((s) => s.active).map((s) => s.name).join('، ') || 'لا شيء'}`;
      return `${skill.name}\n${skill.description}\n\n${skill.instructions}`;
    }
    case 'search_history':
      return searchHistory(ctx.sessions, str(args, 'query'));
    case 'save_memory':
      await ctx.createMemory({ title: str(args, 'title'), content: str(args, 'content') });
      return 'تم حفظ الذكرى.';
    case 'create_task': {
      const timeRaw = typeof args.time === 'string' ? args.time.trim() : '';
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : '18:00';
      await ctx.createTask({
        title: str(args, 'title'),
        time,
        prompt: str(args, 'prompt'),
      });
      return `تمت إضافة المهمة اليومية "${str(args, 'title')}" عند ${time}. افتحيها من تبويب المهام.`;
    }
    case 'wait': {
      // ms is optional in the schema; models frequently omit it.
      const ms =
        args.ms === undefined
          ? 1500
          : Math.min(5000, Math.max(0, int(args, 'ms')));
      await new Promise((r) => setTimeout(r, ms));
      return `انتظرت ${ms}ms.`;
    }
    case 'open_url': {
      const url = safeUrl(str(args, 'url'));
      if (Platform.OS === 'android' && args.browser !== 'default' && Device.isAvailable()) {
        const ok = await Device.openUrl(url, 'com.android.chrome');
        if (ok) return `فُتح الرابط في Chrome: ${url}`;
      }
      await Linking.openURL(url);
      return `فُتح الرابط في المتصفح الافتراضي: ${url}`;
    }
    case 'web_search':
      return await webSearch(str(args, 'query'));
    case 'web_fetch':
      return await webFetch(str(args, 'url'));
    default:
      break;
  }

  // Everything below needs the native Android module.
  if (!Device.isAvailable()) {
    throw new Error('التحكم في الجهاز يعمل فقط في نسخة Android المثبتة (وليس Expo Go أو الويب).');
  }
  switch (name) {
    case 'list_apps':
      return JSON.stringify(await Device.listApps());
    case 'open_app': {
      let pkg = typeof args.package === 'string' ? args.package.trim() : '';
      if (!pkg && typeof args.name !== 'string') {
        throw new Error('حدد التطبيق المطلوب باسمه أو باسم الحزمة.');
      }
      if (!pkg) {
        const wanted = str(args, 'name').trim().toLowerCase();
        const apps = await Device.listApps();
        const match =
          apps.find((a) => a.label.toLowerCase() === wanted) ??
          apps.find((a) => a.label.toLowerCase().includes(wanted));
        if (!match) throw new Error(`لم أجد تطبيقًا باسم "${wanted}".`);
        pkg = match.package;
      }
      const ok = await Device.launchApp(pkg);
      if (!ok) throw new Error(`تعذّر فتح ${pkg}.`);
      // launchApp only confirms the intent was sent, not that the app is on screen.
      return `أُرسل أمر فتح ${pkg}. تأكد بـ get_screen قبل الخطوة التالية.`;
    }
    case 'get_screen':
      Device.assertServiceEnabled();
      return await Device.getScreen();
    case 'tap':
      Device.assertServiceEnabled();
      return await Device.tap(int(args, 'index'));
    case 'type_text':
      Device.assertServiceEnabled();
      return await Device.typeText(int(args, 'index'), str(args, 'text'));
    case 'scroll':
      Device.assertServiceEnabled();
      return await Device.scroll(args.direction === 'up' ? 'up' : 'down');
    case 'press': {
      Device.assertServiceEnabled();
      const key = str(args, 'key');
      if (!['back', 'home', 'recents', 'notifications'].includes(key)) throw new Error('زر غير معروف.');
      return await Device.press(key as 'back' | 'home' | 'recents' | 'notifications');
    }
    default:
      throw new Error(`أداة غير معروفة: ${name}`);
  }
}

/** Human-readable one-liner of what a call will do, for the approval sheet. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  const bits = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return bits.length ? bits.join('\n') : '—';
}
