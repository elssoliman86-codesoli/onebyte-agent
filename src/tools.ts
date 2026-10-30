import { Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import { getEmbeddedBrowser, waitForEmbeddedBrowser } from './embedded-browser';
import { isAuthorized, loadTargets } from './hunter';
import { runHunterRegistryTool } from './hunter-tools';
import { fetchWithRetry } from './fetch-with-retry';
import * as Device from './device';
import { createFile, getDefaultBranch, getRepoTree, listRepos, loadGithubToken, readFileSnapshot, verifyGithubToken, writeFile } from './github';
import { loadConnections, sendTelegramMessage } from './marketing';
import type {
  AssistantMemory,
  AssistantSkill,
  ChatSession,
} from './assistant';

/** 'memory' tools run on-device and are always offered, even when device control is off. */
/** 'net' tools are read-only public web requests, used only when the user asks. */
export type ToolGroup = 'local' | 'memory' | 'net' | 'browser' | 'device_read' | 'device_act';

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
  createTask: (input: { title: string; time: string; prompt: string }) => Promise<string | void>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'telegram_send_message',
    group: 'local',
    label: 'إرسال رسالة تيليجرام',
    description: 'Send a text message to the Telegram chat/channel configured in OneByte Marketing connections using the official Telegram Bot API. Use only when the user explicitly asks to send or publish. Never claim success unless the API confirms it. If no bot/chat is configured, ask the user to configure it in Marketing connections.',
    parameters: obj({ text: { type: 'string' } }, ['text']),
  },
  {
    name: 'github_list_repositories',
    group: 'local',
    label: 'عرض مستودعات GitHub',
    description: 'List repositories accessible to the connected GitHub account. Use when the user asks to show/list their repos. Never claim the account is connected until token verification succeeds.',
    parameters: obj({ query: { type: 'string', description: 'Optional case-insensitive name/description filter.' } }),
  },
  {
    name: 'github_list_files',
    group: 'local',
    label: 'عرض ملفات مستودع GitHub',
    description: 'List tracked files in a GitHub repository. The user must have access to the repository. Use repository full_name and optional branch.',
    parameters: obj({ repository: { type: 'string' }, branch: { type: 'string' } }, ['repository']),
  },
  {
    name: 'github_read_file',
    group: 'local',
    label: 'قراءة ملف GitHub',
    description: 'Read a text file from a GitHub repository before discussing or editing it. Returns content, branch and a revision SHA. Files are limited to 250KB.',
    parameters: obj({ repository: { type: 'string' }, path: { type: 'string' }, branch: { type: 'string' } }, ['repository', 'path']),
  },
  {
    name: 'github_update_file',
    group: 'local',
    label: 'تعديل ملف GitHub',
    description: 'Replace the complete contents of an existing text file and create a GitHub commit. Read the file first, preserve unrelated code, pass the exact current SHA as expected_sha, and use a concise commit message. Report the actual commit URL returned.',
    parameters: obj({ repository: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' }, branch: { type: 'string' }, expected_sha: { type: 'string' } }, ['repository', 'path', 'content', 'message', 'expected_sha']),
  },
  {
    name: 'github_create_file',
    group: 'local',
    label: 'إنشاء ملف GitHub',
    description: 'Create a new text file in a repository and commit it. Never overwrite existing files; if the path exists, read it and use github_update_file.',
    parameters: obj({ repository: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' }, branch: { type: 'string' } }, ['repository', 'path', 'content', 'message']),
  },

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
    group: 'browser',
    label: 'فتح رابط في المتصفح المدمج',
    description: 'Open a URL inside the OneByte embedded WebView so the assistant can read and interact with the page. Never launch Chrome, Edge, or the external device browser for an agent task.',
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
    name: 'browser_navigate',
    group: 'browser',
    label: 'فتح المتصفح المدمج',
    description: 'Open the URL in OneByte embedded WebView for an authorized, in-scope security test. Requires a target saved in Cybersecurity Lab. Never use an arbitrary host or leave the saved scope.',
    parameters: obj({ url: { type: 'string' } }, ['url']),
  },
  {
    name: 'browser_read_page',
    group: 'browser',
    label: 'قراءة صفحة المتصفح',
    description: 'Read the current embedded browser page: title, visible text and indexed interactive elements. Call after navigation and after every click or scroll.',
    parameters: obj({}),
  },
  {
    name: 'browser_click',
    group: 'browser',
    label: 'التفاعل مع صفحة المتصفح',
    description: 'Click a numbered element from the latest browser_read_page result. Never submit destructive actions, payments, account changes, or forms that change real data.',
    parameters: obj({ index: { type: 'integer' } }, ['index']),
  },
  {
    name: 'browser_type_text',
    group: 'browser',
    label: 'الكتابة في صفحة المتصفح',
    description: 'Enter a test string into a numbered field from the latest browser_read_page result. Password fields are blocked. Do not enter real credentials or secrets.',
    parameters: obj({ index: { type: 'integer' }, text: { type: 'string' } }, ['index', 'text']),
  },
  {
    name: 'browser_scroll',
    group: 'browser',
    label: 'تمرير صفحة المتصفح',
    description: 'Scroll the current embedded browser page up or down, then read it again.',
    parameters: obj({ direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']),
  },
  {
    name: 'browser_wait',
    group: 'browser',
    label: 'انتظار تحميل الصفحة',
    description: 'Wait a short time (up to 5 seconds) for the current page to settle, then read it again.',
    parameters: obj({ ms: { type: 'integer' } }),
  },
  {
    name: 'browser_list_requests',
    group: 'browser',
    label: 'عرض طلبات الشبكة الملتقطة',
    description: 'Return the last captured fetch/XHR/sendBeacon requests and main-frame navigations from the current saved authorized scope. Sensitive headers and likely secrets are redacted. Use after browser_navigate and after interacting with the page. This is not a full HTTP proxy and does not capture every static browser resource.',
    parameters: obj({}),
  },
  {
    name: 'browser_send_request',
    group: 'browser',
    label: 'إرسال طلب اختبار من المتصفح',
    description: 'Send an HTTP request from the current embedded page context and return status, headers, elapsed time and response body. Destination must remain in the saved authorized scope; same-origin/CORS and browser security rules apply. Use only non-destructive, authorized tests.',
    parameters: obj({
      url: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      body: { type: 'string' },
    }, ['url', 'method']),
  },
  {
    name: 'hunter_run_saved_tool',
    group: 'browser',
    label: 'تشغيل أداة Hunter محفوظة',
    description: 'Run a previously verified tool from the persistent Hunter Tool Registry. Prefer existing verified tools over generating duplicates. Python tools execute in the isolated on-device WebAssembly worker with network disabled; never use this to probe a target directly. Supply only evidence already collected within the authorized scope.',
    parameters: obj({
      tool_id: { type: 'string' },
      args: { type: 'object', additionalProperties: true },
    }, ['tool_id', 'args']),
  },
  {
    name: 'web_fetch',
    group: 'net',
    label: 'قراءة رابط ويب',
    description:
      'Read a public web page the user asked about. By default return readable text; set includeSource=true when the user asks for HTML/source code.',
    parameters: obj(
      { url: { type: 'string' }, includeSource: { type: 'boolean' } },
      ['url'],
    ),
  },
];

export function toolsForRequest(deviceEnabled: boolean): ToolSpec[] {
  return TOOL_SPECS.filter((tool) => {
    // Browser automation depends on the native WebView bridge. Keep it
    // independent of the optional Accessibility switch, but never advertise
    // it to the plain web build where the native driver cannot register.
    if (tool.group === 'browser') return Platform.OS !== 'web';
    if (tool.group === 'device_read' || tool.group === 'device_act') {
      return deviceEnabled && Platform.OS !== 'web' && Device.isAvailable();
    }
    return true;
  });
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
      const response = await fetchWithRetry(endpoint, { headers: BROWSER_HEADERS }, {
        timeout: 20_000,
        maxRetries: 2,
        baseDelay: 500,
        retryStatusCodes: [429, 500, 502, 503, 504],
      });
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

async function webFetch(rawUrl: string, includeSource = false): Promise<string> {
  const url = safeUrl(rawUrl);
  try {
    const response = await fetchWithRetry(url, { headers: BROWSER_HEADERS }, {
      timeout: 30_000,
      maxRetries: 2,
      baseDelay: 1_000,
      retryStatusCodes: [429, 500, 502, 503, 504],
    });
    if (!response.ok) return `تعذّر جلب الصفحة (HTTP ${response.status}).`;
    const html = await response.text();
    if (includeSource) {
      const source = html.slice(0, MAX_WEB_TEXT);
      return `مصدر HTML للصفحة ${url}${html.length > MAX_WEB_TEXT ? ' (المقتطف الأول)' : ''}:\n${source}`;
    }
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
    case 'telegram_send_message': {
      const connections = await loadConnections();
      const config = connections.telegram;
      if (!config?.botToken?.trim() || !config?.chatId?.trim()) {
        throw new Error('تيليجرام غير متصل. افتح Marketing Studio > الاتصالات واضبط Bot Token وChat ID/القناة أولًا. لا ترسل التوكن في الشات.');
      }
      const message = str(args, 'text').trim();
      if (message.length > 4096) throw new Error('رسالة تيليجرام تتجاوز حد 4096 حرفًا. قسّمها إلى رسائل أقصر.');
      const result = await sendTelegramMessage(config, message);
      if (!result.ok) throw new Error(result.detail);
      return JSON.stringify({ ok: true, platform: 'Telegram', destination: config.chatId, detail: result.detail, url: /^@/.test(config.chatId) ? 'https://t.me/' + config.chatId.slice(1) : null });
    }
    case 'github_list_repositories': {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub غير متصل داخل OneByte. افتح إعدادات GitHub وأضف Fine-grained Personal Access Token بصلاحية المستودعات المطلوبة.');
      const account = await verifyGithubToken(token);
      const all = await listRepos(token);
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const repos = all.filter((repo) => !query || (repo.full_name + ' ' + (repo.description ?? '')).toLowerCase().includes(query));
      return JSON.stringify({ account: account.login, totalAccessible: all.length, shown: repos.length, repositories: repos.map((repo) => ({ full_name: repo.full_name, default_branch: repo.default_branch, private: repo.private, description: repo.description ?? '', url: repo.html_url ?? 'https://github.com/' + repo.full_name })) });
    }
    case 'github_list_files': {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub غير متصل داخل OneByte. أضف التوكن من إعدادات GitHub أولًا.');
      const repository = str(args, 'repository').trim();
      const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : 'HEAD';
      const tree = await getRepoTree(token, repository, branch);
      return JSON.stringify({ repository, branch: tree.branch, count: tree.items.length, truncated: tree.truncated, files: tree.items.map((item) => ({ path: item.path, size: item.size ?? null, url: 'https://github.com/' + repository + '/blob/' + encodeURIComponent(tree.branch) + '/' + item.path.split('/').map(encodeURIComponent).join('/') })) });
    }
    case 'github_read_file': {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub غير متصل داخل OneByte. أضف التوكن من إعدادات GitHub أولًا.');
      const repository = str(args, 'repository').trim();
      const path = str(args, 'path').trim();
      const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : await getDefaultBranch(token, repository);
      const file = await readFileSnapshot(token, repository, path, branch);
      return JSON.stringify({ repository, path, branch, sha: file.sha, size: file.size, content: file.content, url: 'https://github.com/' + repository + '/blob/' + encodeURIComponent(branch) + '/' + path.split('/').map(encodeURIComponent).join('/') });
    }
    case 'github_update_file': {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub غير متصل داخل OneByte. أضف التوكن من إعدادات GitHub أولًا.');
      const repository = str(args, 'repository').trim();
      const path = str(args, 'path').trim();
      const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : await getDefaultBranch(token, repository);
      const expectedSha = str(args, 'expected_sha').trim();
      const content = typeof args.content === 'string' ? args.content : '';
      const result = await writeFile(token, repository, path, content, str(args, 'message'), branch, expectedSha);
      return JSON.stringify({ ...result, repository, path, branch, fileUrl: 'https://github.com/' + repository + '/blob/' + encodeURIComponent(branch) + '/' + path.split('/').map(encodeURIComponent).join('/'), message: 'تم حفظ التعديل على GitHub في commit فعلي.' });
    }
    case 'github_create_file': {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub غير متصل داخل OneByte. أضف التوكن من إعدادات GitHub أولًا.');
      const repository = str(args, 'repository').trim();
      const path = str(args, 'path').trim();
      const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : await getDefaultBranch(token, repository);
      const content = typeof args.content === 'string' ? args.content : '';
      const result = await createFile(token, repository, path, content, str(args, 'message'), branch);
      return JSON.stringify({ ...result, repository, path, branch, message: 'تم إنشاء الملف وحفظه في commit فعلي على GitHub.' });
    }
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
      const reminderMessage = await ctx.createTask({
        title: str(args, 'title'),
        time,
        prompt: str(args, 'prompt'),
      });
      return `تمت إضافة المهمة اليومية "${str(args, 'title')}" عند ${time}. افتحيها من تبويب المهام. ${reminderMessage ?? ''}`.trim();
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
      if (Platform.OS === 'web') {
        throw new Error('المتصفح القابل للتحكم متاح داخل تطبيق Android المثبت؛ نسخة الويب لا تحتوي على WebView bridge.');
      }
      let browser = getEmbeddedBrowser();
      if (!browser) {
        router.push({ pathname: '/browser' });
        browser = await waitForEmbeddedBrowser(15_000);
      }
      const parsed = new URL(url);
      const page = await browser.navigate(url, parsed.hostname, false);
      return JSON.stringify({ message: 'تم فتح الرابط وقراءة الصفحة داخل متصفح OneByte المدمج.', url: page.url, title: page.title, text: page.text, elements: page.elements });
    }
    case 'browser_navigate': {
      const raw = str(args, 'url');
      let parsed: URL;
      try { parsed = new URL(raw); } catch { throw new Error('رابط الاختبار غير صالح.'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('يسمح فقط بروابط HTTP/HTTPS دون بيانات اعتماد مضمّنة.');
      const scope = isAuthorized(parsed.toString(), await loadTargets());
      if (!scope.ok) throw new Error(scope.reason);
      let browser = getEmbeddedBrowser();
      if (!browser) {
        router.push({ pathname: '/browser' });
        browser = await waitForEmbeddedBrowser(15_000);
      }
      const page = await browser.navigate(parsed.toString(), parsed.hostname, true);
      return JSON.stringify({ message: 'تم فتح الهدف في المتصفح المدمج ضمن النطاق المصرح.', url: page.url, title: page.title, text: page.text, elements: page.elements });
    }
    case 'browser_read_page': {
      const browser = await waitForEmbeddedBrowser();
      return JSON.stringify(await browser.readPage());
    }
    case 'browser_list_requests': {
      const browser = await waitForEmbeddedBrowser();
      const entries = await browser.getNetworkLog();
      return JSON.stringify({
        captured: entries.length,
        currentUrl: browser.currentUrl(),
        note: 'Captured JavaScript fetch/XHR/sendBeacon requests and main-frame navigations only; this is not a full proxy. Sensitive headers and likely secrets are redacted.',
        entries: entries.slice(-40),
      });
    }
    case 'browser_click': {
      const browser = await waitForEmbeddedBrowser();
      const result = await browser.click(int(args, 'index'));
      return result + '\n' + JSON.stringify(await browser.readPage());
    }
    case 'browser_type_text': {
      const browser = await waitForEmbeddedBrowser();
      const result = await browser.typeText(int(args, 'index'), str(args, 'text'));
      return result + '\n' + JSON.stringify(await browser.readPage());
    }
    case 'browser_scroll': {
      const browser = await waitForEmbeddedBrowser();
      const direction = args.direction === 'up' ? 'up' : 'down';
      await browser.scroll(direction);
      return JSON.stringify(await browser.readPage());
    }
    case 'browser_wait': {
      const browser = await waitForEmbeddedBrowser();
      return await browser.wait(args.ms === undefined ? 1000 : Math.min(5000, Math.max(0, int(args, 'ms'))));
    }
    case 'browser_send_request': {
      const browser = await waitForEmbeddedBrowser();
      const raw = str(args, 'url');
      let parsed: URL;
      try { parsed = new URL(raw, browser.currentUrl()); } catch { throw new Error('رابط الطلب غير صالح.'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('يسمح فقط بروابط HTTP/HTTPS دون بيانات اعتماد مضمّنة.');
      const method = typeof args.method === 'string' ? args.method.toUpperCase() : 'GET';
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) throw new Error('طريقة HTTP غير مسموحة.');
      const headersRaw = args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers) ? args.headers as Record<string, unknown> : {};
      const headers = Object.fromEntries(Object.entries(headersRaw).map(([key, value]) => [key, String(value)]));
      const result = await browser.sendRequest({ url: parsed.toString(), method, headers, body: typeof args.body === 'string' ? args.body : '' });
      return JSON.stringify(result);
    }
    case 'web_search':
      return await webSearch(str(args, 'query'));
    case 'hunter_run_saved_tool': {
      const toolId = str(args, 'tool_id');
      const toolArgs = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? args.args as Record<string, unknown> : {};
      return await runHunterRegistryTool(toolId, toolArgs);
    }
    case 'web_fetch':
      return await webFetch(str(args, 'url'), args.includeSource === true);
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
