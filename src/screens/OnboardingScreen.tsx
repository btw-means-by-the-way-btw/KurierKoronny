import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton, BottomActions, Card, Field, IconTile, MonoGrid } from '../components/ui';
import { fingerprint } from '../services/crypto/keys';
import { NICK_MAX, useIdentityStore, validateNick } from '../store/identityStore';
import { radius, useAppTheme } from '../theme';

export default function OnboardingScreen() {
  const theme = useAppTheme();
  const nodeId = useIdentityStore((s) => s.nodeId);
  const setNick = useIdentityStore((s) => s.setNick);
  const [nick, setNickInput] = useState('');
  const [touched, setTouched] = useState(false);
  const error = validateNick(nick);

  const submit = () => {
    setTouched(true);
    if (!error) setNick(nick);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView style={styles.safe} behavior="height">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <IconTile size={64} icon="access-point-network" />
            <View style={[styles.accent, { backgroundColor: theme.colors.secondary }]} />
            <Text variant="headlineLarge">Witaj w Mesh Chat</Text>
            <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
              Twój telefon stanie się węzłem sieci. Wiadomości przeskakują przez inne telefony, więc
              dotrą też do osób poza zasięgiem Bluetooth.
            </Text>
          </View>

          <Field
            label="Twój nick"
            value={nick}
            onChangeText={setNickInput}
            onBlur={() => setTouched(true)}
            maxLength={NICK_MAX}
            autoFocus
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={submit}
            counter={`${nick.length}/${NICK_MAX}`}
            error={touched ? error : null}
            helper="Nick jest widoczny dla wszystkich w sieci mesh. Możesz go zmienić później."
          />

          <Card>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Twoje bezpieczeństwo
            </Text>
            <Text variant="bodyMedium">
              Rozmowy są szyfrowane end-to-end, a każda wiadomość jest podpisana kluczem, który powstał na tym
              telefonie i nigdy go nie opuszcza. Komunikaty do wszystkich mogą nadawać tylko konta urzędowe z
              certyfikatem. Szczegóły znajdziesz w Ustawieniach → Bezpieczeństwo.
            </Text>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
              Odcisk Twojego klucza
            </Text>
            <MonoGrid size={14} value={fingerprint(nodeId)} />
          </Card>
        </ScrollView>
        <BottomActions safeArea={false}>
          <AppButton icon="arrow-right" iconPosition="end" onPress={submit}>
            Dołącz do sieci
          </AppButton>
        </BottomActions>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 16 },
  hero: { alignItems: 'flex-start', gap: 12, marginTop: 24 },
  accent: { width: 32, height: 4, borderRadius: radius.full },
});
