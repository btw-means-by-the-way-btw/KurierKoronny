import { create } from 'zustand';

import { checkPeerCert, readPeerCert } from '../services/crypto/authorities';
import type { CertResult } from '../services/crypto/cert';
import { createIdentity, type IdentityLoad, loadIdentity } from '../services/crypto/identity';
import { resetDatabase } from '../services/storage/db';
import { KV_KEYS, kv } from '../services/storage/kv';

export const NICK_MAX = 24;

/** Office name and expiry from the authority certificate installed on this device. */
export interface OwnAuthority {
  name: string;
  exp: number;
}

interface IdentityState {
  /** 'lost' = the key seed existed once but cannot be read any more (see crypto/identity). */
  status: 'loading' | 'ready' | 'lost';
  /** Persistent id of this device in the mesh, derived from its signing key. */
  nodeId: string;
  /** X25519 box public key (base64), announced to the mesh for end-to-end encryption. */
  publicKey: string;
  /** Ed25519 signing public key (base64) – the identity itself; shown as QR for verification. */
  signPublicKey: string;
  nick: string | null;
  /** Authority certificate issued to this device, if any (may have expired – check `authority.exp`). */
  cert: string | null;
  authority: OwnAuthority | null;
  permissionsAcknowledged: boolean;
  load: () => void;
  setNick: (nick: string) => void;
  setPermissionsAcknowledged: () => void;
  /** Stores a certificate after verifying it was issued to this device by a trusted root. */
  installCert: (cert: string) => CertResult;
  removeCert: () => void;
  /** Creates a brand-new identity and wipes the local database. Only after explicit user consent. */
  reset: () => Promise<void>;
}

export const validateNick = (raw: string): string | null => {
  const nick = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (nick.length < 2) return 'Nick musi mieć co najmniej 2 znaki.';
  if (nick.length > NICK_MAX) return `Nick może mieć maksymalnie ${NICK_MAX} znaki.`;
  return null;
};

/** Store fields for a loaded identity, including the certificate kept in kv (if still acceptable). */
function fromLoad(id: IdentityLoad) {
  if (id.status === 'lost') {
    return { status: 'lost' as const, nodeId: '', publicKey: '', signPublicKey: '', cert: null, authority: null };
  }
  const cert = kv.get(KV_KEYS.cert);
  // An expired certificate is kept (so the UI can say "expired"), anything else invalid is dropped.
  const checked = cert ? readPeerCert(cert, id.nodeId) : null;
  return {
    status: 'ready' as const,
    nodeId: id.nodeId,
    publicKey: id.boxPublicKey,
    signPublicKey: id.signPublicKey,
    cert: checked ? cert : null,
    authority: checked ? { name: checked.name, exp: checked.exp } : null,
  };
}

export const useIdentityStore = create<IdentityState>((set, get) => ({
  status: 'loading',
  nodeId: '',
  publicKey: '',
  signPublicKey: '',
  nick: null,
  cert: null,
  authority: null,
  permissionsAcknowledged: false,

  /** Loads identity synchronously; generates the device keys (and the id derived from them) on first launch. */
  load: () => {
    set({
      ...fromLoad(loadIdentity()),
      nick: kv.get(KV_KEYS.nick),
      permissionsAcknowledged: kv.get(KV_KEYS.permissionsAcknowledged) === '1',
    });
  },

  setNick: (nick) => {
    const clean = nick.trim();
    kv.set(KV_KEYS.nick, clean);
    set({ nick: clean });
  },

  setPermissionsAcknowledged: () => {
    kv.set(KV_KEYS.permissionsAcknowledged, '1');
    set({ permissionsAcknowledged: true });
  },

  installCert: (cert) => {
    const result = checkPeerCert(cert, get().nodeId);
    if (result.ok) {
      kv.set(KV_KEYS.cert, cert);
      set({ cert, authority: { name: result.cert.name, exp: result.cert.exp } });
    }
    return result;
  },

  removeCert: () => {
    kv.remove(KV_KEYS.cert);
    set({ cert: null, authority: null });
  },

  reset: async () => {
    await resetDatabase();
    set(fromLoad(createIdentity()));
  },
}));

/** True while this device holds an authority certificate that has not expired. */
export const selectIsAuthority = (s: Pick<IdentityState, 'authority'>, now = Date.now()) =>
  !!s.authority && s.authority.exp >= now;
