import { type CertResult, checkCertValidity, readCert, type VerifiedCert } from './cert';
import { TRUST_ANCHORS } from './trustAnchors';

/**
 * Certificate checks against the app's trust anchors, with a small cache: every alert and message
 * of an authority and every few of its ANNOUNCEs carry the same certificate, and checking the root
 * signature each time would cost an Ed25519 verification per packet.
 */

const MAX_CERT_LENGTH = 1_200;
const cache = new Map<string, CertResult>();

function read(cert: unknown): CertResult {
  if (typeof cert !== 'string' || cert.length > MAX_CERT_LENGTH) return { ok: false, reason: 'format' };
  let result = cache.get(cert);
  if (!result) {
    if (cache.size >= 256) cache.clear();
    result = readCert(cert, TRUST_ANCHORS);
    cache.set(cert, result);
  }
  return result;
}

/** Verifies a certificate presented by `nodeId` (see `checkCertValidity` for `slackMs`). */
export function checkPeerCert(cert: unknown, nodeId: string, now = Date.now(), slackMs = 0): CertResult {
  const result = read(cert);
  return result.ok ? checkCertValidity(result.cert, nodeId, now, slackMs) : result;
}

/** Signature, structure, deny-list and subject – but not the validity window (to tell "expired" apart). */
export function readPeerCert(cert: unknown, nodeId: string): VerifiedCert | null {
  const result = read(cert);
  return result.ok && result.cert.nodeId === nodeId ? result.cert : null;
}

/** Convenience: the verified certificate or null. */
export function peerAuthority(cert: unknown, nodeId: string, now = Date.now(), slackMs = 0): VerifiedCert | null {
  const result = checkPeerCert(cert, nodeId, now, slackMs);
  return result.ok ? result.cert : null;
}
