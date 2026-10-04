import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlertBanner } from '../components/AlertBanner';
import { Card, EmptyState, ListRow } from '../components/ui';
import { docsByGroup } from '../services/rag/kb';
import type { KbDoc } from '../services/rag/types';
import { useAppTheme } from '../theme';

/** "RCB · 2024 · PDF" */
const describe = (doc: KbDoc) =>
  [doc.publisher, doc.year, doc.format === 'pdf' ? 'PDF' : 'strona internetowa'].filter(Boolean).join(' · ');

/**
 * Documents of one group of the source library, read without the internet. The route parameter is
 * the group's position in the library – group names hold colons and Polish letters.
 */
export default function SourcesScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { group } = useLocalSearchParams<{ group: string }>();
  const section = useMemo(() => docsByGroup()[Number(group)], [group]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {section ? (
        <>
          <Stack.Screen options={{ title: section.group }} />
          <AlertBanner />
          <FlatList
            data={section.docs}
            keyExtractor={(doc) => doc.id}
            renderItem={({ item }) => (
              <Card
                radius="md"
                padding={0}
                onPress={() => router.push({ pathname: '/source/[id]', params: { id: item.id } })}
              >
                {/* Titles of legal acts differ only far into the name, hence the extra lines. */}
                <ListRow
                  title={item.title}
                  titleLines={4}
                  description={describe(item)}
                  descriptionLines={4}
                  trailing="chevron"
                />
              </Card>
            )}
            ItemSeparatorComponent={() => <View style={styles.gap} />}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          />
        </>
      ) : (
        <EmptyState tone="neutral" icon="folder-question-outline" text="Nie ma takiego działu w źródłach." />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16 },
  gap: { height: 8 },
});
