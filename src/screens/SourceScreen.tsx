import { Stack, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Linking, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AlertBanner } from '../components/AlertBanner';
import { AppButton, BottomActions, Card, EmptyState } from '../components/ui';
import { chunksOf, docLabel, getDoc } from '../services/rag/kb';
import type { KbChunk, KbDoc } from '../services/rag/types';
import { useAppTheme } from '../theme';

type Passage = { index: number; chunk: KbChunk };

// What FlatList draws at first when nothing asks for more.
const INITIAL_PASSAGES = 10;
const RETRY_MS = 50;

/**
 * Reader of one source document. Opened from the library it starts at the top; opened from a
 * citation (`chunk`, the passage's index in the whole base) it starts at the cited passage.
 */
export default function SourceScreen() {
  const theme = useAppTheme();
  const { id, chunk } = useLocalSearchParams<{ id: string; chunk?: string }>();
  const doc = getDoc(id);
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {doc ? (
        <Reader doc={doc} cited={Number(chunk)} />
      ) : (
        <EmptyState tone="neutral" icon="file-question-outline" text="Nie ma takiego dokumentu w źródłach." />
      )}
    </View>
  );
}

function Reader({ doc, cited }: { doc: KbDoc; cited: number }) {
  const { colors } = useAppTheme();
  const passages = useMemo(() => chunksOf(doc), [doc]);
  // Position of the cited passage within this document; -1 when there is none (or it is not here).
  const offset = cited - doc.first;
  const target = Number.isInteger(offset) && offset >= 0 && offset < doc.count ? offset : -1;
  const list = useRef<FlatList<Passage>>(null);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reveal = useCallback(() => {
    list.current?.scrollToIndex({ index: target, animated: false, viewOffset: 8 });
  }, [target]);

  // Open at the cited passage. A passage has no known height until it is laid out, so the first
  // attempt comes too early and `onScrollToIndexFailed` repeats it. The first passage needs no
  // scrolling – it sits right under the document details.
  useEffect(() => {
    if (target > 0) reveal();
    return () => clearTimeout(retry.current);
  }, [target, reveal]);

  const renderItem = useCallback(
    ({ item, index }: { item: Passage; index: number }) => {
      const previous = passages[index - 1]?.chunk;
      const { s, p, t } = item.chunk;
      return (
        <PassageBlock
          heading={s !== previous?.s ? s : undefined}
          page={p !== previous?.p ? p : undefined}
          text={t}
          cited={index === target}
        />
      );
    },
    [passages, target]
  );

  return (
    <>
      <Stack.Screen options={{ title: docLabel(doc) }} />
      <AlertBanner />
      <FlatList
        ref={list}
        data={passages}
        keyExtractor={(passage) => String(passage.index)}
        renderItem={renderItem}
        // Everything down to the cited passage is drawn in the first pass: its position is then
        // exact, and nothing above it changes height while it is being read.
        initialNumToRender={Math.max(INITIAL_PASSAGES, target + 1)}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          retry.current = setTimeout(reveal, RETRY_MS);
        }}
        ListHeaderComponent={
          <View style={styles.details}>
            {/* The header shows one line of the title; here it is whole. */}
            <Text variant="titleMedium" selectable style={{ color: colors.onSurface }}>
              {docLabel(doc)}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {doc.publisher}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              Pobrano: {doc.fetched.split('-').reverse().join('.')} · Licencja: {doc.license}
            </Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              Tekst wyodrębniono automatycznie z oryginału, układ może się różnić.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
      <BottomActions>
        <AppButton variant="tonal" icon="open-in-new" onPress={() => void Linking.openURL(doc.url)}>
          Otwórz oryginał
        </AppButton>
      </BottomActions>
    </>
  );
}

interface PassageBlockProps {
  heading?: string; // set on the first passage of a section
  page?: number; // set on the first passage of a page
  text: string;
  cited: boolean;
}

/**
 * One passage as a card (DESIGN.md → Reader passage). The cited one is tinted and says so in
 * words – the tint alone would not reach a screen reader.
 */
const PassageBlock = memo(function PassageBlock({ heading, page, text, cited }: PassageBlockProps) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.passage, (heading !== undefined || page !== undefined) && styles.opening]}>
      {page !== undefined && (
        <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
          Strona {page}
        </Text>
      )}
      {heading !== undefined && (
        <Text variant="titleMedium" accessibilityRole="header" style={{ color: colors.onSurface }}>
          {heading}
        </Text>
      )}
      <Card style={cited && { backgroundColor: colors.primaryContainer }}>
        {cited && (
          <Text variant="labelMedium" style={{ color: colors.onPrimaryContainer }}>
            Cytowany fragment
          </Text>
        )}
        <Text
          variant="bodyLarge"
          selectable
          style={{ color: cited ? colors.onPrimaryContainer : colors.onSurface }}
        >
          {text}
        </Text>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingBottom: 16 },
  details: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 4 },
  passage: { paddingHorizontal: 16, marginTop: 8, gap: 8 },
  // A new section or page stands apart from the text before it.
  opening: { marginTop: 24 },
});
