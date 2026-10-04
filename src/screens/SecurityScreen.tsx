import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, type IconName, SectionHeader, StatusDisc, Tag } from '../components/ui';
import { TRUST_ANCHORS } from '../services/crypto/trustAnchors';
import { CLOCK_SKEW_WARN_MS } from '../services/mesh/MeshRouter';
import { hasDeviceLock } from '../services/security/deviceLock';
import { isDatabaseEncrypted } from '../services/storage/db';
import { useChatStore } from '../store/chatStore';
import { useContactsStore } from '../store/contactsStore';
import { selectIsAuthority, useIdentityStore } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import { useAppTheme } from '../theme';
import { formatDate } from '../utils/time';

type State = 'on' | 'warning' | 'unknown';

interface Item {
  title: string;
  state: State;
  detail: string;
}

const STATE_UI: Record<State, { status: 'connected' | 'searching' | 'offline'; icon: IconName; label: string }> = {
  on: { status: 'connected', icon: 'check', label: 'Działa' },
  warning: { status: 'searching', icon: 'exclamation', label: 'Uwaga' },
  unknown: { status: 'offline', icon: 'help', label: 'Nieznane' },
};

const LIMITS = [
  'Metadane są jawne: przekaźniki widzą, kto do kogo pisze, kiedy i jak długą wiadomość – ale nie jej treść.',
  'Brak utajniania wstecznego (forward secrecy): kto nagra szyfrogramy z eteru, a później zdobędzie klucz z Twojego telefonu, odczyta dawne rozmowy.',
  'Komunikaty urzędowe są publiczne: podpisane, ale nieszyfrowane.',
  'Certyfikatu urzędowego nie da się unieważnić bez aktualizacji aplikacji. W czasie awarii przestaje działać dopiero, gdy wygaśnie – dlatego certyfikaty są krótkie.',
  'Złośliwy telefon w sieci może gubić lub opóźniać cudze pakiety. Nie może ich odczytać, zmienić ani podrobić.',
  'Nick każdy wybiera sam. Pewność, z kim piszesz, daje tylko zweryfikowany klucz albo oznaczenie „Konto urzędowe”.',
  'Klucze w trakcie pracy są w pamięci aplikacji. Magazyn systemowy i szyfrowana baza chronią dane w telefonie wyłączonym lub zablokowanym.',
  'Zagłuszanie Bluetooth i przejęty system (root, złośliwe oprogramowanie) są poza zasięgiem tych zabezpieczeń.',
];

/**
 * What protects the user right now – computed from the actual state of this device, not a static
 * list – and, just as prominently, what the app does not protect against.
 */
export default function SecurityScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const identity = useIdentityStore();
  const clockSkewMs = useMeshStore((s) => s.clockSkewMs);
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useContactsStore((s) => s.contacts);
  const [deviceLock, setDeviceLock] = useState<boolean | null>(null);
  const [dbEncrypted, setDbEncrypted] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      setDbEncrypted(isDatabaseEncrypted());
      hasDeviceLock()
        .then(setDeviceLock)
        .catch(() => setDeviceLock(null));
    }, [])
  );

  const verified = conversations.filter((c) => c.peerId && contacts[c.peerId]?.verifiedAt).length;
  const skewMinutes = clockSkewMs === null ? null : Math.round(Math.abs(clockSkewMs) / 60_000);
  const clockOff = clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS;
  const isAuthority = selectIsAuthority(identity);

  const items: Item[] = [
    {
      title: 'Szyfrowanie rozmów end-to-end',
      state: 'on',
      detail: 'Treść i nick czyta tylko odbiorca (X25519 + XSalsa20-Poly1305). Telefony przekazujące wiadomość widzą wyłącznie nagłówek.',
    },
    {
      title: 'Podpis każdego pakietu',
      state: 'on',
      detail: 'Każdy pakiet jest podpisany kluczem nadawcy (Ed25519) i sprawdzany na każdym skoku. Nikt nie nada wiadomości w Twoim imieniu.',
    },
    {
      title: 'Ochrona przed powtórzeniami',
      state: 'on',
      detail: 'Nagrany pakiet nie zadziała drugi raz: liczy się podpisany czas, pamięć widzianych pakietów i identyfikator wiadomości.',
    },
    {
      title: 'Tylko urzędy nadają do wszystkich',
      state: TRUST_ANCHORS.roots.length > 0 ? 'on' : 'warning',
      detail:
        TRUST_ANCHORS.roots.length > 0
          ? 'Komunikat do wszystkich wymaga certyfikatu podpisanego kluczem głównym wszytym w aplikację. Zwykły użytkownik nie może rozgłaszać treści.'
          : 'Ta kompilacja nie ma wszytego klucza głównego, więc żadne konto urzędowe nie zostanie uznane, a alerty nie będą wyświetlane.',
    },
    {
      title: 'Klucze w magazynie systemowym',
      state: 'on',
      detail: 'Ziarno kluczy jest zaszyfrowane kluczem z Android Keystore. Powstało na tym telefonie i nigdy go nie opuszcza.',
    },
    {
      title: 'Zaszyfrowana baza danych',
      state: dbEncrypted === null ? 'unknown' : dbEncrypted ? 'on' : 'warning',
      detail:
        dbEncrypted === false
          ? 'Ta kompilacja nie zawiera SQLCipher – historia rozmów leży w telefonie niezaszyfrowana. Zbuduj aplikację ponownie z aktualną konfiguracją.'
          : 'Historia, kontakty i alerty są szyfrowane (SQLCipher) kluczem z magazynu systemowego. Kopie zapasowe Androida są wyłączone.',
    },
    {
      title: 'Blokada ekranu',
      state: deviceLock === null ? 'unknown' : deviceLock ? 'on' : 'warning',
      detail:
        deviceLock === false
          ? 'Telefon nie ma blokady ekranu. Każdy, kto weźmie go do ręki, przeczyta rozmowy i może pisać jako Ty. Ustaw PIN, wzór lub odcisk palca.'
          : 'Blokada telefonu chroni rozmowy przed osobą, która ma go w ręku.',
    },
    {
      title: 'Zegar telefonu',
      state: skewMinutes === null ? 'unknown' : clockOff ? 'warning' : 'on',
      detail:
        skewMinutes === null
          ? 'Brak sąsiadów do porównania. Pakiety z czasem różniącym się o ponad 10 minut są odrzucane.'
          : clockOff
            ? `Zegar różni się od sąsiadów o ok. ${skewMinutes} min. Powyżej 10 minut inni przestaną przyjmować Twoje wiadomości – ustaw poprawną godzinę.`
            : 'Zegar zgadza się z sąsiadami.',
    },
    {
      title: 'Zweryfikowane kontakty',
      state: conversations.length === 0 ? 'unknown' : verified === conversations.length ? 'on' : 'warning',
      detail:
        conversations.length === 0
          ? 'Nie masz jeszcze rozmów. Klucz rozmówcy sprawdzisz w czacie, pod ikoną tarczy.'
          : `Zweryfikowano ${verified} z ${conversations.length} rozmów. Bez weryfikacji nie masz pewności, czy ktoś nie podszył się pod znajomego cudzym nickiem.`,
    },
  ];
  if (identity.authority) {
    items.push({
      title: 'Konto urzędowe',
      state: isAuthority ? 'on' : 'warning',
      detail: isAuthority
        ? `${identity.authority.name} · certyfikat ważny do ${formatDate(identity.authority.exp)}. Nadanie alertu wymaga odcisku palca lub kodu blokady.`
        : `Certyfikat (${identity.authority.name}) wygasł ${formatDate(identity.authority.exp)}.`,
    });
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <SectionHeader first title="Co Cię chroni" />
      {items.map((item) => {
        const ui = STATE_UI[item.state];
        return (
          <Card key={item.title} style={styles.card}>
            <View style={styles.head}>
              <StatusDisc status={ui.status} icon={ui.icon} />
              <Text variant="titleMedium" style={styles.title}>
                {item.title}
              </Text>
              <Tag label={ui.label} />
            </View>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {item.detail}
            </Text>
          </Card>
        );
      })}

      <SectionHeader title="Czego aplikacja nie chroni" />
      <Card style={styles.limits}>
        {LIMITS.map((limit) => (
          <View key={limit} style={styles.limit}>
            <Icon source="minus-circle-outline" size={20} color={theme.colors.onSurfaceVariant} />
            <Text variant="bodyMedium" style={[styles.title, { color: theme.colors.onSurface }]}>
              {limit}
            </Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  card: { marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1 },
  limits: { gap: 12 },
  limit: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
});
