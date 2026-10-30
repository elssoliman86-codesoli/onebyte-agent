/**
 * Canonical host-scope matching shared by the UI, browser driver and parsers.
 * Exact entries authorize one host only. Wildcards must be explicit (*.example.com).
 */
export function normalizeHostPattern(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function targetMatchesHost(targetHost: string, actualHost: string): boolean {
  const pattern = normalizeHostPattern(targetHost);
  const host = normalizeHostPattern(actualHost);
  if (!pattern || !host) return false;
  if (pattern.startsWith('*.')) {
    const root = pattern.slice(2);
    return !!root && host !== root && host.endsWith('.' + root);
  }
  return host === pattern;
}

export function isHttpUrlInScope(rawUrl: string, targetHost: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    return targetMatchesHost(targetHost, url.hostname);
  } catch {
    return false;
  }
}
