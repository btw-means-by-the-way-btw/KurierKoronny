import { type ComponentProps, useEffect, useRef } from 'react';
import { AppState, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { AppButton, BottomActions, GroupCard, type IconName, IconTile, Notice, StatusDisc, Tag } from '../components/ui';
import { openAppSettings, PERMISSIONS, PermissionState } from '../services/permissions/permissions';
import { useIdentityStore } from '../store/identityStore';
import { usePermissionStore } from '../store/permissionStore';
import { useAppTheme } from '../theme';

const STATE_UI: Record<
  PermissionState,
  { status: ComponentProps<typeof StatusDisc>['status']; icon: IconName; label: string }
> = {
  granted: { status: 'connected', icon: 'check', label: 'Nadane' },
  denied: { status: 'searching', icon: 'close', label: 'Brak' },
  blocked: { status: 'error', icon: 'block-helper', label: 'Zablokowane' },
  install_time: { status: 'connected', icon: 'check', label: 'Przy instalacji' },
  not_applicable: { status: 'offline', icon: 'minus', label: 'Nie dotyczy' },
};

/**
 * First-run gate. The Android system permission dialogs are shown automatically on the first
 * launch; the app cannot continue (see guards in app/_layout.tsx) until every required
 * runtime permission is granted.
 */
export default function PermissionsScreen() {
  const theme = useAppTheme();
  const { snapshot, blocked, requesting, request, check } = usePermissionStore();
  const acknowledged = useIdentityStore((s) => s.permissionsAcknowledged);
  const setAcknowledged = useIdentityStore((s) => s.setPermissionsAcknowledged);
  const autoRequested = useRef(false);

  const onGranted = () => {
    ToastAndroid.show('Uprawnienia zostały nadane pomyślnie ✓', ToastAndroid.LONG);
    setAcknowledged();
  };

  const ask = async () => {
    const res = await request();
    if (res.granted) onGranted();
  };

  // First launch → go straight to the system dialogs.
  useEffect(() => {
    if (!acknowledged && !autoRequested.current) {
      autoRequested.current = true;
      void ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back from system Settings: re-check.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active' && (await check())) onGranted();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);

  const anyDenied = Object.values(snapshot).some((s) => s === 'denied' || s === 'blocked');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <IconTile size={64} icon="bluetooth-connect" />
          <Text variant="headlineLarge">Uprawnienia</Text>
          <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
            Mesh Chat łączy telefony przez Bluetooth, bez internetu. Aby działać, potrzebuje poniższych
            uprawnień systemowych.
          </Text>
        </View>

        {anyDenied && (
          <Notice tone="error" icon="alert-outline">
            {blocked
              ? 'Część uprawnień została odrzucona na stałe. Otwórz ustawienia aplikacji, wejdź w „Uprawnienia” i zezwól na Bluetooth (urządzenia w pobliżu), lokalizację i powiadomienia.'
              : 'Bez tych uprawnień aplikacja nie może wyszukiwać urządzeń ani przesyłać wiadomości. Nadaj je, aby kontynuować.'}
          </Notice>
        )}

        <GroupCard inset={56}>
          {PERMISSIONS.filter((p) => snapshot[p.name] !== 'not_applicable').map((p) => {
            const state = snapshot[p.name] ?? 'denied';
            const ui = STATE_UI[state];
            return (
              <View key={p.name} style={styles.item}>
                <StatusDisc status={ui.status} icon={ui.icon} />
                <View style={styles.itemText}>
                  <Text variant="titleMedium">{p.label}</Text>
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    {p.reason}
                  </Text>
                </View>
                <Tag label={ui.label} />
              </View>
            );
          })}
        </GroupCard>
      </ScrollView>

      <BottomActions safeArea={false}>
        {blocked ? (
          <>
            <PrimaryButton icon="cog-outline" onPress={openAppSettings}>
              Otwórz ustawienia systemowe
            </PrimaryButton>
            <AppButton variant="text" onPress={ask} loading={requesting}>
              Spróbuj ponownie
            </AppButton>
          </>
        ) : (
          <PrimaryButton icon="shield-check-outline" onPress={ask} loading={requesting} disabled={requesting}>
            Nadaj uprawnienia
          </PrimaryButton>
        )}
      </BottomActions>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 16 },
  hero: { alignItems: 'flex-start', gap: 12, marginTop: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  itemText: { flex: 1 },
});
