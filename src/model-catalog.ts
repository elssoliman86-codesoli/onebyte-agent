import { fetchWithRetry } from './fetch-with-retry';

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
  /** Image input support when the provider publishes modality metadata. */
  supportsImages?: boolean | null;
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
  // Accept a root URL, an OpenAI API base, or a pasted full endpoint.
  base = base.replace(/\/chat\/completions$/, '');
  if (base.endsWith('/v1/v1')) base = base.slice(0, -3);
  if (base.includes('generativelanguage.googleapis.com') && base.endsWith('/openai')) {
    return base.replace(/\/openai$/, '/models');
  }
  if (base === 'https://opencode.ai/inference/openai/v1') {
    return 'https://opencode.ai/inference/v1/models';
  }
  if (base.endsWith('/openai')) return `${base}/models`;
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

function readImageSupport(item: Json): boolean | null {
  const architecture = item.architecture && typeof item.architecture === 'object'
    ? item.architecture as Json : null;
  const candidates = [item.input_modalities, item.modalities, architecture?.input_modalities];
  for (const value of candidates) {
    if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
      return value.some(v => /image|vision|photo/i.test(v as string));
    }
  }
  const modality = architecture?.modality;
  if (typeof modality === 'string' && modality.trim()) return /image|vision/i.test(modality);
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
    const rawId = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : null;
    const id = rawId?.replace(/^models\//, '') ?? null;
    if (!id) continue;
    const displayName = typeof item.name === 'string' ? item.name.replace(/^models\//, '') : id;
    const { prompt, completion } = readPricing(item);
    const priced = prompt !== null && completion !== null;
    const free = id.endsWith(':free') || (priced && prompt === 0 && completion === 0);
    out.push({
      id,
      name: displayName !== id ? displayName : id,
      contextLength: readContext(item),
      promptPrice: prompt,
      completionPrice: completion,
      free,
      supportsTools: readTools(item),
      supportsImages: readImageSupport(item),
    });
  }
  return out.sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
}

/** Known keyless models when the provider has no OpenAI-style /models endpoint. */
const FREE_ONEBYTE_MODELS: ModelInfo[] = [
  { id: 'openai', name: 'openai (مجاني)', contextLength: 32000, promptPrice: 0, completionPrice: 0, free: true, supportsTools: null },
  { id: 'openai-reasoning', name: 'openai-reasoning (مجاني)', contextLength: 32000, promptPrice: 0, completionPrice: 0, free: true, supportsTools: null },
  { id: 'openai-large', name: 'openai-large (مجاني)', contextLength: 32000, promptPrice: 0, completionPrice: 0, free: true, supportsTools: null },
  { id: 'qwen-coder', name: 'qwen-coder (مجاني)', contextLength: 32000, promptPrice: 0, completionPrice: 0, free: true, supportsTools: null },
  { id: 'mistral', name: 'mistral (مجاني)', contextLength: 32000, promptPrice: 0, completionPrice: 0, free: true, supportsTools: null },
];

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const normalizedBase = baseUrl.trim();
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(normalizedBase)) {
    throw new Error('عنوان localhost يعمل على نفس الجهاز فقط. لو OmniRoute شغال على الكمبيوتر والموديل من موبايل Android، استخدم IP الكمبيوتر على الشبكة مثل http://192.168.1.10:20128/v1 وافتح المنفذ في الجدار الناري.');
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    if (normalizedBase.includes('generativelanguage.googleapis.com')) {
      headers['x-goog-api-key'] = apiKey;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  const endpoint = modelsEndpoint(normalizedBase);
  let response: Response;
  try {
    response = await fetchWithRetry(
      endpoint,
      { headers },
      { timeout: 30_000, maxRetries: 2, baseDelay: 1_000, signal },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let host = "";
    try {
      host = new URL(normalizedBase).hostname;
    } catch {
      // Keep the raw URL in the fallback message when the input is malformed.
    }

    if (/CLEARTEXT communication/i.test(message)) {
      throw new Error(
        `Android منع اتصال HTTP غير المشفّر إلى ${host || normalizedBase}. أضف عنوان المضيف إلى allowedHosts في app.json ثم أعد بناء APK؛ إعادة فتح التطبيق وحدها لا تكفي.`
      );
    }

    if (
      /fetch failed|Network request failed|UnknownServiceException|ECONNREFUSED|ENETUNREACH|ETIMEDOUT/i.test(
        message
      )
    ) {
      throw new Error(
        `تعذّر الوصول إلى خدمة الموديلات على ${host || normalizedBase}. تأكد أن الهاتف والكمبيوتر على نفس شبكة Wi-Fi، وأن OmniRoute يستمع لاتصالات الشبكة المحلية وأن جدار حماية Windows يسمح بالمنفذ 20128.`
      );
    }

    throw error;
  }
  if ((response.status === 401 || response.status === 403) && apiKey && !normalizedBase.includes('generativelanguage.googleapis.com')) {
    response = await fetchWithRetry(
      endpoint,
      { headers: { Accept: 'application/json', 'x-api-key': apiKey } },
      { timeout: 30_000, maxRetries: 0, baseDelay: 0, signal },
    );
  }
  if (response.status === 401 || response.status === 403) {
    if (normalizedBase.includes('text.pollinations.ai') && !apiKey) return FREE_ONEBYTE_MODELS;
    throw new Error('المزود رفض المفتاح. راجع المفتاح والصلاحيات.');
  }
  if (!response.ok) {
    if (normalizedBase.includes('text.pollinations.ai')) return FREE_ONEBYTE_MODELS;
    throw new Error(`تعذّر جلب قائمة الموديلات (HTTP ${response.status}). تأكد من رابط /models ومن أن خادم OmniRoute متاح من الهاتف.`);
  }
  const models = parseModels(await response.json());
  if (models.length === 0) {
    if (normalizedBase.includes('pollinations.ai')) return FREE_ONEBYTE_MODELS;
    throw new Error('المزود لم يرجع أي موديلات. تحقق من صيغة استجابة /models في الخادم.');
  }
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
