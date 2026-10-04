import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { PrimaryButton } from '../components/PrimaryButton';
import { BottomActions, GroupCard, ListRow, Notice, SectionHeader, TabRoot } from '../components/ui';
import { docsByGroup } from '../services/rag/kb';
import { useAppTheme } from '../theme';
import { EXAMPLE_QUESTIONS } from './KurierScreen';

/** "1 dokument", "3 dokumenty", "12 dokumentów". */
function documents(n: number): string {
  const ones = n % 10;
  const tens = n % 100;
  const few = ones >= 2 && ones <= 4 && !(tens >= 12 && tens <= 14);
  return `${n} ${n === 1 ? 'dokument' : few ? 'dokumenty' : 'dokumentów'}`;
}

/**
 * Root of the "Informacje" tab: the way into Kurier and into the library of sources it answers
 * from. The library is bundled with the app; only a question to Kurier goes over the internet.
 */
export default function RAGScreen() {
  const theme = useAppTheme();
  // The first call parses the bundled knowledge base, so it happens here and not at module level.
  const groups = useMemo(() => docsByGroup(), []);
  const total = groups.reduce((n, g) => n + g.docs.length, 0);

  return (
    <TabRoot title="Informacje">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Notice tone="neutral" icon="information-outline">
          Kurier odpowiada wyłącznie na podstawie oficjalnych źródeł zapisanych w aplikacji. Pytanie jest wysyłane
          przez internet do zewnętrznego modelu językowego. Odpowiedź to automatyczne streszczenie, a nie komunikat
          urzędowy.
        </Notice>

        <SectionHeader title="Przykładowe pytania" />
        <GroupCard inset={16}>
          {EXAMPLE_QUESTIONS.map((q) => (
            <ListRow
              key={q}
              title={q}
              titleLines={3}
              onPress={() => router.push({ pathname: '/kurier', params: { q } })}
            />
          ))}
        </GroupCard>

        <SectionHeader title="Źródła" subtitle={`${documents(total)} · dostępne bez internetu`} />
        <GroupCard inset={16}>
          {groups.map(({ group, docs }, i) => (
            <ListRow
              key={group}
              title={group}
              description={documents(docs.length)}
              // The position, not the name: group names hold colons and Polish letters.
              onPress={() => router.push({ pathname: '/sources/[group]', params: { group: i } })}
            />
          ))}
        </GroupCard>
      </ScrollView>

      {/* The tab bar below takes the system inset. */}
      <BottomActions safeArea={false}>
        <PrimaryButton icon="message-question-outline" onPress={() => router.push('/kurier')}>
          Zapytaj Kuriera
        </PrimaryButton>
        <Text variant="bodyMedium" style={[styles.emergency, { color: theme.colors.onSurfaceVariant }]}>
          W nagłym zagrożeniu życia dzwoń pod 112.
        </Text>
      </BottomActions>
    </TabRoot>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  emergency: { textAlign: 'center' },
});
