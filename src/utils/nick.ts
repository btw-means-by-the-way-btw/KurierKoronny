/** Control, bidi-override and zero-width characters: invisible ways to make one name look like another. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** One line of text from an untrusted peer: invisible characters stripped, length clamped. */
export function sanitizeLine(s: unknown, maxLength: number): string {
  if (typeof s !== 'string') return '';
  return s.replace(UNSAFE_CHARS, '').trim().slice(0, maxLength);
}

/** Nicks come from untrusted peers: strip invisible characters and clamp the length. */
export function sanitizeNick(n: unknown): string {
  return sanitizeLine(n, 24);
}

/**
 * Folded form used to spot look-alike names ("Łukasz" vs "lukasz", full-width letters, …).
 * Not a full confusables table – it catches case, compatibility forms, diacritics and spacing.
 */
export function nickSkeleton(n: string): string {
  return sanitizeNick(n)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/\s+/g, '');
}
