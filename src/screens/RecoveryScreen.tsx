import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton, BottomActions, IconTile, Notice, Sheet } from '../components/ui';
import { resetDatabase } from '../services/storage/db';
import { useIdentityStore } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import { useAppTheme } from '../theme';

interface Props {
  /** 'identity': the key seed cannot be read; 'database': the database key is gone or wrong. */
  kind: 'identity' | 'database';
}

const COPY = {
  identity: {
    title: 'Nie można odczytać kluczy',
    body:
      'Klucze tego urządzenia były zapisane w bezpiecznym magazynie systemu, ale nie da się ich już odczytać. ' +
      'Zdarza się to po przeniesieniu aplikacji na inny telefon albo po wyczyszczeniu danych uwierzytelniających w systemie.',
    consequence:
      'Nowa tożsamość oznacza nowe ID urządzenia: rozmówcy zobaczą Cię jako nową osobę, weryfikacje kluczy i certyfikat urzędowy przepadną, a historia rozmów zostanie usunięta.',
    action: 'Utwórz nową tożsamość',
  },
  database: {
    title: 'Nie można otworzyć historii',
    body:
      'Historia rozmów jest zaszyfrowana kluczem z bezpiecznego magazynu systemu, a ten klucz zaginął lub nie pasuje. ' +
      'Twoja tożsamość w sieci jest nienaruszona.',
    consequence:
      'Usunięcie zaszyfrowanej bazy skasuje z tego telefonu rozmowy, zweryfikowane kontakty i zapisane komunikaty urzędowe. Tej operacji nie da się cofnąć.',
    action: 'Usuń historię i zacznij od nowa',
  },
} as const;

/**
 * Shown instead of the app when secrets kept in SecureStore are gone. The app never repairs this
 * silently: replacing an identity or deleting the database is the user's explicit decision.
 */
export default function RecoveryScreen({ kind }: Props) {
  const theme = useAppTheme();
  const copy = COPY[kind];
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const reset = async () => {
    setConfirm(false);
    setBusy(true);
    setFailed(false);
    try {
      if (kind === 'identity') await useIdentityStore.getState().reset();
      else await resetDatabase();
      useMeshStore.getState().set({ storageError: false });
    } catch (e) {
      console.error('Recovery failed', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <IconTile size={64} tone="danger" icon="shield-alert-outline" />
          <Text variant="headlineLarge">{copy.title}</Text>
          <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
            {copy.body}
          </Text>
        </View>
        <Notice tone="error" icon="alert-outline">
          {copy.consequence}
        </Notice>
        {failed && (
          <Notice tone="error" icon="alert-circle-outline">
            Nie udało się. Sprawdź, czy telefon ma ustawioną blokadę ekranu, i spróbuj ponownie.
          </Notice>
        )}
      </ScrollView>
      <BottomActions safeArea={false}>
        <AppButton variant="destructive" onPress={() => setConfirm(true)} loading={busy} disabled={busy}>
          {copy.action}
        </AppButton>
      </BottomActions>
      <Sheet
        visible={confirm}
        onDismiss={() => setConfirm(false)}
        title="Na pewno?"
        primary={{ label: kind === 'identity' ? 'Utwórz nową' : 'Usuń', destructive: true, onPress: reset }}
      >
        {copy.consequence}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 16 },
  hero: { alignItems: 'flex-start', gap: 12, marginTop: 24 },
});
