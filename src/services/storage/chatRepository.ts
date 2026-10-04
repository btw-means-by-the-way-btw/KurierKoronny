import type { ChatMessage, Conversation, MessageStatus } from '../../store/types';
import { getDb } from './db';

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_nick: string;
  text: string;
  timestamp: number;
  status: MessageStatus;
  direction: 'in' | 'out';
  delivered_count: number;
  hops: number | null;
  authority: string | null;
}

interface ConversationRow {
  id: string;
  type: 'dm';
  title: string;
  peer_id: string | null;
  created_at: number;
  last_message_at: number;
  last_message_preview: string;
  unread: number;
}

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  senderNick: r.sender_nick,
  text: r.text,
  timestamp: r.timestamp,
  status: r.status,
  direction: r.direction,
  deliveredCount: r.delivered_count,
  hops: r.hops,
  authority: r.authority,
});

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  type: r.type,
  title: r.title,
  peerId: r.peer_id,
  createdAt: r.created_at,
  lastMessageAt: r.last_message_at,
  lastMessagePreview: r.last_message_preview,
  unread: r.unread,
});

export const chatRepository = {
  async listConversations(): Promise<Conversation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ConversationRow>(
      'SELECT * FROM conversations ORDER BY last_message_at DESC, created_at DESC'
    );
    return rows.map(toConversation);
  },

  async upsertConversation(c: Conversation): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO conversations (id, type, title, peer_id, created_at, last_message_at, last_message_preview, unread)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         last_message_at = excluded.last_message_at,
         last_message_preview = excluded.last_message_preview,
         unread = excluded.unread`,
      c.id,
      c.type,
      c.title,
      c.peerId,
      c.createdAt,
      c.lastMessageAt,
      c.lastMessagePreview,
      c.unread
    );
  },

  async deleteConversation(id: string): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', id);
      await db.runAsync('DELETE FROM conversations WHERE id = ?', id);
    });
  },

  async listMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?
       ) ORDER BY timestamp ASC`,
      conversationId,
      limit
    );
    return rows.map(toMessage);
  },

  /** Returns false if a message with this id already exists (duplicate delivery). */
  async insertMessage(m: ChatMessage): Promise<boolean> {
    const db = await getDb();
    const res = await db.runAsync(
      `INSERT OR IGNORE INTO messages
        (id, conversation_id, sender_id, sender_nick, text, timestamp, status, direction, delivered_count, hops, authority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.id,
      m.conversationId,
      m.senderId,
      m.senderNick,
      m.text,
      m.timestamp,
      m.status,
      m.direction,
      m.deliveredCount,
      m.hops,
      m.authority
    );
    return res.changes > 0;
  },

  async messageExists(id: string): Promise<boolean> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) AS c FROM messages WHERE id = ?', id);
    return (row?.c ?? 0) > 0;
  },

  async getMessage(id: string): Promise<ChatMessage | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
    return row ? toMessage(row) : null;
  },

  async updateStatus(id: string, status: MessageStatus, deliveredCount?: number): Promise<void> {
    const db = await getDb();
    if (deliveredCount !== undefined) {
      await db.runAsync('UPDATE messages SET status = ?, delivered_count = ? WHERE id = ?', status, deliveredCount, id);
    } else {
      await db.runAsync('UPDATE messages SET status = ? WHERE id = ?', status, id);
    }
  },

  /** Own messages written at `since` or later that nobody acknowledged yet, oldest first. */
  async listUnacknowledged(since: number): Promise<ChatMessage[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM messages
       WHERE direction = 'out' AND status IN ('sending', 'sent', 'waiting') AND timestamp >= ?
       ORDER BY timestamp ASC`,
      since
    );
    return rows.map(toMessage);
  },

  /** Messages written before `before` are too old to be sent again after an app restart – mark them failed. */
  async failPendingMessages(before: number): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE messages SET status = 'failed' WHERE status IN ('sending', 'sent', 'waiting') AND timestamp < ?`,
      before
    );
  },

  async clearAll(): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM messages');
      await db.runAsync('DELETE FROM conversations');
    });
  },
};
