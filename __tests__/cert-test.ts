import nacl from 'tweetnacl';

import * as ca from '../scripts/authority-ca';
import {
  certSigningInput,
  identityQr,
  parseIdentityQr,
  serializeCertBody,
  TrustAnchors,
  verifyCert,
} from '../src/services/crypto/cert';
import { deriveIdentity, fingerprint } from '../src/services/crypto/keys';
import { fromBase64, toBase64, toHex, utf8Decode, utf8Encode } from '../src/utils/bytes';

const root = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
const otherRoot = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8));
const official = deriveIdentity(new Uint8Array(32).fill(1));
const citizen = deriveIdentity(new Uint8Array(32).fill(2));

const anchors: TrustAnchors = { roots: [toBase64(root.publicKey)], revokedSerials: [], revokedKeys: [] };
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const issue = (overrides: Record<string, unknown> = {}, secretKey = root.secretKey) =>
  ca.issueCert(secretKey, {
    devicePublicKey: official.sign.publicKey,
    name: 'Urząd Miasta Kraków – WZK',
    notBefore: NOW - 3_600_000,
    notAfter: NOW + 30 * DAY,
    serial: '00112233aabbccdd',
    ...overrides,
  }).cert;

/** Signs an arbitrary body string with the root key (to craft certificates the CA would never issue). */
const signRaw = (body: string) => {
  const bytes = utf8Encode(body);
  return `MC1:CERT:${toBase64(bytes)}.${toBase64(nacl.sign.detached(certSigningInput(bytes), root.secretKey))}`;
};

describe('authority certificates', () => {
  it('accepts a certificate issued by the CA script for the right device', () => {
    const result = verifyCert(issue(), official.nodeId, NOW, anchors);
    expect(result).toEqual({
      ok: true,
      cert: {
        sn: '00112233aabbccdd',
        nodeId: official.nodeId,
        name: 'Urząd Miasta Kraków – WZK',
        nbf: NOW - 3_600_000,
        exp: NOW + 30 * DAY,
      },
    });
  });

  it('agrees with the CA script on node ids and fingerprints', () => {
    expect(ca.nodeIdFromSignKey(official.sign.publicKey)).toBe(official.nodeId);
    expect(ca.fingerprint(official.nodeId)).toBe(fingerprint(official.nodeId));
    const hex = toHex(official.sign.publicKey).toUpperCase().match(/.{4}/g)!.join(' ');
    const key = toHex(official.sign.publicKey);
    expect(toHex(ca.parseDeviceKey(hex))).toBe(key);
    expect(toHex(ca.parseDeviceKey(identityQr(toBase64(official.sign.publicKey))))).toBe(key);
    expect(() => ca.parseDeviceKey('MC1:ID:AAAA')).toThrow();
  });

  it('is useless on any other device', () => {
    expect(verifyCert(issue(), citizen.nodeId, NOW, anchors)).toEqual({ ok: false, reason: 'subject' });
  });

  it('rejects a certificate signed by an untrusted root', () => {
    expect(verifyCert(issue({}, otherRoot.secretKey), official.nodeId, NOW, anchors)).toEqual({ ok: false, reason: 'signature' });
    expect(verifyCert(issue(), official.nodeId, NOW, { ...anchors, roots: [] })).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects any change to the signed body', () => {
    const cert = issue();
    const [prefix, sig] = cert.split('.');
    const body = utf8Decode(fromBase64(prefix.slice('MC1:CERT:'.length)));
    const renamed = body.replace('Kraków', 'Gdańsk');
    expect(renamed).not.toBe(body);
    const tampered = `MC1:CERT:${toBase64(utf8Encode(renamed))}.${sig}`;
    expect(verifyCert(tampered, official.nodeId, NOW, anchors)).toEqual({ ok: false, reason: 'signature' });
  });

  it('enforces the validity window, with slack only where asked for', () => {
    const cert = issue();
    expect(verifyCert(cert, official.nodeId, NOW - 3_600_001, anchors)).toEqual({ ok: false, reason: 'not_yet_valid' });
    expect(verifyCert(cert, official.nodeId, NOW - 3_600_000, anchors).ok).toBe(true);
    expect(verifyCert(cert, official.nodeId, NOW + 30 * DAY, anchors).ok).toBe(true);
    expect(verifyCert(cert, official.nodeId, NOW + 30 * DAY + 1, anchors)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyCert(cert, official.nodeId, NOW + 30 * DAY + 1, anchors, DAY).ok).toBe(true);
  });

  it('honours the deny-list by serial and by key', () => {
    const cert = issue();
    expect(verifyCert(cert, official.nodeId, NOW, { ...anchors, revokedSerials: ['00112233aabbccdd'] })).toEqual({ ok: false, reason: 'revoked' });
    expect(verifyCert(cert, official.nodeId, NOW, { ...anchors, revokedKeys: [toBase64(official.sign.publicKey)] })).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects correctly signed bodies that are not in canonical form', () => {
    const body = { v: 1 as const, sn: '00112233aabbccdd', pk: toBase64(official.sign.publicKey), name: 'Urząd', nbf: NOW, exp: NOW + DAY };
    const canonical = serializeCertBody(body);
    expect(verifyCert(signRaw(canonical), official.nodeId, NOW, anchors).ok).toBe(true);

    const bad = [
      canonical.replace('{', '{ '), // whitespace
      canonical.replace('"name":"Urząd"', '"name":"Urząd","name":"Inny"'), // duplicate key
      canonical.replace('}', ',"admin":true}'), // extra field
      JSON.stringify({ sn: body.sn, v: 1, pk: body.pk, name: body.name, nbf: body.nbf, exp: body.exp }), // key order
      serializeCertBody({ ...body, name: 'Urząd‮' }), // bidi override in the name
      serializeCertBody({ ...body, name: ' Urząd' }),
      serializeCertBody({ ...body, name: 'x'.repeat(49) }),
      serializeCertBody({ ...body, sn: 'XYZ' }),
      serializeCertBody({ ...body, exp: body.nbf }),
      serializeCertBody({ ...body, pk: 'AAAA' }),
      canonical.replace(`"exp":${body.exp}`, '"exp":1e400'),
      '[]',
      'null',
    ];
    for (const b of bad) expect(verifyCert(signRaw(b), official.nodeId, NOW, anchors)).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects anything that is not a certificate string', () => {
    for (const junk of [undefined, null, 42, '', 'MC1:CERT:', 'https://example.com/?MC1:CERT:AAAA.BBBB', identityQr(toBase64(official.sign.publicKey)), ` ${issue()}`]) {
      expect(verifyCert(junk, official.nodeId, NOW, anchors)).toEqual({ ok: false, reason: 'format' });
    }
  });

  it('makes the CA script refuse unsafe input', () => {
    expect(() => issue({ name: '' })).toThrow();
    expect(() => issue({ name: 'x'.repeat(49) })).toThrow();
    expect(() => issue({ notAfter: NOW - DAY * 365 })).toThrow();
    expect(() => issue({ serial: 'nope' })).toThrow();
    // Control and bidi characters never reach the certificate.
    const cleaned = verifyCert(issue({ name: 'Urząd‮\u0007 Gminy' }), official.nodeId, NOW, anchors);
    expect(cleaned.ok && cleaned.cert.name).toBe('Urząd Gminy');
  });

  it('protects the root key at rest with the passphrase', () => {
    const seed = new Uint8Array(32).fill(7);
    const file = ca.encryptSeed(seed, 'correct horse battery');
    expect(JSON.stringify(file)).not.toContain(toBase64(seed));
    expect(toHex(ca.decryptSeed(file, 'correct horse battery'))).toBe(toHex(seed));
    expect(() => ca.decryptSeed(file, 'wrong passphrase')).toThrow();
  });
});

describe('identity QR', () => {
  it('round-trips a signing key to its node id', () => {
    expect(parseIdentityQr(identityQr(toBase64(official.sign.publicKey)))?.nodeId).toBe(official.nodeId);
  });

  it('accepts nothing but the exact format', () => {
    const code = identityQr(toBase64(official.sign.publicKey));
    for (const junk of [
      `${code}:Urząd Miasta`, // a nick smuggled after the key
      ` ${code}`,
      code.toLowerCase(),
      `https://evil.example/${code}`,
      'MC1:ID:AAAA',
      issue(),
      '',
      null,
      undefined,
      7,
    ]) {
      expect(parseIdentityQr(junk)).toBeNull();
    }
  });
});
