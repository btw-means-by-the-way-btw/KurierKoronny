import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { useAppTheme } from '../../theme';

/** Lays space-separated groups out in rows: groups joined by ' ', rows by '\n'. */
export function gridRows(value: string, perRow = 4): string {
  const groups = value.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  for (let i = 0; i < groups.length; i += perRow) rows.push(groups.slice(i, i + perRow).join(' '));
  return rows.join('\n');
}

interface MonoGridProps {
  value: string; // groups separated by spaces, as `fingerprint()` returns them
  size?: 14 | 16; // default 16
  color?: string; // default onSurface
}

/**
 * A key or fingerprint as a fixed grid of four groups per row (DESIGN.md → Key grid). The line
 * breaks are explicit and font scaling is capped, so two phones held side by side show the same
 * rows and it can be read out loud row by row.
 */
export function MonoGrid({ value, size = 16, color }: MonoGridProps) {
  const { colors } = useAppTheme();
  return (
    <Text
      selectable
      variant={size === 16 ? 'bodyLarge' : 'bodyMedium'}
      maxFontSizeMultiplier={1.35}
      accessibilityLabel={value}
      style={[styles.mono, { lineHeight: size === 16 ? 28 : 24, color: color ?? colors.onSurface }]}
    >
      {gridRows(value)}
    </Text>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'monospace' },
});
