import nacl from 'tweetnacl';

import { bytesToUuid, concatBytes, utf8Encode } from '../../utils/bytes';

/**
 * Identity key derivation (pure – no storage, no randomness).
 *
 *  - One 32-byte seed per device.
 *  - Ed25519 signing pair (from the seed) signs every packet; the node id is the first 16 bytes of
 *    SHA-512(signing public key), so an id is self-certifying.
 *  - X25519 box pair (from a domain-separated hash of the seed) encrypts 1:1 messages. It is bound
 *    to the identity only by appearing in packets signed with the signing key.
 *
 * tweetnacl's own PRNG is not configured in React Native, so only `fromSeed` / `fromSecretKey`
 * are used here – never `keyPair()`.
 */

const BOX_DOMAIN = utf8Encode('meshchat-box-v1');

export interface IdentityKeys {
  nodeId: string;
  sign: nacl.SignKeyPair;
  box: nacl.BoxKeyPair;
}

export function nodeIdFromSignKey(signPublicKey: Uint8Array): string {
  return bytesToUuid(nacl.hash(signPublicKey).subarray(0, 16));
}

export function deriveIdentity(seed: Uint8Array): IdentityKeys {
  if (seed.length !== nacl.sign.seedLength) throw new Error('Invalid identity seed');
  const sign = nacl.sign.keyPair.fromSeed(seed);
  const boxSecret = nacl.hash(concatBytes([BOX_DOMAIN, seed])).subarray(0, nacl.box.secretKeyLength);
  const box = nacl.box.keyPair.fromSecretKey(boxSecret);
  return { nodeId: nodeIdFromSignKey(sign.publicKey), sign, box };
}

/** Key fingerprint as shown to people: the full 128-bit node id in 8 groups of 4 hex digits. */
export function fingerprint(nodeId: string): string {
  const hex = nodeId.replace(/-/g, '').toUpperCase();
  return hex.match(/.{4}/g)?.join(' ') ?? hex;
}
