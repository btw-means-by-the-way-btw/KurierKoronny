import { create } from 'zustand';

import { chatRepository } from '../services/storage/chatRepository';
import type { ChatMessage, Conversation, MessageStatus } from './types';

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  /** Conversation currently on screen – incoming messages there don't count as unread. */
  activeConversationId: string | null;

  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
  setActive: (conversationId: string | null) => void;
  upsertConversation: (c: Conversation) => void;
  addMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, conversationId: string, patch: { status: MessageStatus; deliveredCount?: number }) => void;
  removeConversation: (id: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messages: {},
  activeConversationId: null,

  loadConversations: async () => {
    set({ conversations: await chatRepository.listConversations() });
  },

  loadMessages: async (conversationId) => {
    const list = await chatRepository.listMessages(conversationId);
    set((s) => ({ messages: { ...s.messages, [conversationId]: list } }));
  },

  setActive: (conversationId) => set({ activeConversationId: conversationId }),

  upsertConversation: (c) =>
    set((s) => {
      const rest = s.conversations.filter((x) => x.id !== c.id);
      return {
        conversations: [c, ...rest].sort(
          (a, b) => b.lastMessageAt - a.lastMessageAt || b.createdAt - a.createdAt
        ),
      };
    }),

  addMessage: (m) =>
    set((s) => {
      const list = s.messages[m.conversationId];
      if (!list) return s; // not loaded yet – will be read from SQLite when opened
      if (list.some((x) => x.id === m.id)) return s;
      const next = [...list, m].sort((a, b) => a.timestamp - b.timestamp);
      return { messages: { ...s.messages, [m.conversationId]: next } };
    }),

  updateMessage: (id, conversationId, patch) =>
    set((s) => {
      const list = s.messages[conversationId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [conversationId]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        },
      };
    }),

  removeConversation: (id) =>
    set((s) => {
      const { [id]: _removed, ...messages } = s.messages;
      return { conversations: s.conversations.filter((c) => c.id !== id), messages };
    }),

  reset: () => set({ conversations: [], messages: {}, activeConversationId: get().activeConversationId }),
}));
