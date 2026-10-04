import Storage from 'expo-sqlite/kv-store';

/**
 * Small synchronous key-value store (SQLite-backed) for flags and public settings.
 * This database is NOT encrypted – secrets belong in SecureStore (see crypto/identity, storage/db).
 */
export const KV_KEYS = {
  /** Set once the identity seed exists in SecureStore – tells "first launch" apart from "seed lost". */
  identityCreated: 'identity.created',
  /** Authority certificate issued to this device (public data). */
  cert: 'identity.cert',
  /** Set once the encrypted database and its key exist. */
  dbCreated: 'db.created',
  nick: 'identity.nick',
  permissionsAcknowledged: 'onboarding.permissionsAcknowledged',
  theme: 'settings.theme',
} as const;

export const kv = {
  get(key: string): string | null {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    Storage.setItemSync(key, value);
  },
  remove(key: string) {
    Storage.removeItemSync(key);
  },
  keys(): string[] {
    try {
      return Storage.getAllKeysSync();
    } catch {
      return [];
    }
  },
};
