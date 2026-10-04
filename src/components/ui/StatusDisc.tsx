import { StyleSheet, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { onStatus, radius, statusColors } from '../../theme';
import type { IconName } from './index';

interface StatusDiscProps {
  status: 'connected' | 'searching' | 'offline' | 'error';
  icon: IconName;
  size?: 28 | 32 | 36; // default 28
}

const GLYPH = { 28: 16, 32: 18, 36: 20 } as const;

/**
 * Disc in a status colour with a glyph on it. The status colours are too faint for text, so a
 * state is this disc plus a word beside it – never the colour alone.
 */
export function StatusDisc({ status, icon, size = 28 }: StatusDiscProps) {
  return (
    <View style={[styles.disc, { width: size, height: size, backgroundColor: statusColors[status] }]}>
      <Icon source={icon} size={GLYPH[size]} color={onStatus[status]} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
