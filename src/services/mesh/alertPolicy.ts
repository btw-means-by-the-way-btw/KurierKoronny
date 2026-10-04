import nacl from 'tweetnacl';

import { toHex, utf8Encode } from '../../utils/bytes';
import type { AlertPayload } from './packet';

/**
 * Rules for authority alerts (pure).
 *
 *  - One record per (origin, id). A newer signed timestamp replaces an older one; on a tie a
 *    cancellation wins. A cancellation is kept as a tombstone until the alert it cancels would
 *    have expired – otherwise replaying the original packet would bring the alert back.
 *  - At most MAX_ALERTS_PER_AUTHORITY records per author, always the newest ones. The cap is a
 *    function of the record set alone, so every node ends up with the same set no matter in which
 *    order packets arrived, and one author can never push out another author's alerts.
 *  - Relaying is lenient about time (a phone with a wrong clock must not black-hole alerts),
 *    display is strict.
 */

export const ALERT_HEADLINE_MAX = 80;
export const ALERT_TEXT_MAX = 500;
export const MAX_ALERT_LIFETIME_MS = 72 * 3_600_000;
export const MAX_ALERTS_PER_AUTHORITY = 5;
/** Records are kept and passed on until this long after they expired on the local clock. */
export const ALERT_RELAY_GRACE_MS = 24 * 3_600_000;
/** An alert stamped further into the future than this is not displayed yet. */
export const ALERT_FUTURE_TOLERANCE_MS = 10 * 60_000;

export interface StoredAlert {
  origin: string;
  id: string;
  /** Signed timestamp of the packet (author's clock). */
  timestamp: number;
  exp: number;
  headline: string;
  text: string;
  /** Office name from the author's certificate. */
  authority: string;
  certExp: number;
  cancelled: boolean;
  /** The signed packet as received – handed to other nodes unchanged (except ttl / hops). */
  raw: Uint8Array;
}

type Version = Pick<StoredAlert, 'timestamp' | 'cancelled'>;

/** Structural validation of an alert payload against the packet's signed timestamp. */
export function isValidAlertPayload(a: AlertPayload | null, timestamp: number): a is AlertPayload {
  return (
    !!a &&
    typeof a.id === 'string' &&
    /^[\w-]{1,64}$/.test(a.id) &&
    typeof a.h === 'string' &&
    a.h.length <= ALERT_HEADLINE_MAX &&
    typeof a.t === 'string' &&
    a.t.length <= ALERT_TEXT_MAX &&
    typeof a.c === 'string' &&
    (a.x === undefined || a.x === true) &&
    (a.x === true || a.h.trim().length > 0) &&
    Number.isSafeInteger(a.exp) &&
    a.exp > timestamp &&
    a.exp - timestamp <= MAX_ALERT_LIFETIME_MS
  );
}

export function supersedes(incoming: Version, stored: Version | undefined): boolean {
  if (!stored) return true;
  if (incoming.timestamp !== stored.timestamp) return incoming.timestamp > stored.timestamp;
  return incoming.cancelled && !stored.cancelled;
}

const newestFirst = (a: StoredAlert, b: StoredAlert) => b.timestamp - a.timestamp || (a.id < b.id ? -1 : 1);

/** The records of one author that survive the cap, given a candidate. */
function keptIds(list: StoredAlert[], candidate: Pick<StoredAlert, 'origin' | 'id' | 'timestamp'>): Set<string> {
  const own = list.filter((a) => a.origin === candidate.origin && a.id !== candidate.id);
  own.push(candidate as StoredAlert);
  return new Set(own.sort(newestFirst).slice(0, MAX_ALERTS_PER_AUTHORITY).map((a) => a.id));
}

/** Would this version change the store? Cheap enough to run before verifying the signature. */
export function wantsAlert(
  list: StoredAlert[],
  candidate: Pick<StoredAlert, 'origin' | 'id' | 'timestamp' | 'cancelled'>
): boolean {
  const stored = list.find((a) => a.origin === candidate.origin && a.id === candidate.id);
  return supersedes(candidate, stored) && keptIds(list, candidate).has(candidate.id);
}

/** Applies a verified alert. Returns the same list when nothing changed. */
export function applyAlert(list: StoredAlert[], incoming: StoredAlert): StoredAlert[] {
  if (!wantsAlert(list, incoming)) return list;
  const kept = keptIds(list, incoming);
  return [
    ...list.filter((a) => a.origin !== incoming.origin || (a.id !== incoming.id && kept.has(a.id))),
    incoming,
  ];
}

/** Shown to the user right now (strict about time). */
export function isAlertActive(a: StoredAlert, now: number): boolean {
  return !a.cancelled && a.timestamp <= now + ALERT_FUTURE_TOLERANCE_MS && now <= Math.min(a.exp, a.certExp);
}

/** Still worth storing and handing to other nodes (lenient about time). */
export function isAlertRelayable(a: Pick<StoredAlert, 'exp'>, now: number): boolean {
  return now <= a.exp + ALERT_RELAY_GRACE_MS;
}

export function pruneAlerts(list: StoredAlert[], now: number): StoredAlert[] {
  const kept = list.filter((a) => isAlertRelayable(a, now));
  return kept.length === list.length ? list : kept;
}

/** Short fingerprint of the record set; two nodes with the same digest have nothing to exchange. */
export function alertDigest(list: StoredAlert[]): string {
  const lines = list
    .map((a) => `${a.origin}|${a.id}|${a.timestamp}|${a.cancelled ? 1 : 0}`)
    .sort()
    .join('\n');
  return toHex(nacl.hash(utf8Encode(lines)).subarray(0, 8));
}
