import { useColorScheme } from 'react-native';
import colors, { ACCENTS, type AccentKey } from '@/constants/colors';
import { useAssistant } from '@/src/assistant';
import { spacing, radius, typography, shadows, animation, zIndex, breakpoints } from '@/src/design-tokens';

/**
 * Returns the design tokens for the active palette.
 *
 * The user's theme preference (system/light/dark) is stored in the assistant
 * settings; "system" follows the device appearance. Falls back to the dark
 * palette (premium theme) when no preference is set.
 *
 * The accent preference (emerald/blue/red/purple/amber) recolors the
 * semantic accent tokens; the accent foreground is always contrast-safe.
 */
export function useColors() {
  const systemScheme = useColorScheme();
  let preference: 'system' | 'light' | 'dark' = 'system';
  let accentKey: AccentKey = 'emerald';
  let selectedFontColor = '';
  try {
    const appearance = useAssistant().appearance;
    preference = appearance?.theme ?? 'system';
    accentKey = appearance?.accent ?? 'emerald';
    selectedFontColor = appearance?.fontColor ?? '';
  } catch {
    // Used outside AssistantProvider (e.g. early error screens) — follow system.
  }
  const scheme = preference === 'system' ? systemScheme : preference;
  // Default to dark (premium theme) for the best experience
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  const accent = ACCENTS[accentKey] ?? ACCENTS.emerald;
  const fontColorOptions = scheme === 'dark'
    ? ['#F3F7F4', '#FFFFFF', '#A1ADA5', '#737F77']
    : ['#0B100D', '#202A24', '#4A5550', '#68736D'];
  const fontColor = fontColorOptions.find(
    (color) => color.toLowerCase() === selectedFontColor.toLowerCase(),
  ) ?? palette.foreground;

  // Extended color tokens follow the selected palette.
  const extendedColors = palette as typeof colors.dark;
  
  return {
    ...palette,
    text: fontColor,
    foreground: fontColor,
    cardForeground: fontColor,
    // Accent recolor (contrast-safe foreground per accent)
    tint: accent.primary,
    primary: accent.primary,
    primaryForeground: accent.primaryForeground,
    accent: accent.primary,
    accentForeground: accent.primaryForeground,
    accentSubtle: `${accent.primary}1A`,
    fontColorOptions,
    // Extended color tokens follow the selected palette.
    surfacePrimary: extendedColors.surfacePrimary ?? palette.card,
    surfaceElevated: extendedColors.surfaceElevated ?? palette.card,
    surfaceGlass: extendedColors.surfaceGlass ?? palette.card,
    borderHighlighted: accent.borderHighlighted,
    borderSubtle: extendedColors.borderSubtle ?? palette.border,
    emeraldPrimary: accent.primary,
    emeraldSecondary: accent.secondary,
    emeraldDeep: accent.deep,
    emeraldGlow: accent.glow,
    emeraldGlowStrong: accent.glowStrong,
    textPrimary: fontColor,
    textSecondary: extendedColors.textSecondary ?? palette.mutedForeground,
    textMuted: extendedColors.textMuted ?? palette.mutedForeground,
    information: extendedColors.information ?? '#1570EF',
    // Default radius for backward compatibility
    radius: radius.md,
    // Full radius tokens for components that need specific values
    radiusTokens: radius,
    spacing,
    typography,
    shadows,
    animation,
    zIndex: zIndex as any,
    breakpoints,
    // Helper to get color with opacity
    withOpacity: (color: string, opacity: number) => {
      // Convert hex to rgba
      const hex = color.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    },
  };
}
