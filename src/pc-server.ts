import type { AssistantData, ChatMessage, ToolStep, ChatSession, DailyTask, AssistantSkill, AssistantMemory } from './assistant';
import {
  buildAssistantSystemPrompt,
  toProviderMessages,
} from './model-provider';
import { runAgent, type ApprovalDecision } from './agent';
import { storage } from './storage';
import { executeTool, toolsForRequest, type ToolSpec } from './tools';
import { estimateTokens, planContext, workingBudget } from './context';
import * as Device from './device';
import { respondToPc, onPcRequest, pcServerAvailable } from './device';

/**
 * PC companion server: a tiny HTTP layer over the phone. A browser on the same
 * Wi-Fi opens http://<phone-ip>:<port>, enters the PIN shown in the app, and
 * gets the same chat with the same tools and approvals — approvals themselves
 * are decided on the phone for security.
 */

export interface PcServerContext {
  /** Fresh snapshot of all assistant data. */
  getData: () => AssistantData;
  appendMessage: (sessionId: string, message: ChatMessage) => Promise<void>;
  createSession: () => Promise<string>;
  setActiveSession: (id: string) => Promise<void>;
  createMemory: (input: { title: string; content: string }) => Promise<void>;
  createTask: (input: { title: string; time: string; prompt: string }) => Promise<string>;
  setTaskActive: (id: string, active: boolean, notificationId?: string) => Promise<void>;
}

export type PcApprovalHandler = (
  spec: ToolSpec,
  args: Record<string, unknown>,
) => Promise<ApprovalDecision>;

// ─── Security Constants ──────────────────────────────────────────────
const PIN_LENGTH = 6;
const PIN_ALPHANUMERIC = true; // true = alphanumeric, false = digits only
const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 2_000; // 2s base, doubles each attempt (2s, 4s, 8s, 16s, 32s...)
const MAX_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes max

// ─── Login Attempt Tracking ──────────────────────────────────────────
interface LoginAttemptRecord {
  count: number;
  lastAttempt: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();

function getClientIp(event: { path: string }): string {
  // In a real deployment, this would come from the socket.
  // For now, use a hash of the request path as a weak client identifier.
  // The Kotlin layer could be enhanced to pass the real client IP.
  let hash = 0;
  for (let i = 0; i < event.path.length; i++) {
    hash = ((hash << 5) - hash + event.path.charCodeAt(i)) | 0;
  }
  return `client_${Math.abs(hash).toString(36)}`;
}

function checkLoginLockout(clientIp: string): { allowed: boolean; retryAfterMs: number } {
  const record = loginAttempts.get(clientIp);
  const now = Date.now();

  if (!record || record.count === 0) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (now < record.lockedUntil) {
    return { allowed: false, retryAfterMs: record.lockedUntil - now };
  }

  // Lockout expired, reset count
  if (now > record.lockedUntil) {
    loginAttempts.delete(clientIp);
    return { allowed: true, retryAfterMs: 0 };
  }

  return { allowed: true, retryAfterMs: 0 };
}

function recordFailedLogin(clientIp: string): void {
  const record = loginAttempts.get(clientIp) || { count: 0, lastAttempt: 0, lockedUntil: 0 };
  const now = Date.now();
  record.count += 1;
  record.lastAttempt = now;

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    const delay = Math.min(LOCKOUT_BASE_MS * Math.pow(2, record.count - MAX_LOGIN_ATTEMPTS), MAX_LOCKOUT_MS);
    record.lockedUntil = now + delay;
  }

  loginAttempts.set(clientIp, record);
}

function recordSuccessfulLogin(clientIp: string): void {
  loginAttempts.delete(clientIp);
}

// ─── Token Management ────────────────────────────────────────────────
function generateSecurePin(): string {
  if (PIN_ALPHANUMERIC) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes confusing chars
    let pin = '';
    const randomValues = new Uint8Array(PIN_LENGTH);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < PIN_LENGTH; i++) {
      pin += chars[randomValues[i] % chars.length];
    }
    return pin;
  } else {
    const min = Math.pow(10, PIN_LENGTH - 1);
    const max = Math.pow(10, PIN_LENGTH) - 1;
    const randomValues = new Uint32Array(1);
    crypto.getRandomValues(randomValues);
    return String(min + (randomValues[0] % (max - min + 1)));
  }
}

function generateSecureToken(): string {
  const randomBytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(randomBytes);
  return 'pc-' + Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
}

interface TokenRecord {
  token: string;
  expiresAt: number;
  createdAt: number;
}

const tokenStore = new Map<string, TokenRecord>();

function createToken(): string {
  const token = generateSecureToken();
  const now = Date.now();
  tokenStore.set(token, { token, expiresAt: now + TOKEN_EXPIRY_MS, createdAt: now });
  // Cleanup expired tokens
  for (const [t, rec] of tokenStore.entries()) {
    if (rec.expiresAt < now) tokenStore.delete(t);
  }
  return token;
}

function validateToken(token: string): boolean {
  const record = tokenStore.get(token);
  if (!record) return false;
  if (Date.now() > record.expiresAt) {
    tokenStore.delete(token);
    return false;
  }
  return true;
}

function revokeToken(token: string): void {
  tokenStore.delete(token);
}

let contextRef: PcServerContext | null = null;
let approvalHandler: PcApprovalHandler | null = null;
let unsubscribe: (() => void) | null = null;
let pin = '';
let running = false;
let abortRef: AbortController | null = null;
let liveText = '';
let approvalPending = false;

// Current active token
let currentToken: string | null = null;

export function configurePcServer(ctx: PcServerContext): void {
  contextRef = ctx;
}

export function setPcApprovalHandler(handler: PcApprovalHandler | null): void {
  approvalHandler = handler;
}

export function isPcControlRunning(): boolean {
  return running;
}

export function getPcAccess(): { url: string; pin: string } {
  const ip = Device.pcServerLocalIp();
  const port = Device.pcServerPort();
  return { url: ip && port ? `http://${ip}:${port}` : '', pin };
}

export async function startPcControl(): Promise<{ url: string; pin: string }> {
  if (!pcServerAvailable()) {
    throw new Error('خادم الكمبيوتر متاح فقط في نسخة Android المثبتة.');
  }
  if (running) return getPcAccess();
  pin = generateSecurePin();
  currentToken = createToken();
  const ok = await Device.startPcServer(8089);
  if (!ok) throw new Error('تعذّر تشغيل الخادم (البورت مشغول؟).');
  running = true;
  unsubscribe = onPcRequest((event) => {
    void route(event);
  });
  return getPcAccess();
}

export async function stopPcControl(): Promise<void> {
  running = false;
  pin = '';
  currentToken = null;
  revokeToken(currentToken ?? '');
  abortRef?.abort();
  unsubscribe?.();
  unsubscribe = null;
  await Device.stopPcServer();
}

function authorized(event: { path: string; body: string }): boolean {
  if (!currentToken) return false;
  const urlToken = event.path.split('token=')[1]?.split('&')[0] ?? '';
  let bodyToken = '';
  try {
    bodyToken = (JSON.parse(event.body || '{}') as { token?: string }).token ?? '';
  } catch {
    bodyToken = '';
  }
  return (urlToken === currentToken || bodyToken === currentToken) && validateToken(currentToken);
}

function json(id: string, status: number, payload: unknown): void {
  respondToPc(id, status, 'application/json', JSON.stringify(payload));
}

function html(id: string, body: string): void {
  respondToPc(id, 200, 'text/html', body);
}

async function route(event: {
  id: string;
  method: string;
  path: string;
  route: string;
  body: string;
}): Promise<void> {
  const { id, method, route: path } = event;
  try {
    if (method !== 'GET' && method !== 'POST') {
      return json(id, 405, { error: 'method' });
    }
    if (path === '/' || path === '/index.html') {
      return html(id, PAGE_HTML);
    }
    if (path === '/api/login') {
      const clientIp = getClientIp(event);
      const lockout = checkLoginLockout(clientIp);
      if (!lockout.allowed) {
        const minutes = Math.ceil(lockout.retryAfterMs / 60000);
        return json(id, 429, {
          ok: false,
          error: `تم تجاوز عدد محاولات تسجيل الدخول. حاول مجدداً بعد ${minutes} دقيقة.`,
          retryAfterMs: lockout.retryAfterMs,
        });
      }

      const supplied = (safeParse(event.body).pin ?? '').toString();
      if (running && supplied === pin) {
        recordSuccessfulLogin(clientIp);
        currentToken = createToken();
        return json(id, 200, { ok: true, token: currentToken });
      }

      recordFailedLogin(clientIp);
      const attemptsLeft = Math.max(0, MAX_LOGIN_ATTEMPTS - (loginAttempts.get(clientIp)?.count ?? 1));
      return json(id, 401, {
        ok: false,
        error: `رمز غير صحيح. متبقي ${attemptsLeft} محاولة قبل الحظر المؤقت.`,
        attemptsLeft,
      });
    }
    if (!authorized(event)) {
      return json(id, 401, { ok: false, error: 'غير مصرح' });
    }
    const ctx = contextRef;
    if (!ctx) return json(id, 500, { ok: false, error: 'التطبيق غير جاهز' });

    switch (path) {
      case '/api/state': {
        const data = ctx.getData();
        const session =
          data.sessions.find((s: ChatSession) => s.id === data.activeSessionId) ?? null;
        return json(id, 200, {
          ok: true,
          running: abortRef !== null,
          live: liveText,
          approvalPending,
          activeTitle: session?.title ?? 'محادثة جديدة',
          activeSessionId: session?.id ?? null,
          sessions: data.sessions.slice(0, 30).map((s: ChatSession) => ({
            id: s.id,
            title: s.title,
            updatedAt: s.updatedAt,
          })),
          messages: session?.messages ?? [],
          agent: { deviceControlEnabled: data.agent.deviceControlEnabled },
          device: {
            available: Device.isAvailable(),
            serviceOn: Device.isServiceEnabled(),
          },
          tasks: data.tasks.map((t: DailyTask) => ({
            title: t.title,
            time: t.time,
            active: t.active,
          })),
          skills: data.skills.map((s: AssistantSkill) => ({ name: s.name, active: s.active })),
          memories: data.memories.map((m: AssistantMemory) => ({ title: m.title, active: m.active })),
          provider: {
            name: data.provider.providerName,
            model: data.provider.model,
          },
        });
      }
      case '/api/select': {
        const sessionId = (safeParse(event.body).sessionId ?? '').toString();
        const data = ctx.getData();
        if (!data.sessions.some((s) => s.id === sessionId)) {
          return json(id, 404, { ok: false, error: 'المحادثة غير موجودة' });
        }
        await ctx.setActiveSession(sessionId);
        return json(id, 200, { ok: true });
      }
      case '/api/new': {
        await ctx.createSession();
        return json(id, 200, { ok: true });
      }
      case '/api/stop': {
        abortRef?.abort();
        return json(id, 200, { ok: true });
      }
      case '/api/chat': {
        const text = (safeParse(event.body).text ?? '').toString().trim();
        if (!text) return json(id, 400, { ok: false, error: 'رسالة فاضية' });
        void runPcChat(text).catch(() => undefined);
        return json(id, 200, { ok: true });
      }
      default:
        return json(id, 404, { ok: false, error: 'not found' });
    }
  } catch {
    return json(id, 500, { ok: false, error: 'خطأ داخلي' });
  }
}

function safeParse(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

let messageIdCounter = 0;
function makeMessageId(): string {
  messageIdCounter += 1;
  return `pc-${Date.now()}-${messageIdCounter}`;
}

async function runPcChat(text: string): Promise<void> {
  const ctx = contextRef;
  if (!ctx || !running) return;
  const data = ctx.getData();
  if (!data.provider.model.trim()) {
    liveText = '⛔ الموديل غير مضبوط — افتحي إعدادات الهاتف أولًا.';
    return;
  }
  let sessionId = data.activeSessionId;
  if (!sessionId) {
    sessionId = await ctx.createSession();
  }
  const userMessage: ChatMessage = {
    id: makeMessageId(),
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  };
  await ctx.appendMessage(sessionId, userMessage);

  const controller = new AbortController();
  abortRef = controller;
  liveText = '';
  approvalPending = false;
  const responseId = makeMessageId();
  let steps: ToolStep[] = [];
  let fullResponse = '';
  let settingsApiKey = '';
  try {
    const { getStoredModelApiKey } = await import('./assistant');
    settingsApiKey = data.provider.keyless ? '' : await getStoredModelApiKey();
  } catch {
    liveText = '⛔ المفتاح غير محفوظ — أضيفيه من إعدادات الهاتف.';
    abortRef = null;
    return;
  }

  const publish = (finalText: string, finalSteps: ToolStep[]) => {
    liveText = finalText;
    steps = finalSteps;
  };

  try {
    const fresh = ctx.getData();
    const session = fresh.sessions.find((s) => s.id === sessionId);
    const deviceOn = fresh.agent.deviceControlEnabled;
    const system = buildAssistantSystemPrompt(fresh.skills, fresh.memories, {
      deviceControl: deviceOn,
      deviceAvailable: Device.isAvailable(),
      summary: session?.summary,
    });
    const budget = workingBudget(fresh.provider, fresh.agent.maxWorkingTokens);
    const plan = planContext(
      session ?? null,
      [userMessage],
      estimateTokens(system),
      budget,
    );
    let summary = session?.summary ?? '';
    if (plan.toSummarise.length) {
      const { summariseBacklog } = await import('./context');
      summary = await summariseBacklog({
        settings: fresh.provider,
        apiKey: settingsApiKey,
        previousSummary: summary,
        messages: plan.toSummarise,
        chunkTokens: Math.floor(budget * 0.5),
        signal: controller.signal,
      });
    }

    // Load checkpoint if exists (for resume after interrupt)
    const checkpoint = await storage.loadCheckpoint();
    const hasValidCheckpoint = checkpoint && checkpoint.sessionId === sessionId;

    const result = await runAgent({
      settings: fresh.provider,
      apiKey: settingsApiKey,
      messages: [
        { role: 'system', content: system },
        ...toProviderMessages(plan.recent),
      ],
      specs: toolsForRequest(deviceOn),
      maxSteps: fresh.agent.maxSteps,
      execute: (name, args) =>
        executeTool(name, args, {
          skills: fresh.skills,
          memories: fresh.memories,
          sessions: ctx.getData().sessions,
          createMemory: ctx.createMemory,
          createTask: (input) => ctx.createTask(input).then(() => undefined),
        }),
      requestApproval: async (spec, args) => {
        approvalPending = true;
        try {
          if (approvalHandler) return await approvalHandler(spec, args);
          return 'deny' as ApprovalDecision;
        } finally {
          approvalPending = false;
        }
      },
      onText: (soFar) => publish(soFar, steps),
      onStep: (next) => publish(fullResponse, next),
      signal: controller.signal,
      checkpoint: hasValidCheckpoint ? checkpoint : null,
      sessionId,
      originalUserMessage: userMessage.content,
      onCheckpoint: (cp) => {
        // Checkpoint saved automatically to storage
      },
    });
    fullResponse = result.text || (steps.length ? 'تم تنفيذ الخطوات.' : '');
    publish(fullResponse, result.steps);
    await ctx.appendMessage(sessionId, {
      id: responseId,
      role: 'assistant',
      content: fullResponse,
      createdAt: new Date().toISOString(),
      steps: result.steps,
    });
  } catch {
    const partial = fullResponse.trim() || 'توقفت المهمة.';
    if (partial || steps.length) {
      await ctx
        .appendMessage(sessionId, {
          id: responseId,
          role: 'assistant',
          content: partial,
          createdAt: new Date().toISOString(),
          steps,
        })
        .catch(() => undefined);
    }
  } finally {
    abortRef = null;
    approvalPending = false;
    setTimeout(() => {
      if (abortRef === null) liveText = '';
    }, 1500);
  }
}

/* ------------------------------------------------------------------ */
/* Companion page — same visual identity as the phone app.            */
/* ------------------------------------------------------------------ */

const PAGE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OneByte Agent — من الكمبيوتر</title>
<style>
:root{
  --bg:#081610;--card:#10231B;--fg:#E8F1EC;--primary:#4DE2AB;--primaryFg:#062016;
  --muted:#172A21;--mutedFg:#9AAFA4;--accent:#193D2E;--border:#284536;
  --destructive:#FF8075;--success:#57D7A1;--warning:#F3BD59;--radius:16px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:'Segoe UI',Tahoma,sans-serif;min-height:100vh}
#app{max-width:760px;margin:0 auto;display:flex;flex-direction:column;min-height:100vh}
header{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
header .t{font-weight:700;font-size:17px}
header .s{font-size:11px;color:var(--mutedFg)}
#login{max-width:340px;margin:12vh auto;padding:28px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);text-align:center}
#login input{width:100%;margin:14px 0;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--muted);color:var(--fg);font-size:20px;text-align:center;letter-spacing:6px}
.btn{background:var(--primary);color:var(--primaryFg);border:0;border-radius:12px;padding:11px 18px;font-weight:700;cursor:pointer;font-size:14px}
.btn.ghost{background:var(--muted);color:var(--fg);border:1px solid var(--border)}
.btn.danger{background:var(--destructive);color:#2A0E0B}
#chat{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:82%;padding:10px 13px;border-radius:16px;border:1px solid var(--border);background:var(--card);white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.7}
.msg.user{align-self:flex-start;background:var(--primary);color:var(--primaryFg);border-color:var(--primary)}
.msg.assistant{align-self:flex-end}
.msg .steps{font-size:11px;color:var(--mutedFg);margin-bottom:6px}
.msg code{background:rgba(128,128,128,.2);padding:1px 5px;border-radius:6px;font-family:monospace;direction:ltr;display:inline-block}
.msg pre{background:rgba(8,22,16,.9);border:1px solid var(--border);border-radius:12px;padding:12px;overflow-x:auto;direction:ltr;text-align:left;font-family:monospace;font-size:12.5px;margin:8px 0;position:relative}
.msg pre .cp{position:absolute;top:6px;left:8px;font-size:11px;background:var(--accent);color:var(--primary);border:0;border-radius:8px;padding:3px 10px;cursor:pointer;font-family:inherit}
#live{align-self:flex-end;max-width:82%;padding:10px 13px;border-radius:16px;border:1px dashed var(--border);color:var(--mutedFg);font-size:13px;white-space:pre-wrap}
#composer{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}
#composer textarea{flex:1;resize:none;border-radius:14px;border:1px solid var(--border);background:var(--card);color:var(--fg);padding:11px 13px;font-size:14px;font-family:inherit;min-height:44px;max-height:110px}
#tabs{display:flex;border-top:1px solid var(--border)}
#tabs button{flex:1;background:transparent;border:0;color:var(--mutedFg);padding:11px 4px;font-size:12px;cursor:pointer;font-family:inherit}
#tabs button.on{color:var(--primary);font-weight:700}
.panel{flex:1;overflow-y:auto;padding:16px;display:none}
.panel.on{display:block}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:10px}
.card h3{font-size:14px;margin-bottom:6px}
.card .meta{font-size:12px;color:var(--mutedFg)}
.pill{display:inline-block;font-size:10px;font-weight:700;border:1px solid var(--border);border-radius:8px;padding:2px 8px;margin-right:6px}
.pill.ok{color:var(--success);border-color:var(--success)}
.pill.warn{color:var(--warning);border-color:var(--warning)}
.banner{font-size:12px;color:var(--warning);padding:8px 12px;border:1px dashed var(--warning);border-radius:10px;margin:10px 16px;display:none}
select{background:var(--muted);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:4px 8px;font-family:inherit}
</style>
</head>
<body>
<div id="app">
  <header>
    <div>
      <div class="t">ONEBYTE · مساعدك الشخصي</div>
      <div class="s" id="subtitle">—</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <select id="lang" title="Language">
        <option value="ar">عربي</option>
        <option value="en">English</option>
      </select>
      <button class="btn ghost" id="newChat" style="padding:8px 14px">+ محادثة</button>
    </div>
  </header>
  <div class="banner" id="approveBanner">⏳ في انتظار موافقتك على الهاتف — افتحي التطبيق ووافقي على الطلب</div>

  <div id="chat"></div>

  <div class="panel" id="panel-tasks"></div>
  <div class="panel" id="panel-skills"></div>
  <div class="panel" id="panel-memory"></div>
  <div class="panel" id="panel-settings"></div>

  <div id="composer">
    <button class="btn danger" id="stop" style="display:none">■ إيقاف</button>
    <textarea id="input" rows="1" placeholder="اكتب رسالتك… (يمكنك /help)"></textarea>
    <button class="btn" id="send">إرسال</button>
  </div>

  <div id="tabs">
    <button data-tab="chat" class="on">الشات</button>
    <button data-tab="tasks">المهام</button>
    <button data-tab="skills">المهارات</button>
    <button data-tab="memory">الذاكرة</button>
    <button data-tab="settings">الإعدادات</button>
  </div>
</div>
<script>
(function(){
  var token = sessionStorage.getItem('ob_token') || '';
  var lang = localStorage.getItem('ob_lang') || 'ar';
  var pollTimer = null, lastCount = -1, running = false;

  var I18N = {
    ar:{login:'أدخل رمز التفويض الظاهر في التطبيق (6 حروف/أرقام)', connect:'اتصال', wrong:'رمز غير صحيح', placeholder:'اكتب رسالتك… (يمكنك /help)', send:'إرسال', stop:'■ إيقاف', approve:'⏳ في انتظار موافقتك على الهاتف — افتحي التطبيق ووافقي على الطلب', writing:'المساعد بيكتب…', none:'لا يوجد محتوى بعد', tasks:'المهام اليومية', skills:'المهارات', memory:'الذاكرة', settings:'الإعدادات', device:'التحكم في الهاتف', on:'مفعّل', off:'متوقف', model:'الموديل', active:'نشطة', inactive:'مؤرشفة', newChat:'+ محادثة'},
    en:{login:'Enter the PIN shown in the phone app (6 chars)', connect:'Connect', wrong:'Wrong PIN', placeholder:'Type a message… (/help works)', send:'Send', stop:'■ Stop', approve:'⏳ Waiting for your approval on the phone', writing:'Assistant is typing…', none:'Nothing here yet', tasks:'Daily tasks', skills:'Skills', memory:'Memory', settings:'Settings', device:'Device control', on:'ON', off:'OFF', model:'Model', active:'active', inactive:'archived', newChat:'+ New chat'}
  };
  function t(k){ return (I18N[lang] || I18N.ar)[k]; }

  var el = function(id){ return document.getElementById(id); };

  function esc(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }

  function renderMsg(m){
    var div=document.createElement('div');
    div.className='msg '+m.role;
    var html='';
    if(m.steps && m.steps.length){
      html+='<div class="steps">'+m.steps.map(function(s){return esc(s.tool);}).join(' · ')+'</div>';
    }
    var content=esc(m.content||'');
    content=content.replace(/\`\`\`mermaid\\n?([\s\S]*?)\`\`\`/g,function(_,b){return '<pre>'+b+'</pre>';});
    content=content.replace(/\`\`\`(\\w*)\\n?([\s\S]*?)\`\`\`/g,function(_,l,b){
      var id='cp'+Math.random().toString(36).slice(2,8);
      return '<pre><button class="cp" data-code="'+id+'">copy</button><span id="'+id+'">'+b+'</span></pre>';
    });
    content=content.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
    content=content.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>');
    html+=content;
    div.innerHTML=html;
    return div;
  }

  function applyLang(){
    document.documentElement.lang = lang;
    document.documentElement.dir = lang==='ar'?'rtl':'ltr';
    el('input').placeholder = t('placeholder');
    el('send').textContent = t('send');
    el('stop').textContent = t('stop');
    el('newChat').textContent = t('newChat');
    if(!token) el('subtitle').textContent = t('login');
    renderPanels(lastState);
  }

  function renderPanels(s){
    if(!s) return;
    var tasks=el('panel-tasks'), skills=el('panel-skills'), mem=el('panel-memory'), set=el('panel-settings');
    tasks.innerHTML='<div class="card"><h3>'+t('tasks')+'</h3>'+
      (s.tasks.length? s.tasks.map(function(x){return '<div class="meta">🕐 '+esc(x.title)+' — '+esc(x.time)+' <span class="pill '+(x.active?'ok':'')+'">'+(x.active?t('on'):t('off'))+'</span></div>';}).join(''):'<div class="meta">'+t('none')+'</div>')+'</div>';
    skills.innerHTML='<div class="card"><h3>'+t('skills')+'</h3>'+
      (s.skills.length? s.skills.map(function(x){return '<div class="meta">⚡ '+esc(x.name)+' <span class="pill '+(x.active?'ok':'')+'">'+(x.active?t('active'):t('inactive'))+'</span></div>';}).join(''):'<div class="meta">'+t('none')+'</div>')+'</div>';
    mem.innerHTML='<div class="card"><h3>'+t('memory')+'</h3>'+
      (s.memories.length? s.memories.map(function(x){return '<div class="meta">🔖 '+esc(x.title)+' <span class="pill '+(x.active?'ok':'')+'">'+(x.active?t('active'):t('inactive'))+'</span></div>';}).join(''):'<div class="meta">'+t('none')+'</div>')+'</div>';
    var d=s.device;
    set.innerHTML='<div class="card"><h3>'+t('settings')+'</h3>'+
      '<div class="meta">'+t('model')+': '+esc(s.provider.name)+' — '+esc(s.provider.model||'—')+'</div>'+
      '<div class="meta">'+t('device')+': <span class="pill '+(s.agent.deviceControlEnabled&&d.available&&d.serviceOn?'ok':'warn')+'">'+
      (s.agent.deviceControlEnabled ? (d.available ? (d.serviceOn?t('on'):t('off')) : 'Android only') : t('off'))+'</span></div></div>';
  }

  function poll(){
    fetch('/api/state?token='+encodeURIComponent(token)).then(function(r){return r.json();}).then(function(s){
      if(!s.ok){ logout(); return; }
      lastState=s; renderPanels(s);
      el('subtitle').textContent = s.activeTitle + ' · ' + s.provider.name + ' · ' + (s.provider.model||'—');
      var chat=el('chat');
      var key = s.messages.length + ':' + (s.messages.length? s.messages[s.messages.length-1].content.length:0);
      if(key!==lastCount){
        lastCount=key;
        chat.innerHTML='';
        s.messages.forEach(function(m){ chat.appendChild(renderMsg(m)); });
      }
      var live=el('live');
      running = !!s.running;
      if(running && s.live && !s.messages.some(function(m){return m.content===s.live;})){
        if(!live){ live=document.createElement('div'); live.id='live'; chat.appendChild(live); }
        live.textContent = s.live;
      } else if(live){ live.remove(); }
      chat.scrollTop = chat.scrollHeight;
      el('approveBanner').style.display = (running && s.approvalPending) ? 'block' : 'none';
      el('stop').style.display = running ? 'inline-block' : 'none';
      if(!pollTimer) pollTimer=setInterval(poll, 2000);
    }).catch(function(){});
  }

  var lastState=null;

  function send(){
    var input=el('input');
    var text=input.value.trim();
    if(!text) return;
    input.value='';
    fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,text:text})}).then(function(){poll();});
  }

  function login(){
    var pinInput=el('pin').value.trim();
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pinInput})})
      .then(function(r){return r.json();})
      .then(function(res){
        if(res.ok){ token=res.token; sessionStorage.setItem('ob_token',token); boot(); }
        else { el('loginErr').textContent=t('wrong'); }
      }).catch(function(){ el('loginErr').textContent='—'; });
  }

  function logout(){ token=''; sessionStorage.removeItem('ob_token'); location.reload(); }

  function boot(){
    var l=el('login'); if(l) l.remove();
    poll();
  }

  el('send').addEventListener('click',send);
  el('input').addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
  el('stop').addEventListener('click',function(){ fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})}).then(function(){poll();}); });
  el('newChat').addEventListener('click',function(){ fetch('/api/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})}).then(function(){lastCount=-1;poll();}); });
  el('lang').addEventListener('change',function(e){ lang=e.target.value; localStorage.setItem('ob_lang',lang); applyLang(); });
  document.addEventListener('click',function(e){
    if(e.target.classList && e.target.classList.contains('cp')){
      var span=document.getElementById(e.target.getAttribute('data-code'));
      if(span){ navigator.clipboard.writeText(span.textContent); e.target.textContent='✓'; setTimeout(function(){e.target.textContent='copy';},1500); }
    }
    var tab=e.target.closest && e.target.closest('#tabs button');
    if(tab){
      document.querySelectorAll('#tabs button').forEach(function(b){b.classList.remove('on');});
      tab.classList.add('on');
      var name=tab.getAttribute('data-tab');
      ['tasks','skills','memory','settings'].forEach(function(p){
        el('panel-'+p).classList.toggle('on', p===name);
      });
      el('chat').style.display = name==='chat' ? 'flex' : 'none';
      el('composer').style.display = name==='chat' ? 'flex' : 'none';
    }
  });

  if(token){
    // validate stored token
    fetch('/api/state?token='+encodeURIComponent(token)).then(function(r){return r.json();}).then(function(s){
      if(s.ok){ boot(); } else { showLogin(); }
    }).catch(showLogin);
  } else { showLogin(); }

  function showLogin(){
    var app=document.getElementById('app');
    var box=document.createElement('div');
    box.id='login';
    box.innerHTML='<h2 style="font-size:18px;margin-bottom:4px">OneByte Agent</h2>'+
      '<div class="meta" style="font-size:12px;color:var(--mutedFg)">'+t('login')+'</div>'+
      '<input id="pin" inputmode="text" maxlength="6" placeholder="••••••" autocomplete="one-time-code">'+
      '<div id="loginErr" style="color:var(--destructive);font-size:12px;min-height:16px"></div>'+
      '<button class="btn" id="loginBtn" style="width:100%">'+t('connect')+'</button>';
    app.innerHTML='';
    app.appendChild(box);
    el('loginBtn').addEventListener('click',login);
    el('pin').addEventListener('keydown',function(e){ if(e.key==='Enter') login(); });
    el('pin').focus();
  }

  el('lang').value = lang;
  applyLang();
})();
</script>
</body>
</html>`;
