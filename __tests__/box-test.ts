import { AckPlain, isEnvelope, MessagePlain, open, seal, sharedKey } from '../src/services/crypto/box';
import { deriveIdentity } from '../src/services/crypto/keys';
import { toBase64 } from '../src/utils/bytes';

const identity = (seedByte: number) => deriveIdentity(new Uint8Array(32).fill(seedByte));
const alice = identity(1);
const bob = identity(2);
const mallory = identity(3);
const nonce = (n: number) => new Uint8Array(24).fill(n);

const aliceToBob = sharedKey(bob.box.publicKey, alice.box.secretKey);
const bobFromAlice = sharedKey(alice.box.publicKey, bob.box.secretKey);

const message: MessagePlain = { y: 'm', id: 'msg-1', n: 'Alicja', t: 'Zbiórka o 15:00', from: alice.nodeId, to: bob.nodeId };

describe('1:1 encryption', () => {
  it('round-trips between the two parties', () => {
    const sealed = seal(message, nonce(1), aliceToBob, alice.box.publicKey);
    expect(sealed.k).toBe(toBase64(alice.box.publicKey));
    expect(JSON.stringify(sealed)).not.toContain('Zbiórka');
    const plain = open(sealed, bobFromAlice);
    expect(plain).toEqual(message);
    expect(isEnvelope(plain, 'm', alice.nodeId, bob.nodeId)).toBe(true);
  });

  it('cannot be opened by a third party', () => {
    const sealed = seal(message, nonce(1), aliceToBob, alice.box.publicKey);
    expect(open(sealed, sharedKey(alice.box.publicKey, mallory.box.secretKey))).toBeNull();
  });

  it('rejects tampered or malformed ciphertext without throwing', () => {
    const sealed = seal(message, nonce(1), aliceToBob, alice.box.publicKey);
    expect(open({ ...sealed, c: sealed.c.slice(0, -4) + 'AAAA' }, bobFromAlice)).toBeNull();
    expect(open({ ...sealed, nn: 'short' }, bobFromAlice)).toBeNull();
    expect(open({ ...sealed, c: '***' }, bobFromAlice)).toBeNull();
    expect(open(null, bobFromAlice)).toBeNull();
    expect(open({ k: 1, nn: 2, c: 3 } as never, bobFromAlice)).toBeNull();
  });

  it('does not let a relay claim somebody else\'s ciphertext as its own message', () => {
    // Mallory relays Alice → Bob. She announces ALICE'S box key as her own, lifts the ciphertext
    // and re-sends it in a packet she signs as origin = Mallory. Bob looks up "Mallory's" box
    // key (= Alice's), so the box opens – only the envelope tells the truth.
    const sealed = seal(message, nonce(1), aliceToBob, alice.box.publicKey);
    const mallorysClaimedKey = alice.box.publicKey;
    const plain = open(sealed, sharedKey(mallorysClaimedKey, bob.box.secretKey));
    expect(plain).toEqual(message);
    expect(isEnvelope(plain, 'm', mallory.nodeId, bob.nodeId)).toBe(false);
  });

  it('does not accept a message reflected back to its author or sent to someone else', () => {
    const sealed = seal(message, nonce(1), aliceToBob, alice.box.publicKey);
    const plain = open(sealed, aliceToBob); // box(A→B) also opens with A's secret
    expect(isEnvelope(plain, 'm', bob.nodeId, alice.nodeId)).toBe(false);
    expect(isEnvelope(plain, 'm', alice.nodeId, mallory.nodeId)).toBe(false);
  });

  it('keeps messages and acknowledgements apart', () => {
    const ack: AckPlain = { y: 'a', id: 'msg-1', from: bob.nodeId, to: alice.nodeId };
    const plain = open(seal(ack, nonce(2), bobFromAlice, bob.box.publicKey), aliceToBob);
    expect(isEnvelope(plain, 'a', bob.nodeId, alice.nodeId)).toBe(true);
    expect(isEnvelope(plain, 'm', bob.nodeId, alice.nodeId)).toBe(false);
    expect(isEnvelope(open(seal(message, nonce(1), aliceToBob, alice.box.publicKey), bobFromAlice), 'a', alice.nodeId, bob.nodeId)).toBe(false);
  });

  it('rejects envelopes with missing or wrongly typed fields', () => {
    expect(isEnvelope(null, 'm', alice.nodeId, bob.nodeId)).toBe(false);
    expect(isEnvelope('text', 'm', alice.nodeId, bob.nodeId)).toBe(false);
    expect(isEnvelope({ ...message, t: 5 }, 'm', alice.nodeId, bob.nodeId)).toBe(false);
    expect(isEnvelope({ ...message, id: undefined }, 'm', alice.nodeId, bob.nodeId)).toBe(false);
  });
});
