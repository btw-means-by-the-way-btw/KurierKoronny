import { Fragment, memo, useEffect, useState } from 'react';
import { Animated, type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { RagTurn, SourceRef, TurnStatus } from '../services/rag/types';
import { motion, radius, type, useAppTheme } from '../theme';
import { ListRow } from './ui/ListRow';
import { Notice } from './ui/Notice';
import { reduceMotionEnabled } from './ui/Tappable';

interface Props {
  turn: RagTurn;
  onOpenSource: (source: SourceRef) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}

const PROGRESS: Partial<Record<TurnStatus, string>> = {
  planning: 'Ustalam, czego szukać…',
  searching: 'Przeszukuję źródła…',
  answering: 'Piszę odpowiedź na podstawie źródeł…',
};

// Width of the "[n]" that leads a source row, and where the hairline between rows starts.
const NUMBER_WIDTH = 28;
const ROW_INSET = 16;
const ROW_GAP = 12;

/** What Kurier is doing right now: one line and a dot that fades in and out (DESIGN.md → Motion). */
function Progress({ label }: { label: string }) {
  const { colors } = useAppTheme();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotionEnabled()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: motion.pulse, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: motion.pulse, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.progress}>
      <Animated.View style={[styles.dot, { backgroundColor: colors.primary, opacity: pulse }]} />
      <Text
        variant="bodyMedium"
        accessibilityLiveRegion="polite"
        style={[styles.fill, { color: colors.onSurfaceVariant }]}
      >
        {label}
      </Text>
    </View>
  );
}

interface SourcesProps {
  title: string;
  sources: SourceRef[];
  numbered: boolean; // rows lead with the "[n]" the answer cites them by
  onOpen: (source: SourceRef) => void;
}

/** The passages behind an answer, or the nearest ones when there is none. A row opens the reader. */
function Sources({ title, sources, numbered, onOpen }: SourcesProps) {
  const { colors } = useAppTheme();
  const line = { backgroundColor: colors.outlineVariant };
  return (
    <>
      <View style={[styles.hairline, line]} />
      <Text variant="labelMedium" accessibilityRole="header" style={[styles.label, { color: colors.onSurfaceVariant }]}>
        {title}
      </Text>
      {sources.map((source, i) => (
        <Fragment key={source.n}>
          {i > 0 && (
            <View
              style={[styles.hairline, line, { marginLeft: ROW_INSET + (numbered ? NUMBER_WIDTH + ROW_GAP : 0) }]}
            />
          )}
          <ListRow
            title={source.title}
            titleLines={3}
            description={source.detail || undefined}
            leading={
              numbered ? (
                <Text variant="titleMedium" style={[styles.number, { color: colors.primary }]}>
                  [{source.n}]
                </Text>
              ) : undefined
            }
            accessibilityLabel={`${numbered ? `Źródło ${source.n}` : 'Fragment'}: ${source.title}. ${source.detail}`}
            onPress={() => onOpen(source)}
          />
        </Fragment>
      ))}
    </>
  );
}

/**
 * One question to Kurier and what became of it (DESIGN.md → Answer block). The question is an
 * outgoing bubble. The answer is a plain block, not a bubble: it is an automatic summary, so it
 * carries nothing a message from a person or an authority account does – no tail, no badge, no
 * border. Every statement ends in a "[n]" that opens the passage it comes from; the rows under the
 * answer open the same passages and are the large touch targets.
 */
function KurierTurnImpl({ turn, onOpenSource, onLayout }: Props) {
  const { colors } = useAppTheme();
  const progress = PROGRESS[turn.status];

  return (
    <View onLayout={onLayout} style={styles.turn}>
      <View style={styles.questionRow}>
        <View
          accessible
          accessibilityLabel={`Twoje pytanie: ${turn.question}`}
          style={[styles.question, { backgroundColor: colors.primaryContainer }]}
        >
          <Text variant="bodyLarge" style={{ color: colors.onPrimaryContainer }}>
            {turn.question}
          </Text>
        </View>
      </View>

      {progress ? (
        <Progress label={progress} />
      ) : turn.status === 'error' ? (
        <Notice tone="error" icon="alert-circle-outline" style={styles.block}>
          {turn.error}
        </Notice>
      ) : (
        <View style={[styles.block, styles.answer, { backgroundColor: colors.surface }]}>
          <Text variant="bodyLarge" style={[styles.text, { color: colors.onSurface }]}>
            {turn.status === 'done'
              ? turn.parts.map((part, i) => {
                  if (part.type === 'text') return part.text;
                  const source = turn.sources.find((s) => s.n === part.n);
                  return (
                    source && (
                      <Text
                        key={i}
                        variant="titleMedium"
                        accessibilityRole="link"
                        accessibilityLabel={`Źródło ${source.n}: ${source.title}`}
                        onPress={() => onOpenSource(source)}
                        style={{ color: colors.primary }}
                      >
                        {/* Tied to the word before it, so a marker never starts a line. */}
                        {` [${source.n}]`}
                      </Text>
                    )
                  );
                })
              : 'Nie znalazłem odpowiedzi w źródłach.'}
          </Text>
          {turn.sources.length > 0 && (
            <Sources
              title={turn.status === 'done' ? 'Źródła' : 'Najbliższe fragmenty'}
              sources={turn.sources}
              numbered={turn.status === 'done'}
              onOpen={onOpenSource}
            />
          )}
          {turn.queries.length > 0 && (
            <>
              <View style={[styles.hairline, { backgroundColor: colors.outlineVariant }]} />
              <Text variant="bodyMedium" style={[styles.searched, { color: colors.onSurfaceVariant }]}>
                Szukano: {turn.queries.join(', ')}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

export const KurierTurn = memo(KurierTurnImpl);

const styles = StyleSheet.create({
  turn: { paddingTop: 8 },
  // Same measures as an outgoing chat bubble (MessageBubble).
  questionRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, marginTop: 8 },
  question: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.xs,
  },
  progress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  // Sits on the first line of the label, also when the label wraps.
  dot: { width: 8, height: 8, borderRadius: radius.full, marginTop: (type.bodyMd.lineHeight - 8) / 2 },
  fill: { flex: 1 },
  block: { marginHorizontal: 12, marginTop: 8 },
  // Clipped, so the pressed tint of a source row stays inside the corners.
  answer: { borderRadius: radius.lg, overflow: 'hidden' },
  text: { padding: 16 },
  hairline: { height: 1 },
  label: { paddingHorizontal: ROW_INSET, paddingTop: 12 },
  number: { minWidth: NUMBER_WIDTH },
  searched: { paddingHorizontal: ROW_INSET, paddingVertical: 12 },
});
