import { SeenCache } from '../src/services/mesh/SeenCache';
import { fromBase64Strict, toBase64 } from '../src/utils/bytes';
import { nickSkeleton, sanitizeLine, sanitizeNick } from '../src/utils/nick';

describe('SeenCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('remembers ids only once they are added, per origin', () => {
    const cache = new SeenCache();
    expect(cache.has('alice' + 'id1')).toBe(false);
    cache.add('alice' + 'id1');
    expect(cache.has('alice' + 'id1')).toBe(true);
    // The same packet id under another origin is a different packet.
    expect(cache.has('mallory' + 'id1')).toBe(false);
  });

  it('forgets entries after the ttl and evicts the oldest when full', () => {
    const cache = new SeenCache(2, 1_000);
    cache.add('a');
    jest.advanceTimersByTime(999);
    expect(cache.has('a')).toBe(true);
    jest.advanceTimersByTime(2);
    expect(cache.has('a')).toBe(false);

    cache.add('b');
    cache.add('c');
    cache.add('d');
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });
});

describe('untrusted text', () => {
  it('strips control, bidi and zero-width characters from nicks', () => {
    expect(sanitizeNick('  Ala\u0000\u0007 ')).toBe('Ala');
    expect(sanitizeNick('Urząd‮ dązrU')).toBe('Urząd dązrU');
    expect(sanitizeNick('A​l‍a﻿')).toBe('Ala');
    expect(sanitizeNick('x'.repeat(100))).toHaveLength(24);
    expect(sanitizeNick(undefined)).toBe('');
    expect(sanitizeNick({ toString: () => 'obj' })).toBe('');
    expect(sanitizeLine('  Nagłówek\n\talertu ', 80)).toBe('Nagłówekalertu');
  });

  it('folds look-alike names to the same skeleton', () => {
    const base = nickSkeleton('Łukasz Żak');
    expect(nickSkeleton('lukasz zak')).toBe(base);
    expect(nickSkeleton('ŁUKASZ  ŻAK')).toBe(base);
    expect(nickSkeleton('Łukasz​ Żak')).toBe(base);
    expect(nickSkeleton('Ｌｕｋａｓｚ Ｚａｋ')).toBe(base); // full-width letters
    expect(nickSkeleton('Lukas Zak')).not.toBe(base);
  });
});

describe('fromBase64Strict', () => {
  const bytes = new Uint8Array(32).map((_, i) => i * 7);
  const text = toBase64(bytes);

  it('accepts only canonical base64 of the expected length', () => {
    expect(fromBase64Strict(text, 32)).toEqual(bytes);
    expect(fromBase64Strict(text, 31)).toBeNull();
    expect(fromBase64Strict(text.replace(/=+$/, ''), 32)).toBeNull(); // missing padding
    expect(fromBase64Strict(` ${text}`, 32)).toBeNull();
    // base64url is tolerated by the lenient decoder, not here.
    expect(fromBase64Strict('+/+/', 3)).toEqual(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(fromBase64Strict('-_-_', 3)).toBeNull();
    expect(fromBase64Strict('***', 2)).toBeNull();
    expect(fromBase64Strict(undefined, 32)).toBeNull();
    expect(fromBase64Strict(123, 32)).toBeNull();
  });
});
