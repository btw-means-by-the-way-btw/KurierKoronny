import nacl from 'tweetnacl';

import { fragment, Reassembler } from '../src/services/ble/fragmenter';
import { deriveIdentity, fingerprint, nodeIdFromSignKey } from '../src/services/crypto/keys';
import {
  BROADCAST_ID,
  decodePacket,
  encodePacket,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  MeshPacket,
  originMatchesKey,
  PacketType,
  PROTOCOL_VERSION,
  rewriteForRelay,
  TRAILER_SIZE,
  verifyPacket,
} from '../src/services/mesh/packet';
import { toHex, utf8Encode } from '../src/utils/bytes';

const identity = (seedByte: number) => deriveIdentity(new Uint8Array(32).fill(seedByte));
const signerOf = (id: ReturnType<typeof identity>) => ({
  publicKey: id.sign.publicKey,
  sign: (m: Uint8Array) => nacl.sign.detached(m, id.sign.secretKey),
});

const alice = identity(1);
const mallory = identity(2);

function packet(overrides: Partial<MeshPacket> = {}): Omit<MeshPacket, 'signPk'> {
  return {
    version: PROTOCOL_VERSION,
    type: PacketType.Chat,
    ttl: 7,
    hops: 0,
    flags: 0,
    packetId: '0011223344556677',
    origin: alice.nodeId,
    destination: mallory.nodeId,
    seq: 42,
    timestamp: 1_800_000_000_000,
    payload: utf8Encode('{"hello":"świat"}'),
    ...overrides,
  };
}

const accepts = (raw: Uint8Array) => {
  const p = decodePacket(raw);
  return !!p && originMatchesKey(p) && verifyPacket(raw, p);
};

describe('identity keys', () => {
  it('derives the same keys from the same seed and different ones otherwise', () => {
    expect(identity(1).nodeId).toBe(alice.nodeId);
    expect(identity(3).nodeId).not.toBe(alice.nodeId);
    expect(toHex(alice.box.publicKey)).not.toBe(toHex(alice.sign.publicKey));
  });

  it('binds the node id to the signing key', () => {
    expect(nodeIdFromSignKey(alice.sign.publicKey)).toBe(alice.nodeId);
    expect(alice.nodeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('shows the full 128-bit id as the fingerprint', () => {
    expect(fingerprint(alice.nodeId)).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
    expect(fingerprint(alice.nodeId).replace(/ /g, '').toLowerCase()).toBe(alice.nodeId.replace(/-/g, ''));
  });

  it('rejects a seed of the wrong size', () => {
    expect(() => deriveIdentity(new Uint8Array(16))).toThrow();
  });
});

describe('packet v2', () => {
  it('round-trips and verifies', () => {
    const p = packet();
    const raw = encodePacket(p, signerOf(alice));
    expect(raw.length).toBe(HEADER_SIZE + p.payload.length + TRAILER_SIZE);
    const decoded = decodePacket(raw)!;
    expect(decoded).toMatchObject({ ...p, payload: p.payload });
    expect(accepts(raw)).toBe(true);
  });

  it('lets a relay change ttl and hops, and nothing else', () => {
    const raw = encodePacket(packet(), signerOf(alice));
    const relayed = rewriteForRelay(raw);
    expect(decodePacket(relayed)).toMatchObject({ ttl: 6, hops: 1 });
    expect(accepts(relayed)).toBe(true);

    // Every other byte of header and payload is covered by the signature.
    for (let i = 0; i < raw.length - TRAILER_SIZE; i++) {
      if (i === 2 || i === 3) continue;
      const tampered = raw.slice();
      tampered[i] ^= 0x01;
      expect(accepts(tampered)).toBe(false);
    }
  });

  it('rejects a packet signed by someone other than its claimed origin', () => {
    // Mallory signs with her own key but claims Alice's id.
    const forged = encodePacket(packet({ origin: alice.nodeId }), signerOf(mallory));
    const p = decodePacket(forged)!;
    expect(originMatchesKey(p)).toBe(false);

    // Mallory attaches Alice's public key but cannot produce Alice's signature.
    const withAliceKey = forged.slice();
    withAliceKey.set(alice.sign.publicKey, forged.length - TRAILER_SIZE);
    const q = decodePacket(withAliceKey)!;
    expect(originMatchesKey(q)).toBe(true);
    expect(verifyPacket(withAliceKey, q)).toBe(false);
  });

  it('rejects malformed buffers without throwing', () => {
    const raw = encodePacket(packet(), signerOf(alice));
    expect(decodePacket(raw.subarray(0, raw.length - 1))).toBeNull();
    expect(decodePacket(new Uint8Array([...raw, 0]))).toBeNull();
    expect(decodePacket(new Uint8Array(10))).toBeNull();
    expect(decodePacket(new Uint8Array(0))).toBeNull();

    const wrongVersion = raw.slice();
    wrongVersion[0] = 1;
    expect(decodePacket(wrongVersion)).toBeNull();

    const unknownType = raw.slice();
    unknownType[1] = 99;
    expect(decodePacket(unknownType)).toBeNull();
  });

  it('rejects non-finite and fractional timestamps', () => {
    for (const timestamp of [NaN, Infinity, -Infinity, 1.5, -1]) {
      expect(decodePacket(encodePacket(packet({ timestamp }), signerOf(alice)))).toBeNull();
    }
  });

  it('refuses to encode an oversized payload', () => {
    expect(() => encodePacket(packet({ payload: new Uint8Array(MAX_PAYLOAD_SIZE + 1) }), signerOf(alice))).toThrow();
  });

  it('fits the largest packet into BLE frames at the minimum MTU', () => {
    const raw = encodePacket(
      packet({ destination: BROADCAST_ID, payload: nacl.randomBytes(MAX_PAYLOAD_SIZE) }),
      signerOf(alice)
    );
    const frames = fragment(raw, 7, 23);
    expect(frames.length).toBeLessThanOrEqual(255);
    const reassembler = new Reassembler();
    let out: Uint8Array | null = null;
    for (const f of frames) out = reassembler.push(f) ?? out;
    expect(out).not.toBeNull();
    expect(accepts(out!)).toBe(true);
  });

  it('never builds a frame longer than a GATT attribute value', () => {
    // A characteristic value holds at most 512 bytes; Android 13+ refuses longer writes and
    // notifications even though the usual MTU (517) has room for 514. 420 bytes of payload is an
    // ANNOUNCE carrying an authority certificate – the smallest packet that needs two frames.
    for (const size of [420, MAX_PAYLOAD_SIZE]) {
      const raw = encodePacket(
        packet({ destination: BROADCAST_ID, payload: nacl.randomBytes(size) }),
        signerOf(alice)
      );
      const frames = fragment(raw, 7, 517);
      expect(frames.length).toBeGreaterThan(1);
      expect(Math.max(...frames.map((f) => f.length))).toBeLessThanOrEqual(512);
      const reassembler = new Reassembler();
      let out: Uint8Array | null = null;
      for (const f of frames) out = reassembler.push(f) ?? out;
      expect(out).toEqual(raw);
    }
  });
});
