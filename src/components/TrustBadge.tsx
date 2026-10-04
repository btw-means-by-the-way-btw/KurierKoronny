import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import type { TrustLevel } from '../store/contactsStore';
import { radius, useAppTheme } from '../theme';

const COPY: Record<TrustLevel, { icon: string; label: string }> = {
  official: { icon: 'shield-star-outline', label: 'Konto urzędowe' },
  verified: { icon: 'shield-check-outline', label: 'Klucz zweryfikowany' },
  unverified: { icon: 'shield-alert-outline', label: 'Niezweryfikowany' },
};

/**
 * How much the app knows about who is behind a node (DESIGN.md → Trust badge). Three visibly
 * different states: certified by the root key, checked in person by the user, or nothing –
 * a nick alone never earns a badge.
 */
export function TrustBadge({ level, compact }: { level: TrustLevel; compact?: boolean }) {
  const theme = useAppTheme();
  const { icon, label } = COPY[level];
  const colors =
    level === 'official'
      ? { bg: theme.colors.primary, fg: theme.colors.onPrimary }
      : level === 'verified'
        ? { bg: theme.colors.primaryContainer, fg: theme.colors.onPrimaryContainer }
        : { bg: theme.colors.surfaceVariant, fg: theme.colors.onSurfaceVariant };

  if (compact) {
    return (
      <View accessibilityLabel={label} style={[styles.dot, { backgroundColor: colors.bg }]}>
        <Icon source={icon} size={16} color={colors.fg} />
      </View>
    );
  }
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]}>
      <Icon source={icon} size={16} color={colors.fg} />
      <Text variant="labelMedium" style={{ color: colors.fg }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.full,
  },
  dot: { width: 24, height: 24, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
