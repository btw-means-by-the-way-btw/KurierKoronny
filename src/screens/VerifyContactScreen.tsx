import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { useShallow } from 'zustand/react/shallow';

import { QrScanner } from '../components/QrScanner';
import { TrustBadge } from '../components/TrustBadge';
import { AppButton, BottomActions, Card, EmptyState, GroupCard, ListRow, MonoGrid, Notice, Sheet } from '../components/ui';
import { identityQr } from '../services/crypto/cert';
import { fingerprint } from '../services/crypto/keys';
import { MeshService } from '../services/mesh/MeshService';
import { useChatStore } from '../store/chatStore';
import { authorityName, trustLevel, useContactsStore } from '../store/contactsStore';
import { useIdentityStore } from '../store/identityStore';
import { useVerifyStore } from '../store/verifyStore';
import { radius, useAppTheme } from '../theme';
import { formatDate } from '../utils/time';

type ScanState = 'idle' | 'scanning' | 'match' | 'mismatch' | 'not_a_key';
/**
 * After a matching scan the peer is told about it, so that it marks this device verified too:
 * 'none' = the scanned code was not a one-time code for this conversation,
 * 'unreachable' = the peer never acknowledged.
 */
type MutualState = 'none' | 'pending' | 'confirmed' | 'unreachable';

/** The code disappears from the screen a little before it stops being accepted. */
const SHOW_MARGIN_MS = 10_000;

/** The QR code sits on white in both themes. */
const QR_TILE = '#FFFFFF';

const MUTUAL_TEXT: Record<MutualState, string> = {
  none: 'Ten kod nie był jednorazowym kodem z rozmowy z Tobą, więc rozmówca jeszcze nie widzi Cię jako zweryfikowanej osoby. Niech otworzy czat z Tobą, dotknie tarczy i wybierze „Pokaż mój kod”, a Ty zeskanuj ponownie.',
  pending: 'Czekam na potwierdzenie z telefonu rozmówcy…',
  confirmed: 'Rozmówca też widzi Cię teraz jako zweryfikowaną osobę – drugi skan nie jest potrzebny.',
  unreachable:
    'Klucz rozmówcy się zgadza i jest u Ciebie zweryfikowany, ale jego telefon tego nie potwierdził – u niego nadal jesteś niezweryfikowany. Poproś, żeby pokazał kod jeszcze raz (czat z Tobą → tarcza → „Pokaż mój kod”), i zeskanuj ponownie.',
};

/**
 * Confirms that a conversation's node id belongs to the person standing in front of the user.
 * Both people open this screen for each other; one shows a code, the other scans it, and that
 * single scan verifies both sides (see mesh/verifyOffer).
 *
 * The route parameter only selects which existing conversation is checked – marking it verified
 * always takes a scan, a proof from the peer's phone, or an explicit confirmation on this screen.
 */
export default function VerifyContactScreen() {
  const theme = useAppTheme();
  const { id: peerId } = useLocalSearchParams<{ id: string }>();
  const conversation = useChatStore((s) => s.conversations.find((c) => c.peerId === peerId));
  const trust = useContactsStore(useShallow((s) => ({ contacts: s.contacts, authorities: s.authorities })));
  const signPublicKey = useIdentityStore((s) => s.signPublicKey);
  // The one-time code this device shows for this conversation, and what became of the last one.
  const offer = useVerifyStore((s) => (s.machine.offer?.peerId === peerId ? s.machine.offer : null));
  const outcome = useVerifyStore((s) => (s.outcome?.peerId === peerId ? s.outcome : null));
  // A code this peer has just used. It stays on screen for a moment: if the person standing here
  // has not scanned yet, their scan of the same code is what exposes an impostor (see verifyOffer).
  const accepted = useVerifyStore((s) => (s.machine.accepted?.by === peerId ? s.machine.accepted : null));
  const [scan, setScan] = useState<ScanState>('idle');
  const [mutual, setMutual] = useState<MutualState>('none');
  const [confirmManual, setConfirmManual] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [now, setNow] = useState(Date.now);
  /** Counts scans, so that the answer to an abandoned scan cannot overwrite the state of a newer one. */
  const scanRun = useRef(0);

  // Countdown for the code on screen.
  useEffect(() => {
    if (!offer && !accepted) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [offer, accepted]);

  // Leaving the screen forgets the success banner; a code still in flight stays valid until it
  // expires, and a conflict warning stays until the user has seen it here and acts on it.
  useFocusEffect(
    useCallback(
      () => () => {
        const { outcome: last, set } = useVerifyStore.getState();
        if (last?.peerId === peerId && last.kind === 'verified') set({ outcome: null });
      },
      [peerId]
    )
  );

  if (!conversation || !peerId) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          tone="neutral"
          icon="chat-question-outline"
          text="Nie ma takiej rozmowy. Otwórz czat z osobą, której klucz chcesz sprawdzić."
        />
      </View>
    );
  }

  const level = trustLevel(trust, peerId);
  const office = authorityName(trust, peerId);
  const verifiedAt = trust.contacts[peerId]?.verifiedAt;
  const secondsLeft = offer ? Math.ceil((offer.expiresAt - SHOW_MARGIN_MS - now) / 1_000) : 0;
  const showing = !!offer && secondsLeft > 0;
  const expired = !!offer && secondsLeft <= 0;
  const lingering = !offer && !!accepted && now <= accepted.until;
  const codeToken = showing ? offer.token : lingering ? accepted.token : null;

  const onScan = (text: string) => {
    const run = ++scanRun.current;
    // The service checks the key against this conversation, marks the peer verified and – one scan
    // being enough for both sides – proves to the owner of the code that we saw it on their screen.
    const scanned = MeshService.scanVerificationCode(peerId, text);
    setScan(scanned.result);
    if (scanned.result !== 'match') return;
    if (!scanned.confirmation) return setMutual('none');
    setMutual('pending');
    void scanned.confirmation.then((confirmed) => {
      if (scanRun.current === run) setMutual(confirmed ? 'confirmed' : 'unreachable');
    });
  };

  const startScan = () => {
    scanRun.current++;
    MeshService.closeVerificationOffer();
    if (outcome) useVerifyStore.getState().set({ outcome: null });
    setMutual('none');
    setScan('scanning');
  };

  const showCode = () => {
    setScan('idle');
    setMutual('none');
    setNow(Date.now());
    MeshService.openVerificationOffer(peerId);
  };

  // Scanner side: the key matched and the peer was told (or cannot be told with this kind of code).
  const scanned = scan === 'match' && mutual !== 'unreachable';
  const scanFailed = scan === 'mismatch' || scan === 'not_a_key' || (scan === 'match' && mutual === 'unreachable');
  // Showing side: the peer scanned the code on this screen.
  const wasScanned = outcome?.kind === 'verified';
  const done = scanned || wasScanned;
  // The key matched but the code could not verify us on the other phone: worth another scan.
  const oneSided = scan === 'match' && mutual === 'none';

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text variant="titleLarge">{conversation.title}</Text>
          <TrustBadge level={level} />
          {office && (
            <Text variant="bodyMedium">
              To konto ma certyfikat urzędowy wystawiony dla: {office}. Certyfikat podpisał klucz główny wszyty w
              aplikację – nie da się go uzyskać, podając się za urząd w nicku.
            </Text>
          )}
          {verifiedAt != null && (
            <Text variant="bodyMedium">Klucz zweryfikowany osobiście {formatDate(verifiedAt)}.</Text>
          )}
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            Odcisk klucza tej osoby
          </Text>
          <MonoGrid value={fingerprint(peerId)} />
        </Card>

        {scan === 'scanning' && <QrScanner onScan={onScan} />}

        {codeToken && (
          <Card padding={24} style={styles.code}>
            {/* Always dark-on-white, whatever the theme: scanners need the contrast. */}
            <View style={[styles.qr, { backgroundColor: QR_TILE }]}>
              <QRCode value={identityQr(signPublicKey, codeToken)} size={240} backgroundColor="#FFFFFF" color="#000000" />
            </View>
            {showing ? (
              <>
                <Text variant="bodyMedium" style={styles.centerText}>
                  Niech {conversation.title} otworzy czat z Tobą, dotknie tarczy i zeskanuje ten kod.
                </Text>
                <Text variant="labelMedium" style={[styles.centerText, { color: theme.colors.onSurfaceVariant }]}>
                  Kod jednorazowy, tylko dla tej rozmowy · ważny jeszcze {secondsLeft} s. Pokazuj go osobiście – nie
                  wysyłaj zdjęcia ani zrzutu ekranu.
                </Text>
              </>
            ) : (
              <Text variant="bodyMedium" style={styles.centerText}>
                Czy to osoba obok Ciebie właśnie zeskanowała ten kod? Jeśli jeszcze nie, niech zeskanuje go teraz –
                kod zostaje na chwilę właśnie po to. Gdyby odczytał go ktoś inny, zobaczysz tu ostrzeżenie.
              </Text>
            )}
          </Card>
        )}
        {expired && (
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Kod wygasł. Pokaż nowy, gdy rozmówca będzie gotowy do skanowania.
          </Text>
        )}

        {done && (
          <Notice tone="success" icon="shield-check-outline">
            {wasScanned
              ? `${conversation.title} zeskanował(a) Twój kod. Widzicie się teraz wzajemnie jako zweryfikowani.`
              : `Zgadza się. Ten czat prowadzisz z urządzeniem, którego kod właśnie zeskanowano. ${MUTUAL_TEXT[mutual]}`}
          </Notice>
        )}
        {scanFailed && (
          <Notice tone="error" icon="alert" strong={scan === 'mismatch'}>
            {scan === 'mismatch'
              ? 'To NIE jest klucz tej rozmowy. Osoba, której kod zeskanowano, to inne urządzenie niż to, z którym tu piszesz. Nie ufaj tej rozmowie.'
              : scan === 'not_a_key'
                ? 'To nie jest kod klucza Mesh Chat. Poproś rozmówcę o otwarcie czatu z Tobą → tarcza → „Pokaż mój kod”.'
                : MUTUAL_TEXT.unreachable}
          </Notice>
        )}
        {outcome?.kind === 'conflict' && (
          <Notice
            tone="error"
            icon="alert"
            strong
            footer={
              <View>
                <Text variant="labelMedium" style={{ color: theme.colors.onErrorContainer }}>
                  Tamto urządzenie:
                </Text>
                <MonoGrid size={14} color={theme.colors.onErrorContainer} value={fingerprint(outcome.by)} />
              </View>
            }
          >
            Twój kod odczytało inne urządzenie niż to, z którym prowadzisz tę rozmowę. Albo ktoś podejrzał ekran, albo
            ta rozmowa nie jest z osobą, która stoi przed Tobą. Ten kod nikogo nie zweryfikował – zeskanujcie swoje
            kody nawzajem.
          </Notice>
        )}

        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          Spotkajcie się osobiście i oboje otwórzcie ten ekran (czat → ikona tarczy). Jedno z Was wybiera „Pokaż mój
          kod”, drugie skanuje. Wystarczy jeden skan: oba telefony oznaczą rozmówcę jako zweryfikowanego. Kod przesłany
          zdjęciem przez inną osobę niczego nie dowodzi.
        </Text>
        {/* The two rows never show together, and an empty card would still cast a shadow: one card each. */}
        {level === 'unverified' && (
          <GroupCard>
            <ListRow
              icon="account-voice"
              title="Porównaliśmy odciski na głos"
              trailing="none"
              onPress={() => setConfirmManual(true)}
            />
          </GroupCard>
        )}
        {verifiedAt != null && (
          <GroupCard>
            <ListRow
              tone="danger"
              icon="shield-off-outline"
              title="Cofnij weryfikację"
              trailing="none"
              onPress={() => setConfirmClear(true)}
            />
          </GroupCard>
        )}
      </ScrollView>

      <BottomActions>
        {oneSided ? (
          <>
            <AppButton icon="arrow-left" onPress={() => router.back()}>
              Wróć
            </AppButton>
            <AppButton variant="tonal" icon="qrcode-scan" onPress={startScan}>
              Skanuj ponownie
            </AppButton>
          </>
        ) : done ? (
          <AppButton icon="arrow-left" onPress={() => router.back()}>
            Wróć
          </AppButton>
        ) : showing ? (
          <AppButton variant="tonal" onPress={() => MeshService.closeVerificationOffer()}>
            Ukryj kod
          </AppButton>
        ) : (
          <>
            <AppButton icon="qrcode-scan" onPress={startScan} disabled={scan === 'scanning'}>
              {scanFailed ? 'Skanuj ponownie' : 'Skanuj kod rozmówcy'}
            </AppButton>
            <AppButton variant="tonal" icon="qrcode" onPress={showCode}>
              {expired ? 'Pokaż nowy kod' : 'Pokaż mój kod'}
            </AppButton>
          </>
        )}
      </BottomActions>

      <Sheet
        visible={confirmManual}
        onDismiss={() => setConfirmManual(false)}
        title="Odciski się zgadzają?"
        primary={{
          label: 'Zgadzają się',
          onPress: () => {
            MeshService.markVerified(peerId);
            setConfirmManual(false);
            setScan('idle');
          },
        }}
      >
        Potwierdź tylko wtedy, gdy rozmówca osobiście odczytał swój odcisk z ekranu „Mój klucz” i wszystkie 8 grup jest
        identycznych z odciskiem powyżej. To potwierdza tylko Twoją stronę – rozmówca musi zrobić to samo u siebie.
      </Sheet>
      <Sheet
        visible={confirmClear}
        onDismiss={() => setConfirmClear(false)}
        title="Cofnąć weryfikację?"
        primary={{
          label: 'Cofnij',
          destructive: true,
          onPress: () => {
            scanRun.current++;
            MeshService.clearVerification(peerId);
            setConfirmClear(false);
            setScan('idle');
            setMutual('none');
          },
        }}
      >
        Ta rozmowa znów będzie oznaczona jako niezweryfikowana na tym telefonie. Na telefonie rozmówcy nic się nie
        zmieni.
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  code: { alignItems: 'center', gap: 12 },
  qr: { padding: 16, borderRadius: radius.lg },
  centerText: { textAlign: 'center' },
});
