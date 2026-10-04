import * as Crypto from 'expo-crypto';

/** Cryptographically secure random bytes (native SecureRandom via expo-crypto). */
export function randomBytes(n: number): Uint8Array {
  return Crypto.getRandomBytes(n);
}

export function randomId(): string {
  return Crypto.randomUUID();
}
