/**
 * Persistent Hunter tool registry and bounded hunting workflow.
 *
 * Tool source is stored independently from chat messages. A chat may reference
 * a tool ID/version, while the registry remains the canonical reusable copy.
 * Python execution is deliberately injected through a runtime adapter: this
 * module never evaluates generated source in the React Native JS process.
 */
import { storage } from './storage';
import { endpointFor } from './model-provider';
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

export type HunterToolStatus = 'draft' | 'smoke-tested' | 'verified' | 'disabled';
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

export async function smokeTestHunterPythonTool(id: string): Promise<string> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python') throw new Error('أداة Python غير موجودة.');
  if (!pythonRuntime) throw new Error('محرك Python المحلي لم يجهز بعد.');
  const result = await pythonRuntime.execute({ source: tool.source, args: { target: 'example.invalid', evidence: [], urls: [] }, timeoutMs: 8_000, maxOutputBytes: 64_000, network: 'disabled' });
  if (!result.value || typeof result.value !== 'object') throw new Error('الأداة لم تُرجع نتيجة JSON منظمة.');
  const summary = 'Smoke test passed: run(args) returned JSON-compatible output; network disabled.';
  await setHunterToolStatus(id, 'smoke-tested', summary);
  return result.output;
}

export async function approveHunterPythonTool(id: string): Promise<void> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python' || tool.status !== 'smoke-tested') throw new Error('يجب نجاح اختبار التشغيل الأولي قبل الاعتماد.');
  await setHunterToolStatus(id, 'verified', 'User reviewed source and approved after smoke test.');
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

interface AdaptiveHuntPlan { summary: string; nextSteps: string[]; missingTool?: { name: string; description: string; purpose: string }; }

async function callHunterModel(messages: { role: 'system' | 'user'; content: string }[]): Promise<string | null> {
  const settings = await storage.getProvider();
  if (!settings.baseUrl.trim() || !settings.model.trim()) return null;
  const apiKey = settings.keyless ? '' : (await storage.readApiKey()) ?? '';
  if (!settings.keyless && !apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(endpointFor(settings.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) }, body: JSON.stringify({ model: settings.model, messages, temperature: 0.1, stream: false }), signal: controller.signal });
    if (!response.ok) throw new Error('Hunter model HTTP ' + response.status);
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } finally { clearTimeout(timeout); }
}

async function createAdaptiveHuntPlan(target: HunterTarget, page: EmbeddedBrowserSnapshot, network: EmbeddedBrowserNetworkEntry[], urls: string[]): Promise<AdaptiveHuntPlan> {
  const fallback: AdaptiveHuntPlan = { summary: 'استطلاع سلبي أولي؛ يلزم تحليل يدوي للـ JavaScript والـ endpoints قبل اقتراح اختبارات إضافية.', nextSteps: ['تحليل ملفات JavaScript المرصودة', 'تصنيف endpoints حسب الوظيفة', 'مراجعة النطاق والاستثناءات قبل أي اختبار نشط'] };
  try {
    const raw = await callHunterModel([
      { role: 'system', content: 'You are a defensive bug-bounty hunting planner. Use ONLY passive observations supplied. Never suggest brute force, credential attacks, denial of service, destructive actions, scope expansion, or requests to unapproved hosts. Return JSON only: {"summary":"...","next_steps":["..."],"missing_tool":{"name":"...","description":"...","purpose":"..."} or null}. Suggest a reusable Python tool only if the current registry lacks a useful capability. Do not claim execution or verification.' },
      { role: 'user', content: JSON.stringify({ authorizedTarget: target.host, authorizationNote: target.authorization.slice(0, 1200), page: { url: page.url, title: page.title, visibleText: page.text.slice(0, 7000) }, observedNetwork: network.slice(0, 60).map((entry) => ({ method: entry.method, url: entry.url, status: entry.status })), discoveredUrls: urls.slice(0, 100), toolRegistry: (await loadHunterTools()).map((tool) => ({ id: tool.id, name: tool.name, description: tool.description, kind: tool.kind, status: tool.status })) }) },
    ]);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as { summary?: unknown; next_steps?: unknown; missing_tool?: unknown };
    const missing = parsed.missing_tool && typeof parsed.missing_tool === 'object' ? parsed.missing_tool as Record<string, unknown> : null;
    return { summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : fallback.summary, nextSteps: Array.isArray(parsed.next_steps) ? parsed.next_steps.filter((item): item is string => typeof item === 'string').slice(0, 8) : fallback.nextSteps, missingTool: missing && typeof missing.name === 'string' && typeof missing.description === 'string' && typeof missing.purpose === 'string' ? { name: missing.name.slice(0, 64), description: missing.description.slice(0, 500), purpose: missing.purpose.slice(0, 1200) } : undefined };
  } catch { return fallback; }
}

async function generateHunterPythonTool(need: { name: string; description: string; purpose: string }, context: { target: string; pageTitle: string; discoveredUrls: string[]; networkRequestCount: number }): Promise<HunterTool | null> {
  try {
    const raw = await callHunterModel([
      { role: 'system', content: 'Create a reusable passive-only Python helper for an authorized security research app. Define exactly one public function run(args: dict) -> dict. Use only Python standard library. No network, subprocess, filesystem, dynamic imports, eval or exec. Analyze only evidence passed in args. Return JSON only: {"name":"...","description":"...","source":"complete Python source","output_description":"..."}.' },
      { role: 'user', content: JSON.stringify({ requestedTool: need, evidenceContext: context, constraints: 'Offline analysis of supplied evidence only. No active scanning, sockets, or external targets.' }) },
    ]);
    if (!raw) return null;
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<string, unknown>;
    if (typeof parsed.name !== 'string' || typeof parsed.description !== 'string' || typeof parsed.source !== 'string') return null;
    return await saveHunterTool({ name: parsed.name.slice(0, 64), description: parsed.description.slice(0, 500), source: parsed.source, outputDescription: typeof parsed.output_description === 'string' ? parsed.output_description.slice(0, 500) : 'Structured JSON result', tags: ['generated', 'passive-analysis'] });
  } catch { return null; }
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
    const modelPlan = await createAdaptiveHuntPlan(target, page, network, urls);
    if (modelPlan.summary) record.notes.push('خطة الموديل: ' + modelPlan.summary);
    if (modelPlan.nextSteps.length) record.notes.push('الخطوات المقترحة: ' + modelPlan.nextSteps.join(' | '));
    if (modelPlan.missingTool) {
      const generated = await generateHunterPythonTool(modelPlan.missingTool, { target: target.host, pageTitle: page.title, discoveredUrls: urls.slice(0, 80), networkRequestCount: network.length });
      if (generated) record.notes.push('أنشأ Tool Builder مسودة أداة جديدة: ' + generated.name + ' (v' + generated.version + '). لم يتم تشغيلها أو اعتمادها.');
    }
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
