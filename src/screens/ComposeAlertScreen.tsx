import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { BottomActions, EmptyState, Field, Notice, SegmentedControl, Sheet } from '../components/ui';
import { ALERT_HEADLINE_MAX, ALERT_TEXT_MAX } from '../services/mesh/alertPolicy';
import { CLOCK_SKEW_WARN_MS } from '../services/mesh/MeshRouter';
import { type AlertResult, MeshService } from '../services/mesh/MeshService';
import { selectIsAuthority, useIdentityStore } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import { useAppTheme } from '../theme';

const HOUR_MS = 3_600_000;
const LIFETIMES = [
  { value: '1', label: '1 h' },
  { value: '6', label: '6 h' },
  { value: '24', label: '24 h' },
  { value: '72', label: '72 h' },
];

const FAILURES: Record<Exclude<AlertResult, { ok: true }>['reason'], string> = {
  not_authority: 'To urządzenie nie ma ważnego certyfikatu konta urzędowego.',
  not_confirmed: 'Nie potwierdzono tożsamości – alert nie został nadany.',
  invalid: 'Alert został odrzucony. Sprawdź treść i ważność certyfikatu.',
  offline: 'Sieć mesh jest zatrzymana – włącz Bluetooth i spróbuj ponownie.',
};

/** Broadcast form for authority accounts. Everything here is typed by the user – nothing is prefilled. */
export default function ComposeAlertScreen() {
  const theme = useAppTheme();
  const headerHeight = useHeaderHeight();
  const authority = useIdentityStore((s) => s.authority);
  const isAuthority = useIdentityStore((s) => selectIsAuthority(s));
  const linkCount = useMeshStore((s) => s.links.length);
  const clockSkewMs = useMeshStore((s) => s.clockSkewMs);
  const [headline, setHeadline] = useState('');
  const [text, setText] = useState('');
  const [hours, setHours] = useState('6');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthority || !authority) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <EmptyState
          tone="neutral"
          icon="shield-off-outline"
          text="Alerty mogą nadawać tylko konta urzędowe z ważnym certyfikatem."
        />
      </View>
    );
  }

  const valid = headline.trim().length > 0 && text.length <= ALERT_TEXT_MAX;
  const clockOff = clockSkewMs !== null && Math.abs(clockSkewMs) > CLOCK_SKEW_WARN_MS;

  const send = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    const res = await MeshService.sendAlert(headline, text, Number(hours) * HOUR_MS);
    setBusy(false);
    if (!res.ok) return setError(FAILURES[res.reason]);
    ToastAndroid.show('Alert nadany', ToastAndroid.SHORT);
    router.back();
  };

  return (
    // The room for the system navigation bar sits outside the keyboard-avoiding view, so with the
    // keyboard open it ends up behind the keyboard instead of as a gap under the button.
    <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {/* The window does not shrink for the keyboard (edge-to-edge), and the view measures itself
          against its parent – the header above it has to be passed in. */}
      <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Nadajesz jako <Text style={{ fontWeight: '600' }}>{authority.name}</Text>. Alert zobaczy każdy w zasięgu sieci,
            przypięty na górze aplikacji, i będzie on przekazywany dalej także osobom, które dołączą później.
          </Text>

          {(clockOff || linkCount === 0) && (
            <Notice tone="error" icon="alert-outline">
              {clockOff
                ? 'Zegar tego telefonu różni się od sąsiadów. Alert z błędnym czasem może nie być wyświetlany – ustaw poprawną godzinę przed nadaniem.'
                : 'Brak połączeń z innymi urządzeniami. Alert zostanie zapisany i przekazany pierwszemu urządzeniu, które się połączy.'}
            </Notice>
          )}

          <Field
            label="Nagłówek"
            value={headline}
            onChangeText={setHeadline}
            maxLength={ALERT_HEADLINE_MAX}
            counter={`${headline.length}/${ALERT_HEADLINE_MAX}`}
          />
          <Field
            label="Treść"
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={5}
            maxLength={ALERT_TEXT_MAX}
            helper={`${text.length}/${ALERT_TEXT_MAX} · pisz krótko: co się dzieje, gdzie, co robić.`}
          />

          <Text variant="titleMedium">Ważność</Text>
          <SegmentedControl value={hours} onChange={setHours} options={LIFETIMES} />

          {error && (
            <Notice tone="error" icon="alert-circle-outline">
              {error}
            </Notice>
          )}
        </ScrollView>
        <BottomActions safeArea={false}>
          <PrimaryButton
            icon="bullhorn-outline"
            onPress={() => {
              // The confirmation is a bottom sheet: an open keyboard would cover it.
              Keyboard.dismiss();
              setConfirm(true);
            }}
            disabled={!valid || busy}
            loading={busy}
          >
            Nadaj do wszystkich
          </PrimaryButton>
        </BottomActions>

        <Sheet
          visible={confirm}
          onDismiss={() => setConfirm(false)}
          title="Nadać alert?"
          primary={{ label: 'Nadaj', onPress: send }}
        >
          <Text variant="titleMedium">{headline.trim()}</Text>
          <Text variant="bodyLarge">
            Nadawca: {authority.name}. Ważny {hours} h. Po potwierdzeniu poprosimy o odcisk palca lub kod blokady
            telefonu.
          </Text>
        </Sheet>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
});
