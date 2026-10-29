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

export interface HunterTarget {
  id: string;
  host: string;
  note: string;
  authorization: string;
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

/** Match a hostname against a saved host or HackerOne-style *.example.com entry. */
export function targetMatchesHost(targetHost: string, actualHost: string): boolean {
  const target = targetHost.trim().toLowerCase().replace(/\.$/, '');
  const host = actualHost.trim().toLowerCase().replace(/\.$/, '');
  if (!target || !host) return false;
  if (target.startsWith('*.')) {
    const root = target.slice(2);
    // A wildcard covers subdomains, not the apex itself.
    return host !== root && host.endsWith('.' + root);
  }
  return host === target || host.endsWith('.' + target);
}

export function findAuthorizedTarget(url: string, targets: HunterTarget[]): HunterTarget | null {
  const host = hostOf(url);
  if (!host) return null;
  return targets.find((target) => targetMatchesHost(target.host, host)) ?? null;
}

/** Is this URL inside an authorized scope (exact host, wildcard, or saved subdomain tree)? */
export function isAuthorized(url: string, targets: HunterTarget[]): { ok: boolean; reason: string } {
  const host = hostOf(url);
  if (!host) return { ok: false, reason: 'الرابط غير صالح.' };
  if (!targets.length) {
    return { ok: false, reason: 'أضف تارجت مصرحًا به أولًا — الإرسال خارج السكوب مرفوض.' };
  }
  const match = findAuthorizedTarget(url, targets);
  if (!match) {
    return { ok: false, reason: `النطاق ${host} مش في قايمة التارجت المصرح بيها.` };
  }
  return { ok: true, reason: match.authorization || 'مصرّح' };
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

/**
 * Send the request for real. On web, cross-origin targets obey CORS — an
 * opaque failure is reported honestly instead of being hidden.
 */
export async function runRequest(req: HunterRequest, signal?: AbortSignal): Promise<RunResult> {
  const started = Date.now();
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body || undefined,
      signal,
    });
    const ms = Date.now() - started;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const text = await res.text();
    return {
      status: res.status,
      statusText: res.statusText,
      ms,
      headers,
      body: text.length > 40_000 ? text.slice(0, 40_000) + '\n…(مقتطع)' : text,
      ok: res.ok,
      detail: `HTTP ${res.status} ${res.statusText} · ${ms}ms`,
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
