import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from 'react-native-paper';

import {
  Card,
  Field,
  gridRows,
  GroupCard,
  ListRow,
  SectionHeader,
  SegmentedControl,
  Sheet,
  TabRoot,
} from '../components/ui';
import { fingerprint } from '../services/crypto/keys';
import { openAppSettings } from '../services/permissions/permissions';
import { MeshService } from '../services/mesh/MeshService';
import { PROTOCOL_VERSION } from '../services/mesh/packet';
import { useAppearanceStore } from '../store/appearanceStore';
import { NICK_MAX, selectIsAuthority, useIdentityStore, validateNick } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import { useAppTheme } from '../theme';
import { formatDate } from '../utils/time';

export default function SettingsScreen() {
  const theme = useAppTheme();
  const nodeId = useIdentityStore((s) => s.nodeId);
  const nick = useIdentityStore((s) => s.nick) ?? '';
  const authority = useIdentityStore((s) => s.authority);
  const isAuthority = useIdentityStore((s) => selectIsAuthority(s));
  const radio = useMeshStore((s) => s.radio);
  const themePref = useAppearanceStore((s) => s.theme);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const [editNick, setEditNick] = useState(false);
  const [draft, setDraft] = useState(nick);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRemoveCert, setConfirmRemoveCert] = useState(false);
  const [stats, setStats] = useState(MeshService.getStats());

  useEffect(() => {
    const t = setInterval(() => {
      const current = MeshService.getStats();
      setStats(current ? { ...current } : undefined);
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const nickError = validateNick(draft);

  const saveNick = () => {
    if (nickError) return;
    MeshService.setNick(draft);
    setEditNick(false);
    ToastAndroid.show('Nick zmieniony i rozgłoszony w sieci', ToastAndroid.SHORT);
  };

  return (
    <TabRoot title="Ustawienia">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionHeader first title="Profil" />
        <GroupCard>
          <ListRow
            title="Nick"
            description={nick}
            icon="account-outline"
            trailing="edit"
            onPress={() => {
              setDraft(nick);
              setEditNick(true);
            }}
          />
          <ListRow
            title="Mój klucz"
            description={gridRows(fingerprint(nodeId))}
            descriptionMono
            icon="qrcode"
            onPress={() => router.push('/my-key')}
          />
        </GroupCard>

        <SectionHeader title="Bezpieczeństwo" />
        <GroupCard>
          <ListRow
            title="Stan zabezpieczeń"
            description="Co chroni Twoje rozmowy, a czego aplikacja nie chroni"
            icon="shield-lock-outline"
            onPress={() => router.push('/security')}
          />
          <ListRow
            title="Komunikaty urzędowe"
            description="Aktywne i zakończone alerty"
            icon="alert-octagon-outline"
            onPress={() => router.push('/alerts')}
          />
        </GroupCard>

        <SectionHeader title="Konto urzędowe" />
        <GroupCard>
          {authority ? (
            <>
              <ListRow
                title={authority.name}
                description={
                  isAuthority
                    ? `Certyfikat ważny do ${formatDate(authority.exp)}`
                    : `Certyfikat wygasł ${formatDate(authority.exp)} – poproś o nowy`
                }
                descriptionColor={isAuthority ? undefined : theme.colors.errorText}
                icon="shield-star-outline"
              />
              {isAuthority && (
                <ListRow
                  title="Nadaj alert"
                  description="Pilny komunikat do wszystkich w sieci"
                  icon="bullhorn-outline"
                  onPress={() => router.push('/compose-alert')}
                />
              )}
              <ListRow
                title="Wczytaj nowy certyfikat"
                icon="qrcode-scan"
                onPress={() => router.push('/install-cert')}
              />
              <ListRow
                title="Usuń certyfikat"
                tone="danger"
                icon="shield-off-outline"
                trailing="none"
                onPress={() => setConfirmRemoveCert(true)}
              />
            </>
          ) : (
            <ListRow
              title="Wczytaj certyfikat urzędowy"
              description="Dla upoważnionych pracowników urzędów. Certyfikat wydaje operator po sprawdzeniu tożsamości."
              descriptionLines={3}
              icon="qrcode-scan"
              onPress={() => router.push('/install-cert')}
            />
          )}
        </GroupCard>

        <SectionHeader title="Wygląd" />
        <SegmentedControl
          value={themePref}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Jasny', icon: 'white-balance-sunny' },
            { value: 'dark', label: 'Ciemny', icon: 'weather-night' },
            { value: 'system', label: 'Systemowy', icon: 'theme-light-dark' },
          ]}
        />

        <SectionHeader title="Dane" />
        <GroupCard>
          <ListRow
            title="Wyczyść historię"
            description="Usuwa wszystkie rozmowy i wiadomości z tego urządzenia"
            tone="danger"
            icon="delete-sweep-outline"
            trailing="none"
            onPress={() => setConfirmClear(true)}
          />
          <ListRow
            title="Uprawnienia systemowe"
            description="Otwórz ustawienia aplikacji w systemie"
            icon="shield-key-outline"
            trailing="external"
            onPress={openAppSettings}
          />
        </GroupCard>

        <SectionHeader title="Sieć (diagnostyka)" />
        <GroupCard inset={16}>
          <Row label="Bluetooth" value={radio.bluetooth} />
          <Row label="Tryb Peripheral" value={radio.peripheralSupported ? 'obsługiwany' : 'nieobsługiwany'} />
          <Row label="Rozgłaszanie" value={radio.advertising ? 'aktywne' : 'nieaktywne'} />
          <Row label="Pakiety odebrane" value={String(stats?.received ?? 0)} />
          <Row label="Pakiety przekazane (relay)" value={String(stats?.relayed ?? 0)} />
          <Row label="Duplikaty odrzucone" value={String(stats?.duplicates ?? 0)} />
          <Row label="Odrzucone (limit/błąd)" value={String(stats?.dropped ?? 0)} />
          <Row label="Sfałszowane pakiety" value={String(stats?.forged ?? 0)} />
          <Row
            label="Śr. czas weryfikacji podpisu"
            value={stats?.verified ? `${(stats.verifyMs / stats.verified).toFixed(1)} ms` : '–'}
          />
        </GroupCard>

        <SectionHeader title="O aplikacji" />
        <Card>
          <Text variant="titleMedium">Mesh Chat {Constants.expoConfig?.version ?? ''}</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Czat peer-to-peer przez Bluetooth Low Energy, bez internetu. Każdy telefon jest jednocześnie klientem
            (Central) i serwerem (Peripheral), a wiadomości są przekazywane przez sąsiednie urządzenia
            (flooding z TTL i deduplikacją oraz trasowanie wsteczne z ogłoszeń).
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Protokół mesh v{PROTOCOL_VERSION} · rozmowy są szyfrowane end-to-end, każdy pakiet jest podpisany.
          </Text>
        </Card>
      </ScrollView>

      <Sheet
        visible={editNick}
        onDismiss={() => setEditNick(false)}
        title="Zmień nick"
        keyboard
        primary={{ label: 'Zapisz', onPress: saveNick, disabled: !!nickError }}
      >
        <Field inset autoFocus value={draft} onChangeText={setDraft} maxLength={NICK_MAX} error={nickError} />
      </Sheet>
      <Sheet
        visible={confirmClear}
        onDismiss={() => setConfirmClear(false)}
        title="Wyczyścić historię?"
        primary={{
          label: 'Wyczyść',
          destructive: true,
          onPress: async () => {
            await MeshService.clearHistory();
            setConfirmClear(false);
            ToastAndroid.show('Historia wyczyszczona', ToastAndroid.SHORT);
          },
        }}
      >
        Wszystkie rozmowy i wiadomości zostaną trwale usunięte z tego urządzenia.
      </Sheet>
      <Sheet
        visible={confirmRemoveCert}
        onDismiss={() => setConfirmRemoveCert(false)}
        title="Usunąć certyfikat?"
        primary={{
          label: 'Usuń',
          destructive: true,
          onPress: () => {
            MeshService.removeCert();
            setConfirmRemoveCert(false);
          },
        }}
      >
        To urządzenie przestanie być kontem urzędowym i nie będzie mogło nadawać alertów. Żeby to cofnąć,
        trzeba ponownie wczytać certyfikat od operatora.
      </Sheet>
    </TabRoot>
  );
}

/** One line of the diagnostics card: what is measured on the left, its current value on the right. */
function Row({ label, value }: { label: string; value: string }) {
  const theme = useAppTheme();
  return (
    <View style={styles.row}>
      <Text variant="bodyMedium" style={[styles.rowLabel, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={[styles.rowValue, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowLabel: { flexShrink: 1 },
  rowValue: { fontVariant: ['tabular-nums'] },
});
