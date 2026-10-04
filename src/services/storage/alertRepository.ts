import type { StoredAlert } from '../mesh/alertPolicy';
import { getDb } from './db';

interface AlertRow {
  origin: string;
  id: string;
  timestamp: number;
  exp: number;
  headline: string;
  text: string;
  authority: string;
  cert_exp: number;
  cancelled: number;
  raw: Uint8Array;
}

const toAlert = (r: AlertRow): StoredAlert => ({
  origin: r.origin,
  id: r.id,
  timestamp: r.timestamp,
  exp: r.exp,
  headline: r.headline,
  text: r.text,
  authority: r.authority,
  certExp: r.cert_exp,
  cancelled: r.cancelled !== 0,
  raw: r.raw,
});

export const alertRepository = {
  async list(): Promise<StoredAlert[]> {
    const db = await getDb();
    return (await db.getAllAsync<AlertRow>('SELECT * FROM alerts')).map(toAlert);
  },

  /** The set is tiny (a few records per authority), so it is simply rewritten. */
  async replaceAll(list: StoredAlert[]): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM alerts');
      for (const a of list) {
        await db.runAsync(
          `INSERT INTO alerts (origin, id, timestamp, exp, headline, text, authority, cert_exp, cancelled, raw)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          a.origin,
          a.id,
          a.timestamp,
          a.exp,
          a.headline,
          a.text,
          a.authority,
          a.certExp,
          a.cancelled ? 1 : 0,
          a.raw
        );
      }
    });
  },
};
