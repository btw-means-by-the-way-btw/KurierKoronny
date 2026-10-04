import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import MeshPeripheral from '../../modules/mesh-peripheral';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { CLOCK_SKEW_WARN_MS } from '../services/mesh/MeshRouter';
import { useMeshStore } from '../store/meshStore';
import { elevation, radius, useAppTheme } from '../theme';
import { AppButton } from './ui/AppButton';
import { StatusDisc } from './ui/StatusDisc';
import { Tappable } from './ui/Tappable';

interface Props {
  onPress?: () => void;
}

const STATE = {
  connected: { disc: 'connected', icon: 'check', headline: 'Połączono' },
  searching: { disc: 'searching', icon: 'radar', headline: 'Szukam węzłów w pobliżu…' },
  offline: { disc: 'offline', icon: 'pause', headline: 'Mesh zatrzymany' },
  bluetooth_off: { disc: 'error', icon: 'bluetooth-off', headline: 'Bluetooth wyłączony' },
} as const;

/**
 * Mesh status card: a status disc, the connection state in words, and the neighbour / reachable
 * node counts beneath. With `onPress` the main row is a button.
 */
export function NetworkStatusBar({ onPress }: Props) {
  const { colors, dark } = useAppTheme();
  const { status, linkCount, nodeCount, radio } = useNetworkStatus();
  const clockSkewMs = useMeshStore((s) => s.clockSkewMs);
  const skewMinutes = clockSkewMs === null ? 0 : Math.round(Math.abs(clockSkewMs) / 60_000);

  const { disc, icon, headline } = STATE[status];
  const label = status === 'connected' ? `Połączono · ${linkCount} bezpośr. · ${nodeCount} w sieci` : headline;
  const detail = [
    status === 'connected' && `${linkCount} bezpośr.`,
    status === 'connected' && `${nodeCount} w sieci`,
    status !== 'bluetooth_off' && radio.scanning && 'skanuję',
  ]
    .filter(Boolean)
    .join(' · ');

  const row = (
    <>
      <StatusDisc status={disc} icon={icon} size={36} />
      <View style={styles.text}>
        <Text variant="titleMedium" numberOfLines={2} style={{ color: colors.onSurface }}>
          {headline}
        </Text>
        {/* While searching, "skanuję" comes and goes with every scan cycle: keep its line. */}
        {(!!detail || status === 'searching') && (
          <Text variant="labelMedium" numberOfLines={2} style={[styles.detail, { color: colors.onSurfaceVariant }]}>
            {detail || ' '}
          </Text>
        )}
      </View>
      {status === 'bluetooth_off' ? (
        <AppButton variant="tonal" fullWidth={false} onPress={() => MeshPeripheral.requestEnableBluetooth()}>
          Włącz
        </AppButton>
      ) : onPress ? (
        <Icon source="chevron-right" size={24} color={colors.onSurfaceVariant} />
      ) : null}
    </>
  );

  return (
    <View style={styles.wrapper}>
      <View style={[styles.card, { backgroundColor: colors.surface }, elevation(dark, 'card')]}>
        {onPress ? (
          <Tappable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Status sieci: ${label}`}
            scale
            style={styles.row}
            pressedStyle={{ backgroundColor: colors.surfaceVariant }}
          >
            {row}
          </Tappable>
        ) : (
          <View accessible accessibilityLabel={`Status sieci: ${label}`} style={styles.row}>
            {row}
          </View>
        )}
        {/* Packets stamped too far from the receiver's clock are dropped (replay protection). */}
        {clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS && (
          <>
            <View style={[styles.hairline, { backgroundColor: colors.outlineVariant }]} />
            <View style={styles.skew} accessibilityRole="alert">
              <StatusDisc status="searching" icon="clock-alert-outline" />
              <Text variant="bodyMedium" style={[styles.text, { color: colors.onSurface }]}>
                Zegar telefonu różni się od sąsiadów o ok. {skewMinutes} min – wiadomości mogą być odrzucane. Ustaw
                poprawną godzinę.
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 16, paddingBottom: 12 },
  card: { borderRadius: radius.lg },
  // Rounded like the card, so the pressed tint stays inside its corners without clipping the shadow.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
  },
  text: { flex: 1 },
  detail: { fontVariant: ['tabular-nums'] },
  hairline: { height: 1 },
  skew: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
});
