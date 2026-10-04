import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import type { ChatMessage } from '../store/types';
import { radius, useAppTheme } from '../theme';
import { formatTime } from '../utils/time';
import { Tappable } from './ui/Tappable';

interface Props {
  message: ChatMessage;
  onRetry?: (id: string) => void;
  tail?: boolean; // last bubble of a run: the corner next to the sender's edge is cut to 4px
  grouped?: boolean; // follows a bubble from the same sender: sits closer to it
}

const STATUS_ICON: Record<ChatMessage['status'], { icon: string; label: string }> = {
  sending: { icon: 'clock-outline', label: 'Wysyłanie' },
  sent: { icon: 'check', label: 'Wysłana' },
  waiting: { icon: 'timer-sand', label: 'Czeka na zasięg odbiorcy' },
  delivered: { icon: 'check-all', label: 'Dostarczona' },
  failed: { icon: 'alert-circle-outline', label: 'Nieudana – dotknij, aby ponowić' },
};

/**
 * One chat message (DESIGN.md → Message bubble). Flat – no shadow inside the inverted list. The
 * 1px error border is reserved for the two states that carry meaning: a message from an authority
 * certificate holder ("PILNE · …") and an own message that was not delivered (tap to retry).
 */
function MessageBubbleImpl({ message, onRetry, tail = true, grouped = false }: Props) {
  const { colors } = useAppTheme();
  const mine = message.direction === 'out';
  const status = STATUS_ICON[message.status];
  const failed = mine && message.status === 'failed';
  // Still on its way (it goes out by itself when the recipient is in range): a note, but no error border.
  const waiting = mine && message.status === 'waiting';
  // Set only when the sender held a valid authority certificate – such messages are always urgent.
  const official = message.authority;

  const bubbleColor = mine ? colors.primaryContainer : colors.surface;
  const textColor = mine ? colors.onPrimaryContainer : colors.onSurface;
  const metaColor = colors.onSurfaceVariant;
  // Error-coloured text is too faint on the primary container: there only the icon and border are red.
  const noteColor = mine ? colors.onPrimaryContainer : colors.errorText;

  return (
    <View style={[styles.row, grouped && styles.rowGrouped, mine ? styles.rowMine : styles.rowTheirs]}>
      <Tappable
        disabled={!failed}
        onPress={() => onRetry?.(message.id)}
        accessibilityLabel={
          mine
            ? `Twoja wiadomość, ${status.label}`
            : official
              ? `Pilna wiadomość od konta urzędowego ${official}`
              : `Wiadomość od ${message.senderNick}`
        }
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleColor,
            borderColor: failed || official ? colors.errorText : 'transparent',
          },
          tail && (mine ? styles.tailMine : styles.tailTheirs),
        ]}
        pressedStyle={styles.pressed}
      >
        {official && (
          <View style={styles.official}>
            <Icon source="alert-octagon-outline" size={16} color={colors.errorText} />
            <Text variant="labelMedium" numberOfLines={2} style={{ color: noteColor, flexShrink: 1 }}>
              PILNE · {official}
            </Text>
          </View>
        )}
        <Text variant="bodyLarge" style={{ color: textColor }} selectable>
          {message.text}
        </Text>
        <View style={styles.meta}>
          {!mine && message.hops !== null && message.hops > 1 && (
            <Text variant="labelSmall" style={{ color: metaColor }}>
              {message.hops} skoki ·{' '}
            </Text>
          )}
          <Text variant="labelSmall" style={{ color: metaColor }}>
            {formatTime(message.timestamp)}
          </Text>
          {mine && (
            <View style={{ marginLeft: 3 }}>
              <Icon
                source={status.icon}
                size={16}
                color={
                  message.status === 'failed'
                    ? colors.errorText
                    : message.status === 'delivered'
                      ? colors.primary
                      : metaColor
                }
              />
            </View>
          )}
        </View>
        {failed && (
          <Text variant="labelMedium" style={{ color: noteColor, marginTop: 2 }}>
            Nie dostarczono · dotknij, aby ponowić
          </Text>
        )}
        {waiting && (
          <Text variant="labelMedium" style={{ color: metaColor, marginTop: 2 }}>
            {status.label}
          </Text>
        )}
      </Tappable>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, marginTop: 8, flexDirection: 'row' },
  rowGrouped: { marginTop: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  tailMine: { borderBottomRightRadius: radius.xs },
  tailTheirs: { borderBottomLeftRadius: radius.xs },
  pressed: { opacity: 0.88 },
  official: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 },
});
