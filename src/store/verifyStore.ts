import { create } from 'zustand';

import { newOfferState, type OfferState } from '../services/mesh/verifyOffer';

/** What happened to the last one-time code this device showed. */
export interface VerifyOutcome {
  /** The conversation the code was shown for. */
  peerId: string;
  /** 'verified': that peer scanned it. 'conflict': some other device knew the code – nobody is verified by it. */
  kind: 'verified' | 'conflict';
  /** The node that presented the code. */
  by: string;
  at: number;
}

interface VerifyState {
  /** Offer shown as a QR code plus the memory of the last accepted token (see mesh/verifyOffer). */
  machine: OfferState;
  outcome: VerifyOutcome | null;
  set: (patch: Partial<Pick<VerifyState, 'machine' | 'outcome'>>) => void;
}

/** In-memory only: a verification code must not survive an app restart. */
export const useVerifyStore = create<VerifyState>((set) => ({
  machine: newOfferState(),
  outcome: null,
  set: (patch) => set(patch),
}));
