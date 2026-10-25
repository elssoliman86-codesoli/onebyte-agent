import { Linking, Platform } from 'react-native';
import * as Device from './device';
import type {
  AssistantMemory,
  AssistantSkill,
  ChatSession,
} from './assistant';

/** 'memory' tools run on-device and are always offered, even when device control is off. */
export type ToolGroup = 'local' | 'memory' | 'device_read' | 'device_act';

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
];

export function toolsForRequest(deviceEnabled: boolean): ToolSpec[] {
  return TOOL_SPECS.filter(
    (t) => deviceEnabled || t.group === 'local' || t.group === 'memory',
  );
}

export function toOpenAITools(specs: ToolSpec[]) {
  return specs.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function needsApproval(spec: ToolSpec): boolean {
  return spec.group === 'device_read' || spec.group === 'device_act';
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
