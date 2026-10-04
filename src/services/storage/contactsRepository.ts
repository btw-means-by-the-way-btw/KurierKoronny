import type { Contact } from '../../store/types';
import { getDb } from './db';

interface ContactRow {
  node_id: string;
  box_key: string | null;
  nick: string;
  verified_at: number | null;
  cert: string | null;
  first_seen: number;
}

const toContact = (r: ContactRow): Contact => ({
  nodeId: r.node_id,
  boxKey: r.box_key,
  nick: r.nick,
  verifiedAt: r.verified_at,
  cert: r.cert,
  firstSeen: r.first_seen,
});

export const contactsRepository = {
  async list(): Promise<Contact[]> {
    const db = await getDb();
    return (await db.getAllAsync<ContactRow>('SELECT * FROM contacts')).map(toContact);
  },

  async upsert(c: Contact): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO contacts (node_id, box_key, nick, verified_at, cert, first_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET
         box_key = excluded.box_key,
         nick = excluded.nick,
         verified_at = excluded.verified_at,
         cert = excluded.cert`,
      c.nodeId,
      c.boxKey,
      c.nick,
      c.verifiedAt,
      c.cert,
      c.firstSeen
    );
  },
};
