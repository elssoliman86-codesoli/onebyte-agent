/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#10231D',
    tint: '#087F67',
    background: '#F3F7F4',
    foreground: '#10231D',
    card: '#FFFFFF',
    cardForeground: '#10231D',
    primary: '#087F67',
    primaryForeground: '#FFFFFF',
    secondary: '#E5EEE9',
    secondaryForeground: '#24473B',
    muted: '#EAF0EC',
    mutedForeground: '#718078',
    accent: '#D9F4E6',
    accentForeground: '#12684F',
    destructive: '#C74B4B',
    destructiveForeground: '#FFFFFF',
    border: '#DCE6E0',
    input: '#D0DDD5',
    success: '#18876A',
    warning: '#B87516',
  },
  dark: {
    text: '#E8F1EC',
    tint: '#4DE2AB',
    background: '#081610',
    foreground: '#E8F1EC',
    card: '#10231B',
    cardForeground: '#E8F1EC',
    primary: '#4DE2AB',
    primaryForeground: '#062016',
    secondary: '#1C3328',
    secondaryForeground: '#DAE9E0',
    muted: '#172A21',
    mutedForeground: '#9AAFA4',
    accent: '#193D2E',
    accentForeground: '#82F0BB',
    destructive: '#FF8075',
    destructiveForeground: '#2A0E0B',
    border: '#284536',
    input: '#355646',
    success: '#57D7A1',
    warning: '#F3BD59',
  },
  radius: 18,
};

export default colors;
