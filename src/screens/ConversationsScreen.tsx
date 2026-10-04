import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { ConversationListItem } from '../components/ConversationListItem';
import { NetworkStatusBar } from '../components/NetworkStatusBar';
import { AppButton, EmptyState, Sheet, TabRoot } from '../components/ui';
import { MeshService } from '../services/mesh/MeshService';
import { useChatStore } from '../store/chatStore';
import { trustLevel, useContactsStore } from '../store/contactsStore';
import { selectIsAuthority, useIdentityStore } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import type { Conversation } from '../store/types';
import { elevation, useAppTheme } from '../theme';

export default function ConversationsScreen() {
  const { dark } = useAppTheme();
  const conversations = useChatStore((s) => s.conversations);
  const nodes = useMeshStore((s) => s.nodes);
  const trust = useContactsStore(useShallow((s) => ({ contacts: s.contacts, authorities: s.authorities })));
  const isAuthority = useIdentityStore((s) => selectIsAuthority(s));
  const [toDelete, setToDelete] = useState<Conversation | null>(null);

  const reachable = useMemo(() => new Set(nodes.map((n) => n.nodeId)), [nodes]);

  // Conversations with certified authority accounts stay on top; the store keeps the rest by recency.
  const rows = useMemo(() => {
    const withTrust = conversations.map((c) => ({ c, level: trustLevel(trust, c.peerId) }));
    return [...withTrust.filter((r) => r.level === 'official'), ...withTrust.filter((r) => r.level !== 'official')];
  }, [conversations, trust]);

  const open = useCallback((id: string) => {
    router.push({ pathname: '/chat/[id]', params: { id } });
  }, []);

  return (
    <TabRoot
      title="Mesh Chat"
      titleRight={
        isAuthority && (
          <AppButton
            variant="tonal"
            fullWidth={false}
            icon="bullhorn-outline"
            onPress={() => router.push('/compose-alert')}
          >
            Nowy alert
          </AppButton>
        )
      }
    >
      <NetworkStatusBar onPress={() => router.navigate('/network')} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.c.id}
        renderItem={({ item }) => (
          <ConversationListItem
            conversation={item.c}
            online={!!item.c.peerId && reachable.has(item.c.peerId)}
            trust={item.level}
            onPress={open}
            onLongPress={setToDelete}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        ListEmptyComponent={
          <EmptyState
            icon="chat-outline"
            text="Brak rozmów. Otwórz zakładkę „Sieć”, aby napisać do kogoś w pobliżu."
          />
        }
        contentContainerStyle={styles.list}
      />

      <View style={styles.float}>
        <AppButton
          fullWidth={false}
          icon="message-plus-outline"
          accessibilityLabel="Nowa rozmowa"
          onPress={() => router.navigate('/network')}
          style={elevation(dark, 'float')}
        >
          Nowa rozmowa
        </AppButton>
      </View>

      <Sheet
        visible={!!toDelete}
        onDismiss={() => setToDelete(null)}
        title="Usunąć rozmowę?"
        primary={{
          label: 'Usuń',
          destructive: true,
          onPress: async () => {
            if (toDelete) await MeshService.deleteConversation(toDelete.id);
            setToDelete(null);
          },
        }}
      >
        Historia „{toDelete?.title}” zostanie usunięta z tego urządzenia.
      </Sheet>
    </TabRoot>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingTop: 4, paddingBottom: 96 },
  gap: { height: 8 },
  float: { position: 'absolute', right: 16, bottom: 16 },
});
