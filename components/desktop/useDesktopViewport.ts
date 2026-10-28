import { Platform, useWindowDimensions } from 'react-native';
import { desktopLayout } from './DesktopTokens';

/**
 * Manual viewport override, web only: `?desktop=1` forces the desktop command
 * center, `?desktop=0` forces the mobile layout. The explicit choice is sticky
 * for the browser tab (sessionStorage) because client-side navigation drops
 * the query string. Absent everywhere (and on Android/iOS, where URLs carry no
 * such query) → automatic detection. Useful for narrow side windows, kiosk
 * setups, and automated testing.
 */
const OVERRIDE_KEY = 'onebyte.desktop-override';

function queryOverride(): boolean | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const value = new URLSearchParams(window.location.search).get('desktop');
    if (value === '1' || value === '0') {
      // Sticky within this browser tab: client-side navigation (router.push)
      // and reloads drop the query string, so remember the explicit choice.
      try {
        window.sessionStorage.setItem(OVERRIDE_KEY, value);
      } catch {
        // Storage unavailable — the query itself still applies this load.
      }
      return value === '1';
    }
    try {
      const stored = window.sessionStorage.getItem(OVERRIDE_KEY);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch {
      // Storage unavailable — fall through to automatic detection.
    }
  } catch {
    // URLSearchParams unavailable — fall back to automatic detection.
  }
  return null;
}

/**
 * True only when running in a browser on a desktop-sized viewport.
 * Gated on web FIRST so Android/iOS (including large tablets) always keep the
 * existing mobile tab navigation untouched.
 */
export function useIsDesktopViewport(): boolean {
  const { width } = useWindowDimensions();
  const forced = queryOverride();
  if (forced !== null) return forced;
  return Platform.OS === 'web' && width >= desktopLayout.minViewport;
}

/** Wide enough for the inspector panel to be useful (auto-open threshold). */
export function useWideViewport(): boolean {
  const { width } = useWindowDimensions();
  const forced = queryOverride();
  if (forced !== null) return forced;
  return Platform.OS === 'web' && width >= desktopLayout.inspectorAutoViewport;
}
