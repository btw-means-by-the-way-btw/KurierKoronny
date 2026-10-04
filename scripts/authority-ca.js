#!/usr/bin/env node
/**
 * Offline certificate authority for Mesh Chat authority ("government") accounts.
 *
 *   node scripts/authority-ca.js init
 *       Creates the root key. The secret half is encrypted with a passphrase and written to
 *       ca/root.key (git-ignored); the public half is added to the app's trust anchors
 *       (src/services/crypto/authority-roots.json). Rebuild the app afterwards.
 *
 *   node scripts/authority-ca.js issue --key <MC1:ID:… | 64 hex digits> --name "<office>" [--days 30]
 *       Issues a certificate for one device. Prints the fingerprint of the key (compare it with
 *       the official's phone: Ustawienia → Mój klucz), then the certificate as text and as a QR
 *       code to scan in the app (Ustawienia → Konto urzędowe).
 *
 * Run this on a machine that stays offline. Whoever holds ca/root.key and its passphrase can
 * create authority accounts; nothing else in the system can.
 *
 * The certificate format is defined in src/services/crypto/cert.ts – keep the two in sync
 * (__tests__/cert-test.ts checks that certificates issued here verify in the app).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const nacl = require('tweetnacl');

const ROOT = path.join(__dirname, '..');
const KEY_FILE = path.join(ROOT, 'ca', 'root.key');
const LOG_FILE = path.join(ROOT, 'ca', 'issued.log');
const ANCHORS_FILE = path.join(ROOT, 'src', 'services', 'crypto', 'authority-roots.json');

const CERT_DOMAIN = Buffer.from('meshchat-cert-v1', 'utf8');
const NAME_MAX = 48;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const DAY_MS = 86_400_000;
/** Certificates start an hour early so a slightly slow phone clock does not reject them. */
const BACKDATE_MS = 3_600_000;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
// Same set as the app: control, bidi and zero-width characters.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

function nodeIdFromSignKey(publicKey) {
  const h = Buffer.from(nacl.hash(publicKey).subarray(0, 16)).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function fingerprint(nodeId) {
  return nodeId.replace(/-/g, '').toUpperCase().match(/.{4}/g).join(' ');
}

/** Accepts the app's identity code or the hex form shown on "Mój klucz"; nothing else is read from it. */
function parseDeviceKey(input) {
  const text = String(input).trim();
  const id = /^MC1:ID:([A-Za-z0-9+/]{43}=)$/.exec(text);
  let key;
  if (id) {
    key = Buffer.from(id[1], 'base64');
  } else {
    const hex = text.replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Key must be an MC1:ID:… code or 64 hex digits');
    key = Buffer.from(hex, 'hex');
  }
  if (key.length !== nacl.sign.publicKeyLength) throw new Error('Key has the wrong length');
  return new Uint8Array(key);
}

/** Signs a certificate. Pure: all inputs are explicit, so the app's tests can call it. */
function issueCert(rootSecretKey, { devicePublicKey, name, notBefore, notAfter, serial }) {
  const cleanName = String(name).replace(UNSAFE_CHARS, '').trim();
  if (!cleanName || cleanName.length > NAME_MAX) throw new Error(`Name must be 1–${NAME_MAX} characters`);
  if (!Number.isSafeInteger(notBefore) || !Number.isSafeInteger(notAfter) || notBefore >= notAfter) {
    throw new Error('Invalid validity window');
  }
  if (!/^[0-9a-f]{16}$/.test(serial)) throw new Error('Serial must be 16 hex digits');
  // Key order is part of the format – the app re-serialises and compares bytes.
  const body = Buffer.from(
    JSON.stringify({ v: 1, sn: serial, pk: b64(devicePublicKey), name: cleanName, nbf: notBefore, exp: notAfter }),
    'utf8'
  );
  const sig = nacl.sign.detached(new Uint8Array(Buffer.concat([CERT_DOMAIN, body])), rootSecretKey);
  return { cert: `MC1:CERT:${b64(body)}.${b64(sig)}`, name: cleanName };
}

// --- Root key at rest -------------------------------------------------------------------

function encryptSeed(seed, passphrase) {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(nacl.secretbox.nonceLength);
  const key = crypto.scryptSync(passphrase, salt, nacl.secretbox.keyLength, SCRYPT);
  const box = nacl.secretbox(seed, new Uint8Array(nonce), new Uint8Array(key));
  return { v: 1, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: b64(salt), nonce: b64(nonce), box: b64(box) };
}

function decryptSeed(file, passphrase) {
  const key = crypto.scryptSync(passphrase, Buffer.from(file.salt, 'base64'), nacl.secretbox.keyLength, {
    N: file.N,
    r: file.r,
    p: file.p,
    maxmem: SCRYPT.maxmem,
  });
  const seed = nacl.secretbox.open(
    new Uint8Array(Buffer.from(file.box, 'base64')),
    new Uint8Array(Buffer.from(file.nonce, 'base64')),
    new Uint8Array(key)
  );
  if (!seed) throw new Error('Wrong passphrase');
  return seed;
}

/** Reads a line without echoing it. MESHCHAT_CA_PASSPHRASE overrides the prompt (automation, tests). */
function askHidden(question) {
  if (process.env.MESHCHAT_CA_PASSPHRASE) return Promise.resolve(process.env.MESHCHAT_CA_PASSPHRASE);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = () => {};
  });
}

// --- Commands ---------------------------------------------------------------------------

async function init() {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} already exists – refusing to overwrite a root key`);
  const passphrase = await askHidden('New passphrase for the root key (min. 12 characters): ');
  if (passphrase.length < 12) throw new Error('Passphrase too short');
  if ((await askHidden('Repeat passphrase: ')) !== passphrase) throw new Error('Passphrases differ');

  const seed = new Uint8Array(crypto.randomBytes(nacl.sign.seedLength));
  const publicKey = b64(nacl.sign.keyPair.fromSeed(seed).publicKey);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify({ ...encryptSeed(seed, passphrase), publicKey }, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });

  const anchors = JSON.parse(fs.readFileSync(ANCHORS_FILE, 'utf8'));
  if (!anchors.roots.includes(publicKey)) anchors.roots.push(publicKey);
  fs.writeFileSync(ANCHORS_FILE, JSON.stringify(anchors, null, 2) + '\n');

  console.log(`Root key created.\n  secret (encrypted): ${KEY_FILE}\n  public:             ${publicKey}`);
  console.log(`The public key was added to ${path.relative(ROOT, ANCHORS_FILE)} – rebuild the app.`);
  console.log('Keep ca/root.key and the passphrase offline. Losing them means no new certificates; leaking them means anyone can issue them.');
}

async function issue(args) {
  if (!args.key || !args.name) throw new Error('Usage: issue --key <MC1:ID:… | hex> --name "<office>" [--days 30]');
  const days = args.days === undefined ? DEFAULT_DAYS : Number(args.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`--days must be 1–${MAX_DAYS}`);
  const devicePublicKey = parseDeviceKey(args.key);
  const nodeId = nodeIdFromSignKey(devicePublicKey);

  console.log(`\nKey fingerprint:  ${fingerprint(nodeId)}`);
  console.log('Compare ALL groups with the phone (Ustawienia → Mój klucz) before continuing.');
  console.log('Check the person\'s identity and authorisation in person – this is the step that matters.\n');

  const file = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const seed = decryptSeed(file, await askHidden('Root key passphrase: '));
  const now = Date.now();
  const serial = crypto.randomBytes(8).toString('hex');
  const notBefore = now - BACKDATE_MS;
  const notAfter = now + days * DAY_MS;
  const { cert, name } = issueCert(nacl.sign.keyPair.fromSeed(seed).secretKey, {
    devicePublicKey,
    name: args.name,
    notBefore,
    notAfter,
    serial,
  });

  fs.appendFileSync(
    LOG_FILE,
    JSON.stringify({ issuedAt: new Date(now).toISOString(), sn: serial, nodeId, pk: b64(devicePublicKey), name, nbf: notBefore, exp: notAfter }) + '\n'
  );

  console.log(`Issued to:   ${name}`);
  console.log(`Serial:      ${serial}`);
  console.log(`Valid until: ${new Date(notAfter).toISOString()}\n`);
  console.log(cert);
  // Optional dependency: without it the text form above still works (paste it in the app).
  try {
    console.log('\n' + (await require('qrcode').toString(cert, { type: 'terminal', small: true, errorCorrectionLevel: 'L' })));
  } catch {
    console.log('\n(QR code not shown: the "qrcode" package is not installed. Run npm install.)');
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

module.exports = { issueCert, parseDeviceKey, nodeIdFromSignKey, fingerprint, encryptSeed, decryptSeed };

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const run = command === 'init' ? init() : command === 'issue' ? issue(parseArgs(rest)) : null;
  if (!run) {
    console.error('Usage: node scripts/authority-ca.js <init | issue --key … --name … [--days N]>');
    process.exit(2);
  }
  run.catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
}
