import type { EmbeddedBrowserNetworkEntry, EmbeddedBrowserSnapshot } from './embedded-browser';
import { targetMatchesHost } from './hunter-scope';

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 500);
}

export function collectEndpointCandidates(snapshot: EmbeddedBrowserSnapshot, network: EmbeddedBrowserNetworkEntry[], targetHost: string): string[] {
  const candidates: string[] = [];
  const absolute = /https?:\/\/[^\s"'<>\\)]+/gi;
  const sourceText = (snapshot.text || '') + '\n' + (snapshot.source || '');
  for (const match of sourceText.match(absolute) ?? []) candidates.push(match.replace(/[),.;]+$/, ''));
  const apiPath = /["'](\/(?:api|graphql|rest|v[0-9]+|oauth|auth)[^"'\s<>]*)["']/gi;
  for (const match of sourceText.matchAll(apiPath)) {
    try { candidates.push(new URL(match[1], snapshot.url).toString()); } catch { /* Ignore malformed paths. */ }
  }
  for (const element of snapshot.elements) if (element.href) candidates.push(element.href);
  for (const entry of network) candidates.push(entry.url);
  const output: string[] = [];
  for (const candidate of unique(candidates)) {
    try {
      const url = new URL(candidate, snapshot.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (targetMatchesHost(targetHost, url.hostname)) output.push(url.toString());
    } catch { /* Ignore malformed page values. */ }
  }
  return unique(output);
}

export function collectJavaScriptAssets(urls: string[]): string[] {
  return unique(urls.filter((url) => /\.m?js(?:[?#]|$)/i.test(url)));
}
