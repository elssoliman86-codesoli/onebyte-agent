/**
 * Developer Lab workspace: an independent file store, separate from chat
 * memory. Files keep a short version history so edits can be reviewed and
 * reverted. Everything is local; heavy build/run steps are explicitly out
 * of scope for the phone.
 */

import { storage } from './storage';

export interface WorkspaceFile {
  id: string;
  path: string;
  content: string;
  language: string;
  updatedAt: string;
  createdAt: string;
}

export interface WorkspaceVersion {
  version: number;
  content: string;
  savedAt: string;
  /** What changed — short note the editor/user supplies. */
  note: string;
}

export interface WorkspaceFileHistory {
  fileId: string;
  versions: WorkspaceVersion[];
}

const FILES_KEY = '@onebyte-agent/workspace-files';
const HISTORY_KEY = '@onebyte-agent/workspace-history';
const MAX_VERSIONS = 20;

export async function loadWorkspaceFiles(): Promise<WorkspaceFile[]> {
  return storage.readRawJSON<WorkspaceFile[]>(FILES_KEY, []);
}

export async function saveWorkspaceFiles(files: WorkspaceFile[]): Promise<void> {
  await storage.writeRawJSON(FILES_KEY, files);
}

export async function loadWorkspaceHistory(): Promise<WorkspaceFileHistory[]> {
  return storage.readRawJSON<WorkspaceFileHistory[]>(HISTORY_KEY, []);
}

export async function saveWorkspaceHistory(history: WorkspaceFileHistory[]): Promise<void> {
  await storage.writeRawJSON(HISTORY_KEY, history);
}

export function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown',
    yml: 'yaml', yaml: 'yaml', java: 'java', kt: 'kotlin', php: 'php',
    rb: 'ruby', go: 'go', rs: 'rust', c: 'c', cpp: 'cpp', cs: 'csharp',
    sql: 'sql', sh: 'bash', dart: 'dart', swift: 'swift', txt: 'text',
  };
  return map[ext] ?? 'text';
}

/** Create a new file (or overwrite an existing one by path) in the workspace. */
export async function upsertFile(path: string, content: string): Promise<WorkspaceFile> {
  const files = await loadWorkspaceFiles();
  const nowIso = new Date().toISOString();
  const existing = files.find((f) => f.path === path);
  let file: WorkspaceFile;
  if (existing) {
    file = { ...existing, content, updatedAt: nowIso };
    await saveWorkspaceFiles(files.map((f) => (f.id === existing.id ? file : f)));
  } else {
    file = {
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path,
      content,
      language: guessLanguage(path),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await saveWorkspaceFiles([...files, file]);
  }
  await pushVersion(file.id, content, existing ? 'تعديل' : 'إنشاء الملف');
  return file;
}

/** Save a new version and keep history bounded (oldest dropped). */
export async function pushVersion(fileId: string, content: string, note: string): Promise<void> {
  const history = await loadWorkspaceHistory();
  const nowIso = new Date().toISOString();
  const entry = history.find((h) => h.fileId === fileId);
  const versionNumber = (entry?.versions.at(-1)?.version ?? 0) + 1;
  const version: WorkspaceVersion = { version: versionNumber, content, savedAt: nowIso, note };
  if (!entry) {
    await saveWorkspaceHistory([...history, { fileId, versions: [version] }]);
    return;
  }
  const versions = [...entry.versions, version].slice(-MAX_VERSIONS);
  await saveWorkspaceHistory(
    history.map((h) => (h.fileId === fileId ? { ...h, versions } : h)),
  );
}

export async function fileHistory(fileId: string): Promise<WorkspaceVersion[]> {
  const history = await loadWorkspaceHistory();
  return history.find((h) => h.fileId === fileId)?.versions ?? [];
}

export async function deleteFile(fileId: string): Promise<void> {
  const files = await loadWorkspaceFiles();
  await saveWorkspaceFiles(files.filter((f) => f.id !== fileId));
  const history = await loadWorkspaceHistory();
  await saveWorkspaceHistory(history.filter((h) => h.fileId !== fileId));
}

// ─── Simple line diff (added/removed arrays — readable on a phone) ────
export interface LineDiff {
  added: string[];
  removed: string[];
}

/** Line-level set diff between two versions of a file. */
export function diffLines(before: string, after: string): LineDiff {
  const a = before.split('\n');
  const b = after.split('\n');
  const aSet = new Map<string, number>();
  for (const line of a) aSet.set(line, (aSet.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of b) {
    const n = aSet.get(line) ?? 0;
    if (n > 0) aSet.set(line, n - 1);
    else added.push(line);
  }
  const bSet = new Map<string, number>();
  for (const line of b) bSet.set(line, (bSet.get(line) ?? 0) + 1);
  const removed: string[] = [];
  for (const line of a) {
    const n = bSet.get(line) ?? 0;
    if (n > 0) bSet.set(line, n - 1);
    else removed.push(line);
  }
  return { added, removed };
}

export function diffToText(diff: LineDiff): string {
  const lines: string[] = [];
  for (const line of diff.added) lines.push(`+ ${line}`);
  for (const line of diff.removed) lines.push(`- ${line}`);
  return lines.join('\n') || '(لا فرق)';
}
