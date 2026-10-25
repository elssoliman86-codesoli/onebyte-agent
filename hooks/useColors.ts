import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { useAssistant } from '@/src/assistant';

/**
 * Returns the design tokens for the active palette.
 *
 * The user's theme preference (system/light/dark) is stored in the assistant
 * settings; "system" follows the device appearance. Falls back to the light
 * palette when no dark key is defined in constants/colors.ts.
 */
export function useColors() {
  const systemScheme = useColorScheme();
  let preference: 'system' | 'light' | 'dark' = 'system';
  try {
    preference = useAssistant().appearance?.theme ?? 'system';
  } catch {
    // Used outside AssistantProvider (e.g. early error screens) — follow system.
  }
  const scheme = preference === 'system' ? systemScheme : preference;
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
