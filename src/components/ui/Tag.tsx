import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radius, useAppTheme } from '../../theme';
import type { IconName } from './index';

interface TagProps {
  label: string;
  icon?: IconName;
}

/**
 * Passive status word (DESIGN.md → status tag). Not a button: no role, no press state. Never
 * placed in the same row as a `TrustBadge`. Made for rows: it is aligned by the row it sits in.
 */
export function Tag({ label, icon }: TagProps) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.surfaceVariant }]}>
      {icon && <Icon source={icon} size={16} color={colors.onSurfaceVariant} />}
      <Text variant="labelMedium" style={{ color: colors.onSurface }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.full,
  },
});
