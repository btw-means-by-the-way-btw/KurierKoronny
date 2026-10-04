import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { TrustLevel } from '../store/contactsStore';
import type { Conversation } from '../store/types';
import { radius, size, statusColors, useAppTheme } from '../theme';
import { formatRelative } from '../utils/time';
import { Avatar } from './Avatar';
import { TrustBadge } from './TrustBadge';
import { Card } from './ui/Card';

interface Props {
  conversation: Conversation;
  online: boolean;
  trust: TrustLevel;
  onPress: (id: string) => void;
  onLongPress?: (c: Conversation) => void;
}

/**
 * Row of the conversation list (DESIGN.md → List row): a card of its own with the avatar and
 * online dot, title + time, last message + unread count and, on the third line, the trust badge.
 */
function ConversationListItemImpl({ conversation: c, online, trust, onPress, onLongPress }: Props) {
  const { colors } = useAppTheme();
  const official = trust === 'official';
  return (
    <Card
      radius="md"
      padding={0}
      onPress={() => onPress(c.id)}
      onLongPress={() => onLongPress?.(c)}
      style={styles.card}
    >
      <View style={styles.row}>
        <View>
          <Avatar id={c.id} label={c.title} size={size.avatar} icon={official ? 'bank-outline' : undefined} />
          {online && (
            <View style={[styles.online, { backgroundColor: statusColors.connected, borderColor: colors.surface }]} />
          )}
        </View>
        <View style={styles.body}>
          <View style={styles.top}>
            <Text variant="titleMedium" numberOfLines={1} style={styles.title}>
              {c.title}
            </Text>
            {c.lastMessageAt > 0 && (
              <Text variant="labelSmall" style={{ color: c.unread ? colors.primary : colors.onSurfaceVariant }}>
                {formatRelative(c.lastMessageAt)}
              </Text>
            )}
          </View>
          <View style={styles.top}>
            <Text
              variant="bodyMedium"
              numberOfLines={1}
              style={[styles.preview, { color: official ? colors.errorText : colors.onSurfaceVariant }]}
            >
              {official && c.lastMessagePreview ? 'PILNE · ' : ''}
              {c.lastMessagePreview || 'Brak wiadomości'}
            </Text>
            {c.unread > 0 && (
              <View style={[styles.unread, { backgroundColor: colors.primary }]}>
                <Text variant="labelSmall" style={[styles.count, { color: colors.onPrimary }]}>
                  {c.unread}
                </Text>
              </View>
            )}
          </View>
          <TrustBadge level={trust} />
        </View>
      </View>
    </Card>
  );
}

export const ConversationListItem = memo(ConversationListItemImpl);

const styles = StyleSheet.create({
  card: { marginHorizontal: 16 },
  row: { flexDirection: 'row', padding: 12, paddingRight: 16, gap: 12, alignItems: 'center', minHeight: 72 },
  body: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1 },
  preview: { flex: 1 },
  online: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontVariant: ['tabular-nums'] },
});
