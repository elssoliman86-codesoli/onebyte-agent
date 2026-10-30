import { storage } from './storage';
import { strToU8 } from 'fflate';

export type RunStepStatus = 'pending' | 'running' | 'done' | 'error' | 'waiting-approval';
export interface DeveloperProjectFile {
  id: string;
  sessionId: string;
  path: string;
  language: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
export interface DeveloperPlanStep {
  id: string;
  sessionId: string;
  title: string;
  detail: string;
  status: RunStepStatus;
  startedAt?: string;
  finishedAt?: string;
}
export interface CodeReviewRequest {
  id: string;
  sessionId: string;
  filePath: string;
  original: string;
  proposed: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}
export interface DeveloperProject {
  sessionId: string;
  title: string;
  files: DeveloperProjectFile[];
  plan: DeveloperPlanStep[];
  reviews: CodeReviewRequest[];
  /** Optional code-only model override; conversation model remains unchanged. */
  codeModelId?: string;
  updatedAt: string;
}
const KEY = '@onebyte-agent/developer-projects-v1';
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

function safeProjectPath(value: string): string {
  const path = value.trim();
  if (path !== value || !path || path.length > 240 || path.includes(String.fromCharCode(0)) || path.startsWith('/') ||
    path.includes(String.fromCharCode(92)) || /^[a-zA-Z]:/.test(path) ||
    path.split('/').some(part => !part || part === '.' || part === '..' || !part.trim())) {
    throw new Error('مسار الملف غير صالح.');
  }
  return path;
}

export async function loadDeveloperProjects(): Promise<DeveloperProject[]> {
  return storage.readRawJSON<DeveloperProject[]>(KEY, []);
}
export async function saveDeveloperProjects(projects: DeveloperProject[]): Promise<void> {
  await storage.writeRawJSON(KEY, projects);
}
export async function getDeveloperProject(sessionId: string, title = 'مشروع جديد'): Promise<DeveloperProject> {
  const all = await loadDeveloperProjects();
  return all.find(p => p.sessionId === sessionId) ?? {
    sessionId, title, files: [], plan: [], reviews: [], updatedAt: now(),
  };
}
export async function putDeveloperProject(project: DeveloperProject): Promise<void> {
  const all = await loadDeveloperProjects();
  const next = { ...project, updatedAt: now() };
  await saveDeveloperProjects([next, ...all.filter(p => p.sessionId !== project.sessionId)]);
}
export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string,string> = { ts:'TypeScript',tsx:'TSX',js:'JavaScript',jsx:'JSX',py:'Python',json:'JSON',md:'Markdown',html:'HTML',css:'CSS',sql:'SQL',sh:'Shell',rs:'Rust',go:'Go',java:'Java',cs:'C#',cpp:'C++',c:'C',swift:'Swift' };
  return map[ext] ?? 'Text';
}
export async function setDeveloperCodeModel(sessionId: string, modelId: string | undefined): Promise<void> {
  const project = await getDeveloperProject(sessionId);
  await putDeveloperProject({ ...project, codeModelId: modelId || undefined });
}
export async function saveProjectFile(sessionId: string, title: string, rawPath: string, content: string): Promise<DeveloperProjectFile> {
  const path = safeProjectPath(rawPath);
  if (typeof content !== 'string') throw new Error('محتوى الملف غير صالح.');
  const contentBytes = strToU8(content).length;
  if (contentBytes > 25 * 1024 * 1024) throw new Error('محتوى الملف يتجاوز حد 25MB.');
  const project = await getDeveloperProject(sessionId, title);
  const previous = project.files.find(f => f.path === path);
  if (!previous && project.files.length >= 500) throw new Error('المشروع وصل إلى الحد الأقصى البالغ 500 ملف.');
  const totalBytes = project.files.reduce((sum, file) => sum + strToU8(file.content).length, 0) - (previous ? strToU8(previous.content).length : 0) + contentBytes;
  if (totalBytes > 80 * 1024 * 1024) throw new Error('الحجم الإجمالي للمشروع يتجاوز 80MB.');
  const file: DeveloperProjectFile = previous
    ? { ...previous, content, updatedAt: now() }
    : { id: id('file'), sessionId, path, language: languageForPath(path), content, createdAt: now(), updatedAt: now() };
  await putDeveloperProject({ ...project, files: previous ? project.files.map(f => f.id === previous.id ? file : f) : [...project.files, file] });
  return file;
}
/** Rename one file without changing its contents or losing pending review history. */
export async function renameProjectFile(sessionId: string, oldPath: string, rawNewPath: string): Promise<void> {
  const newPath = safeProjectPath(rawNewPath);
  const project = await getDeveloperProject(sessionId);
  const file = project.files.find(item => item.path === oldPath);
  if (!file) throw new Error('الملف المطلوب غير موجود.');
  if (project.files.some(item => item.path === newPath && item.id !== file.id)) {
    throw new Error('يوجد ملف آخر بهذا المسار بالفعل.');
  }
  const timestamp = now();
  const files = project.files.map(item => item.id === file.id
    ? { ...item, path: newPath, language: languageForPath(newPath), updatedAt: timestamp }
    : item);
  const reviews = project.reviews.map(review => review.filePath === oldPath
    ? { ...review, filePath: newPath }
    : review);
  await putDeveloperProject({ ...project, files, reviews });
}

/** Delete a file and close pending proposals tied to the deleted path. */
export async function deleteProjectFile(sessionId: string, path: string): Promise<void> {
  const project = await getDeveloperProject(sessionId);
  if (!project.files.some(file => file.path === path)) throw new Error('الملف المطلوب غير موجود.');
  const reviews = project.reviews.map(review => review.filePath === path && review.status === 'pending'
    ? { ...review, status: 'rejected' as const }
    : review);
  await putDeveloperProject({ ...project, files: project.files.filter(file => file.path !== path), reviews });
}

/** Import a complete archive in one storage transaction; every file remains scoped to its chat session. */
export async function importProjectFiles(
  sessionId: string,
  title: string,
  entries: Array<{ path: string; content: string }>,
): Promise<number> {
  if (!entries.length) throw new Error('الأرشيف لا يحتوي على ملفات نصية.');
  if (entries.length > 500) throw new Error('الأرشيف يحتوي على أكثر من 500 ملف.');
  const normalized = new Map<string, string>();
  let totalBytes = 0;
  for (const entry of entries) {
    const path = safeProjectPath(entry.path.trim());
    if (typeof entry.content !== 'string') throw new Error('محتوى ملف غير صالح.');
    const bytes = strToU8(entry.content).length;
    if (bytes > 25 * 1024 * 1024) throw new Error(`الملف ${path} يتجاوز حد 25MB.`);
    totalBytes += bytes;
    if (totalBytes > 80 * 1024 * 1024) throw new Error('الحجم الإجمالي للملفات يتجاوز 80MB.');
    normalized.set(path, entry.content);
  }
  const project = await getDeveloperProject(sessionId, title);
  const timestamp = now();
  const existing = new Map(project.files.map(file => [file.path, file]));
  for (const [path, content] of normalized) {
    const previous = existing.get(path);
    existing.set(path, previous
      ? { ...previous, content, updatedAt: timestamp }
      : { id: id('file'), sessionId, path, language: languageForPath(path), content, createdAt: timestamp, updatedAt: timestamp });
  }
  await putDeveloperProject({ ...project, files: [...existing.values()] });
  return normalized.size;
}

export async function replaceProjectPlan(sessionId: string, title: string, steps: Array<{title:string;detail:string}>): Promise<void> {
  const project = await getDeveloperProject(sessionId, title);
  await putDeveloperProject({ ...project, plan: steps.map((step, index) => ({
    id: id('step'), sessionId, title: step.title.trim() || `الخطوة ${index + 1}`, detail: step.detail,
    status: 'pending' as const,
  })) });
}
export async function updatePlanStep(sessionId: string, stepId: string, status: RunStepStatus): Promise<void> {
  const project = await getDeveloperProject(sessionId);
  const timestamp = now();
  await putDeveloperProject({ ...project, plan: project.plan.map(step => step.id !== stepId ? step : {
    ...step, status,
    startedAt: status === 'running' ? (step.startedAt ?? timestamp) : step.startedAt,
    finishedAt: status === 'done' || status === 'error' ? timestamp : undefined,
  }) });
}
export async function proposeCodeReview(sessionId: string, filePath: string, original: string, proposed: string, reason: string): Promise<CodeReviewRequest> {
  const project = await getDeveloperProject(sessionId);
  const review: CodeReviewRequest = { id: id('review'), sessionId, filePath, original, proposed, reason, status: 'pending', createdAt: now() };
  await putDeveloperProject({ ...project, reviews: [review, ...project.reviews] });
  return review;
}
/** Apply proposed code only after an explicit approval action. */
export async function decideCodeReview(sessionId: string, reviewId: string, approve: boolean): Promise<void> {
  const project = await getDeveloperProject(sessionId);
  const review = project.reviews.find(r => r.id === reviewId);
  if (!review || review.status !== 'pending') throw new Error('طلب المراجعة لم يعد متاحًا.');
  const reviews = project.reviews.map(r => r.id === reviewId ? { ...r, status: approve ? 'approved' as const : 'rejected' as const } : r);
  let files = project.files;
  if (approve) {
    const previous = files.find(f => f.path === review.filePath);
    if ((previous?.content ?? '') !== review.original) {
      throw new Error('الملف تغيّر بعد إنشاء المراجعة. أنشئ مراجعة جديدة حتى لا تستبدل تعديلات أحدث.');
    }
    const file: DeveloperProjectFile = previous
      ? { ...previous, content: review.proposed, updatedAt: now() }
      : { id: id('file'), sessionId, path: review.filePath, language: languageForPath(review.filePath), content: review.proposed, createdAt: now(), updatedAt: now() };
    files = previous ? files.map(f => f.id === previous.id ? file : f) : [...files, file];
  }
  await putDeveloperProject({ ...project, files, reviews });
}
export function buildProjectOutline(files: DeveloperProjectFile[]): Array<{path:string; depth:number; directory:boolean}> {
  const nodes = new Map<string, {path:string;depth:number;directory:boolean}>();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0,i).join('/');
      nodes.set(path, { path, depth: i - 1, directory: true });
    }
    nodes.set(file.path, { path: file.path, depth: parts.length - 1, directory: false });
  }
  return [...nodes.values()].sort((a,b) => a.path.localeCompare(b.path));
}
