import { fetch } from 'expo/fetch';

export interface ModelInfo {
  id: string;
  name: string;
  /** Context window in tokens, when the provider reports it. */
  contextLength: number | null;
  /** USD per 1M input tokens. null = provider does not report pricing. */
  promptPrice: number | null;
  /** USD per 1M output tokens. null = provider does not report pricing. */
  completionPrice: number | null;
  free: boolean;
  supportsTools: boolean | null;
}

type Json = Record<string, unknown>;

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function modelsEndpoint(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) throw new Error('أضف رابط الخدمة أولًا.');
  base = base.replace(/\/chat\/completions$/, '');
  if (base.endsWith('/models')) return base;
  if (base.endsWith('/v1')) return `${base}/models`;
  return `${base}/v1/models`;
}

/**
 * Providers disagree on units:
 *  - OpenRouter: pricing.prompt / pricing.completion = USD *per token* (string)
 *  - Together / some gateways: pricing.input / pricing.output = USD *per 1M tokens*
 * Returns USD per 1M tokens.
 */
function readPricing(item: Json): {
  prompt: number | null;
  completion: number | null;
} {
  const pricing = item.pricing;
  if (!pricing || typeof pricing !== 'object') {
    return { prompt: null, completion: null };
  }
  const p = pricing as Json;
  const perToken = {
    prompt: asNumber(p.prompt),
    completion: asNumber(p.completion),
  };
  if (perToken.prompt !== null || perToken.completion !== null) {
    return {
      prompt: perToken.prompt === null ? null : perToken.prompt * 1_000_000,
      completion:
        perToken.completion === null ? null : perToken.completion * 1_000_000,
    };
  }
  return { prompt: asNumber(p.input), completion: asNumber(p.output) };
}

function readContext(item: Json): number | null {
  const direct =
    asNumber(item.context_length) ??
    asNumber(item.context_window) ??
    asNumber(item.max_context_length) ??
    asNumber(item.max_model_len) ??
    asNumber(item.inputTokenLimit);
  if (direct) return direct;
  const top = item.top_provider;
  if (top && typeof top === 'object') {
    return asNumber((top as Json).context_length);
  }
  return null;
}

function readTools(item: Json): boolean | null {
  const params = item.supported_parameters;
  if (Array.isArray(params)) return params.includes('tools');
  return null;
}

export function parseModels(payload: unknown): ModelInfo[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Json).data)
      ? ((payload as Json).data as unknown[])
      : payload && typeof payload === 'object' && Array.isArray((payload as Json).models)
        ? ((payload as Json).models as unknown[])
        : [];
  const out: ModelInfo[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Json;
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : null;
    if (!id) continue;
    const { prompt, completion } = readPricing(item);
    const priced = prompt !== null && completion !== null;
    const free = id.endsWith(':free') || (priced && prompt === 0 && completion === 0);
    out.push({
      id,
      name: typeof item.name === 'string' && item.name !== id ? item.name : id,
      contextLength: readContext(item),
      promptPrice: prompt,
      completionPrice: completion,
      free,
      supportsTools: readTools(item),
    });
  }
  return out.sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const response = await fetch(modelsEndpoint(baseUrl), {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('المزود رفض المفتاح. راجع المفتاح والصلاحيات.');
  }
  if (!response.ok) {
    throw new Error(`تعذّر جلب قائمة الموديلات (HTTP ${response.status}). تأكد من الرابط.`);
  }
  const models = parseModels(await response.json());
  if (models.length === 0) throw new Error('المزود لم يرجع أي موديلات.');
  return models;
}

export function formatPrice(model: Pick<ModelInfo, 'free' | 'promptPrice' | 'completionPrice'>): string {
  if (model.free) return 'مجاني';
  if (model.promptPrice === null || model.completionPrice === null) return 'السعر غير معلن';
  const f = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(3)).replace(/\.?0+$/, '');
  return `$${f(model.promptPrice)} دخل / $${f(model.completionPrice)} خرج لكل 1M`;
}

export function formatContext(tokens: number | null | undefined): string {
  if (!tokens) return 'السياق غير معلن';
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M توكن`;
  return `${Math.round(tokens / 1000)}K توكن`;
}
