import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton, Card, MonoGrid } from '../components/ui';
import { identityQr } from '../services/crypto/cert';
import { fingerprint } from '../services/crypto/keys';
import { useIdentityStore } from '../store/identityStore';
import { radius, useAppTheme } from '../theme';
import { fromBase64, toHex } from '../utils/bytes';

/** The QR code sits on white in both themes. */
const QR_TILE = '#FFFFFF';

/**
 * This device's public identity: the signing key as a QR code, its fingerprint, and a form that
 * can be typed (for the operator issuing an authority certificate). Nothing here is secret.
 *
 * Scanning this code verifies the owner on the scanner's phone only. The one-scan mutual
 * verification uses a one-time code opened from the chat with a specific person
 * (VerifyContactScreen) – that code is not public and is never shown here.
 */
export default function MyKeyScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const nodeId = useIdentityStore((s) => s.nodeId);
  const signPublicKey = useIdentityStore((s) => s.signPublicKey);
  const nick = useIdentityStore((s) => s.nick);
  const code = identityQr(signPublicKey);
  const hex = toHex(fromBase64(signPublicKey)).toUpperCase().match(/.{4}/g)?.join(' ') ?? '';

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        To Twój klucz publiczny. Kto go zeskanuje w czacie z Tobą, ma pewność, że pisze z Tobą, a nie z kimś, kto użył
        Twojego nicku. Żeby jednym skanem zweryfikować się wzajemnie, otwórz czat z tą osobą, dotknij ikony tarczy
        i wybierz „Pokaż mój kod”.
      </Text>

      <Card padding={24} style={styles.hero}>
        {/* Always dark-on-white, whatever the theme: scanners need the contrast. */}
        <View style={[styles.qr, { backgroundColor: QR_TILE }]}>
          <QRCode value={code} size={240} backgroundColor="#FFFFFF" color="#000000" />
        </View>
        <Text variant="titleLarge" style={styles.center}>
          {nick}
        </Text>
      </Card>

      <Card>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Odcisk klucza
        </Text>
        <MonoGrid value={fingerprint(nodeId)} />
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Bez aparatu: porównajcie ten odcisk na głos z tym, co widzi rozmówca. Wszystkie 8 grup musi się zgadzać.
        </Text>
      </Card>

      <Card>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Klucz publiczny (do przepisania przy wydawaniu certyfikatu)
        </Text>
        <MonoGrid size={14} value={hex} />
        <AppButton variant="tonal" icon="share-variant-outline" onPress={() => void Share.share({ message: code })}>
          Udostępnij klucz jako tekst
        </AppButton>
      </Card>

      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        To jest klucz publiczny – można go bezpiecznie pokazywać. Klucz prywatny nigdy nie opuszcza tego telefonu.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  hero: { alignItems: 'center', gap: 12 },
  qr: { padding: 16, borderRadius: radius.lg },
  center: { textAlign: 'center' },
});
