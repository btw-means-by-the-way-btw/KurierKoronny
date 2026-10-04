import { isEnvelope } from '../src/services/crypto/box';
import { identityQr, parseIdentityQr } from '../src/services/crypto/cert';
import { deriveIdentity } from '../src/services/crypto/keys';
import {
  ACCEPTED_MEMORY_MS,
  acceptProof,
  closeOffer,
  forgetAccepted,
  newOfferState,
  OFFER_TTL_MS,
  openOffer,
} from '../src/services/mesh/verifyOffer';
import { toBase64 } from '../src/utils/bytes';

const NOW = 1_800_000_000_000;
const TOKEN = toBase64(new Uint8Array(16).fill(7));
const OTHER = toBase64(new Uint8Array(16).fill(8));

/** A state in which Bob shows a code from his chat with Alice. */
const offered = (peerId = 'alice', token = TOKEN) => {
  const state = newOfferState();
  openOffer(state, peerId, token, NOW);
  return state;
};

describe('one-scan mutual verification offer', () => {
  it('verifies the peer the code was opened for, once', () => {
    const state = offered();
    expect(acceptProof(state, 'alice', TOKEN, NOW + 1_000, null)).toEqual({ kind: 'verified', peerId: 'alice' });
    expect(state.offer).toBeNull();
    // Alice retrying (her acknowledgement got lost) is told again, without anything changing.
    expect(acceptProof(state, 'alice', TOKEN, NOW + 5_000, NOW)).toEqual({ kind: 'repeat' });
    expect(state.accepted).toMatchObject({ by: 'alice', previousVerifiedAt: null });
  });

  it('never verifies a device other than the one the code was opened for', () => {
    // Mallory photographs the screen and sends the right token before Alice does.
    const state = offered();
    expect(acceptProof(state, 'mallory', TOKEN, NOW + 500, null)).toEqual({
      kind: 'conflict',
      peerId: 'alice',
      revoke: null,
    });
    // The leaked code is dead: Alice's honest proof is not accepted either, so the two of them
    // notice and start over instead of trusting a code somebody else has seen.
    expect(acceptProof(state, 'alice', TOKEN, NOW + 1_000, null)).toEqual({ kind: 'ignored' });
    expect(state.accepted).toBeNull();
  });

  it('undoes the verification when a second device turns out to know the token', () => {
    // Bob opened the code from a chat that is really Mallory's node (she uses Alice's nick) and
    // Mallory, watching the screen, proves the token first. The real Alice's phone then sends
    // the same token from another node id: evidence that the code did not stay between two people.
    const state = offered('mallory');
    expect(acceptProof(state, 'mallory', TOKEN, NOW, 1_700_000_000_000).kind).toBe('verified');
    const result = acceptProof(state, 'alice', TOKEN, NOW + 2_000, null);
    expect(result).toEqual({
      kind: 'conflict',
      peerId: 'mallory',
      revoke: {
        token: TOKEN,
        by: 'mallory',
        until: NOW + ACCEPTED_MEMORY_MS,
        grantedAt: NOW,
        previousVerifiedAt: 1_700_000_000_000,
      },
    });
    // After a conflict nothing about this token is honoured any more.
    expect(acceptProof(state, 'mallory', TOKEN, NOW + 3_000, null)).toEqual({ kind: 'ignored' });
  });

  it('undoes an earlier grant when the next code of the same conversation leaks', () => {
    // Code 1 was proved by the impostor before the real person could scan; Bob shows code 2 and
    // this time the real person is first. The grant made by code 1 must not survive that.
    const state = offered('mallory');
    acceptProof(state, 'mallory', TOKEN, NOW, null);
    openOffer(state, 'mallory', OTHER, NOW + 10_000);
    expect(acceptProof(state, 'alice', OTHER, NOW + 12_000, null)).toMatchObject({
      kind: 'conflict',
      peerId: 'mallory',
      revoke: { token: TOKEN, by: 'mallory', grantedAt: NOW, previousVerifiedAt: null },
    });
    expect(state.accepted).toBeNull();
  });

  it('remembers the state before the first of several codes, not before the latest', () => {
    const state = offered();
    acceptProof(state, 'alice', TOKEN, NOW, null);
    openOffer(state, 'alice', OTHER, NOW + 5_000);
    // By now the contact carries the timestamp written by code 1 – that is not the "previous" state.
    expect(acceptProof(state, 'alice', OTHER, NOW + 6_000, NOW).kind).toBe('verified');
    expect(state.accepted).toMatchObject({ grantedAt: NOW + 6_000, previousVerifiedAt: null });
  });

  it('forgets the accepted token when the user undoes that verification', () => {
    const state = offered();
    acceptProof(state, 'alice', TOKEN, NOW, null);
    forgetAccepted(state, 'bob'); // somebody else: nothing happens
    expect(state.accepted).not.toBeNull();
    forgetAccepted(state, 'alice');
    expect(state.accepted).toBeNull();
    expect(acceptProof(state, 'alice', TOKEN, NOW + 1_000, null)).toEqual({ kind: 'ignored' });
    expect(acceptProof(state, 'mallory', TOKEN, NOW + 1_000, null)).toEqual({ kind: 'ignored' });
  });

  it('ignores wrong, expired and malformed tokens without spending the offer', () => {
    const state = newOfferState();
    expect(acceptProof(state, 'alice', TOKEN, NOW, null)).toEqual({ kind: 'ignored' }); // nothing on screen
    openOffer(state, 'alice', TOKEN, NOW);
    expect(acceptProof(state, 'alice', OTHER, NOW, null)).toEqual({ kind: 'ignored' });
    expect(acceptProof(state, 'mallory', OTHER, NOW, null)).toEqual({ kind: 'ignored' });
    for (const junk of [undefined, null, 7, {}, '', TOKEN.slice(1)]) {
      expect(acceptProof(state, 'alice', junk, NOW, null)).toEqual({ kind: 'ignored' });
    }
    expect(acceptProof(state, 'alice', TOKEN, NOW + OFFER_TTL_MS + 1, null)).toEqual({ kind: 'ignored' });
    expect(acceptProof(state, 'alice', TOKEN, NOW + OFFER_TTL_MS, null).kind).toBe('verified');
  });

  it('stops accepting once the code is withdrawn or replaced', () => {
    const state = offered();
    closeOffer(state);
    expect(acceptProof(state, 'alice', TOKEN, NOW, null)).toEqual({ kind: 'ignored' });

    openOffer(state, 'alice', TOKEN, NOW);
    openOffer(state, 'carol', OTHER, NOW); // a new code for another conversation
    expect(acceptProof(state, 'alice', TOKEN, NOW, null)).toEqual({ kind: 'ignored' });
    expect(acceptProof(state, 'carol', OTHER, NOW, null).kind).toBe('verified');
  });

  it('forgets a used token after the retry window', () => {
    const state = offered();
    acceptProof(state, 'alice', TOKEN, NOW, null);
    expect(acceptProof(state, 'alice', TOKEN, NOW + ACCEPTED_MEMORY_MS, null)).toEqual({ kind: 'repeat' });
    expect(acceptProof(state, 'alice', TOKEN, NOW + ACCEPTED_MEMORY_MS + 1, null)).toEqual({ kind: 'ignored' });
    // …and a stranger showing up with it that late changes nothing.
    expect(acceptProof(state, 'mallory', TOKEN, NOW + ACCEPTED_MEMORY_MS + 1, null)).toEqual({ kind: 'ignored' });
  });
});

describe('identity QR with a verification token', () => {
  const alice = deriveIdentity(new Uint8Array(32).fill(1));
  const key = toBase64(alice.sign.publicKey);

  it('carries the token only when one is given', () => {
    expect(parseIdentityQr(identityQr(key))).toEqual({ nodeId: alice.nodeId, token: null });
    expect(parseIdentityQr(identityQr(key, null))).toEqual({ nodeId: alice.nodeId, token: null });
    expect(parseIdentityQr(identityQr(key, TOKEN))).toEqual({ nodeId: alice.nodeId, token: TOKEN });
  });

  it('rejects codes with a malformed token instead of silently dropping it', () => {
    for (const bad of ['', 'AAAA', TOKEN.slice(0, -2), `${TOKEN}=`, TOKEN.replace(/=/g, ''), `${TOKEN}:${TOKEN}`, 'x'.repeat(24)]) {
      expect(parseIdentityQr(`MC1:ID:${key}:${bad}`)).toBeNull();
    }
  });
});

describe('verification proof envelope', () => {
  const proof = { y: 'v', id: TOKEN, from: 'alice', to: 'bob' };

  it('must travel from the signed origin to this node', () => {
    expect(isEnvelope(proof, 'v', 'alice', 'bob')).toBe(true);
    expect(isEnvelope(proof, 'v', 'mallory', 'bob')).toBe(false);
    expect(isEnvelope(proof, 'v', 'alice', 'carol')).toBe(false);
  });

  it('is not mistaken for a message or an acknowledgement', () => {
    expect(isEnvelope(proof, 'm', 'alice', 'bob')).toBe(false);
    expect(isEnvelope(proof, 'a', 'alice', 'bob')).toBe(false);
    expect(isEnvelope({ ...proof, y: 'a' }, 'v', 'alice', 'bob')).toBe(false);
    expect(isEnvelope({ ...proof, y: 'm', t: 'hi' }, 'v', 'alice', 'bob')).toBe(false);
  });
});
