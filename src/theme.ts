import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { configureFonts, MD3DarkTheme, MD3LightTheme, type MD3Theme, useTheme } from 'react-native-paper';

/** Design tokens – see DESIGN.md (single source of truth for the visual language). */
export const radius = { xs: 4, sm: 8, md: 12, lg: 16, full: 9999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, gutter: 16 } as const;

/** Fixed sizes of controls and chrome (dp). */
export const size = { touch: 44, control: 48, row: 64, tile: 40, avatar: 48, header: 56, chatHeader: 64 } as const;
/** Durations (ms). Timing only – no springs. */
export const motion = { pressIn: 80, pressOut: 140, segment: 160, sheet: 220, pulse: 800 } as const;

// With a named font family Android collapses every weight below 700 to normal, so the family is
// left out and the weight alone picks the face.
// API 26–27 cannot take numeric weights: 500/600 use the Medium alias. minSdk is 26.
const legacy = Platform.OS === 'android' && Number(Platform.Version) < 28;
const face = (w: '400' | '500' | '600' | '700'): TextStyle =>
  legacy && (w === '500' || w === '600')
    ? { fontFamily: 'sans-serif-medium', fontWeight: 'normal' }
    : { fontFamily: undefined, fontWeight: w };

/**
 * The seven text styles (DESIGN.md → Typography). Paper's `<Text variant>` reads them through the
 * theme; text that is not a Paper `Text` (RN `Text`, `TextInput`, tab labels) spreads them directly.
 */
export const type = {
  display: { fontSize: 32, lineHeight: 38, letterSpacing: -0.32, ...face('700') },
  titleLg: { fontSize: 20, lineHeight: 26, letterSpacing: 0, ...face('600') },
  titleMd: { fontSize: 17, lineHeight: 23, letterSpacing: 0, ...face('600') },
  bodyLg: { fontSize: 16, lineHeight: 23, letterSpacing: 0, ...face('400') },
  bodyMd: { fontSize: 14, lineHeight: 20, letterSpacing: 0, ...face('400') },
  labelMd: { fontSize: 13, lineHeight: 17, letterSpacing: 0, ...face('500') },
  labelSm: { fontSize: 11, lineHeight: 14, letterSpacing: 0, ...face('500') },
} as const;

// System typeface; hierarchy comes from weight and size (DESIGN.md → Typography). Every Paper
// variant is mapped onto one of the seven styles; configureFonts merges over Paper's typescale,
// so the explicit `fontFamily: undefined` is what removes Paper's named family.
const fonts = configureFonts({
  config: {
    displayLarge: type.display,
    displayMedium: type.display,
    displaySmall: type.display,
    headlineLarge: type.display,
    headlineMedium: type.titleLg,
    headlineSmall: type.titleLg,
    titleLarge: type.titleLg,
    titleMedium: type.titleMd,
    bodyLarge: type.bodyLg,
    bodyMedium: type.bodyMd,
    bodySmall: type.bodyMd,
    titleSmall: type.labelMd,
    labelLarge: type.labelMd,
    labelMedium: type.labelMd,
    labelSmall: type.labelSm,
    default: { ...face('400'), letterSpacing: 0 },
  } as never, // MD3Type.fontFamily is typed `string`; undefined is intentional
});

/** Paper's MD3 theme plus the two colour roles it lacks. */
export type AppTheme = MD3Theme & { colors: MD3Theme['colors'] & { errorText: string; tonalText: string } };
export const useAppTheme = () => useTheme<AppTheme>();

export const lightTheme: AppTheme = {
  ...MD3LightTheme,
  roundness: 4,
  fonts,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#0052A5',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D6E6F8',
    onPrimaryContainer: '#0A2A52',
    // Crimson is an identity accent only – never an action colour.
    secondary: '#D4213D',
    onSecondary: '#FFFFFF',
    // Paper paints chips / tonal buttons / segmented buttons with the secondary container: keep them blue.
    secondaryContainer: '#D6E6F8',
    onSecondaryContainer: '#0A2A52',
    tertiary: '#0052A5',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#D6E6F8',
    onTertiaryContainer: '#0A2A52',
    // `error` is for fills only (alert banner, destructive button, error disc); error-coloured
    // text, icons and 1px borders use `errorText`.
    error: '#D32F2F',
    onError: '#FFFFFF',
    errorText: '#D32F2F',
    errorContainer: '#FAE6E6',
    onErrorContainer: '#1A2233',
    // Label and icon on primaryContainer.
    tonalText: '#0052A5',
    background: '#F2F5FA',
    onBackground: '#1A2233',
    surface: '#FFFFFF',
    onSurface: '#1A2233',
    surfaceVariant: '#E8EEF6',
    onSurfaceVariant: '#5B6577',
    outline: '#8A94A6',
    outlineVariant: '#DDE3EC',
    inverseSurface: '#1A2233',
    inverseOnSurface: '#F2F5FA',
    inversePrimary: '#4A9EF0',
    surfaceDisabled: '#E8EEF6',
    onSurfaceDisabled: '#8A94A6',
    backdrop: 'rgba(26, 34, 51, 0.4)',
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#FFFFFF',
      level3: '#FFFFFF',
      level4: '#FFFFFF',
      level5: '#FFFFFF',
    },
  },
};

export const darkTheme: AppTheme = {
  ...MD3DarkTheme,
  roundness: 4,
  fonts,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#4A9EF0',
    onPrimary: '#06213F',
    primaryContainer: '#17406E',
    onPrimaryContainer: '#D6E6F8',
    secondary: '#D4213D',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#17406E',
    onSecondaryContainer: '#D6E6F8',
    tertiary: '#4A9EF0',
    onTertiary: '#06213F',
    tertiaryContainer: '#17406E',
    onTertiaryContainer: '#D6E6F8',
    // The error fill is the same red in both themes; only error-coloured text is lightened.
    error: '#D32F2F',
    onError: '#FFFFFF',
    errorText: '#E29193',
    errorContainer: '#4D282C',
    onErrorContainer: '#F1F3F6',
    // Primary on its own container is too faint in dark mode.
    tonalText: '#D6E6F8',
    background: '#15171B',
    onBackground: '#F1F3F6',
    surface: '#23262B',
    onSurface: '#F1F3F6',
    surfaceVariant: '#2D3137',
    onSurfaceVariant: '#A4ACB9',
    outline: '#6B7482',
    outlineVariant: '#343941',
    inverseSurface: '#F1F3F6',
    inverseOnSurface: '#15171B',
    inversePrimary: '#0052A5',
    surfaceDisabled: '#2D3137',
    onSurfaceDisabled: '#6B7482',
    backdrop: 'rgba(0, 0, 0, 0.6)',
    // No shadows in dark mode: levels are told apart by a lighter surface.
    elevation: {
      level0: 'transparent',
      level1: '#23262B',
      level2: '#282B31',
      level3: '#2D3137',
      level4: '#30343B',
      level5: '#343941',
    },
  },
};

/** Semantic colors not covered by MD3. */
export const statusColors = {
  connected: '#22A06B',
  searching: '#E2A400',
  offline: '#8A8F8E',
  error: '#D32F2F',
};

/** Glyph colour on a disc filled with the matching status colour (fixed, theme-independent). */
export const onStatus = { connected: '#1A2233', searching: '#1A2233', offline: '#1A2233', error: '#FFFFFF' } as const;

const ink = (a: number) => `rgba(26, 34, 51, ${a})`;
/** One soft diffuse shadow per level (DESIGN.md → Elevation & Depth). Never Android `elevation`. */
export const shadows = {
  card: [{ offsetX: 0, offsetY: 2, blurRadius: 8, spreadDistance: 0, color: ink(0.08) }],
  float: [{ offsetX: 0, offsetY: 4, blurRadius: 12, spreadDistance: 0, color: ink(0.16) }],
  sheet: [{ offsetX: 0, offsetY: -8, blurRadius: 24, spreadDistance: 0, color: ink(0.16) }],
} as const;
/** Shadow style of a level. Empty in dark mode, where levels are told apart by a lighter surface. */
export const elevation = (dark: boolean, level: keyof typeof shadows): ViewStyle =>
  dark ? {} : { boxShadow: shadows[level] };
