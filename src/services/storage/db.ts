import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import { toHex } from '../../utils/bytes';
import { randomBytes } from '../../utils/random';
import { KV_KEYS, kv } from './kv';

/**
 * Chat history, contacts and alerts live in one SQLCipher-encrypted database (app.json:
 * expo-sqlite `useSQLCipher`). Its 256-bit key is random, generated on first launch and kept in
 * SecureStore. A missing or wrong key is reported as DatabaseKeyError – the file is never deleted
 * because of it; only an explicit, user-confirmed `resetDatabase()` does that.
 */

const DB_NAME = 'meshchat-v2.db';
/** Unencrypted database of protocol v1 – removed on first launch of this version. */
const LEGACY_DB_NAME = 'meshchat.db';
const DB_KEY = 'db.key';

export class DatabaseKeyError extends Error {
  constructor() {
    super('Database key is missing or does not match the database');
    this.name = 'DatabaseKeyError';
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let encrypted: boolean | null = null;

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    peer_id TEXT,
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL DEFAULT 0,
    last_message_preview TEXT NOT NULL DEFAULT '',
    unread INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_nick TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,
    direction TEXT NOT NULL,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    hops INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages (conversation_id, timestamp);
  `,
  // v2: authority flag on messages, contacts (keys, verification, certificates), authority alerts
  `
  ALTER TABLE messages ADD COLUMN authority TEXT;
  CREATE TABLE IF NOT EXISTS contacts (
    node_id TEXT PRIMARY KEY NOT NULL,
    box_key TEXT,
    nick TEXT NOT NULL DEFAULT '',
    verified_at INTEGER,
    cert TEXT,
    first_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    origin TEXT NOT NULL,
    id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    exp INTEGER NOT NULL,
    headline TEXT NOT NULL,
    text TEXT NOT NULL,
    authority TEXT NOT NULL,
    cert_exp INTEGER NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0,
    raw BLOB NOT NULL,
    PRIMARY KEY (origin, id)
  );
  `,
];

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
    });
    version++;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

/** Hex database key from SecureStore; created on first launch only. */
function loadDbKey(): string {
  let stored: string | null;
  try {
    stored = SecureStore.getItem(DB_KEY);
  } catch {
    throw new DatabaseKeyError();
  }
  if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  if (stored !== null || kv.get(KV_KEYS.dbCreated) !== null) throw new DatabaseKeyError();
  const key = toHex(randomBytes(32));
  SecureStore.setItem(DB_KEY, key);
  kv.set(KV_KEYS.dbCreated, '1');
  return key;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = loadDbKey();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  try {
    // Raw-key syntax: the key is already 256 random bits, no password stretching needed.
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    // A wrong key only shows on the first real read ("file is not a database").
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
  } catch {
    await db.closeAsync().catch(() => undefined);
    throw new DatabaseKeyError();
  }
  // Plain SQLite (a build made without the SQLCipher plugin option) ignores PRAGMA key and
  // returns nothing here – the security screen reports that honestly instead of assuming.
  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
  encrypted = !!cipher?.cipher_version;
  await migrate(db);
  SQLite.deleteDatabaseAsync(LEGACY_DB_NAME).catch(() => undefined);
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = open().catch((e) => {
      dbPromise = null; // allow a retry instead of caching the failure forever
      throw e;
    });
  }
  return dbPromise;
}

/** Whether the opened database is really encrypted; null until it has been opened. */
export function isDatabaseEncrypted(): boolean | null {
  return encrypted;
}

/** Deletes the database and its key. Destroys history, contacts and stored alerts. */
export async function resetDatabase(): Promise<void> {
  const current = dbPromise;
  dbPromise = null;
  encrypted = null;
  if (current) await current.then((db) => db.closeAsync()).catch(() => undefined);
  await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => undefined);
  await SecureStore.deleteItemAsync(DB_KEY).catch(() => undefined);
  kv.remove(KV_KEYS.dbCreated);
}
