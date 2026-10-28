/**
 * DesktopTokens.ts — Single source of truth for the desktop (web, ≥1024px) design language.
 *
 * Identity (per the approved final mockup): near-black green-tinted surfaces,
 * emerald interactive accents with soft glow, light text on dark.
 * Deliberately separate from `constants/colors.ts` so the mobile app keeps its
 * existing light/dark/system behaviour untouched.
 */

export const desktopColors = {
  background: '#050D0A',
  surface: '#0A1A13',
  surfaceSecondary: '#0E2418',
  surfaceRaised: '#12291C',
  accent: '#10B981',
  accentHover: '#34D399',
  accentSoft: 'rgba(16, 185, 129, 0.14)',
  accentGlow: 'rgba(16, 185, 129, 0.35)',
  text: '#E9F6F0',
  textMuted: '#86A99A',
  border: '#173627',
  borderStrong: '#1F4A33',
  success: '#34D399',
  warning: '#F3BD59',
  error: '#FF7066',
} as const;

/** alpha helper — desktop accents are often used as translucent tints. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Ambient corner/hero glows rendered behind the workspace (subtle, per mockup). */
export const ambientGlow = {
  orbGlow: { color: 'rgba(16, 185, 129, 0.10)', radius: 320 },
  cornerGlow: { color: 'rgba(16, 185, 129, 0.07)', radius: 260 },
} as const;

/** Orb (hero) gradient stops — marbled emerald sphere. */
export const orbGradient = {
  core: '#6EE7B7',
  mid: '#16A34A',
  deep: '#052E16',
  rim: 'rgba(52, 211, 153, 0.55)',
  swirl: 'rgba(187, 247, 208, 0.45)',
} as const;

export const desktopSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const desktopRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  full: 999,
} as const;

export const desktopTypography = {
  /** Inter is loaded globally in app/_layout.tsx. */
  mono: 'monospace',
  h1: { fontSize: 22, fontWeight: '700' as const, lineHeight: 30 },
  h2: { fontSize: 16, fontWeight: '700' as const, lineHeight: 23 },
  h3: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  body: { fontSize: 14, fontWeight: '400' as const, lineHeight: 21 },
  small: { fontSize: 12, fontWeight: '500' as const, lineHeight: 17 },
  tiny: { fontSize: 10.5, fontWeight: '600' as const, lineHeight: 15 },
};

export const desktopShadows = {
  panel: {
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  glow: {
    shadowColor: desktopColors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  popup: {
    shadowColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
} as const;

/** Layout widths/heights required by the directive (§4.A). */
export const desktopLayout = {
  sidebarWidth: 252,
  sidebarWidthCollapsed: 60,
  inspectorWidth: 316,
  minViewport: 1024,
  inspectorAutoViewport: 1280,
  bottomPanelHeights: { compact: 150, normal: 220, tall: 320 },
} as const;

export const desktopTransition = {
  fast: '120ms',
  normal: '180ms',
} as const;
