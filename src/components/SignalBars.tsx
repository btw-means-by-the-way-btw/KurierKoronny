import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

import { statusColors } from '../theme';

/** Maps RSSI (dBm) to 0–4 bars. */
export function rssiToLevel(rssi: number): number {
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  if (rssi >= -90) return 1;
  return 0;
}

export function SignalBars({ rssi, showValue = true }: { rssi: number; showValue?: boolean }) {
  const theme = useTheme();
  const known = rssi > -127;
  const level = known ? rssiToLevel(rssi) : 0;
  return (
    <View style={styles.row} accessibilityLabel={known ? `Sygnał ${rssi} dBm` : 'Sygnał nieznany'}>
      <View style={styles.bars}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: 5 + i * 4,
                backgroundColor: i < level ? statusColors.connected : theme.colors.outlineVariant,
              },
            ]}
          />
        ))}
      </View>
      {showValue && (
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, minWidth: 52, textAlign: 'right' }}>
          {known ? `${rssi} dBm` : '—'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 17 },
  bar: { width: 4, borderRadius: 1 },
});
