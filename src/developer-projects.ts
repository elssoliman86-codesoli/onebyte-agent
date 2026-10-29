import { storage } from './storage';

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
  updatedAt: string;
}
const KEY = '@onebyte-agent/developer-projects-v1';
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

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
export async function saveProjectFile(sessionId: string, title: string, path: string, content: string): Promise<DeveloperProjectFile> {
  if (!path.trim() || path.startsWith('/') || path.split('/').some(part => part === '..' || part.trim() === '')) {
    throw new Error('مسار الملف غير صالح.');
  }
  const project = await getDeveloperProject(sessionId, title);
  const previous = project.files.find(f => f.path === path);
  const file: DeveloperProjectFile = previous
    ? { ...previous, content, updatedAt: now() }
    : { id: id('file'), sessionId, path, language: languageForPath(path), content, createdAt: now(), updatedAt: now() };
  await putDeveloperProject({ ...project, files: previous ? project.files.map(f => f.id === previous.id ? file : f) : [...project.files, file] });
  return file;
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
