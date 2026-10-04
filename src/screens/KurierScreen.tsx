import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, KeyboardAvoidingView, type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertBanner } from '../components/AlertBanner';
import { KurierTurn } from '../components/KurierTurn';
import { MessageInput } from '../components/MessageInput';
import { EmptyState } from '../components/ui';
import { reduceMotionEnabled } from '../components/ui/Tappable';
import type { RagTurn, SourceRef } from '../services/rag/types';
import { useRagStore } from '../store/ragStore';
import { useAppTheme } from '../theme';

/** Listed on the "Informacje" tab; a row there opens this screen with the question as `q`. */
export const EXAMPLE_QUESTIONS = [
  'Co spakować do plecaka ewakuacyjnego?',
  'Co robić, gdy usłyszę syreny alarmowe?',
  'Jak przygotować dom na długą przerwę w dostawie prądu?',
  'Jak postępować podczas powodzi?',
];

const LIST_PADDING = 8;

/**
 * Conversation with Kurier: questions of this session and their answers, each statement tied to
 * the passage of an official source it comes from. Asking needs the internet; the passages open
 * in the reader without it.
 */
export default function KurierScreen() {
  const theme = useAppTheme();
  const headerHeight = useHeaderHeight();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const turns = useRagStore((s) => s.turns);
  const busy = useRagStore((s) => s.busy);
  const ask = useRagStore((s) => s.ask);
  const list = useRef<FlatList<RagTurn>>(null);
  const viewport = useRef(0);
  const asked = useRef(false);

  // An example question is asked once, as soon as no other question is running. This route can
  // also be opened by a link from outside the app, so the parameter only picks one of the built-in
  // examples: any other question has to be typed and sent by the user.
  useEffect(() => {
    if (asked.current || busy || !q || !EXAMPLE_QUESTIONS.includes(q)) return;
    asked.current = true;
    void ask(q);
  }, [q, busy, ask]);

  const reversed = useMemo(() => [...turns].reverse(), [turns]);

  const send = useCallback(
    async (text: string) => {
      // Queued, not awaited: the field clears at once and the progress shows in the list.
      void ask(text);
      return true;
    },
    [ask]
  );

  const open = useCallback((source: SourceRef) => {
    router.push({ pathname: '/source/[id]', params: { id: source.docId, chunk: source.chunk } });
  }, []);

  // The list is anchored to its bottom edge and an answer is usually taller than the screen, so
  // when the newest turn changes size the list moves to where that turn starts: a new question is
  // seen at once and an answer is read from its first line.
  const onNewestLayout = useCallback((e: LayoutChangeEvent) => {
    if (!viewport.current) return;
    const hidden = e.nativeEvent.layout.height + LIST_PADDING - viewport.current;
    list.current?.scrollToOffset({ offset: Math.max(0, hidden), animated: !reduceMotionEnabled() });
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: RagTurn; index: number }) => (
      // The list is inverted: index 0 is the newest turn.
      <KurierTurn turn={item} onOpenSource={open} onLayout={index === 0 ? onNewestLayout : undefined} />
    ),
    [open, onNewestLayout]
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.colors.surface }]}>
      <AlertBanner />
      {/* Laid out like the chat – see ChatScreen for why the header height is passed in. */}
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          ref={list}
          data={reversed}
          inverted
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout.height;
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            // A plain view around it: the inverted list turns its empty component upright through `style`.
            <View style={styles.empty}>
              <EmptyState
                icon="message-question-outline"
                text="Zapytaj, jak przygotować się na sytuację kryzysową albo jak się w niej zachować. Kurier odpowie na podstawie oficjalnych źródeł i pokaże, skąd pochodzi każda informacja."
              />
            </View>
          }
        />
        <MessageInput
          onSend={send}
          disabled={busy}
          placeholder="Zadaj pytanie"
          accessibilityLabel="Pytanie do Kuriera"
        />
        <Text
          variant="bodyMedium"
          style={[styles.disclaimer, { color: theme.colors.onSurfaceVariant, backgroundColor: theme.colors.surface }]}
        >
          Automatyczne streszczenie źródeł, nie komunikat urzędowy. W nagłym zagrożeniu dzwoń pod 112.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingVertical: LIST_PADDING, flexGrow: 1 },
  empty: { flexGrow: 1 },
  // Continues the white composer bar above it.
  disclaimer: { textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
});
