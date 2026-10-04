import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { AlertBanner } from '../components/AlertBanner';
import { Avatar } from '../components/Avatar';
import { MessageBubble } from '../components/MessageBubble';
import { MessageInput } from '../components/MessageInput';
import { TrustBadge } from '../components/TrustBadge';
import { IconButton, Notice } from '../components/ui';
import { MeshService } from '../services/mesh/MeshService';
import { useChatStore } from '../store/chatStore';
import { authorityName, trustLevel, useContactsStore } from '../store/contactsStore';
import { useMeshStore } from '../store/meshStore';
import type { ChatMessage } from '../store/types';
import { radius, statusColors, useAppTheme, type } from '../theme';
import { nickSkeleton } from '../utils/nick';

const EMPTY: ChatMessage[] = [];

/** Consecutive messages of one sender form a run: tighter spacing and a single tail on the newest. */
const sameRun = (a: ChatMessage, b: ChatMessage | undefined) =>
  !!b && a.direction === b.direction && a.senderNick === b.senderNick && a.authority === b.authority;

export default function ChatScreen() {
  const theme = useAppTheme();
  const headerHeight = useHeaderHeight();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversation = useChatStore((s) => s.conversations.find((c) => c.id === id));
  const messages = useChatStore((s) => s.messages[id] ?? EMPTY);
  const peerId = conversation?.peerId;
  const node = useMeshStore((s) => (peerId ? s.nodes.find((n) => n.nodeId === peerId) : undefined));
  const trust = useContactsStore(useShallow((s) => ({ contacts: s.contacts, authorities: s.authorities })));
  const [snack, setSnack] = useState<string | null>(null);

  // The send-failure notice above the composer goes away on its own.
  useEffect(() => {
    if (!snack) return;
    const timer = setTimeout(() => setSnack(null), 3000);
    return () => clearTimeout(timer);
  }, [snack]);

  useEffect(() => {
    if (!id) return;
    const store = useChatStore.getState();
    store.setActive(id);
    void store.loadMessages(id);
    void MeshService.markRead(id);
    return () => useChatStore.getState().setActive(null);
  }, [id]);

  // Mark read while the screen stays open and new messages arrive.
  useEffect(() => {
    if (id && conversation?.unread) void MeshService.markRead(id);
  }, [id, conversation?.unread]);

  const level = trustLevel(trust, peerId);
  const office = authorityName(trust, peerId);
  const title = conversation?.title ?? 'Czat';
  // A stranger using the name of someone the user verified in person is the classic impersonation.
  const lookalike = useMemo(() => {
    if (level !== 'unverified' || !peerId) return false;
    const skeleton = nickSkeleton(title);
    return Object.values(trust.contacts).some(
      (c) => c.nodeId !== peerId && !!c.verifiedAt && nickSkeleton(c.nick) === skeleton
    );
  }, [level, peerId, title, trust.contacts]);

  const subtitle = node
    ? node.hops <= 1
      ? 'W zasięgu · bezpośrednio'
      : `Osiągalny przez mesh · ${node.hops} skoki`
    : 'Poza zasięgiem – wiadomość poczeka do 24 h';

  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  const send = useCallback(
    async (text: string) => {
      const res = await MeshService.sendMessage(id, text);
      if (res.ok) return true;
      if (res.reason === 'rate_limited') {
        setSnack(`Zwolnij – ochrona przed floodem. Spróbuj za ${Math.ceil((res.retryInMs ?? 1000) / 1000)} s.`);
      } else if (res.reason === 'too_long') {
        setSnack('Wiadomość jest za długa.');
      }
      return false;
    },
    [id]
  );

  const retry = useCallback((messageId: string) => void MeshService.resend(messageId), []);

  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => (
      // The list is inverted: index + 1 is the older neighbour, index - 1 the newer one.
      <MessageBubble
        message={item}
        onRetry={retry}
        grouped={sameRun(item, reversed[index + 1])}
        tail={!sameRun(item, reversed[index - 1])}
      />
    ),
    [retry, reversed]
  );

  const verify = () => peerId && router.push({ pathname: '/verify/[id]', params: { id: peerId } });

  // Security notice at the start of the conversation (the list is inverted: footer = top).
  const notice = (
    <Notice
      tone={lookalike ? 'error' : 'neutral'}
      strong={lookalike}
      icon={lookalike ? 'alert' : 'lock-outline'}
      footer={<TrustBadge level={level} />}
      onPress={verify}
      style={styles.notice}
    >
      {lookalike ? (
        // One warning, split in source only so that its first sentence can be set heavier.
        <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
          <Text variant="titleMedium" style={{ color: theme.colors.onErrorContainer }}>
            {'Uwaga: ktoś o tej samej nazwie jest na liście Twoich zweryfikowanych kontaktów, ale to jest inne urządzenie.'}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
            {' Sprawdź klucz, zanim zaufasz tej rozmowie.'}
          </Text>
        </Text>
      ) : office ? (
        `Rozmowa szyfrowana end-to-end. Nadawca ma certyfikat konta urzędowego: ${office}.`
      ) : level === 'verified' ? (
        'Rozmowa szyfrowana end-to-end. Klucz tej osoby został zweryfikowany osobiście.'
      ) : (
        'Rozmowa szyfrowana end-to-end. Klucz tej osoby nie jest zweryfikowany – dotknij, aby sprawdzić, z kim rozmawiasz.'
      )}
    </Notice>
  );

  return (
    <SafeAreaView edges={['bottom']} style={[styles.flex, { backgroundColor: theme.colors.surface }]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.header}>
              <Avatar id={id} label={title} size={40} icon={office ? 'bank-outline' : undefined} />
              <View style={styles.flex}>
                <Text variant="titleMedium" numberOfLines={1} style={{ color: theme.colors.onSurface }}>
                  {title}
                </Text>
                <View style={styles.reach}>
                  <View
                    style={[styles.dot, { backgroundColor: node ? statusColors.connected : statusColors.offline }]}
                  />
                  <Text
                    variant="labelMedium"
                    numberOfLines={2}
                    style={[styles.flex, { color: theme.colors.onSurfaceVariant }]}
                  >
                    {subtitle}
                  </Text>
                </View>
              </View>
            </View>
          ),
          headerRight: () => (
            <IconButton
              icon={level === 'unverified' ? 'shield-alert-outline' : 'shield-check-outline'}
              color={theme.colors.primary}
              accessibilityLabel="Weryfikacja klucza rozmówcy"
              onPress={verify}
            />
          ),
        }}
      />
      <AlertBanner />
      {/* The window does not shrink for the keyboard (edge-to-edge), and the view measures itself
          against its parent – the header above it has to be passed in. Padding, not height: the
          alert banner can appear or grow while the chat is open. */}
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.colors.background }]}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <FlatList
          data={reversed}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListFooterComponent={notice}
        />
        {!!snack && (
          <Notice tone="error" icon="alert-circle-outline" live style={styles.snack}>
            {snack}
          </Notice>
        )}
        <MessageInput onSend={send} disabled={!conversation} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  reach: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  // Sits on the first line of the reach text, also when that text wraps to a second line.
  dot: { width: 8, height: 8, borderRadius: radius.full, marginTop: (type.labelMd.lineHeight - 8) / 2 },
  list: { paddingVertical: 8, flexGrow: 1 },
  notice: { marginHorizontal: 12, marginVertical: 8 },
  snack: { marginHorizontal: 12, marginBottom: 8 },
});
