/**
 * Persistent Hunter tool registry and bounded hunting workflow.
 *
 * Tool source is stored independently from chat messages. A chat may reference
 * a tool ID/version, while the registry remains the canonical reusable copy.
 * Python execution is deliberately injected through a runtime adapter: this
 * module never evaluates generated source in the React Native JS process.
 */
import { storage } from './storage';
import {
  isAuthorized,
  type HunterTarget,
} from './hunter';
import {
  waitForEmbeddedBrowser,
  type EmbeddedBrowserSnapshot,
  type EmbeddedBrowserNetworkEntry,
} from './embedded-browser';

const REGISTRY_KEY = '@onebyte-agent/hunter-tool-registry-v1';
const RUNS_KEY = '@onebyte-agent/hunter-runs-v1';
const MAX_TOOLS = 200;
const MAX_SOURCE_LENGTH = 64_000;
const MAX_RUNS = 100;

export type HunterToolStatus = 'draft' | 'verified' | 'disabled';
export type HunterToolKind = 'python' | 'builtin';
export interface HunterToolVersion {
  version: number;
  source: string;
  createdAt: string;
  testSummary: string;
}
export interface HunterTool {
  id: string;
  name: string;
  description: string;
  kind: HunterToolKind;
  status: HunterToolStatus;
  inputSchema: Record<string, unknown>;
  outputDescription: string;
  source: string;
  version: number;
  versions: HunterToolVersion[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  tags: string[];
}
export interface HunterRunRecord {
  id: string;
  target: string;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'partial' | 'failed' | 'stopped';
  plan: { id: string; title: string; detail: string; status: 'done' | 'skipped' | 'error' }[];
  pageTitle?: string;
  pageUrl?: string;
  pageTextPreview?: string;
  discoveredUrls: string[];
  networkRequests: number;
  notes: string[];
}

export interface PythonRuntime {
  execute(input: {
    source: string;
    args: Record<string, unknown>;
    timeoutMs: number;
    maxOutputBytes: number;
    network: 'disabled';
  }): Promise<{ output: string; value?: unknown }>;
}
let pythonRuntime: PythonRuntime | null = null;

/** Register only a separately isolated runtime adapter; never pass eval/Function here. */
export function registerHunterPythonRuntime(runtime: PythonRuntime): () => void {
  pythonRuntime = runtime;
  return () => { if (pythonRuntime === runtime) pythonRuntime = null; };
}

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const BUILTIN_HUNTER_TOOLS: HunterTool[] = [
  {
    id: 'hunter.extract-endpoints',
    name: 'Endpoint Collector',
    description: 'Extract same-scope links, API paths and endpoint candidates from browser-observed page text and network records.',
    kind: 'builtin',
    status: 'verified',
    inputSchema: { pageText: 'string', urls: 'string[]' },
    outputDescription: 'Unique in-scope URL and path candidates with source labels.',
    source: 'builtin:endpoint-collector:v1',
    version: 1,
    versions: [{ version: 1, source: 'builtin:endpoint-collector:v1', createdAt: '2026-10-30T00:00:00.000Z', testSummary: 'Built-in deterministic parser.' }],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    useCount: 0,
    tags: ['recon', 'endpoint', 'passive'],
  },
  {
    id: 'hunter.javascript-inventory',
    name: 'JavaScript Inventory',
    description: 'Collect JavaScript asset URLs exposed by page links and captured same-scope network traffic.',
    kind: 'builtin',
    status: 'verified',
    inputSchema: { urls: 'string[]' },
    outputDescription: 'Deduplicated JavaScript asset URLs.',
    source: 'builtin:javascript-inventory:v1',
    version: 1,
    versions: [{ version: 1, source: 'builtin:javascript-inventory:v1', createdAt: '2026-10-30T00:00:00.000Z', testSummary: 'Built-in deterministic parser.' }],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    useCount: 0,
    tags: ['recon', 'javascript', 'passive'],
  },
];

export async function loadHunterTools(): Promise<HunterTool[]> {
  const saved = await storage.readRawJSON<HunterTool[]>(REGISTRY_KEY, []);
  const merged = [...BUILTIN_HUNTER_TOOLS];
  for (const item of saved) {
    const index = merged.findIndex((tool) => tool.id === item.id);
    if (index >= 0) merged[index] = item;
    else merged.push(item);
  }
  return merged.slice(0, MAX_TOOLS);
}

export async function saveHunterTool(input: {
  id?: string;
  name: string;
  description: string;
  source: string;
  inputSchema?: Record<string, unknown>;
  outputDescription?: string;
  tags?: string[];
}): Promise<HunterTool> {
  const name = input.name.trim();
  const source = input.source;
  if (name.length < 3 || name.length > 64) throw new Error('اسم الأداة يجب أن يكون بين 3 و64 حرفًا.');
  if (!source.trim() || source.length > MAX_SOURCE_LENGTH) throw new Error('كود الأداة فارغ أو أكبر من الحد المسموح (64KB).');
  if (!/^([a-zA-Z_][a-zA-Z0-9_]*\s*)/.test(source)) {
    // A soft syntax sanity check only; it is not a Python security validator.
    throw new Error('الكود لا يبدو كملف Python صالح.');
  }
  const tools = await loadHunterTools();
  const existing = input.id ? tools.find((tool) => tool.id === input.id) : undefined;
  const timestamp = now();
  if (existing) {
    const version = existing.version + 1;
    const updated: HunterTool = {
      ...existing,
      name,
      description: input.description.trim(),
      source,
      kind: 'python',
      status: 'draft',
      inputSchema: input.inputSchema ?? existing.inputSchema,
      outputDescription: input.outputDescription ?? existing.outputDescription,
      version,
      versions: [...existing.versions, { version: existing.version, source: existing.source, createdAt: timestamp, testSummary: 'Previous version retained.' }],
      updatedAt: timestamp,
      tags: input.tags ?? existing.tags,
    };
    await persistTools(tools.map((tool) => tool.id === existing.id ? updated : tool));
    return updated;
  }
  if (tools.length >= MAX_TOOLS) throw new Error('وصلت مكتبة الأدوات إلى الحد الأقصى.');
  const created: HunterTool = {
    id: makeId('hunter-tool'),
    name,
    description: input.description.trim(),
    kind: 'python',
    status: 'draft',
    inputSchema: input.inputSchema ?? {},
    outputDescription: input.outputDescription ?? 'لم يتم تحديد شكل المخرجات بعد.',
    source,
    version: 1,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    useCount: 0,
    tags: input.tags ?? [],
  };
  await persistTools([...tools, created]);
  return created;
}

async function persistTools(tools: HunterTool[]): Promise<void> {
  // Built-ins ship with the app and are not duplicated in user storage.
  await storage.writeRawJSON(REGISTRY_KEY, tools.filter((tool) => !tool.id.startsWith('hunter.')));
}

export async function setHunterToolStatus(id: string, status: HunterToolStatus, testSummary?: string): Promise<void> {
  const tools = await loadHunterTools();
  const next = tools.map((tool) => tool.id !== id ? tool : ({
    ...tool,
    status,
    updatedAt: now(),
    versions: tool.versions.map((version) => version.version === tool.version
      ? { ...version, testSummary: testSummary ?? version.testSummary }
      : version),
  }));
  await persistTools(next);
}

export async function deleteHunterTool(id: string): Promise<void> {
  if (id.startsWith('hunter.')) throw new Error('لا يمكن حذف الأدوات الأساسية المدمجة.');
  const tools = await loadHunterTools();
  await persistTools(tools.filter((tool) => tool.id !== id));
}

export async function runPythonHunterTool(id: string, args: Record<string, unknown>): Promise<string> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python') throw new Error('أداة Python غير موجودة.');
  if (tool.status !== 'verified') throw new Error('الأداة غير معتمدة. اختبرها واعتمد إصدارها أولًا.');
  if (!pythonRuntime) throw new Error('محرك Python المحلي المعزول غير مدمج في هذا الإصدار بعد؛ تم حفظ الكود في المكتبة دون تشغيله.');
  const result = await pythonRuntime.execute({
    source: tool.source,
    args,
    timeoutMs: 8_000,
    maxOutputBytes: 64_000,
    network: 'disabled',
  });
  const tools = await loadHunterTools();
  await persistTools(tools.map((item) => item.id === id
    ? { ...item, lastUsedAt: now(), useCount: item.useCount + 1 }
    : item));
  return result.output.slice(0, 64_000);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 500);
}

export function collectEndpointCandidates(snapshot: EmbeddedBrowserSnapshot, network: EmbeddedBrowserNetworkEntry[], targetHost: string): string[] {
  const candidates: string[] = [];
  const absolute = /https?:\/\/[^\s"'<>\\)]+/gi;
  for (const match of snapshot.text.match(absolute) ?? []) candidates.push(match.replace(/[),.;]+$/, ''));
  for (const element of snapshot.elements) if (element.href) candidates.push(element.href);
  for (const entry of network) candidates.push(entry.url);
  const output: string[] = [];
  for (const candidate of unique(candidates)) {
    try {
      const url = new URL(candidate, snapshot.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.hostname === targetHost || url.hostname.endsWith('.' + targetHost)) output.push(url.toString());
    } catch { /* Ignore malformed page values. */ }
  }
  return unique(output);
}

export function collectJavaScriptAssets(urls: string[]): string[] {
  return unique(urls.filter((url) => /\.m?js(?:[?#]|$)/i.test(url)));
}

export async function loadHunterRuns(): Promise<HunterRunRecord[]> {
  return storage.readRawJSON<HunterRunRecord[]>(RUNS_KEY, []);
}
export async function saveHunterRun(run: HunterRunRecord): Promise<void> {
  const runs = await loadHunterRuns();
  await storage.writeRawJSON(RUNS_KEY, [run, ...runs.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS));
}

/**
 * A conservative browser-first reconnaissance pass. It never probes newly
 * discovered hosts; every request stays on the explicitly authorized host tree.
 */
export async function runBrowserRecon(target: HunterTarget, signal?: AbortSignal): Promise<HunterRunRecord> {
  const startedAt = now();
  const rootUrl = `https://${target.host.replace(/^\*\./, '')}/`;
  const scope = isAuthorized(rootUrl, [target]);
  if (!scope.ok) throw new Error(scope.reason);
  const plan: HunterRunRecord['plan'] = [
    { id: 'scope', title: 'Scope validation', detail: 'تأكيد النطاق المصرح به قبل أي اتصال.', status: 'done' },
    { id: 'browser', title: 'Browser reconnaissance', detail: 'فتح الموقع وقراءة النص والعناصر الظاهرة من WebView المدمج.', status: 'error' },
    { id: 'network', title: 'Network inventory', detail: 'قراءة الطلبات التي التقطها المتصفح داخل النطاق.', status: 'skipped' },
    { id: 'analysis', title: 'Endpoint & JavaScript analysis', detail: 'استخراج روابط وملفات JavaScript المرصودة فقط.', status: 'skipped' },
    { id: 'next', title: 'Adaptive next-step planning', detail: 'تحديد ما يلزم استكماله دون تشغيل فحوص نشطة تلقائيًا.', status: 'skipped' },
  ];
  const record: HunterRunRecord = {
    id: makeId('hunt'),
    target: target.host,
    startedAt,
    finishedAt: startedAt,
    status: 'partial',
    plan,
    discoveredUrls: [],
    networkRequests: 0,
    notes: [],
  };
  try {
    if (signal?.aborted) throw new Error('تم إيقاف الفحص.');
    const browser = await waitForEmbeddedBrowser(12_000);
    const snapshot = await browser.navigate(rootUrl, target.host, true);
    if (signal?.aborted) throw new Error('تم إيقاف الفحص.');
    plan[1].status = 'done';
    const page = await browser.readPage();
    record.pageTitle = page.title;
    record.pageUrl = page.url;
    record.pageTextPreview = page.text.slice(0, 12_000);
    const network = (await browser.getNetworkLog()).filter((entry) => {
      try {
        const host = new URL(entry.url).hostname.toLowerCase();
        return host === target.host.replace(/^\*\./, '') || host.endsWith('.' + target.host.replace(/^\*\./, ''));
      } catch { return false; }
    });
    record.networkRequests = network.length;
    plan[2].status = 'done';
    const urls = collectEndpointCandidates(page, network, target.host.replace(/^\*\./, ''));
    record.discoveredUrls = urls;
    plan[3].status = 'done';
    const jsAssets = collectJavaScriptAssets(urls);
    record.notes.push(`تم رصد ${urls.length} رابطًا داخل النطاق و${jsAssets.length} ملف JavaScript.`);
    record.notes.push('لم يتم إرسال طلبات تخمين أو brute-force أو اختبارات نشطة.');
    plan[4].status = 'done';
    record.status = 'completed';
    void snapshot;
  } catch (error) {
    record.status = 'partial';
    record.notes.push(error instanceof Error ? error.message : 'تعذّر إكمال الاستطلاع.');
    const failed = plan.find((step) => step.status === 'error');
    if (failed) failed.detail += ' تعذّر الوصول إلى المتصفح أو قراءة الصفحة.';
  }
  record.finishedAt = now();
  await saveHunterRun(record);
  return record;
}
