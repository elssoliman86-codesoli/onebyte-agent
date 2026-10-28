/**
 * Marketing studio data layer.
 *
 * Real integrations only:
 * - Telegram Bot API: free, official, works with a bot token — the one
 *   platform that can post programmatically today with zero cost.
 * - GitHub: official REST API with the user's personal access token (free).
 * - Everything else: official APIs exist but require app registration /
 *   review / business accounts — the studio prepares the content and opens
 *   the platform in the browser instead. We never claim automated posting
 *   where the platform doesn't allow it.
 */

import { storage } from './storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ─── Platform capabilities (honest matrix) ────────────────────────────
export type PlatformKey =
  | 'telegram' | 'facebook' | 'instagram' | 'tiktok' | 'whatsapp'
  | 'youtube' | 'x' | 'linkedin' | 'gmail' | 'github';

export interface PlatformCap {
  key: PlatformKey;
  label: string;
  /** 'api' = free official integration works now; 'browser' = in-app browser fallback. */
  level: 'api' | 'browser';
  note: string;
}

export const PLATFORMS: PlatformCap[] = [
  { key: 'telegram', label: 'تيليجرام', level: 'api', note: 'Bot API رسمي ومجاني — نشر حقيقي للقنوات والمجموعات اللي البوت أدمن فيها.' },
  { key: 'github', label: 'GitHub', level: 'api', note: 'REST API رسمي مع توكن شخصي مجاني — قراءة وكتابة على حسابك.' },
  { key: 'facebook', label: 'فيسبوك', level: 'browser', note: 'النشر البرمجي يحتاج تطبيق Meta معتمد؛ بنجهّز المحتوى ونفتح المنصة في المتصفح المدمج.' },
  { key: 'instagram', label: 'إنستجرام', level: 'browser', note: 'الـAPI الرسمي للحسابات Business/Creator فقط؛ الباقي من المتصفح المدمج.' },
  { key: 'tiktok', label: 'تيك توك', level: 'browser', note: 'Content Posting API يحتاج تسجيل تطبيق ومراجعة؛ الباقي من المتصفح المدمج.' },
  { key: 'whatsapp', label: 'واتساب', level: 'browser', note: 'WhatsApp Business Platform للشركات فقط؛ الرسائل الشخصية من المتصفح المدمج.' },
  { key: 'youtube', label: 'يوتيوب', level: 'browser', note: 'رفع الفيديو عبر Data API يحتاج OAuth ومشروع Google معتمد؛ بنفتح صفحة الرفع جاهزة.' },
  { key: 'x', label: 'X (تويتر)', level: 'browser', note: 'النشر البرمجي يحتاج خطة مدفوعة؛ بنجهّز التغريدة ونفتح المنصة.' },
  { key: 'linkedin', label: 'لينكدإن', level: 'browser', note: 'النشر البرمجي للتطبيقات المعتمدة؛ بنجهّز البوست ونفتح المنصة.' },
  { key: 'gmail', label: 'Gmail', level: 'browser', note: 'Gmail API يحتاج مشروع OAuth معتمد؛ الردود تُجهّز وتُفتح في المتصفح المدمج.' },
];

export const PLATFORM_URLS: Record<PlatformKey, string> = {
  telegram: 'https://web.telegram.org',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  tiktok: 'https://www.tiktok.com/upload',
  whatsapp: 'https://web.whatsapp.com',
  youtube: 'https://studio.youtube.com',
  x: 'https://x.com/compose/post',
  linkedin: 'https://www.linkedin.com/feed/',
  gmail: 'https://mail.google.com',
  github: 'https://github.com',
};

// ─── Post plan ────────────────────────────────────────────────────────
export interface MarketingPost {
  id: string;
  /** Day label (e.g. السبت) or exact date ISO. */
  day: string;
  time: string;
  platform: PlatformKey;
  idea: string;
  caption: string;
  /** What media the post carries (وصف — لا ملفات هنا). */
  media: string;
  status: 'planned' | 'posted' | 'skipped';
  createdAt: string;
  updatedAt: string;
}

export const MARKETING_POSTS_KEY = '@onebyte-agent/marketing-posts';

export async function loadMarketingPosts(): Promise<MarketingPost[]> {
  return storage.readRawJSON<MarketingPost[]>(MARKETING_POSTS_KEY, []);
}

export async function saveMarketingPosts(posts: MarketingPost[]): Promise<void> {
  await storage.writeRawJSON(MARKETING_POSTS_KEY, posts);
}

// ─── Weekly plan generator (local, real — no fake AI output) ─────────
const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const IDEA_TEMPLATES = [
  'بوست تعريفي بنشاطك وقيمته الأساسية',
  'نصيحة عملية تصلح مشكلة يومية لجمهورك',
  'لقطة من كواليس الشغل أو خطوة إنجاز',
  'سؤال تفاعلي يفتح نقاشًا مع الجمهور',
  'عرض أو خدمة مع شرح مباشر للفائدة',
  'رأي أو ملاحظة خبرة تثبت معرفتك بالمجال',
  'ملخص الأسبوع + دعوة للتواصل',
];

/**
 * Build a 7-day plan rotating platforms the user picked, one post per day
 * at the chosen hour. Content lines are templates the model (or user) can
 * refine — never presented as published output.
 */
export function buildWeeklyPlan(input: {
  business: string;
  platforms: PlatformKey[];
  time: string;
}): MarketingPost[] {
  const platforms = (input.platforms.length ? input.platforms : ['facebook', 'instagram']) as PlatformKey[];
  const nowIso = new Date().toISOString();
  return DAY_NAMES.map((day, i) => {
    const platform = platforms[i % platforms.length];
    const idea = `${IDEA_TEMPLATES[i]} — مرتبط بـ${input.business}`;
    return {
      id: `post-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      day,
      time: input.time,
      platform,
      idea,
      caption: `${idea}\n\n#تسويق #${input.business.replace(/\s+/g, '_').slice(0, 24)}`,
      media: platform === 'tiktok' || platform === 'youtube' ? 'فيديو قصير' : 'صورة أو تصميم بسيط',
      status: 'planned' as const,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}

// ─── Telegram (real Bot API) ─────────────────────────────────────────
export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface PublishResult {
  ok: boolean;
  detail: string;
}

/** Send a text message through the official Bot API. Real network call. */
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
): Promise<PublishResult> {
  if (!config.botToken.trim() || !config.chatId.trim()) {
    return { ok: false, detail: 'أضيفي توكن البوت وChat ID في الاتصالات أولًا.' };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.botToken.trim()}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.chatId.trim(), text }),
      },
    );
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) return { ok: true, detail: 'اتنشر على تيليجرام بنجاح.' };
    return { ok: false, detail: `تيليجرام رفض الإرسال: ${data.description ?? res.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: `تعذّر الاتصال بتيليجرام: ${error instanceof Error ? error.message : 'خطأ شبكة'}`,
    };
  }
}

// ─── Connections store (tokens stay local, never in chat) ────────────
export interface MarketingConnections {
  telegram?: TelegramConfig;
  githubToken?: string;
}

const CONNECTIONS_KEY = '@onebyte-agent/marketing-connections';
const GITHUB_TOKEN_KEY = 'onebyte-agent.marketing.github-token';
const TELEGRAM_TOKEN_KEY = 'onebyte-agent.marketing.telegram-token';

export async function loadConnections(): Promise<MarketingConnections> {
  const stored = await storage.readRawJSON<MarketingConnections>(CONNECTIONS_KEY, {});
  if (Platform.OS === 'web') return stored;

  const [githubToken, telegramToken] = await Promise.all([
    SecureStore.getItemAsync(GITHUB_TOKEN_KEY).catch(() => null),
    SecureStore.getItemAsync(TELEGRAM_TOKEN_KEY).catch(() => null),
  ]);
  const resolvedGithubToken = githubToken ?? stored.githubToken ?? '';
  const resolvedTelegramToken = telegramToken ?? stored.telegram?.botToken ?? '';

  // Migrate old plain AsyncStorage values before removing them from the record.
  if ((!githubToken && stored.githubToken) || (!telegramToken && stored.telegram?.botToken)) {
    try {
      if (!githubToken && stored.githubToken) {
        await SecureStore.setItemAsync(GITHUB_TOKEN_KEY, stored.githubToken, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      if (!telegramToken && stored.telegram?.botToken) {
        await SecureStore.setItemAsync(TELEGRAM_TOKEN_KEY, stored.telegram.botToken, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      await storage.writeRawJSON(CONNECTIONS_KEY, {
        ...(stored.telegram ? { telegram: { botToken: '', chatId: stored.telegram.chatId } } : {}),
      });
    } catch {
      // Keep the legacy value available if secure storage is temporarily unavailable.
    }
  }

  return {
    ...stored,
    githubToken: resolvedGithubToken,
    ...(stored.telegram
      ? { telegram: { ...stored.telegram, botToken: resolvedTelegramToken } }
      : {}),
  };
}

export async function saveConnections(c: MarketingConnections): Promise<void> {
  if (Platform.OS === 'web') {
    await storage.writeRawJSON(CONNECTIONS_KEY, c);
    return;
  }

  const githubToken = c.githubToken?.trim() ?? '';
  const telegramToken = c.telegram?.botToken.trim() ?? '';
  await Promise.all([
    githubToken
      ? SecureStore.setItemAsync(GITHUB_TOKEN_KEY, githubToken, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
      : SecureStore.deleteItemAsync(GITHUB_TOKEN_KEY).catch(() => undefined),
    telegramToken
      ? SecureStore.setItemAsync(TELEGRAM_TOKEN_KEY, telegramToken, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
      : SecureStore.deleteItemAsync(TELEGRAM_TOKEN_KEY).catch(() => undefined),
  ]);
  await storage.writeRawJSON(CONNECTIONS_KEY, {
    ...(c.telegram ? { telegram: { botToken: '', chatId: c.telegram.chatId } } : {}),
  });
}

/** Verify a GitHub PAT against the official /user endpoint. */
export async function verifyGithubToken(token: string): Promise<{ ok: boolean; login?: string; detail: string }> {
  if (!token.trim()) return { ok: false, detail: 'أدخل التوكن أولًا.' };
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (res.status === 401) return { ok: false, detail: 'التوكن مرفوض (401) — راجعه أو صلاحياته.' };
    if (!res.ok) return { ok: false, detail: `GitHub رجع ${res.status}.` };
    const data = (await res.json()) as { login?: string };
    return data.login
      ? { ok: true, login: data.login, detail: `متصوّل بحساب ${data.login}.` }
      : { ok: false, detail: 'استجابة غير متوقعة من GitHub.' };
  } catch (error) {
    return { ok: false, detail: `تعذّر الاتصال: ${error instanceof Error ? error.message : 'خطأ شبكة'}` };
  }
}
