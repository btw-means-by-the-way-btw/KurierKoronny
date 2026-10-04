import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { QrScanner } from '../components/QrScanner';
import { AppButton, BottomActions, Field, Notice } from '../components/ui';
import { parseIdentityQr } from '../services/crypto/cert';
import { type InstallCertResult, MeshService } from '../services/mesh/MeshService';
import { useAppTheme } from '../theme';

const FAILURES: Record<Exclude<InstallCertResult, { ok: true }>['reason'], string> = {
  format: 'To nie jest certyfikat Mesh Chat.',
  signature: 'Certyfikat nie jest podpisany kluczem głównym, któremu ufa ta aplikacja.',
  subject: 'Ten certyfikat wystawiono dla innego urządzenia. Certyfikat działa tylko na telefonie, którego klucz podano operatorowi.',
  not_yet_valid: 'Certyfikat nie jest jeszcze ważny. Sprawdź datę i godzinę w telefonie.',
  expired: 'Certyfikat już wygasł. Poproś operatora o nowy.',
  revoked: 'Ten certyfikat został unieważniony.',
  no_device_lock:
    'Ustaw blokadę ekranu (PIN, wzór lub odcisk palca) i spróbuj ponownie. Bez niej każdy, kto weźmie ten telefon do ręki, mógłby nadawać alerty.',
};

/**
 * Installs an authority certificate handed over by the issuing operator (QR code or text).
 * The certificate comes only from the camera or the text field on this screen – never from a link.
 */
export default function InstallCertScreen() {
  const theme = useAppTheme();
  const headerHeight = useHeaderHeight();
  const [scanning, setScanning] = useState(true);
  const [scanKey, setScanKey] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Office name from the certificate once it was installed. */
  const [installed, setInstalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async (cert: string) => {
    setBusy(true);
    setError(null);
    const value = cert.trim();
    const res = parseIdentityQr(value)
      ? null // someone's identity code, most likely the user's own "Mój klucz" screen
      : await MeshService.installCert(value);
    setBusy(false);
    setScanning(false);
    if (res?.ok) return setInstalled(res.name);
    setError(res ? FAILURES[res.reason] : 'To jest kod klucza, a nie certyfikat. Zeskanuj kod wydany przez operatora.');
  };

  const scanAgain = () => {
    setError(null);
    setScanKey((k) => k + 1);
    setScanning(true);
  };

  return (
    // The room for the system navigation bar sits outside the keyboard-avoiding view, so with the
    // keyboard open it ends up behind the keyboard instead of as a gap above it.
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* The window does not shrink for the keyboard (edge-to-edge), and the view measures itself
          against its parent – the header above it has to be passed in. */}
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {installed ? (
            <Notice tone="success" icon="shield-star-outline">
              Certyfikat zainstalowany: {installed}. To urządzenie jest teraz kontem urzędowym – Twoje wiadomości
              będą oznaczane jako pilne, a w Ustawieniach możesz nadać alert do wszystkich.
            </Notice>
          ) : (
            <>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                Certyfikat konta urzędowego wydaje operator po sprawdzeniu Twojej tożsamości i klucza (Ustawienia →
                Mój klucz). Zeskanuj kod QR z jego ekranu albo wklej certyfikat jako tekst.
              </Text>

              {scanning && <QrScanner key={scanKey} onScan={(data) => void install(data)} />}

              {error && (
                <Notice tone="error" icon="alert-outline">
                  {error}
                </Notice>
              )}

              <Text variant="titleMedium">Albo wklej tekst</Text>
              <Field
                multiline
                mono
                placeholder="MC1:CERT:…"
                value={text}
                onChangeText={setText}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <AppButton
                variant="tonal"
                onPress={() => void install(text)}
                disabled={!text.trim() || busy}
                loading={busy}
              >
                Zainstaluj z tekstu
              </AppButton>
            </>
          )}
        </ScrollView>

        {/* Success → back; a failed attempt → scan again. While the camera is live there is nothing to press. */}
        {installed ? (
          <BottomActions safeArea={false}>
            <PrimaryButton icon="arrow-left" onPress={() => router.back()}>
              Wróć
            </PrimaryButton>
          </BottomActions>
        ) : (
          !scanning && (
            <BottomActions safeArea={false}>
              <PrimaryButton icon="qrcode-scan" onPress={scanAgain}>
                Skanuj ponownie
              </PrimaryButton>
            </BottomActions>
          )
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 16 },
});
