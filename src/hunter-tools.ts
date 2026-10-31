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
import { collectEndpointCandidates, collectJavaScriptAssets } from './hunter-parsers';
import {
  isAuthorized,
  targetMatchesHost,
  loadTargets,
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
const DEFAULT_PYTHON_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' }, maxItems: 200 },
    urls: { type: 'array', items: { type: 'string' }, maxItems: 200 },
    page_text: { type: 'string', maxLength: 12000 },
  },
  required: [],
  additionalProperties: false,
};
const MAX_RUNS = 100;

export type HunterToolStatus = 'draft' | 'smoke-tested' | 'verified' | 'disabled';
export type HunterToolKind = 'python' | 'builtin';
export interface HunterToolVersion {
  version: number;
  source: string;
  inputSchema?: Record<string, unknown>;
  outputDescription?: string;
  createdAt: string;
  testSummary: string;
}
export interface HunterTool {
  id: string;
  name: string;
  description: string;
  kind: HunterToolKind;
  status: HunterToolStatus;
  /** Version explicitly inspected by the user before testing/approval. */
  reviewedVersion?: number;
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
  plan: { id: string; title: string; detail: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'error' }[];
  pageTitle?: string;
  pageUrl?: string;
  pageTextPreview?: string;
  pageSourcePreview?: string;
  discoveredUrls: string[];
  discoveredSubdomains: string[];
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

type HunterProgressListener = (record: HunterRunRecord) => void;
const hunterProgressListeners = new Set<HunterProgressListener>();
const hunterStopListeners = new Set<() => void>();

export function subscribeHunterProgress(listener: HunterProgressListener): () => void {
  hunterProgressListeners.add(listener);
  return () => hunterProgressListeners.delete(listener);
}
function emitHunterProgress(record: HunterRunRecord): void {
  const snapshot: HunterRunRecord = {
    ...record,
    plan: record.plan.map((step) => ({ ...step })),
    notes: [...record.notes],
    discoveredUrls: [...record.discoveredUrls],
    discoveredSubdomains: [...record.discoveredSubdomains],
  };
  for (const listener of [...hunterProgressListeners]) {
    try { listener(snapshot); } catch { /* UI subscribers must not interrupt a hunt. */ }
  }
}
export function subscribeHunterStop(listener: () => void): () => void {
  hunterStopListeners.add(listener);
  return () => hunterStopListeners.delete(listener);
}
export function requestHunterStop(): void {
  for (const listener of [...hunterStopListeners]) {
    try { listener(); } catch { /* Ignore stale screen listeners. */ }
  }
}

/** Register only a separately isolated runtime adapter; never pass eval/Function here. */
export function registerHunterPythonRuntime(runtime: PythonRuntime): () => void {
  pythonRuntime = runtime;
  return () => { if (pythonRuntime === runtime) pythonRuntime = null; };
}

const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

function assertToolInputSchema(schema: Record<string, unknown>): void {
  const serializedSchema = JSON.stringify(schema) ?? '';
  if (serializedSchema.length > 16_000) throw new Error('مخطط مدخلات الأداة يتجاوز 16KB.');
  if (schema.type !== undefined && schema.type !== 'object') throw new Error('مخطط مدخلات الأداة يجب أن يكون من النوع object.');
  if (schema.properties !== undefined && (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))) {
    throw new Error('properties في مخطط الأداة غير صالح.');
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== 'string'))) {
    throw new Error('required في مخطط الأداة يجب أن يكون قائمة أسماء نصية.');
  }
}

function validateToolArgs(schema: Record<string, unknown>, args: Record<string, unknown>): void {
  const serializedArgs = JSON.stringify(args) ?? '';
  if (Object.keys(args).length > 64 || serializedArgs.length > 64_000) throw new Error('مدخلات الأداة تتجاوز الحدود المسموحة.');
  if (!Object.keys(schema).length) return;
  assertToolInputSchema(schema);
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  if (Object.keys(properties).length > 64) throw new Error('مخطط الأداة يحتوي على أكثر من 64 مدخلًا.');
  const required = Array.isArray(schema.required) ? schema.required as string[] : [];
  if (required.length > 64) throw new Error('قائمة المدخلات المطلوبة طويلة جدًا.');
  for (const key of required) {
    if (!(key in properties)) throw new Error('مخطط الأداة يطلب مدخلًا غير معرّف: ' + key);
    if (!(key in args)) throw new Error('مدخل مطلوب مفقود: ' + key);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) if (!(key in properties)) throw new Error('مدخل غير معرّف في مخطط الأداة: ' + key);
  }
  for (const [key, rawRule] of Object.entries(properties)) {
    if (!(key in args) || !rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) continue;
    const rule = rawRule as Record<string, unknown>;
    const value = args[key];
    if (Array.isArray(rule.enum) && !(rule.enum as unknown[]).some((item) => Object.is(item, value))) {
      throw new Error('قيمة غير مسموحة للمدخل: ' + key);
    }
    const type = rule.type;
    const valid = type === undefined ||
      (type === 'string' && typeof value === 'string') ||
      (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
      (type === 'boolean' && typeof value === 'boolean') ||
      (type === 'array' && Array.isArray(value)) ||
      (type === 'object' && !!value && typeof value === 'object' && !Array.isArray(value)) ||
      (type === 'null' && value === null);
    if (!valid) throw new Error('نوع المدخل غير صحيح: ' + key + ' (المطلوب ' + String(type) + ').');
    if (type === 'string' && typeof value === 'string') {
      if (typeof rule.minLength === 'number' && value.length < rule.minLength) throw new Error('المدخل أقصر من الحد المطلوب: ' + key);
      if (typeof rule.maxLength === 'number' && value.length > rule.maxLength) throw new Error('المدخل أطول من الحد المسموح: ' + key);
    }
    if (type === 'array' && Array.isArray(value) && typeof rule.maxItems === 'number' && value.length > rule.maxItems) {
      throw new Error('عدد عناصر المدخل يتجاوز الحد: ' + key);
    }
    if (type === 'array' && Array.isArray(value) && rule.items && typeof rule.items === 'object' && !Array.isArray(rule.items)) {
      const itemType = (rule.items as Record<string, unknown>).type;
      if (itemType === 'string' && value.some((item) => typeof item !== 'string')) throw new Error('كل عناصر المدخل يجب أن تكون نصوصًا: ' + key);
    }
  }
}


export const BUILTIN_HUNTER_TOOLS: HunterTool[] = [
  {
    id: 'hunter.extract-endpoints',
    name: 'Endpoint Collector',
    description: 'Extract same-scope links, API paths and endpoint candidates from browser-observed page text and network records.',
    kind: 'builtin',
    status: 'verified',
    inputSchema: { type: 'object', properties: { targetHost: { type: 'string' }, pageUrl: { type: 'string' }, pageText: { type: 'string' }, urls: { type: 'array', items: { type: 'string' }, maxItems: 500 } }, required: ['targetHost', 'pageText', 'urls'], additionalProperties: false },
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
    id: 'hunter.passive-subdomain-discovery',
    name: 'Passive Subdomain Discovery',
    description: 'Collect certificate-transparency names for the explicitly saved root domain. Does not resolve or probe discovered hosts.',
    kind: 'builtin',
    status: 'verified',
    inputSchema: { type: 'object', properties: { targetHost: { type: 'string' } }, required: ['targetHost'], additionalProperties: false },
    outputDescription: 'Deduplicated in-scope subdomain names from public certificate transparency records.',
    source: 'builtin:ct-subdomain:v1',
    version: 1,
    versions: [{ version: 1, source: 'builtin:ct-subdomain:v1', createdAt: '2026-10-30T00:00:00.000Z', testSummary: 'Passive certificate-transparency lookup; no target probing.' }],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    useCount: 0,
    tags: ['recon', 'subdomain', 'passive'],
  },
  {
    id: 'hunter.javascript-inventory',
    name: 'JavaScript Inventory',
    description: 'Collect JavaScript asset URLs exposed by page links and captured same-scope network traffic.',
    kind: 'builtin',
    status: 'verified',
    inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 500 } }, required: ['urls'], additionalProperties: false },
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
  const inputSchema = input.inputSchema ?? existing?.inputSchema ?? DEFAULT_PYTHON_INPUT_SCHEMA;
  assertToolInputSchema(inputSchema);
  if (!input.id && tools.some((tool) => tool.name.toLowerCase() === name.toLowerCase())) throw new Error('يوجد اسم أداة مطابق بالفعل؛ افتح الأداة الموجودة لإنشاء إصدار جديد.');
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
      reviewedVersion: undefined,
      inputSchema,
      outputDescription: input.outputDescription ?? existing.outputDescription,
      version,
      versions: [...(existing.versions.some((item) => item.version === existing.version) ? existing.versions : [...existing.versions, { version: existing.version, source: existing.source, inputSchema: existing.inputSchema, outputDescription: existing.outputDescription, createdAt: existing.createdAt, testSummary: 'Previous version retained.' }]), { version, source, inputSchema, outputDescription: input.outputDescription ?? existing.outputDescription, createdAt: timestamp, testSummary: 'Draft — awaiting review and test.' }].slice(-50),
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
    inputSchema,
    outputDescription: input.outputDescription ?? 'لم يتم تحديد شكل المخرجات بعد.',
    source,
    version: 1,
    versions: [{ version: 1, source, inputSchema, outputDescription: input.outputDescription ?? 'لم يتم تحديد شكل المخرجات بعد.', createdAt: timestamp, testSummary: 'Not tested yet.' }],
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

export async function setHunterToolStatus(id: string, status: HunterToolStatus, testSummary?: string, expectedVersion?: number): Promise<void> {
  const tools = await loadHunterTools();
  const current = tools.find((tool) => tool.id === id);
  if (!current) throw new Error('الأداة لم تعد موجودة.');
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    throw new Error('تغيّر إصدار الأداة أثناء العملية. أعد المراجعة والاختبار للإصدار الحالي.');
  }
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

export async function markHunterToolReviewed(id: string): Promise<void> {
  const tools = await loadHunterTools();
  const tool = tools.find((item) => item.id === id);
  if (!tool || tool.kind !== 'python' || tool.status !== 'draft') throw new Error('افتح أداة Python في حالة Draft لمراجعة مصدرها أولًا.');
  await persistTools(tools.map((item) => item.id === id ? { ...item, reviewedVersion: tool.version, versions: item.versions.map((version) => version.version === item.version ? { ...version, testSummary: 'Source reviewed by user; awaiting manual smoke test.' } : version) } : item));
}

export async function smokeTestHunterPythonTool(id: string): Promise<string> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python') throw new Error('أداة Python غير موجودة.');
  if (tool.status !== 'draft' || tool.reviewedVersion !== tool.version) throw new Error('راجع مصدر الإصدار الحالي وأكّد المراجعة قبل تشغيل الاختبار.');
  if (!pythonRuntime) throw new Error('محرك Python المحلي لم يجهز بعد.');
  const result = await pythonRuntime.execute({ source: tool.source, args: { target: 'example.invalid', evidence: [], urls: [] }, timeoutMs: 8_000, maxOutputBytes: 64_000, network: 'disabled' });
  if (!result.value || typeof result.value !== 'object') throw new Error('الأداة لم تُرجع نتيجة JSON منظمة.');
  const summary = 'Smoke test passed: run(args) returned JSON-compatible output; network disabled.';
  const latest = (await loadHunterTools()).find((item) => item.id === id);
  if (!latest || latest.version !== tool.version || latest.reviewedVersion !== tool.version) throw new Error('تغيّر مصدر الأداة أثناء الاختبار؛ لم يتم تسجيل النتيجة على إصدار آخر.');
  await setHunterToolStatus(id, 'smoke-tested', summary, tool.version);
  return result.output;
}

export async function approveHunterPythonTool(id: string): Promise<void> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python' || tool.status !== 'smoke-tested' || tool.reviewedVersion !== tool.version) throw new Error('يجب مراجعة مصدر الإصدار الحالي واختباره يدويًا قبل الاعتماد.');
  await setHunterToolStatus(id, 'verified', 'User reviewed source and approved after smoke test.', tool.version);
}

async function discoverPassiveSubdomains(targetHost: string): Promise<string[]> {
  const savedTargets = await loadTargets();
  const target = savedTargets.find((item) => item.host.toLowerCase() === targetHost.toLowerCase());
  if (!target) throw new Error('أداة اكتشاف النطاقات الفرعية تتطلب تارجت محفوظًا.');
  const probeHost = target.host.startsWith('*.') ? 'www.' + target.host.slice(2) : target.host;
  const authorization = isAuthorized('https://' + probeHost + '/', [target]);
  if (!authorization.ok) throw new Error(authorization.reason);
  const root = target.host.startsWith('*.') ? target.host.slice(2).toLowerCase() : target.host.toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('https://crt.sh/?q=%25.' + encodeURIComponent(root) + '&output=json', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Certificate Transparency lookup HTTP ' + response.status);
    const rows = await response.json() as { name_value?: string }[];
    const names = new Set<string>();
    for (const row of rows.slice(0, 5000)) {
      const entries = (row.name_value ?? '').replace(/\r/g, '').split('\n');
      for (const raw of entries) {
        const value = raw.trim().toLowerCase();
        const name = (value.startsWith('*.') ? value.slice(2) : value).replace(/\.$/, '');
        if (name !== root && name.endsWith('.' + root) && /^[a-z0-9.-]+$/.test(name)) names.add(name);
      }
    }
    return [...names].slice(0, 500);
  } finally {
    clearTimeout(timeout);
  }
}

export async function listHunterToolCatalog(): Promise<string> {
  const tools = await loadHunterTools();
  return JSON.stringify(tools.map((tool) => ({
    id: tool.id, name: tool.name, description: tool.description, kind: tool.kind,
    status: tool.status, version: tool.version, tags: tool.tags,
    inputSchema: tool.inputSchema, outputDescription: tool.outputDescription,
  })));
}

export async function runHunterRegistryTool(id: string, args: Record<string, unknown>): Promise<string> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.status !== 'verified') throw new Error('الأداة غير موجودة أو لم يتم اعتمادها.');
  validateToolArgs(tool.inputSchema, args);
  let result: string;
  if (tool.kind === 'python') {
    result = await runPythonHunterTool(id, args);
  } else if (id === 'hunter.extract-endpoints') {
    const pageText = typeof args.pageText === 'string' ? args.pageText : '';
    const targetHost = typeof args.targetHost === 'string' ? args.targetHost : '';
    const urls = Array.isArray(args.urls) ? args.urls.filter((item): item is string => typeof item === 'string') : [];
    const snapshot: EmbeddedBrowserSnapshot = { url: typeof args.pageUrl === 'string' ? args.pageUrl : 'https://' + targetHost + '/', title: '', text: pageText, elements: [] };
    const observed = urls.map((url, index) => ({ id: 'observed-' + index, source: 'fetch' as const, method: 'GET', url, createdAt: now(), elapsedMs: 0, status: null, requestHeaders: {}, requestBody: '' }));
    result = JSON.stringify({ endpoints: collectEndpointCandidates(snapshot, observed, targetHost), suppliedUrlCount: urls.length });
  } else if (id === 'hunter.passive-subdomain-discovery') {
    const targetHost = typeof args.targetHost === 'string' ? args.targetHost.trim().toLowerCase() : '';
    result = JSON.stringify({ source: 'crt.sh certificate transparency', passive: true, subdomains: await discoverPassiveSubdomains(targetHost) });
  } else if (id === 'hunter.javascript-inventory') {
    const urls = Array.isArray(args.urls) ? args.urls.filter((item): item is string => typeof item === 'string') : [];
    result = JSON.stringify({ javascriptAssets: collectJavaScriptAssets(urls) });
  } else { throw new Error('نوع الأداة المدمجة غير مدعوم.'); }
  if (tool.kind !== 'python') {
    const tools = await loadHunterTools();
    await persistTools(tools.map((item) => item.id === id ? { ...item, lastUsedAt: now(), useCount: item.useCount + 1 } : item));
  }
  return result.slice(0, 64_000);
}

/**
 * Runs a generated passive helper on supplied evidence in the isolated,
 * network-disabled worker. Its status remains Draft until human approval.
 */
export async function checkAndRunDraftPythonTool(id: string, args: Record<string, unknown>): Promise<string> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python' || tool.status !== 'draft') throw new Error('الأداة ليست مسودة قابلة للفحص.');
  const forbidden = [
    /\b(?:import|from|open|eval|exec|compile|globals|locals|vars|getattr|setattr|delattr|memoryview|breakpoint)\b/i,
    /__/,
    /\b(?:socket|subprocess|requests|httpx|urllib|aiohttp|websocket|pathlib|os|sys|ctypes|js)\b/i,
  ];
  if (tool.source.length > MAX_SOURCE_LENGTH || forbidden.some((pattern) => pattern.test(tool.source))) {
    const reason = 'Automated source review blocked imports, dunder access, reflection, filesystem and network APIs.';
    await setHunterToolStatus(id, 'draft', reason, tool.version);
    throw new Error('فشل الفحص الساكن: المصدر يحتوي واجهات محظورة أو يتجاوز حد الحجم.');
  }
  if (!pythonRuntime) throw new Error('محرك Python غير جاهز؛ لم يتم تشغيل الأداة.');
  validateToolArgs(tool.inputSchema, args);
  const result = await pythonRuntime.execute({
    source: tool.source, args, timeoutMs: 8_000, maxOutputBytes: 64_000, network: 'disabled',
  });
  if (!result.value || typeof result.value !== 'object') throw new Error('الأداة لم تُرجع مخرجات JSON منظمة.');
  await setHunterToolStatus(
    id,
    'draft',
    'Automated offline sandbox test + evidence execution passed. Network disabled. User approval is still required.',
    tool.version,
  );
  return result.output.slice(0, 8_000);
}

export async function runPythonHunterTool(id: string, args: Record<string, unknown>): Promise<string> {
  const tool = (await loadHunterTools()).find((item) => item.id === id);
  if (!tool || tool.kind !== 'python') throw new Error('أداة Python غير موجودة.');
  validateToolArgs(tool.inputSchema, args);
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

export async function runSafeHttpHeaderChecks(target: HunterTarget, runId: string): Promise<HunterRunRecord> {
  const savedTargets = await loadTargets();
  const savedTarget = savedTargets.find((item) => item.id === target.id && item.host.toLowerCase() === target.host.toLowerCase());
  if (!savedTarget) throw new Error('النطاق لم يعد محفوظًا أو لم يعد مصرحًا به.');
  const runs = await loadHunterRuns();
  const run = runs.find((item) => item.id === runId && item.target.toLowerCase() === target.host.toLowerCase());
  if (!run) throw new Error('عملية Hunting الأصلية غير موجودة.');
  const browser = await waitForEmbeddedBrowser(12_000);
  const candidates = [...new Set(run.discoveredUrls)].filter((url) => {
    try { return isAuthorized(url, [savedTarget]).ok && new URL(url).protocol === 'https:'; }
    catch { return false; }
  }).slice(0, 6);
  if (!candidates.length) throw new Error('لا توجد endpoints HTTPS داخل النطاق لإجراء فحص HEAD الآمن.');
  run.plan.push({ id: 'safe-headers', title: 'Safe HTTP header checks', detail: 'HEAD فقط، دون body أو payload أو تغيير بيانات؛ يتطلب ضغط المستخدم على زر الفحص.', status: 'done' });
  const findings: string[] = [];
  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await browser.sendRequest({ url, method: 'HEAD', headers: { Accept: '*/*' }, body: '', signal: controller.signal });
      if (!isAuthorized(response.url, [savedTarget]).ok) {
        findings.push('تم تجاهل استجابة أعادت توجيه الطلب خارج النطاق: ' + url);
        continue;
      }
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
      const missing = [
        !headers['strict-transport-security'] ? 'HSTS' : '',
        !headers['content-security-policy'] ? 'CSP' : '',
        !headers['x-content-type-options'] ? 'X-Content-Type-Options' : '',
        !headers['referrer-policy'] ? 'Referrer-Policy' : '',
        !headers['permissions-policy'] ? 'Permissions-Policy' : '',
        !headers['x-frame-options'] && !/frame-ancestors/i.test(headers['content-security-policy'] ?? '') ? 'anti-clickjacking' : '',
      ].filter(Boolean);
      findings.push(response.status + ' ' + url + ': ' + (missing.length ? 'headers not observed: ' + missing.join(', ') : 'baseline security headers observed'));
    } catch (error) {
      findings.push('تعذّر فحص HEAD لـ ' + url + ': ' + (error instanceof Error ? error.message : 'network error'));
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  run.notes.push('Safe HTTP header checks (explicit user action; HEAD only; ' + candidates.length + ' URLs max): ' + findings.join(' | ').slice(0, 6000));
  run.finishedAt = now();
  await saveHunterRun(run);
  return run;
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
      { role: 'user', content: JSON.stringify({ authorizedTarget: target.host, authorizationNote: target.authorization.slice(0, 1200), page: { url: page.url, title: page.title, visibleText: page.text.slice(0, 7000), sourcePreview: (page.source ?? '').slice(0, 5000) }, observedNetwork: network.slice(0, 60).map((entry) => ({ method: entry.method, url: entry.url, status: entry.status })), discoveredUrls: urls.slice(0, 100), toolRegistry: (await loadHunterTools()).map((tool) => ({ id: tool.id, name: tool.name, description: tool.description, kind: tool.kind, status: tool.status })) }) },
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
      { role: 'system', content: 'Create a reusable passive-only Python helper for an authorized security research app. Define exactly one public function run(args: dict) -> dict. Use only Python built-in syntax and built-in data types; do not use imports, filesystem, network, subprocess, dynamic execution, reflection, dunder names, or access to runtime objects. Analyze only evidence passed in args. Return JSON only: {"name":"...","description":"...","input_schema":{"type":"object","properties":{},"required":[],"additionalProperties":false},"source":"complete Python source","output_description":"..."}.' },
      { role: 'user', content: JSON.stringify({ requestedTool: need, evidenceContext: context, constraints: 'Pure offline analysis of supplied evidence only. No imports, active scanning, sockets, or external targets.' }) },
    ]);
    if (!raw) return null;
    const parsed = JSON.parse(raw.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '')) as Record<string, unknown>;
    if (typeof parsed.name !== 'string' || typeof parsed.description !== 'string' || typeof parsed.source !== 'string') return null;
    const inputSchema = parsed.input_schema && typeof parsed.input_schema === 'object' && !Array.isArray(parsed.input_schema)
      ? parsed.input_schema as Record<string, unknown>
      : DEFAULT_PYTHON_INPUT_SCHEMA;
    const tool = await saveHunterTool({
      name: parsed.name.slice(0, 64),
      inputSchema,
      description: parsed.description.slice(0, 500),
      source: parsed.source,
      outputDescription: typeof parsed.output_description === 'string' ? parsed.output_description.slice(0, 500) : 'Structured JSON result',
      tags: ['generated', 'passive-analysis'],
    });
    // Generated code is always Draft. The user must inspect it, explicitly run
    // the isolated smoke test, then approve this exact version.
    await setHunterToolStatus(tool.id, 'draft', 'Generated by the model. Awaiting user source review, explicit smoke test, and approval.');
    return { ...tool, status: 'draft' };
  } catch { return null; }
}

/**
 * A conservative browser-first reconnaissance pass. It never probes newly
 * discovered hosts; every request stays on the explicitly authorized host tree.
 */
export async function runBrowserRecon(
  target: HunterTarget,
  signal?: AbortSignal,
  onProgress?: HunterProgressListener,
): Promise<HunterRunRecord> {
  const startedAt = now();
  const rootHost = target.host.startsWith('*.') ? target.host.slice(2) : target.host;
  const rootUrl = target.host.startsWith('*.') ? `https://www.${rootHost}/` : `https://${rootHost}/`;
  const scope = isAuthorized(rootUrl, [target]);
  if (!scope.ok) throw new Error(scope.reason);

  const plan: HunterRunRecord['plan'] = [
    { id: 'scope', title: 'تأكيد النطاق', detail: 'التحقق من تصريح الهدف قبل أي اتصال.', status: 'done' },
    { id: 'browser', title: 'فتح الموقع وقراءة الصفحة', detail: 'فتح الهدف في WebView وقراءة النص والعناصر.', status: 'pending' },
    { id: 'network', title: 'جمع طلبات الشبكة', detail: 'قراءة fetch وXHR وطلبات التنقل المرصودة داخل النطاق.', status: 'pending' },
    { id: 'discovery', title: 'اكتشاف الروابط والملفات', detail: 'استخراج endpoints وملفات JavaScript والنطاقات الفرعية السلبية.', status: 'pending' },
    { id: 'planning', title: 'تحليل الموديل وبناء الأدوات', detail: 'مقارنة الأدلة بالأدوات الموجودة واقتراح أداة Python عند الحاجة.', status: 'pending' },
    { id: 'python', title: 'اختبار الأداة على الأدلة', detail: 'فحص المصدر وتشغيل مساعد Python دون شبكة؛ يظل Draft حتى اعتماد المستخدم.', status: 'pending' },
    { id: 'baseline', title: 'فحوص المواقع المكتشفة', detail: 'إرسال HEAD فقط إلى روابط HTTPS داخل النطاق، بحد أقصى 6 روابط.', status: 'pending' },
    { id: 'reusable', title: 'تشغيل الأدوات المعتمدة', detail: 'تشغيل أدوات التحليل السابقة على الأدلة الجديدة داخل Python المعزول.', status: 'pending' },
  ];
  const record: HunterRunRecord = {
    id: makeId('hunt'), target: target.host, startedAt, finishedAt: startedAt,
    status: 'partial', plan, discoveredUrls: [], discoveredSubdomains: [], networkRequests: 0, notes: [],
  };
  const checkpoint = async () => {
    record.finishedAt = now();
    await saveHunterRun(record);
    emitHunterProgress(record);
    onProgress?.(record);
  };
  const assertRunning = async () => {
    if (signal?.aborted) throw new Error('تم إيقاف Hunting بواسطة المستخدم.');
    const saved = await loadTargets();
    const current = saved.find((item) => item.id === target.id && item.host.toLowerCase() === target.host.toLowerCase());
    if (!current || !isAuthorized(rootUrl, [current]).ok) throw new Error('تم حذف تصريح الهدف أو تغييره أثناء التشغيل.');
  };
  const updateStep = async (id: string, status: HunterRunRecord['plan'][number]['status'], detail?: string) => {
    const step = plan.find((item) => item.id === id);
    if (step) { step.status = status; if (detail) step.detail = detail; }
    await checkpoint();
  };
  await checkpoint();

  try {
    await assertRunning();
    await updateStep('browser', 'running', 'المتصفح يفتح الهدف وينتظر اكتمال التحميل.');
    const browser = await waitForEmbeddedBrowser(20_000);
    const snapshot = await browser.navigate(rootUrl, target.host, true);
    await assertRunning();
    const page = await browser.readPage();
    record.pageTitle = page.title;
    record.pageUrl = page.url;
    record.pageTextPreview = page.text.slice(0, 12_000);
    record.pageSourcePreview = (page.source ?? '').slice(0, 16_000);
    await updateStep('browser', 'done', `تم فتح ${page.url} وقراءة ${page.text.length} حرفًا.`);
    void snapshot;

    await updateStep('network', 'running', 'قراءة سجل الشبكة وتنقية كل عنوان وفق تصريح الهدف.');
    const network = (await browser.getNetworkLog()).filter((entry) => {
      try { return isAuthorized(entry.url, [target]).ok; } catch { return false; }
    }).slice(0, 200);
    record.networkRequests = network.length;
    await updateStep('network', 'done', `تم جمع ${network.length} طلبًا داخل النطاق.`);

    await updateStep('discovery', 'running', 'استخراج endpoints وملفات JavaScript.');
    const endpointResult = await runHunterRegistryTool('hunter.extract-endpoints', {
      pageText: page.text + '\n' + (page.source ?? ''),
      urls: network.map((entry) => entry.url), targetHost: target.host, pageUrl: page.url,
    });
    const endpointData = JSON.parse(endpointResult) as { endpoints?: string[] };
    const urls = (endpointData.endpoints ?? collectEndpointCandidates(page, network, target.host))
      .filter((candidate) => { try { return isAuthorized(candidate, [target]).ok; } catch { return false; } })
      .slice(0, 200);
    record.discoveredUrls = [...new Set([page.url, ...urls])];
    const jsResult = await runHunterRegistryTool('hunter.javascript-inventory', { urls: record.discoveredUrls });
    const jsAssets = (JSON.parse(jsResult) as { javascriptAssets?: string[] }).javascriptAssets ?? [];
    try {
      const subdomainResult = await runHunterRegistryTool('hunter.passive-subdomain-discovery', { targetHost: target.host });
      record.discoveredSubdomains = (JSON.parse(subdomainResult) as { subdomains?: string[] }).subdomains ?? [];
      record.notes.push(`Certificate Transparency: ${record.discoveredSubdomains.length} نطاقات فرعية مرصودة سلبيًا؛ لم تُفحص.`);
    } catch (error) {
      record.notes.push('تعذّر الاستعلام السلبي عن النطاقات الفرعية: ' + (error instanceof Error ? error.message : 'network error'));
    }
    record.notes.push(`الاكتشاف: ${record.discoveredUrls.length} رابطًا ضمن النطاق و${jsAssets.length} ملف JavaScript.`);
    await updateStep('discovery', 'done', `اكتمل الاكتشاف: ${record.discoveredUrls.length} رابط و${jsAssets.length} ملف JS.`);

    await assertRunning();
    await updateStep('planning', 'running', 'الموديل يحلل الأدلة ويقارنها بالأدوات المسجلة.');
    const modelPlan = await createAdaptiveHuntPlan(target, page, network, record.discoveredUrls);
    if (modelPlan.summary) record.notes.push('تحليل الموديل: ' + modelPlan.summary);
    if (modelPlan.nextSteps.length) record.notes.push('خطة الموديل: ' + modelPlan.nextSteps.join(' | '));
    await updateStep('planning', 'done', 'انتهى تحليل الأدلة ووضع الخطوات التالية.');

    await updateStep('python', 'running', 'فحص الأدوات وبناء مساعدة جديدة عند وجود حاجة فعلية.');
    let generatedTool: HunterTool | null = null;
    if (modelPlan.missingTool) {
      generatedTool = await generateHunterPythonTool(modelPlan.missingTool, {
        target: target.host, pageTitle: page.title,
        discoveredUrls: record.discoveredUrls.slice(0, 80), networkRequestCount: network.length,
      });
      if (generatedTool) record.notes.push(`بنى الموديل أداة Python Draft: ${generatedTool.name} v${generatedTool.version}.`);
      else record.notes.push('تعذّر بناء أداة Python صالحة رغم اقتراح الموديل.');
    } else {
      record.notes.push('لا توجد أداة جديدة مطلوبة لهذه الأدلة؛ سيتم تشغيل الأدوات المعتمدة فقط.');
    }

    const evidence: Record<string, unknown> = {
      target: target.host,
      evidence: record.discoveredUrls.slice(0, 200),
      urls: record.discoveredUrls.slice(0, 200),
      page_text: page.text.slice(0, 12_000),
      pageTitle: page.title,
      pageUrl: page.url,
      pageSource: (page.source ?? '').slice(0, 16_000),
      javascriptAssets: jsAssets.slice(0, 100),
      networkRequests: network.slice(0, 100).map((entry) => ({ method: entry.method, url: entry.url, status: entry.status })),
    };
    if (generatedTool) {
      try {
        const properties = (generatedTool.inputSchema.properties ?? {}) as Record<string, unknown>;
        const args = Object.fromEntries(Object.keys(properties).filter((key) => key in evidence).map((key) => [key, evidence[key]]));
        const output = await checkAndRunDraftPythonTool(generatedTool.id, args);
        record.notes.push('اجتاز فحص الأداة المولدة وتنفيذها offline: ' + output.slice(0, 1200) + ' · بقيت Draft وتحتاج اعتمادك.');
      } catch (error) {
        record.notes.push('فشل الفحص الآلي للأداة المولدة: ' + (error instanceof Error ? error.message : 'Python runtime error'));
      }
    }
    await updateStep('python', 'done', generatedTool
      ? 'تم إنشاء المسودة وفحصها وتشغيلها على الأدلة دون شبكة؛ لم يتم اعتمادها.'
      : 'انتهى بناء الأدوات دون حاجة لأداة جديدة.');

    await assertRunning();
    await updateStep('baseline', 'running', 'فحص HEAD غير المدمّر للروابط المكتشفة والمسموح بها فقط.');
    const candidates = [...new Set(record.discoveredUrls)].filter((url) => {
      try { return new URL(url).protocol === 'https:' && isAuthorized(url, [target]).ok; } catch { return false; }
    }).slice(0, 6);
    const findings: string[] = [];
    for (const candidate of candidates) {
      await assertRunning();
      try {
        const response = await browser.sendRequest({
          url: candidate, method: 'HEAD', headers: { Accept: '*/*' }, body: '', signal,
        });
        if (!isAuthorized(response.url, [target]).ok) {
          findings.push('رفض استجابة خارج النطاق: ' + candidate);
          continue;
        }
        const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
        const missing = [
          !headers['strict-transport-security'] ? 'HSTS' : '',
          !headers['content-security-policy'] ? 'CSP' : '',
          !headers['x-content-type-options'] ? 'X-Content-Type-Options' : '',
          !headers['referrer-policy'] ? 'Referrer-Policy' : '',
          !headers['permissions-policy'] ? 'Permissions-Policy' : '',
          !headers['x-frame-options'] && !/frame-ancestors/i.test(headers['content-security-policy'] ?? '') ? 'anti-clickjacking' : '',
        ].filter(Boolean);
        findings.push(`HEAD ${response.status} ${candidate}: ${missing.length ? 'لم تُرصد ' + missing.join(', ') : 'تم رصد ترويسات الأمان الأساسية'}`);
      } catch (error) {
        findings.push(`HEAD تعذّر ${candidate}: ${error instanceof Error ? error.message : 'network error'}`);
      }
      await checkpoint();
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    record.notes.push(candidates.length
      ? 'نتائج الفحص التلقائي الآمن: ' + findings.join(' | ').slice(0, 6000)
      : 'لم توجد روابط HTTPS داخل النطاق لإجراء فحص HEAD.');
    await updateStep('baseline', 'done', `تم فحص ${findings.length} رابطًا بـHEAD فقط؛ دون payload أو تغيير بيانات.`);

    await assertRunning();
    await updateStep('reusable', 'running', 'تشغيل أدوات Python المعتمدة فقط على الأدلة الجديدة.');
    const reusableTools = (await loadHunterTools()).filter((tool) => tool.kind === 'python' && tool.status === 'verified').slice(0, 10);
    for (const tool of reusableTools) {
      await assertRunning();
      try {
        const properties = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
        const args = Object.keys(properties).length
          ? Object.fromEntries(Object.keys(properties).filter((key) => key in evidence).map((key) => [key, evidence[key]]))
          : tool.inputSchema?.additionalProperties === false ? {} : evidence;
        const output = await runPythonHunterTool(tool.id, args);
        record.notes.push(`شغّل ${tool.name} v${tool.version}: ${output.slice(0, 1400)}`);
      } catch (error) {
        record.notes.push(`فشل تشغيل ${tool.name}: ${error instanceof Error ? error.message : 'runtime error'}`);
      }
      await checkpoint();
    }
    await updateStep('reusable', 'done', `تم تشغيل ${reusableTools.length} أداة معتمدة على الأدلة.`);
    record.status = 'completed';
  } catch (error) {
    record.status = signal?.aborted ? 'stopped' : record.pageUrl ? 'partial' : 'failed';
    record.notes.push(error instanceof Error ? error.message : 'تعذّر إكمال الاستطلاع.');
    const running = plan.find((step) => step.status === 'running');
    if (running) {
      running.status = signal?.aborted ? 'skipped' : 'error';
      running.detail += ' ' + (error instanceof Error ? error.message : 'تعذّر إكمال الخطوة.');
    }
    for (const step of plan) if (step.status === 'pending') step.status = 'skipped';
  }
  record.finishedAt = now();
  await saveHunterRun(record);
  emitHunterProgress(record);
  onProgress?.(record);
  return record;
}
