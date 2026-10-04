import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { AppButton, BottomActions, Card, EmptyState, SectionHeader, Sheet } from '../components/ui';
import type { StoredAlert } from '../services/mesh/alertPolicy';
import { MeshService } from '../services/mesh/MeshService';
import { alertKey, useActiveAlerts, useAlertStore } from '../store/alertStore';
import { selectIsAuthority, useIdentityStore } from '../store/identityStore';
import { useAppTheme } from '../theme';
import { formatDateTime } from '../utils/time';

/** Every alert this device holds: the active ones in full, then the ended ones. */
export default function AlertsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const all = useAlertStore((s) => s.alerts);
  const active = useActiveAlerts();
  const nodeId = useIdentityStore((s) => s.nodeId);
  const isAuthority = useIdentityStore((s) => selectIsAuthority(s));
  const [toCancel, setToCancel] = useState<StoredAlert | null>(null);

  const ended = useMemo(() => {
    const activeKeys = new Set(active.map(alertKey));
    return all.filter((a) => !activeKeys.has(alertKey(a))).sort((a, b) => b.timestamp - a.timestamp);
  }, [all, active]);

  const cancel = async () => {
    const alert = toCancel;
    setToCancel(null);
    if (!alert) return;
    const res = await MeshService.cancelAlert(alert.id);
    ToastAndroid.show(
      res.ok
        ? 'Alert odwołany'
        : res.reason === 'not_confirmed'
          ? 'Nie potwierdzono tożsamości – alert nadal aktywny'
          : 'Nie udało się odwołać alertu',
      ToastAndroid.SHORT
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: isAuthority ? 16 : insets.bottom + 24 }]}>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Komunikaty do wszystkich mogą nadawać wyłącznie konta urzędowe z certyfikatem. Każdy jest podpisany – nie
          da się go podrobić ani zmienić po drodze.
        </Text>

        {active.length === 0 && (
          <EmptyState tone="neutral" icon="information-outline" text="Brak aktywnych komunikatów." />
        )}
        {active.map((a) => (
          <Card key={alertKey(a)} alert>
            <View style={styles.label}>
              <Icon source="alert-octagon-outline" size={20} color={theme.colors.errorText} />
              <Text variant="labelMedium" style={{ color: theme.colors.errorText, flex: 1 }}>
                PILNE · {a.authority}
              </Text>
            </View>
            <Text variant="titleLarge">{a.headline}</Text>
            {!!a.text && (
              <Text variant="bodyLarge" selectable>
                {a.text}
              </Text>
            )}
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Nadano {formatDateTime(a.timestamp)} · ważny do {formatDateTime(Math.min(a.exp, a.certExp))}
            </Text>
            {a.origin === nodeId && (
              <AppButton variant="text" danger fullWidth={false} onPress={() => setToCancel(a)} style={styles.cancel}>
                Odwołaj alert
              </AppButton>
            )}
          </Card>
        ))}

        {ended.length > 0 && (
          // The header brings its own margins (24 above, 12 below); this takes the list gap back out.
          <View style={styles.section}>
            <SectionHeader title="Zakończone" />
          </View>
        )}
        {ended.map((a) => (
          <Card key={alertKey(a)}>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {a.cancelled ? 'Odwołany' : 'Wygasł'} · {a.authority}
            </Text>
            <Text variant="titleMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {a.headline}
            </Text>
            {!!a.text && (
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {a.text}
              </Text>
            )}
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {formatDateTime(a.timestamp)}
            </Text>
          </Card>
        ))}
      </ScrollView>

      {isAuthority && (
        <BottomActions>
          <PrimaryButton icon="bullhorn-outline" onPress={() => router.push('/compose-alert')}>
            Nowy alert
          </PrimaryButton>
        </BottomActions>
      )}

      <Sheet
        visible={!!toCancel}
        onDismiss={() => setToCancel(null)}
        title="Odwołać alert?"
        primary={{ label: 'Odwołaj', destructive: true, onPress: cancel }}
      >
        „{toCancel?.headline}” zniknie u wszystkich, do których dotrze odwołanie. Tej operacji nie da się cofnąć – w
        razie pomyłki trzeba nadać nowy alert.
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  section: { marginVertical: -12 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cancel: { alignSelf: 'flex-start', marginLeft: -12 },
});
