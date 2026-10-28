/**
 * GitHub REST client — official API with the user's own personal access
 * token (free). Read repos/files, write file changes (commits), and import
 * repository files into the Developer Lab workspace. Honest errors only.
 */

const API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function ghError(status: number): string {
  if (status === 401) return 'التوكن مرفوض (401) — راجعه أو صلاحياته.';
  if (status === 403) return 'الصلاحيات غير كافية أو حد الاستخدام (403).';
  if (status === 404) return 'المسار غير موجود (404) — راجع اسم المستودع أو الفرع.';
  return `GitHub رجع ${status}.`;
}

export interface GhRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

export async function listRepos(token: string): Promise<GhRepo[]> {
  const res = await fetch(`${API}/user/repos?per_page=30&sort=updated`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw new Error(ghError(res.status));
  const data = (await res.json()) as GhRepo[];
  return Array.isArray(data) ? data : [];
}

export interface GhTreeItem {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

/** Flat tree of a repo's files (branch defaults to the repo default). */
export async function getRepoTree(
  token: string,
  fullName: string,
  branch?: string,
): Promise<{ items: GhTreeItem[]; branch: string }> {
  const base = branch
    ? `${API}/repos/${fullName}/git/trees/${branch}?recursive=1`
    : `${API}/repos/${fullName}/git/trees/HEAD?recursive=1`;
  const res = await fetch(base, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(ghError(res.status));
  const data = (await res.json()) as {
    tree?: GhTreeItem[];
  };
  const items = (data.tree ?? []).filter((i) => i.type === 'blob');
  const resolved = branch ?? 'HEAD';
  return { items, branch: resolved };
}

/** Read a file's raw content (base64 in the contents API, decoded here). */
export async function readFile(
  token: string,
  fullName: string,
  path: string,
  branch?: string,
): Promise<string> {
  const url = new URL(`${API}/repos/${fullName}/contents/${encodeURI(path)}`);
  if (branch && branch !== 'HEAD') url.searchParams.set('ref', branch);
  const res = await fetch(url.toString(), { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(ghError(res.status));
  const data = (await res.json()) as { content?: string; encoding?: string; size?: number };
  if (data.encoding === 'base64' && typeof data.content === 'string') {
    // Content arrives with newlines — strip before decoding.
    const clean = data.content.replace(/\n/g, '');
    if (typeof globalThis.atob === 'function') {
      const bin = globalThis.atob(clean);
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    throw new Error('فك الترميز غير متاح في هذه البيئة.');
  }
  throw new Error('الملف ثنائي أو كبير — القراءة النصية غير مدعومة له.');
}

/** UTF-8-safe base64 (chunked so large files don't blow the call stack). */
function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return globalThis.btoa(bin);
}

/** Write (create/update) a file — produces a real commit on the branch. */
export async function writeFile(
  token: string,
  fullName: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
): Promise<{ ok: true; commitUrl: string }> {
  // Required: the existing file's sha for updates (fetch it first).
  let sha: string | undefined;
  const headRes = await fetch(
    `${API}/repos/${fullName}/contents/${encodeURI(path)}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`,
    { headers: ghHeaders(token) },
  );
  if (headRes.ok) {
    const head = (await headRes.json()) as { sha?: string };
    sha = head.sha;
  }
  const res = await fetch(`${API}/repos/${fullName}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: message || 'OneByte Agent update',
      content: toBase64(content),
      sha,
      branch: branch && branch !== 'HEAD' ? branch : undefined,
    }),
  });
  if (!res.ok) throw new Error(ghError(res.status));
  const data = (await res.json()) as { commit?: { html_url?: string } };
  return { ok: true, commitUrl: data.commit?.html_url ?? '' };
}

export interface ImportResult {
  imported: { path: string; content: string }[];
  skipped: string[];
}
