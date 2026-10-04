import nacl from 'tweetnacl';

import { bytesToUuid, uuidToBytes, utf8Decode, utf8Encode } from '../../utils/bytes';
import { nodeIdFromSignKey } from '../crypto/keys';

/**
 * Mesh packet wire format v2 (network layer), big endian:
 *
 *  off size field
 *    0    1 version            PROTOCOL_VERSION
 *    1    1 type               PacketType
 *    2    1 ttl                remaining hops; relays decrement, drop at 0
 *    3    1 hops               hops travelled so far (for route metrics)
 *    4    1 flags              PacketFlags
 *    5    8 packetId           random; flood de-duplication key (together with origin)
 *   13   16 origin             node id (UUID) of the author
 *   29   16 destination        node id, or BROADCAST_ID
 *   45    4 seq                per-origin monotonically increasing sequence number
 *   49    8 timestamp          float64 ms since epoch (author's clock)
 *   57    2 payloadLength
 *   59    N payload            UTF-8 JSON (type-specific); 1:1 payloads are end-to-end encrypted
 * 59+N   32 signPk             Ed25519 public key of the author
 * 91+N   64 sig                Ed25519 signature
 *
 * Every packet is signed by its author. The signature covers "meshchat-pkt-v2" ‖ header ‖ payload
 * with ttl and hops zeroed – those two bytes are the only thing a relay may change. The origin
 * must be the hash of signPk (see crypto/keys), so any node – relay or destination – can verify a
 * packet on its own and nobody can originate a packet under somebody else's id.
 */

export const PROTOCOL_VERSION = 2;
export const HEADER_SIZE = 59;
export const TRAILER_SIZE = nacl.sign.publicKeyLength + nacl.sign.signatureLength;
/** Fits an encrypted 500-character message plus an authority certificate. */
export const MAX_PAYLOAD_SIZE = 3_500;
export const BROADCAST_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const SIGN_DOMAIN = utf8Encode('meshchat-pkt-v2');

export enum PacketType {
  /** Link-local handshake (ttl=1): binds a physical link to a node id. Never relayed. */
  Hello = 1,
  /** Periodic flooded presence beacon: nick + builds the route table. */
  Announce = 2,
  /** 1:1 chat message, directed and end-to-end encrypted. */
  Chat = 3,
  /** Delivery receipt, directed back to the message author. */
  Ack = 4,
  /** Public alert from a certified authority account – the only broadcast content. */
  Alert = 5,
}

export const PacketFlags = {
  /** Ignore the route table and flood (used for retries after a stale route). */
  ForceFlood: 1 << 0,
} as const;

export const DEFAULT_TTL: Record<PacketType, number> = {
  [PacketType.Hello]: 1,
  [PacketType.Announce]: 5,
  [PacketType.Chat]: 7,
  [PacketType.Ack]: 7,
  // Alerts hop one link at a time: a node passes one on only if it was news to its own store.
  [PacketType.Alert]: 1,
};

export interface MeshPacket {
  version: number;
  type: PacketType;
  ttl: number;
  hops: number;
  flags: number;
  packetId: string; // 16 hex chars
  origin: string;
  destination: string;
  seq: number;
  timestamp: number;
  payload: Uint8Array;
  /** Signing key carried in the trailer. Trust it only after `originMatchesKey` and `verifyPacket`. */
  signPk: Uint8Array;
}

export interface PacketSigner {
  publicKey: Uint8Array;
  sign(message: Uint8Array): Uint8Array;
}

// --- Payloads ---------------------------------------------------------------------------

export interface HelloPayload {
  n: string; // nick
  k: string; // box public key (base64)
  /** Fresh random challenge of the sender (base64). */
  ch: string;
  /** Echo of the peer's challenge: proves this HELLO was made for this link, now. */
  re?: string;
  /** Digest of the sender's alert set (only in replies) – a mismatch triggers a re-sync. */
  ad?: string;
  /** Authority certificate of the sender. No longer sent (see ANNOUNCE), still accepted from older versions. */
  c?: string;
}

export interface AnnouncePayload {
  n: string; // nick
  k: string; // box public key (base64)
  c?: string; // authority certificate
}

export interface AlertPayload {
  id: string; // alert UUID, unique per author
  h: string; // headline
  t: string; // text
  /** Expiry, ms since epoch. A cancellation keeps the expiry of the alert it cancels. */
  exp: number;
  c: string; // authority certificate of the author
  /** Cancellation tombstone. */
  x?: true;
}

// --- Codec ------------------------------------------------------------------------------

/** Encodes and signs a packet. */
export function encodePacket(p: Omit<MeshPacket, 'signPk'>, signer: PacketSigner): Uint8Array {
  if (p.payload.length > MAX_PAYLOAD_SIZE) throw new Error('Payload too large');
  const signedEnd = HEADER_SIZE + p.payload.length;
  const buf = new Uint8Array(signedEnd + TRAILER_SIZE);
  const view = new DataView(buf.buffer);
  buf[0] = p.version;
  buf[1] = p.type;
  buf[2] = p.ttl;
  buf[3] = p.hops;
  buf[4] = p.flags;
  for (let i = 0; i < 8; i++) buf[5 + i] = parseInt(p.packetId.substr(i * 2, 2), 16);
  buf.set(uuidToBytes(p.origin), 13);
  buf.set(uuidToBytes(p.destination), 29);
  view.setUint32(45, p.seq >>> 0);
  view.setFloat64(49, p.timestamp);
  view.setUint16(57, p.payload.length);
  buf.set(p.payload, HEADER_SIZE);
  buf.set(signer.publicKey, signedEnd);
  buf.set(signer.sign(signedBytes(buf)), signedEnd + nacl.sign.publicKeyLength);
  return buf;
}

/** Structural decoding only. Returns null for anything malformed – never throws on network input. */
export function decodePacket(buf: Uint8Array): MeshPacket | null {
  if (buf.length < HEADER_SIZE + TRAILER_SIZE) return null;
  if (buf[0] !== PROTOCOL_VERSION) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = view.getUint16(57);
  if (len > MAX_PAYLOAD_SIZE || HEADER_SIZE + len + TRAILER_SIZE !== buf.length) return null;
  const type = buf[1];
  if (!(type in DEFAULT_TTL)) return null;
  const timestamp = view.getFloat64(49);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null;
  let packetId = '';
  for (let i = 0; i < 8; i++) packetId += buf[5 + i].toString(16).padStart(2, '0');
  const signedEnd = HEADER_SIZE + len;
  return {
    version: buf[0],
    type,
    ttl: buf[2],
    hops: buf[3],
    flags: buf[4],
    packetId,
    origin: bytesToUuid(buf.subarray(13, 29)),
    destination: bytesToUuid(buf.subarray(29, 45)),
    seq: view.getUint32(45),
    timestamp,
    payload: buf.slice(HEADER_SIZE, signedEnd),
    signPk: buf.slice(signedEnd, signedEnd + nacl.sign.publicKeyLength),
  };
}

/** The message a packet signature is computed over (ttl / hops are zeroed). */
export function signedBytes(raw: Uint8Array): Uint8Array {
  const signedEnd = raw.length - TRAILER_SIZE;
  const msg = new Uint8Array(SIGN_DOMAIN.length + signedEnd);
  msg.set(SIGN_DOMAIN, 0);
  msg.set(raw.subarray(0, signedEnd), SIGN_DOMAIN.length);
  msg[SIGN_DOMAIN.length + 2] = 0;
  msg[SIGN_DOMAIN.length + 3] = 0;
  return msg;
}

/** Cheap half of authentication: the carried signing key really hashes to the claimed origin. */
export function originMatchesKey(p: MeshPacket): boolean {
  return nodeIdFromSignKey(p.signPk) === p.origin;
}

/** Expensive half: the Ed25519 signature. `raw` must be the buffer `p` was decoded from. */
export function verifyPacket(raw: Uint8Array, p: MeshPacket): boolean {
  return nacl.sign.detached.verify(signedBytes(raw), raw.subarray(raw.length - nacl.sign.signatureLength), p.signPk);
}

/** Relay rewrite: decrement ttl / increment hops in place on a copy. */
export function rewriteForRelay(raw: Uint8Array): Uint8Array {
  const copy = raw.slice();
  copy[2] = Math.max(0, copy[2] - 1);
  copy[3] = Math.min(255, copy[3] + 1);
  return copy;
}

/** Copy of a stored packet ready to be handed to one neighbour (ttl=1, hops=0). */
export function rewriteForHandover(raw: Uint8Array): Uint8Array {
  const copy = raw.slice();
  copy[2] = 1;
  copy[3] = 0;
  return copy;
}

export function encodeJson(obj: unknown): Uint8Array {
  return utf8Encode(JSON.stringify(obj));
}

export function decodeJson<T>(bytes: Uint8Array): T | null {
  try {
    return JSON.parse(utf8Decode(bytes)) as T;
  } catch {
    return null;
  }
}
