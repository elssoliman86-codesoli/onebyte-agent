import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API = 'https://api.github.com';
const TOKEN_KEY = 'onebyte-agent.marketing.github-token';
const WEB_TOKEN_KEY = 'onebyte-agent.github-editor-token';
export const MAX_GITHUB_TEXT_FILE_BYTES = 250_000;

function headers(token: string): Record<string, string> {
  return {
    Authorization: 'Bearer ' + token.trim(),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function apiRepo(fullName: string): string {
  const parts = fullName.split('/');
  if (parts.length !== 2 || parts.some((p) => !p.trim())) throw new Error('اسم المستودع لازم يكون owner/repository.');
  return parts.map(encodeURIComponent).join('/');
}

function apiPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function apiError(status: number): string {
  if (status === 401) return 'التوكن مرفوض (401). راجع التوكن وصلاحيته.';
  if (status === 403) return 'الصلاحيات غير كافية أو تم تجاوز حد الاستخدام (403).';
  if (status === 404) return 'المستودع أو الملف أو الفرع غير موجود (404).';
  if (status === 409) return 'تعارض في GitHub أثناء حفظ الملف.';
  if (status === 422) return 'GitHub رفض التعديل؛ راجع صلاحيات المستودع ورسالة الـcommit.';
  return 'GitHub رجع HTTP ' + status + '.';
}

export async function loadGithubToken(): Promise<string> {
  if (Platform.OS === 'web') {
    try {
      return typeof window === 'undefined' ? '' : window.sessionStorage.getItem(WEB_TOKEN_KEY) ?? '';
    } catch { return ''; }
  }
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (token) return token;

  // Migrate the old Marketing Studio token into Android secure storage, if present.
  try {
    const { storage } = await import('./storage');
    const old = await storage.readRawJSON<{ githubToken?: string }>('@onebyte-agent/marketing-connections', {});
    const legacy = old.githubToken?.trim() ?? '';
    if (legacy) {
      await SecureStore.setItemAsync(TOKEN_KEY, legacy, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await storage.writeRawJSON('@onebyte-agent/marketing-connections', { ...old, githubToken: '' });
      return legacy;
    }
  } catch { /* Secure storage may temporarily be unavailable. */ }
  return '';
}

export async function saveGithubToken(token: string): Promise<void> {
  const clean = token.trim();
  if (!clean) throw new Error('أدخل توكن GitHub أولًا.');
  if (Platform.OS === 'web') {
    try {
      if (typeof window === 'undefined') throw new Error('sessionStorage غير متاح.');
      window.sessionStorage.setItem(WEB_TOKEN_KEY, clean);
    } catch { throw new Error('المتصفح لم يسمح بحفظ التوكن في جلسة التبويب.'); }
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, clean, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteGithubToken(): Promise<void> {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.sessionStorage.removeItem(WEB_TOKEN_KEY); } catch { /* no-op */ }
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

export interface GithubAccount { login: string; html_url: string }

export async function verifyGithubToken(token: string): Promise<GithubAccount> {
  const res = await fetch(API + '/user', { headers: headers(token) });
  if (!res.ok) throw new Error(apiError(res.status));
  const data = (await res.json()) as Partial<GithubAccount>;
  if (!data.login) throw new Error('GitHub رجع معلومات حساب غير متوقعة.');
  return { login: data.login, html_url: data.html_url ?? 'https://github.com/' + data.login };
}

export interface GhRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
  description?: string | null;
  html_url?: string;
}

export async function listRepos(token: string): Promise<GhRepo[]> {
  const res = await fetch(API + '/user/repos?per_page=100&sort=updated&direction=desc&type=all', {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(apiError(res.status));
  const data = (await res.json()) as GhRepo[];
  return Array.isArray(data) ? data : [];
}

export interface GhTreeItem { path: string; type: 'blob' | 'tree'; size?: number; sha?: string }

export async function getRepoTree(
  token: string,
  fullName: string,
  branch: string,
): Promise<{ items: GhTreeItem[]; branch: string; truncated: boolean }> {
  const url = API + '/repos/' + apiRepo(fullName) + '/git/trees/' +
    encodeURIComponent(branch || 'HEAD') + '?recursive=1';
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(apiError(res.status));
  const data = (await res.json()) as { tree?: GhTreeItem[]; truncated?: boolean };
  return {
    items: (data.tree ?? []).filter((item) => item.type === 'blob'),
    branch: branch || 'HEAD',
    truncated: Boolean(data.truncated),
  };
}

export interface GhFileSnapshot { content: string; sha: string; size: number }

export async function readFileSnapshot(
  token: string,
  fullName: string,
  path: string,
  branch?: string,
): Promise<GhFileSnapshot> {
  const ref = branch ? '?ref=' + encodeURIComponent(branch) : '';
  const url = API + '/repos/' + apiRepo(fullName) + '/contents/' + apiPath(path) + ref;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(apiError(res.status));
  const data = (await res.json()) as { content?: string; encoding?: string; size?: number; sha?: string; type?: string };
  if (data.type !== 'file' || !data.sha) throw new Error('العنصر المحدد ليس ملفًا نصيًا.');
  if ((data.size ?? 0) > MAX_GITHUB_TEXT_FILE_BYTES) throw new Error('الملف أكبر من 250KB.');
  if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('الملف ثنائي أو لا يدعم GitHub قراءته كنص.');
  if (typeof globalThis.atob !== 'function') throw new Error('فك الترميز غير متاح في هذه البيئة.');
  const binary = globalThis.atob(data.content.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return {
    content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
    sha: data.sha,
    size: data.size ?? 0,
  };
}

export async function writeFile(
  token: string,
  fullName: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  expectedSha: string,
): Promise<{ ok: true; commitUrl: string }> {
  if (!token.trim()) throw new Error('اتصل بـGitHub أولًا.');
  if (new TextEncoder().encode(content).byteLength > MAX_GITHUB_TEXT_FILE_BYTES) {
    throw new Error('الملف بعد التعديل أكبر من 250KB.');
  }

  const repo = apiRepo(fullName);
  const filePath = apiPath(path);
  const refQuery = branch ? '?ref=' + encodeURIComponent(branch) : '';
  const headRes = await fetch(API + '/repos/' + repo + '/contents/' + filePath + refQuery, {
    headers: headers(token),
  });
  if (!headRes.ok) throw new Error(apiError(headRes.status));
  const current = (await headRes.json()) as { sha?: string };
  if (!current.sha || current.sha !== expectedSha) {
    throw new Error('الملف اتغيّر على GitHub بعد ما فتحته. أعد تحميله وراجع التغييرات قبل الحفظ.');
  }

  const res = await fetch(API + '/repos/' + repo + '/contents/' + filePath, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message.trim() || 'Update ' + path + ' via OneByte Agent',
      content: encodeBase64(content),
      sha: current.sha,
      branch,
    }),
  });
  if (!res.ok) throw new Error(apiError(res.status));
  const data = (await res.json()) as { commit?: { html_url?: string } };
  return { ok: true, commitUrl: data.commit?.html_url ?? '' };
}

function encodeBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return globalThis.btoa(binary);
}
