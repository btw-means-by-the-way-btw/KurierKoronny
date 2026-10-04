import { create } from 'zustand';

import { peerAuthority } from '../services/crypto/authorities';
import { contactsRepository } from '../services/storage/contactsRepository';
import type { Contact } from './types';

/** How a peer is presented: by certificate, by a key the user checked in person, or not at all. */
export type TrustLevel = 'official' | 'verified' | 'unverified';

export interface PeerAuthority {
  name: string;
  exp: number;
}

interface ContactsState {
  /** Persisted contacts: peers with a conversation, a verification or a certificate. */
  contacts: Record<string, Contact>;
  /** Peers that presented a valid authority certificate (from signature-verified packets). */
  authorities: Record<string, PeerAuthority>;
  load: () => Promise<void>;
  /** Creates or updates a persisted contact. */
  remember: (nodeId: string, patch: Partial<Omit<Contact, 'nodeId' | 'firstSeen'>>) => void;
  /** Records a verified certificate for a peer and persists it. */
  noteAuthority: (nodeId: string, cert: string, info: PeerAuthority, nick: string) => void;
  reset: () => void;
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: {},
  authorities: {},

  load: async () => {
    const list = await contactsRepository.list();
    const contacts: Record<string, Contact> = {};
    const authorities: Record<string, PeerAuthority> = {};
    for (const c of list) {
      contacts[c.nodeId] = c;
      const verified = c.cert ? peerAuthority(c.cert, c.nodeId) : null;
      if (verified) authorities[c.nodeId] = { name: verified.name, exp: verified.exp };
    }
    set({ contacts, authorities });
  },

  remember: (nodeId, patch) => {
    const current: Contact | undefined = get().contacts[nodeId];
    const base: Contact = current ?? {
      nodeId,
      boxKey: null,
      nick: '',
      verifiedAt: null,
      cert: null,
      firstSeen: Date.now(),
    };
    const next: Contact = { ...base, ...patch };
    if (
      current &&
      current.boxKey === next.boxKey &&
      current.nick === next.nick &&
      current.verifiedAt === next.verifiedAt &&
      current.cert === next.cert
    ) {
      return;
    }
    set((s) => ({ contacts: { ...s.contacts, [nodeId]: next } }));
    void contactsRepository.upsert(next).catch((e) => console.error('Contact save failed', e));
  },

  noteAuthority: (nodeId, cert, info, nick) => {
    const known = get().authorities[nodeId];
    if (!known || known.name !== info.name || known.exp !== info.exp) {
      set((s) => ({ authorities: { ...s.authorities, [nodeId]: info } }));
    }
    // The announced nick only fills an empty name – it never renames a contact the user knows.
    get().remember(nodeId, nick && !get().contacts[nodeId]?.nick ? { cert, nick } : { cert });
  },

  reset: () => set({ contacts: {}, authorities: {} }),
}));

export function trustLevel(
  s: Pick<ContactsState, 'contacts' | 'authorities'>,
  nodeId: string | null | undefined,
  now = Date.now()
): TrustLevel {
  if (!nodeId) return 'unverified';
  const authority = s.authorities[nodeId];
  if (authority && authority.exp >= now) return 'official';
  return s.contacts[nodeId]?.verifiedAt ? 'verified' : 'unverified';
}

/** Office name of a peer holding a currently valid certificate, else null. */
export function authorityName(
  s: Pick<ContactsState, 'authorities'>,
  nodeId: string | null | undefined,
  now = Date.now()
): string | null {
  const authority = nodeId ? s.authorities[nodeId] : undefined;
  return authority && authority.exp >= now ? authority.name : null;
}
