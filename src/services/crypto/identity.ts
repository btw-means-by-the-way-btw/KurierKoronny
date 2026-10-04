import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';

import { fromBase64Strict, toBase64 } from '../../utils/bytes';
import { randomBytes } from '../../utils/random';
import { KV_KEYS, kv } from '../storage/kv';
import { deriveIdentity, type IdentityKeys } from './keys';

/**
 * Device identity at rest and in memory.
 *
 * The 32-byte seed lives in SecureStore (encrypted with a key held by Android Keystore). While the
 * app runs, the derived keys are in JS memory – SecureStore protects them at rest only.
 *
 * SecureStore returns null both on first launch and when the Keystore entry is gone (restore to a
 * new phone, cleared credentials). A marker in the plain kv store tells the two apart: a missing
 * seed with the marker present is reported as 'lost' and never silently replaced, because a new
 * identity means a new node id, lost verifications and a lost authority certificate.
 */

const SEED_KEY = 'identity.seed';
/** v1 kept the X25519 secret and peer keys in the unencrypted kv store. */
const LEGACY_SECRET_KEY = 'identity.secretKey';
const LEGACY_PREFIXES = ['peerKey.', 'identity.nodeId'];

let keys: IdentityKeys | null = null;

export type IdentityLoad =
  | { status: 'ready'; nodeId: string; signPublicKey: string; boxPublicKey: string }
  | { status: 'lost' };

function ready(k: IdentityKeys): IdentityLoad {
  keys = k;
  return {
    status: 'ready',
    nodeId: k.nodeId,
    signPublicKey: toBase64(k.sign.publicKey),
    boxPublicKey: toBase64(k.box.publicKey),
  };
}

function purgeLegacySecrets() {
  if (kv.get(LEGACY_SECRET_KEY) === null) return;
  for (const key of kv.keys()) {
    if (key === LEGACY_SECRET_KEY || LEGACY_PREFIXES.some((p) => key.startsWith(p))) kv.remove(key);
  }
}

/** Generates a brand-new identity. Only call on first launch or after the user confirmed a reset. */
export function createIdentity(): IdentityLoad {
  const seed = randomBytes(nacl.sign.seedLength);
  SecureStore.setItem(SEED_KEY, toBase64(seed));
  kv.set(KV_KEYS.identityCreated, '1');
  kv.remove(KV_KEYS.cert);
  return ready(deriveIdentity(seed));
}

export function loadIdentity(): IdentityLoad {
  purgeLegacySecrets();
  let stored: string | null;
  try {
    stored = SecureStore.getItem(SEED_KEY);
  } catch {
    return { status: 'lost' };
  }
  const seed = fromBase64Strict(stored, nacl.sign.seedLength);
  if (seed) return ready(deriveIdentity(seed));
  if (stored !== null || kv.get(KV_KEYS.identityCreated) !== null) return { status: 'lost' };
  return createIdentity();
}

export function getIdentityKeys(): IdentityKeys {
  if (!keys) throw new Error('Identity not loaded');
  return keys;
}

/** Detached Ed25519 signature with the device signing key. */
export function signBytes(message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, getIdentityKeys().sign.secretKey);
}
