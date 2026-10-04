import nacl from 'tweetnacl';

import { fromBase64Strict } from '../../utils/bytes';
import { randomBytes } from '../../utils/random';
import { open, seal, type SealedPayload, sharedKey } from './box';
import { getIdentityKeys } from './identity';

/**
 * End-to-end encryption of 1:1 messages with this device's identity (see ./box for the scheme).
 *
 *  - The secret key never leaves the device.
 *  - A peer's box key is learned only from packets carrying a valid signature of that peer
 *    (HELLO / ANNOUNCE / the `k` field of an encrypted packet) – callers must have verified it.
 *  - Relays only see the packet header (origin, destination, timestamp) – never the text or nick.
 */

const MAX_PEERS = 2_048;

interface Peer {
  boxKey: string;
  key: Uint8Array;
  /** X25519 shared key, computed on first use (most announced nodes are never written to). */
  shared?: Uint8Array;
}

const peers = new Map<string, Peer>();

/**
 * Remembers a peer's box public key. The first key seen for a node id wins: an identity derives
 * its box key from its seed, so it never legitimately changes.
 */
export function rememberPeerKey(nodeId: string, boxPublicKey: unknown): boolean {
  if (peers.has(nodeId)) return true;
  const key = fromBase64Strict(boxPublicKey, nacl.box.publicKeyLength);
  if (!key) return false;
  if (peers.size >= MAX_PEERS) {
    const oldest = peers.keys().next().value;
    if (oldest !== undefined) peers.delete(oldest);
  }
  peers.set(nodeId, { boxKey: boxPublicKey as string, key });
  return true;
}

export function getPeerBoxKey(nodeId: string): string | null {
  return peers.get(nodeId)?.boxKey ?? null;
}

function sharedWith(nodeId: string): Uint8Array | null {
  const peer = peers.get(nodeId);
  if (!peer) return null;
  return (peer.shared ??= sharedKey(peer.key, getIdentityKeys().box.secretKey));
}

/** Encrypts a JSON object for one recipient. Returns null while the recipient's key is unknown. */
export function sealJson(peerNodeId: string, obj: unknown): SealedPayload | null {
  const shared = sharedWith(peerNodeId);
  if (!shared) return null;
  return seal(obj, randomBytes(nacl.box.nonceLength), shared, getIdentityKeys().box.publicKey);
}

/**
 * Decrypts a payload from a packet whose signature by `originNodeId` was already verified.
 * The caller still has to check the envelope (`isEnvelope`).
 */
export function openJson(originNodeId: string, sealed: SealedPayload | null): unknown {
  if (!sealed || !rememberPeerKey(originNodeId, sealed.k)) return null;
  return open(sealed, sharedWith(originNodeId)!);
}
