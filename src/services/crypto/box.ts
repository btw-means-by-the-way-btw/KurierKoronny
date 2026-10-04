import nacl from 'tweetnacl';

import { fromBase64, fromBase64Strict, toBase64, utf8Decode, utf8Encode } from '../../utils/bytes';

/**
 * End-to-end encryption of 1:1 payloads (pure – keys and nonces are passed in).
 *
 * NaCl box (X25519 + XSalsa20-Poly1305) between the two long-term box keys. The box only proves
 * "someone holding one of the two secret keys wrote this", and a box public key is self-asserted
 * (bound to a node id just by that node's packet signature). So the plaintext itself names the
 * sender and the recipient: without `from`, a node could announce a victim's box key as its own,
 * re-sign a captured ciphertext and have it displayed as its own message.
 */

/** Wire payload of an encrypted packet (all fields base64). */
export interface SealedPayload {
  k: string; // sender box public key
  nn: string; // nonce
  c: string; // ciphertext + MAC
  /** Authority certificate of the sender (outside the ciphertext, covered by the packet signature). */
  a?: string;
}

export interface MessagePlain {
  y: 'm';
  id: string; // message UUID (application-level idempotency key)
  n: string; // author nick
  t: string; // text
  from: string;
  to: string;
  /** Time of writing (ms) – only in a message that left the sender well after it was written. */
  s?: number;
}

export interface AckPlain {
  y: 'a';
  id: string; // acknowledged message id (or verification token)
  from: string;
  to: string;
}

/** "I scanned the code on your screen": proves the sender saw the recipient's one-time token. */
export interface VerifyPlain {
  y: 'v';
  id: string; // the token from the recipient's QR code
  from: string;
  to: string;
}

interface Envelopes {
  m: MessagePlain;
  a: AckPlain;
  v: VerifyPlain;
}

export function sharedKey(peerBoxPublicKey: Uint8Array, myBoxSecretKey: Uint8Array): Uint8Array {
  return nacl.box.before(peerBoxPublicKey, myBoxSecretKey);
}

export function seal(obj: unknown, nonce: Uint8Array, shared: Uint8Array, myBoxPublicKey: Uint8Array): SealedPayload {
  const box = nacl.box.after(utf8Encode(JSON.stringify(obj)), nonce, shared);
  return { k: toBase64(myBoxPublicKey), nn: toBase64(nonce), c: toBase64(box) };
}

/** Decrypts and authenticates. Returns null for anything malformed or forged – never throws. */
export function open(sealed: SealedPayload | null, shared: Uint8Array): unknown {
  if (!sealed || typeof sealed.c !== 'string') return null;
  const nonce = fromBase64Strict(sealed.nn, nacl.box.nonceLength);
  if (!nonce) return null;
  try {
    const plain = nacl.box.open.after(fromBase64(sealed.c), nonce, shared);
    return plain ? JSON.parse(utf8Decode(plain)) : null;
  } catch {
    return null;
  }
}

/**
 * Checks that a decrypted payload is of the expected kind and really travels between the signed
 * packet origin and this node.
 */
export function isEnvelope<K extends keyof Envelopes>(
  plain: unknown,
  kind: K,
  origin: string,
  me: string
): plain is Envelopes[K] {
  if (!plain || typeof plain !== 'object') return false;
  const p = plain as Record<string, unknown>;
  if (p.y !== kind || p.from !== origin || p.to !== me || typeof p.id !== 'string') return false;
  return kind !== 'm' || typeof p.t === 'string';
}
