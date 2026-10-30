/**
 * Bug Hunter data layer — LEGAL, defensive testing only.
 *
 * Core guarantees:
 * - A request can only be sent to a host the user explicitly added to their
 *   Targets/Scopes list (the app enforces this — not just a suggestion).
 * - Requests run with the user's explicit send action (real fetch), logged
 *   with status/time for evidence.
 * - Web builds hit CORS honestly; the Android app has direct sockets via
 *   its runtime. Neither pretends to be a full Burp Suite replacement.
 */

import { storage } from './storage';
import { targetMatchesHost } from './hunter-scope';
export { targetMatchesHost } from './hunter-scope';

export interface HunterTarget {
  id: string;
  host: string;
  note: string;
  authorization: string;
  /** Explicit user attestation; legacy targets must be reconfirmed before use. */
  authorizationConfirmedAt?: string;
  createdAt: string;
}

export interface HunterRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  createdAt: string;
}

export interface HunterLogEntry {
  id: string;
  requestId: string | null;
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  ms: number;
  detail: string;
  responsePreview: string;
  at: string;
}

const TARGETS_KEY = '@onebyte-agent/hunter-targets';
const LOG_KEY = '@onebyte-agent/hunter-log';
const LOG_MAX = 120;

export async function loadTargets(): Promise<HunterTarget[]> {
  return storage.readRawJSON<HunterTarget[]>(TARGETS_KEY, []);
}

export async function saveTargets(targets: HunterTarget[]): Promise<void> {
  await storage.writeRawJSON(TARGETS_KEY, targets);
}

export async function loadHunterLog(): Promise<HunterLogEntry[]> {
  return storage.readRawJSON<HunterLogEntry[]>(LOG_KEY, []);
}

export async function saveHunterLog(log: HunterLogEntry[]): Promise<void> {
  await storage.writeRawJSON(LOG_KEY, log.slice(0, LOG_MAX));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}


export function findAuthorizedTarget(url: string, targets: HunterTarget[]): HunterTarget | null {
  const host = hostOf(url);
  if (!host) return null;
  return targets.find((target) => targetMatchesHost(target.host, host)) ?? null;
}

/** Is this URL inside an authorized scope (exact host, wildcard, or saved subdomain tree)? */
export function isAuthorized(url: string, targets: HunterTarget[]): { ok: boolean; reason: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: 'الرابط غير صالح.' }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return { ok: false, reason: 'يسمح فقط بروابط HTTP وHTTPS دون بيانات اعتماد مضمّنة.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'الرابط غير صالح.' };
  if (!targets.length) {
    return { ok: false, reason: 'أضف تارجت مصرحًا به أولًا — الإرسال خارج السكوب مرفوض.' };
  }
  const match = findAuthorizedTarget(url, targets);
  if (!match) {
    return { ok: false, reason: `النطاق ${host} مش في قايمة التارجت المصرح بيها.` };
  }
  if (typeof match.authorization !== 'string' || !match.authorization.trim() || !match.authorizationConfirmedAt) {
    return { ok: false, reason: 'التارجت محفوظ لكنه غير مفعّل: راجع مصدر التصريح وأكّد امتلاكك للإذن والنطاق قبل الاختبار.' };
  }
  return { ok: true, reason: 'تم تأكيد الإذن من المستخدم؛ راجع شروط البرنامج قبل كل اختبار.' };
}

export interface RunResult {
  status: number | null;
  statusText: string;
  ms: number;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  detail: string;
}

async function readBoundedResponse(response: Response, maxBytes = 512 * 1024): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    try { await response.body?.cancel?.(); } catch { /* Best-effort cancellation. */ }
    return { text: '', truncated: true };
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const remaining = maxBytes - total;
    if (remaining <= 0) { truncated = true; await reader.cancel(); break; }
    const chunk = value.subarray(0, remaining);
    text += decoder.decode(chunk, { stream: true });
    total += chunk.byteLength;
    if (chunk.byteLength < value.byteLength) { truncated = true; await reader.cancel(); break; }
  }
  text += decoder.decode();
  return { text, truncated };
}

/**
 * Send the request for real. On web, cross-origin targets obey CORS — an
 * opaque failure is reported honestly instead of being hidden.
 */
export async function runRequest(req: HunterRequest, signal?: AbortSignal): Promise<RunResult> {
  const started = Date.now();
  const scope = isAuthorized(req.url, await loadTargets());
  if (!scope.ok) throw new Error('رفض أمني قبل الإرسال: ' + scope.reason);
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method.toUpperCase())) {
    throw new Error('طريقة HTTP غير مسموحة.');
  }
  if (req.body.length > 1_000_000) throw new Error('حجم Request Body يتجاوز 1MB.');
  try {
    const res = await fetch(req.url, {
      method: req.method.toUpperCase(),
      headers: req.headers,
      redirect: 'manual',
      body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : req.body || undefined,
      signal,
    });
    const ms = Date.now() - started;
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, statusText: res.statusText, ms, headers: {}, body: '', ok: false, detail: 'تم إيقاف إعادة التوجيه تلقائيًا. راجع Location وتحقق من النطاق قبل المتابعة.' };
    }
    if (res.url && !isAuthorized(res.url, await loadTargets()).ok) {
      throw new Error('تم رفض الاستجابة لأن عنوانها النهائي خارج النطاق المحفوظ.');
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const preview = await readBoundedResponse(res);
    return {
      status: res.status,
      statusText: res.statusText,
      ms,
      headers,
      body: preview.text.length > 40_000 ? preview.text.slice(0, 40_000) + '\n…(مقتطع)' : preview.text,
      ok: res.ok,
      detail: `HTTP ${res.status} ${res.statusText} · ${ms}ms${preview.truncated ? ' · تم اقتطاع الاستجابة بعد حد 512KB' : ''}`,
    };
  } catch (error) {
    const ms = Date.now() - started;
    const msg = error instanceof Error ? error.message : 'خطأ شبكة';
    return {
      status: null,
      statusText: '',
      ms,
      headers: {},
      body: '',
      ok: false,
      detail:
        `فشل الإرسال: ${msg}` +
        (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('failed to fetch')
          ? ' — على الويب الطلبات خاضعة لسياسة CORS؛ في تطبيق أندرويد الشبكة مباشرة.'
          : ''),
    };
  }
}

/** Build a ready-to-chat analysis prompt for the sub-agent (real text). */
export function analysisPrompt(entry: HunterLogEntry): string {
  return [
    'حلل هذا الطلب والاستجابة كوكيل أمن دفاعي (تارجت مصرح به):',
    `الطلب: ${entry.method} ${entry.url}`,
    `النتيجة: ${entry.detail}`,
    entry.responsePreview ? `مقتطف الاستجابة:\n${entry.responsePreview.slice(0, 2000)}` : '',
    'المطلوب: نقاط الخطر المرصودة، اختبارات آمنة مقترحة (بلا ضرر)، وأي مؤشرات على مشاكل حماية — مرتبة: المشكلة، الدليل، الخطورة، التصحيح.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
