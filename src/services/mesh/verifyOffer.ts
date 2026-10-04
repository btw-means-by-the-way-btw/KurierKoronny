/**
 * One-scan mutual verification (pure state machine).
 *
 * Verifying a contact means "I checked in person that this node id belongs to this human". When A
 * scans the code on B's screen, A learns that from the key in the code. For B to learn the same
 * about A without a second scan, B's code carries a one-time random token, and A sends it back
 * end-to-end encrypted: whoever knows the token has seen B's screen.
 *
 * Seeing a screen is not the same as being the person B is meeting – a QR code can be read by any
 * camera in sight. So the token alone never verifies anybody:
 *
 *  - An offer is BOUND to one conversation: B opens the code from the chat with A, and only a
 *    proof from that conversation's node id is accepted. The human chose who gets verified.
 *  - The right token from any OTHER device means the code leaked, or the conversation is not with
 *    the person who is scanning. That is a conflict: the offer is dropped, what this conversation's
 *    codes granted in the last minute is undone, and nothing is acknowledged. The scanning phone
 *    sends its proof even when the key does not match its own conversation, and the code stays
 *    on screen for a moment after it was accepted, so the person actually standing there still
 *    produces that second proof when an impostor's camera was faster.
 *  - A token lives in memory only, for OFFER_TTL_MS, and is spent by the first proof.
 *  - A repeated proof from the accepted node is acknowledged again (the first acknowledgement may
 *    have been lost) for ACCEPTED_MEMORY_MS; everything else is ignored silently.
 */

export const OFFER_TTL_MS = 2 * 60_000;
/** How long a used token is remembered: covers the scanner's retries and catches a second device. */
export const ACCEPTED_MEMORY_MS = 60_000;

export interface Offer {
  token: string;
  /** Node id of the conversation the code was opened from – the only node it can verify. */
  peerId: string;
  expiresAt: number;
}

export interface Accepted {
  token: string;
  by: string;
  until: number;
  /** The `verifiedAt` this token wrote – a rollback only undoes exactly that value. */
  grantedAt: number;
  /** The contact's `verifiedAt` before the codes of this window verified it. */
  previousVerifiedAt: number | null;
}

export interface OfferState {
  offer: Offer | null;
  accepted: Accepted | null;
}

export type ProofResult =
  /** The bound peer proved it saw the code: mark it verified (at `now`) and acknowledge. */
  | { kind: 'verified'; peerId: string }
  /** The same peer again: acknowledge again, change nothing. */
  | { kind: 'repeat' }
  /** A different device knew the token. `revoke` is what the codes of `peerId` granted just before. */
  | { kind: 'conflict'; peerId: string; revoke: Accepted | null }
  | { kind: 'ignored' };

export const newOfferState = (): OfferState => ({ offer: null, accepted: null });

/** Replaces the displayed offer with a fresh token for the conversation with `peerId`. */
export function openOffer(state: OfferState, peerId: string, token: string, now: number): void {
  state.offer = { token, peerId, expiresAt: now + OFFER_TTL_MS };
}

export function closeOffer(state: OfferState): void {
  state.offer = null;
}

/** Forgets the accepted token of `nodeId` (the user undid that verification by hand). */
export function forgetAccepted(state: OfferState, nodeId: string): void {
  if (state.accepted?.by === nodeId) state.accepted = null;
}

/**
 * Handles a proof from `origin` (whose packet signature was already verified). Mutates `state`
 * synchronously – callers must not await between receiving the proof and calling this.
 * @param previousVerifiedAt the `verifiedAt` currently stored for `origin`
 */
export function acceptProof(
  state: OfferState,
  origin: string,
  token: unknown,
  now: number,
  previousVerifiedAt: number | null
): ProofResult {
  if (typeof token !== 'string') return { kind: 'ignored' };
  const { offer } = state;
  const accepted = state.accepted && now <= state.accepted.until ? state.accepted : null;

  if (offer && offer.token === token && now <= offer.expiresAt) {
    state.offer = null; // spent either way: a token somebody else knows must not be accepted later
    if (origin !== offer.peerId) {
      // Also undo what an earlier code of this same conversation granted moments ago.
      const revoke = accepted && accepted.by === offer.peerId ? accepted : null;
      if (revoke) state.accepted = null;
      return { kind: 'conflict', peerId: offer.peerId, revoke };
    }
    state.accepted = {
      token,
      by: origin,
      until: now + ACCEPTED_MEMORY_MS,
      grantedAt: now,
      // A second code within the window must not launder the first one's grant into "previous".
      previousVerifiedAt: accepted && accepted.by === origin ? accepted.previousVerifiedAt : previousVerifiedAt,
    };
    return { kind: 'verified', peerId: offer.peerId };
  }

  if (accepted && accepted.token === token) {
    if (origin === accepted.by) return { kind: 'repeat' };
    state.accepted = null;
    return { kind: 'conflict', peerId: accepted.by, revoke: accepted };
  }

  return { kind: 'ignored' };
}
