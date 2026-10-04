import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radius, useAppTheme } from '../../theme';
import type { IconName } from './index';
import { Tappable } from './Tappable';

interface IconTileProps {
  icon: IconName;
  size?: 40 | 56 | 64; // default 40
  shape?: 'tile' | 'circle'; // default 'tile'
  tone?: 'primary' | 'neutral' | 'danger'; // default 'primary'
}

const GLYPH = { 40: 22, 56: 28, 64: 32 } as const;

/**
 * Tinted square (or circle) with a glyph: leads a list row, an empty state or a start-screen hero.
 * Decorative – the text beside it carries the meaning.
 */
export function IconTile({ icon, size = 40, shape = 'tile', tone = 'primary' }: IconTileProps) {
  const { colors } = useAppTheme();
  const { fill, glyph } =
    tone === 'primary'
      ? { fill: colors.primaryContainer, glyph: colors.tonalText }
      : tone === 'neutral'
        ? { fill: colors.surfaceVariant, glyph: colors.onSurfaceVariant }
        : { fill: colors.errorContainer, glyph: colors.errorText };
  return (
    <View
      importantForAccessibility="no"
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: shape === 'circle' ? radius.full : size === 40 ? radius.sm : radius.lg,
          backgroundColor: fill,
        },
      ]}
    >
      <Icon source={icon} size={GLYPH[size]} color={glyph} />
    </View>
  );
}

interface ListRowProps {
  title: string;
  description?: string;
  descriptionLines?: number; // default 2
  descriptionMono?: boolean;
  descriptionColor?: string; // default onSurfaceVariant
  icon?: IconName; // drawn in an IconTile
  leading?: ReactNode; // overrides icon (Avatar, StatusDisc)
  trailing?: 'chevron' | 'edit' | 'external' | 'none' | ReactNode; // default: 'chevron' if onPress, else 'none'
  tone?: 'default' | 'danger';
  onPress?: () => void;
  accessibilityLabel?: string;
}

// What the row does when tapped: navigate, edit in place, leave the app.
const TRAILING = {
  chevron: 'chevron-right',
  edit: 'pencil-outline',
  external: 'open-in-new',
} as const satisfies Record<string, IconName>;
const isGlyph = (t: unknown): t is keyof typeof TRAILING => t === 'chevron' || t === 'edit' || t === 'external';

/**
 * Row of a list (DESIGN.md → List row): leading tile or avatar, title + description, trailing
 * glyph. It has no background of its own – it sits in a `Card` or `GroupCard`.
 */
export function ListRow({
  title,
  description,
  descriptionLines = 2,
  descriptionMono,
  descriptionColor,
  icon,
  leading,
  trailing,
  tone = 'default',
  onPress,
  accessibilityLabel,
}: ListRowProps) {
  const { colors } = useAppTheme();
  const danger = tone === 'danger';
  const end = trailing === undefined ? (onPress ? 'chevron' : 'none') : trailing;
  const content = (
    <>
      {leading ?? (icon ? <IconTile icon={icon} tone={danger ? 'danger' : 'primary'} /> : null)}
      <View style={styles.body}>
        <Text variant="titleMedium" numberOfLines={2} style={{ color: danger ? colors.errorText : colors.onSurface }}>
          {title}
        </Text>
        {description !== undefined && (
          <Text
            variant="bodyMedium"
            numberOfLines={descriptionLines}
            style={[{ color: descriptionColor ?? colors.onSurfaceVariant }, descriptionMono && styles.mono]}
          >
            {description}
          </Text>
        )}
      </View>
      {isGlyph(end) ? (
        <Icon source={TRAILING[end]} size={24} color={colors.onSurfaceVariant} />
      ) : end === 'none' ? null : (
        end
      )}
    </>
  );

  if (onPress) {
    return (
      <Tappable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={styles.row}
        pressedStyle={{ backgroundColor: colors.surfaceVariant }}
      >
        {content}
      </Tappable>
    );
  }
  return (
    <View accessible={accessibilityLabel ? true : undefined} accessibilityLabel={accessibilityLabel} style={styles.row}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  body: { flex: 1 },
  mono: { fontFamily: 'monospace' },
});
