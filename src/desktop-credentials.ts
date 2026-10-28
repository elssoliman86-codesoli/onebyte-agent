import { Platform } from 'react-native';

/**
 * Desktop (browser) credential storage for the standalone Windows experience.
 *
 * Honest limitation, per directive §7: a plain browser cannot offer OS-level
 * secure storage like the native `expo-secure-store` keychain. The model:
 *   - Default: the key lives in `sessionStorage` (cleared when the tab closes).
 *   - Only with EXPLICIT user consent ("تذكر على هذا الجهاز") does the key get
 *     written to `localStorage` — plaintext, scoped to this browser profile.
 * The settings UI must disclose this. Keys are never logged, exported, or put
 * in URLs.
 */

const CONSENT_KEY = '@onebyte-agent/desktop-key-consent';
const DEVICE_KEY = 'onebyte-agent.desktop-key.v1';
const SESSION_KEY = 'onebyte-agent.desktop-key.session';

export type DesktopKeyScope = 'none' | 'session' | 'device';

function webOnly(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export function isDesktopWeb(): boolean {
  return webOnly();
}

export function getPersistConsent(): boolean {
  if (!webOnly()) return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Withdrawing consent also erases any previously remembered key. */
export function setPersistConsent(allowed: boolean): void {
  if (!webOnly()) return;
  try {
    if (allowed) {
      window.localStorage.setItem(CONSENT_KEY, '1');
    } else {
      window.localStorage.removeItem(CONSENT_KEY);
      window.localStorage.removeItem(DEVICE_KEY);
    }
  } catch {
    // storage unavailable (private mode etc.) — consent silently unused
  }
}

export async function saveDesktopApiKey(key: string): Promise<DesktopKeyScope> {
  if (!webOnly()) return 'none';
  try {
    window.sessionStorage.setItem(SESSION_KEY, key);
    if (getPersistConsent()) {
      window.localStorage.setItem(DEVICE_KEY, key);
      return 'device';
    }
    return 'session';
  } catch {
    return 'none';
  }
}

export function readDesktopApiKey(): string | null {
  if (!webOnly()) return null;
  try {
    return (
      window.sessionStorage.getItem(SESSION_KEY) ??
      window.localStorage.getItem(DEVICE_KEY)
    );
  } catch {
    return null;
  }
}

export function clearDesktopApiKey(): void {
  if (!webOnly()) return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // noop
  }
}
