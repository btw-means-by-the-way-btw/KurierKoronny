import nacl from 'tweetnacl';

import { concatBytes, fromBase64Strict, utf8Decode, utf8Encode } from '../../utils/bytes';
import { nodeIdFromSignKey } from './keys';

/**
 * Authority certificates and QR payloads (pure).
 *
 * A certificate is a statement signed by the offline root key: "the holder of signing key `pk`
 * speaks for `name` between `nbf` and `exp`". Text form (also the QR payload):
 *
 *   MC1:CERT:<base64(body)>.<base64(signature)>
 *
 * `body` is UTF-8 JSON with a fixed key order; the root signs "meshchat-cert-v1" ‖ body. The
 * verifier checks the signature over the exact bytes first and only then parses them, and rejects
 * a body that does not re-serialise to the same bytes (no duplicate keys, no extra fields).
 *
 * A certificate is public: copying it gives nothing without the matching signing key, because
 * every packet must be signed by `pk`.
 */

const CERT_DOMAIN = utf8Encode('meshchat-cert-v1');
const CERT_RE = /^MC1:CERT:([A-Za-z0-9+/]{1,800}={0,2})\.([A-Za-z0-9+/]{86}==)$/;
const ID_RE = /^MC1:ID:([A-Za-z0-9+/]{43}=)(?::([A-Za-z0-9+/]{22}==))?$/;
/** Control, bidi and zero-width characters – never allowed in a name shown as "official". */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;

export const CERT_NAME_MAX = 48;
/** Size of the one-time token in a verification offer. */
export const VERIFY_TOKEN_BYTES = 16;

export interface CertBody {
  v: 1;
  /** Serial number, 16 hex digits. */
  sn: string;
  /** Ed25519 signing public key of the holder (base64). */
  pk: string;
  /** Name of the office, shown to users. */
  name: string;
  /** Validity window, ms since epoch. */
  nbf: number;
  exp: number;
}

export interface VerifiedCert {
  sn: string;
  /** Node id of the holder (derived from `pk`). */
  nodeId: string;
  name: string;
  nbf: number;
  exp: number;
}

export interface TrustAnchors {
  /** Root public keys (base64) allowed to sign certificates. */
  roots: string[];
  revokedSerials: string[];
  /** Revoked holder keys (base64). */
  revokedKeys: string[];
}

export type CertFailure = 'format' | 'signature' | 'subject' | 'not_yet_valid' | 'expired' | 'revoked';
export type CertResult = { ok: true; cert: VerifiedCert } | { ok: false; reason: CertFailure };

/** The exact bytes that get signed: JSON with this key order and no whitespace. */
export function serializeCertBody(b: CertBody): string {
  return JSON.stringify({ v: b.v, sn: b.sn, pk: b.pk, name: b.name, nbf: b.nbf, exp: b.exp });
}

export function certSigningInput(body: Uint8Array): Uint8Array {
  return concatBytes([CERT_DOMAIN, body]);
}

function parseBody(text: string): CertBody | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as CertBody;
  if (
    b.v !== 1 ||
    typeof b.sn !== 'string' ||
    !/^[0-9a-f]{16}$/.test(b.sn) ||
    typeof b.name !== 'string' ||
    b.name.length < 1 ||
    b.name.length > CERT_NAME_MAX ||
    b.name !== b.name.trim() ||
    UNSAFE_CHARS.test(b.name) ||
    !Number.isSafeInteger(b.nbf) ||
    !Number.isSafeInteger(b.exp) ||
    b.nbf >= b.exp ||
    !fromBase64Strict(b.pk, nacl.sign.publicKeyLength)
  ) {
    return null;
  }
  return serializeCertBody(b) === text ? b : null;
}

const fail = (reason: CertFailure): CertResult => ({ ok: false, reason });

/**
 * The time-independent part of verification: root signature, structure and deny-list.
 * The result may be cached per certificate text; `checkCertValidity` must still be applied.
 */
export function readCert(cert: unknown, anchors: TrustAnchors): CertResult {
  if (typeof cert !== 'string') return fail('format');
  const m = CERT_RE.exec(cert);
  if (!m) return fail('format');
  const bodyBytes = fromBase64Strict(m[1], Math.floor((m[1].replace(/=/g, '').length * 3) / 4));
  const sig = fromBase64Strict(m[2], nacl.sign.signatureLength);
  if (!bodyBytes || !sig) return fail('format');

  const input = certSigningInput(bodyBytes);
  const signed = anchors.roots.some((root) => {
    const key = fromBase64Strict(root, nacl.sign.publicKeyLength);
    return !!key && nacl.sign.detached.verify(input, sig, key);
  });
  if (!signed) return fail('signature');

  const body = parseBody(utf8Decode(bodyBytes));
  if (!body) return fail('format');
  if (anchors.revokedSerials.includes(body.sn) || anchors.revokedKeys.includes(body.pk)) return fail('revoked');
  const nodeId = nodeIdFromSignKey(fromBase64Strict(body.pk, nacl.sign.publicKeyLength)!);
  return { ok: true, cert: { sn: body.sn, nodeId, name: body.name, nbf: body.nbf, exp: body.exp } };
}

/**
 * The per-use part: the certificate belongs to the node presenting it and is within its validity.
 * @param slackMs tolerance on the validity window (relays are lenient so that a wrong local clock
 *                does not black-hole alerts; display code passes 0).
 */
export function checkCertValidity(cert: VerifiedCert, subjectNodeId: string, now: number, slackMs = 0): CertResult {
  if (cert.nodeId !== subjectNodeId) return fail('subject');
  if (now < cert.nbf - slackMs) return fail('not_yet_valid');
  if (now > cert.exp + slackMs) return fail('expired');
  return { ok: true, cert };
}

/** Full verification of a certificate presented by `subjectNodeId`. */
export function verifyCert(
  cert: unknown,
  subjectNodeId: string,
  now: number,
  anchors: TrustAnchors,
  slackMs = 0
): CertResult {
  const read = readCert(cert, anchors);
  return read.ok ? checkCertValidity(read.cert, subjectNodeId, now, slackMs) : read;
}

// --- Identity QR ------------------------------------------------------------------------

export interface ScannedIdentity {
  nodeId: string;
  /** One-time verification token shown on the owner's screen, if the code carried one. */
  token: string | null;
}

/**
 * QR / text form of a public identity: the signing key (nicks are not part of it). The code shown
 * from a chat's verify screen also carries a one-time `token` (see mesh/verifyOffer). That form
 * is meant for one person's camera only and is never shared as text: the token verifies nobody
 * but the conversation it was opened for, yet anyone else presenting it cancels the verification.
 */
export function identityQr(signPublicKeyBase64: string, token?: string | null): string {
  return token ? `MC1:ID:${signPublicKeyBase64}:${token}` : `MC1:ID:${signPublicKeyBase64}`;
}

/** Parses an identity QR. Returns null for anything else (URLs, certificates, junk). */
export function parseIdentityQr(text: unknown): ScannedIdentity | null {
  if (typeof text !== 'string') return null;
  const m = ID_RE.exec(text);
  const key = m ? fromBase64Strict(m[1], nacl.sign.publicKeyLength) : null;
  if (!key) return null;
  const token = m![2] && fromBase64Strict(m![2], VERIFY_TOKEN_BYTES) ? m![2] : null;
  if (m![2] && !token) return null;
  return { nodeId: nodeIdFromSignKey(key), token };
}
