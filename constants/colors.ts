/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Premium Dark Emerald Theme - matched to reference image specifications.
 * Background: Nearly black with deep emerald atmospheric lighting
 * Accent: Bright but restrained emerald green
 * Surfaces: Glass-like with subtle transparency
 */

/**
 * Accent themes — the user picks one in settings and every screen follows.
 * `primaryForeground` is the text drawn ON TOP of the accent; it stays
 * near-black for every accent so text is never lost against the color
 * (bright accents × dark text = readable in light and dark themes alike).
 */
export type AccentKey = 'emerald' | 'blue' | 'red' | 'purple' | 'amber';

export interface AccentPalette {
  primary: string;
  primaryForeground: string;
  secondary: string;
  deep: string;
  glow: string;
  glowStrong: string;
  borderHighlighted: string;
}

export const ACCENTS: Record<AccentKey, AccentPalette> = {
  emerald: {
    primary: '#00D977',
    primaryForeground: '#050806',
    secondary: '#00B965',
    deep: '#064B30',
    glow: 'rgba(0, 217, 119, 0.20)',
    glowStrong: 'rgba(0, 217, 119, 0.40)',
    borderHighlighted: 'rgba(0, 217, 119, 0.30)',
  },
  blue: {
    primary: '#4DA3FF',
    primaryForeground: '#030B16',
    secondary: '#2E86E8',
    deep: '#0A2547',
    glow: 'rgba(77, 163, 255, 0.20)',
    glowStrong: 'rgba(77, 163, 255, 0.40)',
    borderHighlighted: 'rgba(77, 163, 255, 0.32)',
  },
  red: {
    primary: '#FF5F56',
    primaryForeground: '#1B0402',
    secondary: '#E8443B',
    deep: '#4A0E0A',
    glow: 'rgba(255, 95, 86, 0.20)',
    glowStrong: 'rgba(255, 95, 86, 0.40)',
    borderHighlighted: 'rgba(255, 95, 86, 0.32)',
  },
  purple: {
    primary: '#A78BFA',
    primaryForeground: '#120826',
    secondary: '#8B5CF6',
    deep: '#2A1650',
    glow: 'rgba(167, 139, 250, 0.20)',
    glowStrong: 'rgba(167, 139, 250, 0.40)',
    borderHighlighted: 'rgba(167, 139, 250, 0.32)',
  },
  amber: {
    primary: '#FFB224',
    primaryForeground: '#1D1200',
    secondary: '#E89B0C',
    deep: '#4A3200',
    glow: 'rgba(255, 178, 36, 0.20)',
    glowStrong: 'rgba(255, 178, 36, 0.40)',
    borderHighlighted: 'rgba(255, 178, 36, 0.32)',
  },
};

const colors = {
  light: {
    // Light theme — bright background with dark text
    text: '#0B100D',
    tint: '#00D977',
    background: '#F3F7F4',
    foreground: '#0B100D',
    card: '#FFFFFF',
    cardForeground: '#0B100D',
    primary: '#00D977',
    primaryForeground: '#050806',
    secondary: '#E8F1EC',
    secondaryForeground: '#0B100D',
    muted: '#E8F1EC',
    mutedForeground: '#4A5550',
    accent: '#00D977',
    accentForeground: '#050806',
    destructive: '#FF5F56',
    destructiveForeground: '#FFFFFF',
    border: 'rgba(11,16,13,0.18)',
    input: 'rgba(11,16,13,0.12)',
    success: '#00D977',
    warning: '#F3B94F',
  },
  dark: {
    // Premium Dark Emerald Theme - Primary theme
    text: '#F3F7F4',
    tint: '#00D977',
    background: '#050806',
    foreground: '#F3F7F4',
    card: '#101713',
    cardForeground: '#F3F7F4',
    primary: '#00D977',
    primaryForeground: '#050806',
    secondary: '#151E18',
    secondaryForeground: '#A1ADA5',
    muted: '#101713',
    mutedForeground: '#737F77',
    accent: '#00D977',
    accentForeground: '#050806',
    destructive: '#FF6868',
    destructiveForeground: '#F3F7F4',
    border: 'rgba(255,255,255,0.08)',
    input: 'rgba(20,35,26,0.8)',
    success: '#35D98A',
    warning: '#F3B94F',
    // Extended tokens for premium effects
    emeraldPrimary: '#00D977',
    emeraldSecondary: '#00B965',
    emeraldDeep: '#064B30',
    emeraldGlow: 'rgba(0, 217, 119, 0.20)',
    emeraldGlowStrong: 'rgba(0, 217, 119, 0.40)',
    surfacePrimary: '#101713',
    surfaceElevated: '#151E18',
    surfaceGlass: 'rgba(20, 35, 26, 0.72)',
    borderSubtle: 'rgba(255, 255, 255, 0.08)',
    borderHighlighted: 'rgba(0, 217, 119, 0.30)',
    textPrimary: '#F3F7F4',
    textSecondary: '#A1ADA5',
    textMuted: '#737F77',
    information: '#72B7FF',
  },
  radius: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
    full: 9999,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  typography: {
    // Font sizes
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 22,
    xxxl: 28,
    // Line heights
    lineHeightTight: 1.2,
    lineHeightNormal: 1.5,
    lineHeightRelaxed: 1.7,
    // Font weights
    weightRegular: '400',
    weightMedium: '500',
    weightSemiBold: '600',
    weightBold: '700',
  },
  shadows: {
    sm: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.15,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.20,
      shadowRadius: 8,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 8,
    },
    glow: {
      shadowColor: '#00D977',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.30,
      shadowRadius: 12,
      elevation: 4,
    },
  },
};

export default colors;
