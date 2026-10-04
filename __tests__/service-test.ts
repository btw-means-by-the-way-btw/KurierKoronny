import nacl from 'tweetnacl';

import * as ca from '../scripts/authority-ca';
import type { Link } from '../src/services/ble/LinkManager';
import { identityQr, parseIdentityQr } from '../src/services/crypto/cert';
import { deriveIdentity, type IdentityKeys } from '../src/services/crypto/keys';
import type { MeshPacket } from '../src/services/mesh/packet';
import type { ChatMessage, Conversation } from '../src/store/types';
import { Emitter } from '../src/utils/Emitter';
import { toBase64, toHex, utf8Decode } from '../src/utils/bytes';

/**
 * End-to-end tests of the application layer: several complete nodes (MeshService + router +
 * stores + crypto), each in its own module registry, talking over an in-memory "radio".
 * Only the device-bound edges are replaced: BLE links, SecureStore/SQLite and the native module.
 */

jest.setTimeout(120_000);

// babel-preset-expo leaves `import()` alone, so the isolated registries are filled with require().
declare const require: (id: string) => unknown;

const nodeCrypto = jest.requireActual('crypto');
const root = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(201));

class FakeLinks extends Emitter<{
  linkUp: [Link];
  linkDown: [Link];
  packet: [Link, Uint8Array];
  nearbyChanged: [unknown[]];
  radioChanged: [unknown];
}> {
  links = new Map<string, Link>();
  remotes = new Map<string, FakeLinks>();
  /** Number of upcoming transmissions that get lost on the air (the sender still sees success). */
  drop = 0;

  start() {}
  async stop() {}
  rescan() {}
  setBackground() {}
  getRadio = () => ({ bluetooth: 'PoweredOn', scanning: false, advertising: true, peripheralSupported: true, error: null });
  getLinks = () => [...this.links.values()];
  getLink = (id: string) => this.links.get(id);

  async send(linkId: string, raw: Uint8Array) {
    const remote = this.remotes.get(linkId);
    if (!remote || !this.links.has(linkId)) return false;
    if (this.drop > 0) {
      this.drop--;
      return true;
    }
    setTimeout(() => {
      const link = remote.links.get(linkId);
      if (link) remote.emit('packet', link, raw.slice());
    }, 1);
    return true;
  }

  bindPeer(linkId: string, _me: string, peerNodeId: string, nick: string) {
    const link = this.links.get(linkId);
    if (!link) return false;
    if (link.peerNodeId) return link.peerNodeId === peerNodeId;
    link.peerNodeId = peerNodeId;
    link.peerNick = nick;
    return true;
  }

  closeLink(linkId: string) {
    const link = this.links.get(linkId);
    if (!link) return;
    this.links.delete(linkId);
    this.emit('linkDown', link);
  }

  penalize(linkId: string) {
    this.closeLink(linkId);
  }
}

let linkCounter = 0;
function connect(a: TestNode, b: TestNode) {
  const id = `link${++linkCounter}`;
  for (const [self, other] of [
    [a.links, b.links],
    [b.links, a.links],
  ]) {
    self.links.set(id, { id, kind: 'central', address: id, mtu: 517, connectedAt: Date.now() });
    self.remotes.set(id, other);
  }
  a.links.emit('linkUp', a.links.links.get(id)!);
  b.links.emit('linkUp', b.links.links.get(id)!);
}

function memoryChatRepository() {
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ChatMessage>();
  return {
    listConversations: async () => [...conversations.values()],
    upsertConversation: async (c: Conversation) => void conversations.set(c.id, { ...c }),
    deleteConversation: async (id: string) => void conversations.delete(id),
    listMessages: async (conversationId: string) =>
      [...messages.values()].filter((m) => m.conversationId === conversationId).sort((x, y) => x.timestamp - y.timestamp),
    insertMessage: async (m: ChatMessage) => {
      if (messages.has(m.id)) return false;
      messages.set(m.id, { ...m });
      return true;
    },
    messageExists: async (id: string) => messages.has(id),
    getMessage: async (id: string) => messages.get(id) ?? null,
    updateStatus: async (id: string, status: ChatMessage['status'], deliveredCount?: number) => {
      const m = messages.get(id);
      if (m) messages.set(id, { ...m, status, deliveredCount: deliveredCount ?? m.deliveredCount });
    },
    listUnacknowledged: async (since: number) =>
      [...messages.values()]
        .filter((m) => m.direction === 'out' && m.timestamp >= since)
        .filter((m) => m.status === 'sending' || m.status === 'sent' || m.status === 'waiting')
        .sort((x, y) => x.timestamp - y.timestamp)
        .map((m) => ({ ...m })),
    failPendingMessages: async (before: number) => {
      for (const m of messages.values()) {
        const pending = m.status === 'sending' || m.status === 'sent' || m.status === 'waiting';
        if (pending && m.timestamp < before) messages.set(m.id, { ...m, status: 'failed' });
      }
    },
    clearAll: async () => {
      conversations.clear();
      messages.clear();
    },
    messages,
  };
}

interface TestNode {
  id: string;
  nick: string;
  keys: IdentityKeys;
  links: FakeLinks;
  repo: ReturnType<typeof memoryChatRepository>;
  service: (typeof import('../src/services/mesh/MeshService'))['MeshService'];
  contacts: (typeof import('../src/store/contactsStore'))['useContactsStore'];
  trustLevel: (typeof import('../src/store/contactsStore'))['trustLevel'];
  verify: (typeof import('../src/store/verifyStore'))['useVerifyStore'];
  alerts: (typeof import('../src/store/alertStore'))['useAlertStore'];
  chats: (typeof import('../src/store/chatStore'))['useChatStore'];
  identity: (typeof import('../src/store/identityStore'))['useIdentityStore'];
  /** This node's own crypto / packet modules (module state is per node). */
  e2e: typeof import('../src/services/crypto/e2e');
  packet: typeof import('../src/services/mesh/packet');
  /** Delivers an AppState change to this node's MeshService. */
  appState: (state: 'active' | 'background') => void;
}

const nodes: TestNode[] = [];

/** Boots one complete node in an isolated module registry. */
async function boot(seedByte: number, nick: string): Promise<TestNode> {
  const keys = deriveIdentity(new Uint8Array(32).fill(seedByte));
  const links = new FakeLinks();
  const repo = memoryChatRepository();
  const kvData = new Map<string, string>([['identity.nick', nick]]);
  let node!: TestNode;

  jest.isolateModules(() => {
    jest.doMock('../src/utils/random', () => ({
      randomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
      randomId: () => nodeCrypto.randomUUID(),
    }));
    jest.doMock('../src/services/crypto/identity', () => ({
      getIdentityKeys: () => keys,
      signBytes: (m: Uint8Array) => nacl.sign.detached(m, keys.sign.secretKey),
      loadIdentity: () => ({
        status: 'ready',
        nodeId: keys.nodeId,
        signPublicKey: toBase64(keys.sign.publicKey),
        boxPublicKey: toBase64(keys.box.publicKey),
      }),
      createIdentity: () => {
        throw new Error('not used in tests');
      },
    }));
    jest.doMock('../src/services/crypto/trustAnchors', () => ({
      TRUST_ANCHORS: { roots: [toBase64(root.publicKey)], revokedSerials: [], revokedKeys: [] },
    }));
    jest.doMock('../src/services/storage/kv', () => ({
      KV_KEYS: {
        identityCreated: 'identity.created',
        cert: 'identity.cert',
        dbCreated: 'db.created',
        nick: 'identity.nick',
        permissionsAcknowledged: 'onboarding.permissionsAcknowledged',
        theme: 'settings.theme',
      },
      kv: {
        get: (k: string) => kvData.get(k) ?? null,
        set: (k: string, v: string) => void kvData.set(k, v),
        remove: (k: string) => void kvData.delete(k),
        keys: () => [...kvData.keys()],
      },
    }));
    jest.doMock('../src/services/storage/db', () => ({
      resetDatabase: async () => {},
      isDatabaseEncrypted: () => true,
      DatabaseKeyError: class DatabaseKeyError extends Error {},
    }));
    jest.doMock('../src/services/storage/chatRepository', () => ({ chatRepository: repo }));
    jest.doMock('../src/services/storage/contactsRepository', () => ({
      contactsRepository: { list: async () => [], upsert: async () => {} },
    }));
    jest.doMock('../src/services/storage/alertRepository', () => ({
      alertRepository: { list: async () => [], replaceAll: async () => {} },
    }));
    jest.doMock('../src/services/ble/LinkManager', () => ({
      LinkManager: function LinkManager() {
        return links;
      },
    }));
    jest.doMock('../modules/mesh-peripheral', () => ({
      __esModule: true,
      default: { startForegroundService() {}, stopForegroundService() {}, updateForegroundService() {} },
    }));
    jest.doMock('react-native-ble-plx', () => ({ State: { Unknown: 'Unknown', PoweredOn: 'PoweredOn' } }));
    jest.doMock('expo-local-authentication', () => ({
      SecurityLevel: { NONE: 0 },
      getEnrolledLevelAsync: async () => 3,
      authenticateAsync: async () => ({ success: true }),
    }));

    const { MeshService } = require('../src/services/mesh/MeshService') as typeof import('../src/services/mesh/MeshService');
    const { useContactsStore, trustLevel } = require('../src/store/contactsStore') as typeof import('../src/store/contactsStore');
    const { useVerifyStore } = require('../src/store/verifyStore') as typeof import('../src/store/verifyStore');
    const { useAlertStore } = require('../src/store/alertStore') as typeof import('../src/store/alertStore');
    const { useChatStore } = require('../src/store/chatStore') as typeof import('../src/store/chatStore');
    const { useIdentityStore } = require('../src/store/identityStore') as typeof import('../src/store/identityStore');
    const e2e = require('../src/services/crypto/e2e') as typeof import('../src/services/crypto/e2e');
    const packet = require('../src/services/mesh/packet') as typeof import('../src/services/mesh/packet');
    const { AppState } = require('react-native') as { AppState: { addEventListener: jest.Mock } };
    useIdentityStore.getState().load();
    node = {
      id: keys.nodeId,
      nick,
      keys,
      links,
      repo,
      service: MeshService,
      contacts: useContactsStore,
      trustLevel,
      verify: useVerifyStore,
      alerts: useAlertStore,
      chats: useChatStore,
      identity: useIdentityStore,
      e2e,
      packet,
      // MeshService registers its listener in start(); the registry's AppState is a jest mock.
      appState: (state) => {
        const listener = AppState.addEventListener.mock.calls.filter(([event]) => event === 'change').at(-1)?.[1];
        listener(state);
      },
    };
  });

  await node.service.start();
  nodes.push(node);
  return node;
}

const settle = (ms = 3_000) => jest.advanceTimersByTimeAsync(ms);
const trust = (on: TestNode, of: TestNode) => on.trustLevel(on.contacts.getState(), of.id);
const messagesOn = (n: TestNode) => [...n.repo.messages.values()];

/** The code currently on `owner`'s screen (or the bare public key when no offer is open). */
const codeOn = (owner: TestNode) =>
  identityQr(toBase64(owner.keys.sign.publicKey), owner.verify.getState().machine.offer?.token);

/**
 * `scanner` reads `code` on the verify screen of its conversation with `conversationPeer`.
 * Returns the app's verdict and whether the owner of the code confirmed.
 */
function scan(scanner: TestNode, conversationPeer: TestNode, code: string) {
  const outcome = scanner.service.scanVerificationCode(conversationPeer.id, code);
  const confirmed = outcome.result === 'match' && outcome.confirmation ? outcome.confirmation : Promise.resolve(null);
  return { result: outcome.result, confirmed };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_800_000_000_000);
});

afterEach(async () => {
  for (const n of nodes.splice(0)) await n.service.stop();
  jest.useRealTimers();
  jest.resetModules();
});

describe('1:1 messages between two complete nodes', () => {
  it('are encrypted on the wire, delivered through a relay and acknowledged', async () => {
    const [alice, relay, bob] = [await boot(1, 'Alicja'), await boot(2, 'Relay'), await boot(3, 'Bob')];
    connect(alice, relay);
    connect(relay, bob);
    await settle(5_000);

    const wire: Uint8Array[] = [];
    relay.links.on('packet', (_l, raw) => wire.push(raw));

    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    expect(await alice.service.sendMessage(conversationId, 'Zbiórka o 15:00 pod szkołą')).toEqual({ ok: true });
    await settle();

    const received = messagesOn(bob);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ text: 'Zbiórka o 15:00 pod szkołą', senderId: alice.id, senderNick: 'Alicja', authority: null });
    expect(messagesOn(alice)[0]).toMatchObject({ status: 'delivered' });
    // The relay carried it but stored nothing and never saw the text.
    expect(messagesOn(relay)).toHaveLength(0);
    expect(wire.length).toBeGreaterThan(0);
    for (const raw of wire) expect(utf8Decode(raw)).not.toContain('Zbiórka');
    // Nobody is verified just because they talked.
    expect(trust(bob, alice)).toBe('unverified');
  });
});

describe('messages to a recipient who is out of range', () => {
  /** Chat packets of `from` for `to`, as they arrive on the links of `at` – every transmission counts. */
  function chatPacketsAt(at: TestNode, from: TestNode, to = at) {
    const packets: MeshPacket[] = [];
    at.links.on('packet', (_l, raw) => {
      const p = at.packet.decodePacket(raw);
      if (p?.type === at.packet.PacketType.Chat && p.origin === from.id && p.destination === to.id) packets.push(p);
    });
    return packets;
  }
  /** The two nodes walk out of each other's range. */
  function disconnect(a: TestNode, b: TestNode) {
    for (const [id, remote] of a.links.remotes) {
      if (remote !== b.links) continue;
      a.links.closeLink(id);
      b.links.closeLink(id);
    }
  }
  const statusesOn = (n: TestNode) => messagesOn(n).map((m) => m.status);

  it('wait at the sender and are delivered exactly once when the recipient shows up', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    const arrived = chatPacketsAt(bob, alice);
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Jestem cała, idę do babci');
    await settle(40_000);
    // The quick retries are over, but the message is not given up on.
    expect(statusesOn(alice)).toEqual(['waiting']);

    await settle(10 * 60_000);
    expect(statusesOn(alice)).toEqual(['waiting']);
    connect(alice, bob);
    await settle(5_000);
    expect(messagesOn(bob)).toMatchObject([{ text: 'Jestem cała, idę do babci', senderId: alice.id }]);
    expect(statusesOn(alice)).toEqual(['delivered']);

    // Acknowledged means done: the following cycles send nothing more.
    await settle(3 * 60_000);
    expect(arrived).toHaveLength(1);
    // Re-sent as a flood: the route to somebody who has just come back may be stale.
    expect(arrived[0].flags & alice.packet.PacketFlags.ForceFlood).toBeTruthy();
  });

  it('are sent again by the next cycle when a re-send got lost', async () => {
    const [alice, relay, bob] = [await boot(1, 'Alicja'), await boot(2, 'Relay'), await boot(3, 'Bob')];
    connect(alice, relay);
    await settle(5_000);
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Spotkajmy się przy moście');
    await settle(40_000);
    expect(statusesOn(alice)).toEqual(['waiting']);

    // Bob joins the mesh. The packet Alice sends on seeing him is lost on the air.
    alice.links.drop = 1;
    connect(relay, bob);
    await settle(5_000);
    expect(alice.links.drop).toBe(0);
    expect(messagesOn(bob)).toHaveLength(0);
    expect(statusesOn(alice)).toEqual(['waiting']);
    // Bob is in the node list now: further traffic from the mesh triggers nothing, only the cycle does.
    relay.service.setNick('Przekaźnik');
    await settle(5_000);
    expect(messagesOn(bob)).toHaveLength(0);

    await settle(60_000);
    expect(messagesOn(bob)).toMatchObject([{ text: 'Spotkajmy się przy moście' }]);
    expect(statusesOn(alice)).toEqual(['delivered']);
  });

  it('are not transmitted while the recipient is not in the node list', async () => {
    const [alice, relay, bob] = [await boot(1, 'Alicja'), await boot(2, 'Relay'), await boot(3, 'Bob')];
    connect(alice, relay);
    connect(relay, bob);
    await settle(5_000);
    // Bob walks away; two minutes later his route has expired on Alice's phone (she keeps his key).
    disconnect(relay, bob);
    await settle(2 * 60_000);

    const onAir = chatPacketsAt(relay, alice, bob);
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Gdzie jesteś?');
    await settle(40_000);
    expect(statusesOn(alice)).toEqual(['waiting']);
    expect(onAir).toHaveLength(4); // the quick series
    await settle(5 * 60_000);
    expect(onAir).toHaveLength(4);

    connect(relay, bob);
    await settle(5_000);
    expect(onAir).toHaveLength(5);
    expect(messagesOn(bob)).toMatchObject([{ text: 'Gdzie jesteś?' }]);
    expect(statusesOn(alice)).toEqual(['delivered']);
  });

  it('are given up after 24 hours, and can still be sent again by hand', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Wracam jutro');
    await settle(24 * 3_600_000 - 60_000);
    expect(statusesOn(alice)).toEqual(['waiting']);
    await settle(3 * 60_000);
    expect(statusesOn(alice)).toEqual(['failed']);

    // Too late for the automatic delivery …
    connect(alice, bob);
    await settle(2 * 60_000);
    expect(messagesOn(bob)).toHaveLength(0);
    // … but a tap on the bubble still sends it – and with Bob gone again it waits anew.
    disconnect(alice, bob);
    await alice.service.resend(messagesOn(alice)[0].id);
    await settle(40_000);
    expect(statusesOn(alice)).toEqual(['waiting']);
    connect(alice, bob);
    await settle(5_000);
    expect(messagesOn(bob)).toMatchObject([{ text: 'Wracam jutro' }]);
    expect(statusesOn(alice)).toEqual(['delivered']);
  });

  it('survive a restart of the sender', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Pierwsza');
    await settle(40_000);
    // The second one is still in its quick retries when the app goes away.
    await alice.service.sendMessage(conversationId, 'Druga');
    await settle(1_000);
    expect(statusesOn(alice)).toEqual(['waiting', 'sending']);

    await alice.service.stop();
    await alice.service.start();
    expect(statusesOn(alice)).toEqual(['waiting', 'waiting']);

    await settle(60_000);
    connect(alice, bob);
    await settle(5_000);
    expect(messagesOn(bob).map((m) => m.text)).toEqual(['Pierwsza', 'Druga']);
    expect(statusesOn(alice)).toEqual(['delivered', 'delivered']);
  });

  it('count their 24 hours from the writing, also across a restart', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Wczorajsza');
    await settle(23 * 3_600_000);
    await alice.service.stop();
    await alice.service.start();
    expect(statusesOn(alice)).toEqual(['waiting']);
    await settle(61 * 60_000);
    expect(statusesOn(alice)).toEqual(['failed']);
  });

  it('are given up on start when the app comes back more than 24 hours later', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    connect(alice, bob);
    await settle(5_000);
    alice.links.drop = 1_000; // Bob is in range, but nothing of Alice's gets through to him
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Czekająca');
    await settle(40_000);
    await alice.service.sendMessage(conversationId, 'Oddana sąsiadowi');
    await settle(1_000);
    disconnect(alice, bob);
    await alice.service.sendMessage(conversationId, 'W trakcie ponowień');
    await settle(1_000);
    expect(statusesOn(alice)).toEqual(['waiting', 'sent', 'sending']);

    await alice.service.stop();
    await settle(24 * 3_600_000);
    await alice.service.start();
    expect(statusesOn(alice)).toEqual(['failed', 'failed', 'failed']);
  });

  it('are no longer transmitted once their conversation is deleted', async () => {
    const [alice, bob, carol] = [await boot(1, 'Alicja'), await boot(3, 'Bob'), await boot(4, 'Karol')];
    const toBob = await alice.service.openDirectConversation(bob.id, 'Bob');
    const toCarol = await alice.service.openDirectConversation(carol.id, 'Karol');
    await alice.service.sendMessage(toBob, 'Do Boba');
    await alice.service.sendMessage(toCarol, 'Do Karola');
    await settle(40_000);
    expect(statusesOn(alice)).toEqual(['waiting', 'waiting']);

    await alice.service.deleteConversation(toBob);
    const arrived = chatPacketsAt(bob, alice);
    connect(alice, bob);
    connect(alice, carol);
    await settle(3 * 60_000);
    expect(arrived).toHaveLength(0);
    expect(messagesOn(bob)).toHaveLength(0);
    // The other conversation is not affected.
    expect(messagesOn(carol)).toMatchObject([{ text: 'Do Karola' }]);
  });

  it('are all delivered, oldest first, when twenty of them waited', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    const arrived = chatPacketsAt(bob, alice);
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    const texts = Array.from({ length: 20 }, (_, i) => `Wiadomość ${i + 1}`);
    for (const text of texts) {
      expect(await alice.service.sendMessage(conversationId, text)).toEqual({ ok: true });
      await settle(1_000); // the sender's own anti-flood limit
    }
    await settle(35_000);
    expect(statusesOn(alice)).toEqual(texts.map(() => 'waiting'));

    // Bob takes about one chat packet per second from one sender, so they go out paced – which
    // takes long enough for a 60 s cycle to come round in the middle.
    connect(alice, bob);
    await settle(30_000);
    expect(messagesOn(bob).map((m) => m.text)).toEqual(texts);
    expect(statusesOn(alice)).toEqual(texts.map(() => 'delivered'));
    // None was refused, none was transmitted a second time, and no two came closer than a second.
    expect(arrived).toHaveLength(20);
    const gaps = arrived.slice(1).map((p, i) => p.timestamp - arrived[i].timestamp);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1_000);
  });

  it('go out without a pause when the recipient shows up while the app is in the background', async () => {
    // The sender is booted last: appState() reaches the listener of the node that started last.
    const [bob, alice] = [await boot(3, 'Bob'), await boot(1, 'Alicja')];
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    const texts = Array.from({ length: 5 }, (_, i) => `Wiadomość ${i + 1}`);
    for (const text of texts) await alice.service.sendMessage(conversationId, text);
    await settle(40_000);
    expect(statusesOn(alice)).toEqual(texts.map(() => 'waiting'));

    // React Native fires no JS timers in the background: a pause after the first message would never end.
    alice.appState('background');
    connect(alice, bob);
    await settle(500);
    expect(messagesOn(bob).map((m) => m.text)).toEqual(texts);
    expect(statusesOn(alice)).toEqual(texts.map(() => 'delivered'));
  });

  it('reach a recipient who shows up while the messages for somebody else are going out', async () => {
    const [alice, bob, carol] = [await boot(1, 'Alicja'), await boot(3, 'Bob'), await boot(4, 'Karol')];
    const toCarol = await alice.service.openDirectConversation(carol.id, 'Karol');
    const toBob = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(toCarol, 'Do Karola');
    for (const text of ['Do Boba 1', 'Do Boba 2', 'Do Boba 3']) await alice.service.sendMessage(toBob, text);
    await settle(40_000);

    connect(alice, bob);
    await settle(1_000);
    // Bob's messages are still going out, one at a time – Karol does not have to wait for the next cycle.
    connect(alice, carol);
    await settle(5_000);
    expect(messagesOn(carol)).toMatchObject([{ text: 'Do Karola' }]);
    expect(messagesOn(bob).map((m) => m.text)).toEqual(['Do Boba 1', 'Do Boba 2', 'Do Boba 3']);
    expect(statusesOn(alice)).toEqual(['delivered', 'delivered', 'delivered', 'delivered']);
  });

  it('keep the time they were written, which a message sent right away does not carry', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(3, 'Bob')];
    const arrived = chatPacketsAt(bob, alice);
    const plainOf = (p: MeshPacket) =>
      bob.e2e.openJson(alice.id, bob.packet.decodeJson(p.payload)) as Record<string, unknown>;
    const conversationId = await alice.service.openDirectConversation(bob.id, 'Bob');
    await alice.service.sendMessage(conversationId, 'Napisana rano');
    const writtenAt = messagesOn(alice)[0].timestamp;
    await settle(10 * 60_000);
    connect(alice, bob);
    await settle(5_000);
    // The packet is stamped when it is sent; the time of writing travels inside the ciphertext.
    expect(arrived[0].timestamp).toBeGreaterThan(writtenAt + 9 * 60_000);
    expect(plainOf(arrived[0]).s).toBe(writtenAt);
    expect(messagesOn(bob)[0].timestamp).toBe(writtenAt);
    // The conversation list goes by the arrival: what has just come in belongs on top.
    expect(bob.chats.getState().conversations[0].lastMessageAt).toBe(arrived[0].timestamp);

    await alice.service.sendMessage(conversationId, 'Wysłana od razu');
    await settle();
    expect(Object.keys(plainOf(arrived[1]))).toEqual(['y', 'id', 'n', 't', 'from', 'to']);
    expect(messagesOn(bob)[1].timestamp).toBe(arrived[1].timestamp);

    // A claimed time is believed only within the waiting limit, and never as later than the packet.
    type Originate = (type: number, destination: string, payload: Uint8Array) => Promise<number>;
    const router = (alice.service as unknown as { router: { originate: Originate } }).router;
    const sentAt = Date.now();
    const claims = [sentAt + 30_000, sentAt - 26 * 3_600_000, sentAt - 1_000.5, String(writtenAt)];
    const believed = sentAt - 24 * 3_600_000; // a message that waited the whole day
    for (const [i, s] of [...claims, believed].entries()) {
      const plain = { y: 'm', id: `claim-${i}`, n: 'Alicja', t: 'Zegar', from: alice.id, to: bob.id, s };
      const forged = alice.packet.encodeJson(alice.e2e.sealJson(bob.id, plain));
      await router.originate(alice.packet.PacketType.Chat, bob.id, forged);
    }
    await settle();
    expect(messagesOn(bob).slice(2).map((m) => m.timestamp)).toEqual([...claims.map(() => sentAt), believed]);
  });
});

describe('one-scan mutual verification', () => {
  it('verifies both sides when the peer scans a code opened from the chat with them', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(2, 'Bob')];
    connect(alice, bob);
    await settle();
    await alice.service.openDirectConversation(bob.id, 'Bob');
    await bob.service.openDirectConversation(alice.id, 'Alicja');

    bob.service.openVerificationOffer(alice.id);
    const { result, confirmed } = scan(alice, bob, codeOn(bob));
    await settle(500);

    expect(result).toBe('match');
    await expect(confirmed).resolves.toBe(true);
    expect(trust(alice, bob)).toBe('verified');
    expect(trust(bob, alice)).toBe('verified');
    expect(bob.verify.getState().outcome).toMatchObject({ kind: 'verified', peerId: alice.id, by: alice.id });
    expect(bob.verify.getState().machine.offer).toBeNull(); // single use
    expect(bob.contacts.getState().contacts[alice.id].nick).toBe('Alicja');
  });

  it('does not verify an onlooker who read the code, and tells the owner', async () => {
    const [alice, bob, mallory] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(66, 'Alicja')];
    connect(alice, bob);
    connect(mallory, bob);
    await settle();
    await bob.service.openDirectConversation(alice.id, 'Alicja');

    await alice.service.openDirectConversation(bob.id, 'Bob');
    await mallory.service.openDirectConversation(bob.id, 'Bob');

    bob.service.openVerificationOffer(alice.id);
    const code = codeOn(bob);
    // Mallory photographed the screen and is faster than Alice.
    const stolen = scan(mallory, bob, code);
    await settle(200);
    const honest = scan(alice, bob, code);
    await settle(60_000);

    await expect(stolen.confirmed).resolves.toBe(false);
    await expect(honest.confirmed).resolves.toBe(false);
    expect(trust(bob, mallory)).toBe('unverified');
    expect(trust(bob, alice)).toBe('unverified');
    expect(bob.verify.getState().outcome).toMatchObject({ kind: 'conflict', peerId: alice.id, by: mallory.id });
    // Each scanner did check Bob's key with its own camera – that part stands on their phones.
    expect(trust(alice, bob)).toBe('verified');
  });

  it('undoes the verification of an impostor chat when the real person scans the same code', async () => {
    // Bob has been chatting with "Alicja" who is really Mallory, and opens the code from that chat.
    const [alice, bob, mallory] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(66, 'Alicja')];
    connect(alice, bob);
    connect(mallory, bob);
    await settle();
    await bob.service.openDirectConversation(mallory.id, 'Alicja');
    await alice.service.openDirectConversation(bob.id, 'Bob');
    await mallory.service.openDirectConversation(bob.id, 'Bob');

    bob.service.openVerificationOffer(mallory.id);
    const code = codeOn(bob);
    const impostor = scan(mallory, bob, code);
    await settle(500);
    await expect(impostor.confirmed).resolves.toBe(true);
    expect(trust(bob, mallory)).toBe('verified');

    // The person actually standing there scans the code (still on Bob's screen) with her own phone.
    const real = scan(alice, bob, code);
    await settle(60_000);

    expect(real.result).toBe('match');
    await expect(real.confirmed).resolves.toBe(false);
    expect(trust(bob, mallory)).toBe('unverified');
    expect(trust(bob, alice)).toBe('unverified');
    expect(bob.verify.getState().outcome).toMatchObject({ kind: 'conflict', peerId: mallory.id, by: alice.id });
  });

  it('raises the conflict even when the scanner is talking to the impostor too', async () => {
    // Full man in the middle: Alice's chat "Bob" and Bob's chat "Alicja" are both Mallory's node.
    const [alice, bob, mallory] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(66, 'Alicja')];
    connect(alice, bob);
    connect(mallory, bob);
    connect(mallory, alice);
    await settle();
    await bob.service.openDirectConversation(mallory.id, 'Alicja');
    await alice.service.openDirectConversation(mallory.id, 'Bob');
    await mallory.service.openDirectConversation(bob.id, 'Bob');

    bob.service.openVerificationOffer(mallory.id);
    const code = codeOn(bob);
    const impostor = scan(mallory, bob, code);
    await settle(500);
    await expect(impostor.confirmed).resolves.toBe(true);
    expect(trust(bob, mallory)).toBe('verified');

    // Alice scans from her chat with "Bob" (really Mallory): the key does not match, she is
    // warned – and her phone still tells the owner of the code that it was read.
    const real = scan(alice, mallory, code);
    await settle(5_000);

    expect(real.result).toBe('mismatch');
    expect(trust(alice, mallory)).toBe('unverified');
    expect(trust(alice, bob)).toBe('unverified');
    expect(trust(bob, mallory)).toBe('unverified');
    expect(bob.verify.getState().outcome).toMatchObject({ kind: 'conflict', peerId: mallory.id, by: alice.id });
  });

  it('keeps an older verification, and only that, when an onlooker shows up after the honest scan', async () => {
    const [alice, bob, mallory] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(66, 'Ktoś')];
    connect(alice, bob);
    connect(mallory, bob);
    await settle();
    await bob.service.openDirectConversation(alice.id, 'Alicja');
    await alice.service.openDirectConversation(bob.id, 'Bob');
    await mallory.service.openDirectConversation(bob.id, 'Bob');
    const lastWeek = Date.now() - 7 * 86_400_000;
    bob.service.markVerified(alice.id, lastWeek);

    bob.service.openVerificationOffer(alice.id);
    const code = codeOn(bob);
    await settle(100);
    const honest = scan(alice, bob, code);
    await settle(500);
    await expect(honest.confirmed).resolves.toBe(true);
    expect(bob.contacts.getState().contacts[alice.id].verifiedAt).toBeGreaterThan(lastWeek);

    scan(mallory, bob, code);
    await settle(1_000);
    // The code no longer counts, but what Bob checked himself last week does.
    expect(bob.verify.getState().outcome).toMatchObject({ kind: 'conflict', peerId: alice.id, by: mallory.id });
    expect(bob.contacts.getState().contacts[alice.id].verifiedAt).toBe(lastWeek);
    expect(trust(bob, mallory)).toBe('unverified');
  });

  it('never overrides what the user decided by hand after the code was accepted', async () => {
    const [alice, bob, mallory] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(66, 'Ktoś')];
    connect(alice, bob);
    connect(mallory, bob);
    await settle();
    await bob.service.openDirectConversation(alice.id, 'Alicja');
    await alice.service.openDirectConversation(bob.id, 'Bob');
    await mallory.service.openDirectConversation(bob.id, 'Bob');
    bob.service.markVerified(alice.id, Date.now() - 7 * 86_400_000);

    // Undo wins: neither a late conflict nor a retry brings the badge back.
    bob.service.openVerificationOffer(alice.id);
    const first = codeOn(bob);
    const accepted = scan(alice, bob, first);
    await settle(500);
    await expect(accepted.confirmed).resolves.toBe(true);
    bob.service.clearVerification(alice.id);
    scan(mallory, bob, first);
    await settle(1_000);
    expect(trust(bob, alice)).toBe('unverified');
    expect(bob.verify.getState().outcome).toBeNull();

    // An own scan wins too: a conflict only undoes the timestamp the code itself wrote.
    bob.service.openVerificationOffer(alice.id);
    const second = codeOn(bob);
    scan(alice, bob, second);
    await settle(500);
    jest.advanceTimersByTime(1_000);
    bob.service.markVerified(alice.id); // Bob scanned Alice's key himself in the meantime
    scan(mallory, bob, second);
    await settle(1_000);
    expect(bob.verify.getState().outcome).toMatchObject({ kind: 'conflict' });
    expect(trust(bob, alice)).toBe('verified');
  });

  it('gets through when the first proof or the first acknowledgement is lost', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(2, 'Bob')];
    connect(alice, bob);
    await settle();
    await bob.service.openDirectConversation(alice.id, 'Alicja');
    await alice.service.openDirectConversation(bob.id, 'Bob');

    // The proof itself is lost: the retry four seconds later lands.
    bob.service.openVerificationOffer(alice.id);
    alice.links.drop = 1;
    const lostProof = scan(alice, bob, codeOn(bob));
    await settle(1_000);
    expect(trust(bob, alice)).toBe('unverified');
    await settle(5_000);
    await expect(lostProof.confirmed).resolves.toBe(true);
    expect(trust(bob, alice)).toBe('verified');

    // The acknowledgement is lost: Bob answers the repeated proof again without changing anything.
    await settle(70_000);
    const since = bob.contacts.getState().contacts[alice.id].verifiedAt;
    bob.service.openVerificationOffer(alice.id);
    bob.links.drop = 1;
    const lostAck = scan(alice, bob, codeOn(bob));
    await settle(1_000);
    const granted = bob.contacts.getState().contacts[alice.id].verifiedAt;
    expect(granted).toBeGreaterThan(since!);
    await settle(5_000);
    await expect(lostAck.confirmed).resolves.toBe(true);
    expect(bob.contacts.getState().contacts[alice.id].verifiedAt).toBe(granted);
  });

  it('does not let a third node confirm on behalf of the owner of the code', async () => {
    const [alice, bob, mallory] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(66, 'Ktoś')];
    connect(alice, bob);
    connect(mallory, alice);
    await settle();
    await alice.service.openDirectConversation(bob.id, 'Bob');

    // Bob's code was withdrawn, so he will never confirm. Mallory knows the token and tries to.
    bob.service.openVerificationOffer(alice.id);
    const code = codeOn(bob);
    const token = parseIdentityQr(code)!.token!;
    bob.service.closeVerificationOffer();
    const outcome = scan(alice, bob, code);
    await settle(500);
    const forged = mallory.e2e.sealJson(alice.id, { y: 'a', id: token, from: mallory.id, to: alice.id });
    expect(forged).not.toBeNull();
    const router = (mallory.service as unknown as { router: { originate: (t: number, d: string, p: Uint8Array) => Promise<number> } }).router;
    await router.originate(mallory.packet.PacketType.Ack, alice.id, mallory.packet.encodeJson(forged));
    await settle(60_000);

    await expect(outcome.confirmed).resolves.toBe(false);
  });

  it('accepts no proof once the code was withdrawn, expired, or the app went to the background', async () => {
    const [alice, bob] = [await boot(1, 'Alicja'), await boot(2, 'Bob')];
    connect(alice, bob);
    await settle();
    await bob.service.openDirectConversation(alice.id, 'Alicja');

    bob.service.openVerificationOffer(alice.id);
    const shown = bob.verify.getState().machine.offer!.token;
    bob.appState('background');
    expect(bob.verify.getState().machine.offer).toBeNull();
    bob.appState('active');
    const afterBackground = alice.service.sendVerificationProof(bob.id, shown);
    await settle(60_000);
    await expect(afterBackground).resolves.toBe(false);

    bob.service.openVerificationOffer(alice.id);
    const token = bob.verify.getState().machine.offer!.token;
    bob.service.closeVerificationOffer();
    const late = alice.service.sendVerificationProof(bob.id, token);
    await settle(60_000);
    await expect(late).resolves.toBe(false);

    bob.service.openVerificationOffer(alice.id);
    const second = bob.verify.getState().machine.offer!.token;
    await settle(3 * 60_000); // longer than the code lives
    const expired = alice.service.sendVerificationProof(bob.id, second);
    await settle(60_000);
    await expect(expired).resolves.toBe(false);
    expect(trust(bob, alice)).toBe('unverified');
    expect(bob.verify.getState().outcome).toBeNull();
  });

  it('treats the public key code as a one-sided check, and rejects anything that is not a key', async () => {
    const [alice, bob, carol] = [await boot(1, 'Alicja'), await boot(2, 'Bob'), await boot(4, 'Karol')];
    connect(alice, bob);
    await settle();
    await alice.service.openDirectConversation(bob.id, 'Bob');

    expect(alice.service.scanVerificationCode(bob.id, 'https://example.com/MC1:ID:abc').result).toBe('not_a_key');
    expect(alice.service.scanVerificationCode(bob.id, codeOn(carol)).result).toBe('mismatch');
    expect(trust(alice, bob)).toBe('unverified');

    // Bob shows the code from Settings → Mój klucz: no token, nothing to send back.
    const plain = alice.service.scanVerificationCode(bob.id, codeOn(bob));
    expect(plain).toEqual({ result: 'match', confirmation: null });
    await settle();
    expect(trust(alice, bob)).toBe('verified');
    expect(trust(bob, alice)).toBe('unverified');

    alice.service.clearVerification(bob.id);
    expect(trust(alice, bob)).toBe('unverified');
  });
});

describe('authority accounts', () => {
  const certify = (node: TestNode, name: string) =>
    ca.issueCert(root.secretKey, {
      devicePublicKey: node.keys.sign.publicKey,
      name,
      notBefore: Date.now() - 3_600_000,
      notAfter: Date.now() + 30 * 86_400_000,
      serial: toHex(new Uint8Array(8).fill(9)),
    }).cert;

  it('reach everyone with an alert and are marked official in private messages', async () => {
    const [office, relay, citizen] = [await boot(10, 'dyzurny'), await boot(2, 'Relay'), await boot(3, 'Ola')];
    await expect(office.service.installCert(certify(office, 'Urząd Miasta – WZK'))).resolves.toEqual({
      ok: true,
      name: 'Urząd Miasta – WZK',
    });
    connect(office, relay);
    connect(relay, citizen);
    await settle(5_000);

    await expect(office.service.sendAlert('Ewakuacja', 'Punkt zbiórki: szkoła nr 3', 6 * 3_600_000)).resolves.toEqual({ ok: true });
    await settle();
    for (const n of [relay, citizen]) {
      expect(n.alerts.getState().alerts).toMatchObject([
        { origin: office.id, authority: 'Urząd Miasta – WZK', headline: 'Ewakuacja', cancelled: false },
      ]);
      expect(trust(n, office)).toBe('official');
    }

    const conversationId = await office.service.openDirectConversation(citizen.id, 'Ola');
    await office.service.sendMessage(conversationId, 'Proszę zostać w domu.');
    await settle();
    expect(messagesOn(citizen)).toMatchObject([{ text: 'Proszę zostać w domu.', authority: 'Urząd Miasta – WZK' }]);
    // The conversation is named after the certificate, not after the self-chosen nick.
    expect(citizen.chats.getState().conversations[0].title).toBe('Urząd Miasta – WZK');

    const [alert] = office.alerts.getState().alerts;
    await expect(office.service.cancelAlert(alert.id)).resolves.toEqual({ ok: true });
    await settle();
    expect(citizen.alerts.getState().alerts).toMatchObject([{ id: alert.id, cancelled: true }]);
  });

  it('are recognised from their announces alone, and stay recognised between two certificates', async () => {
    const [office, relay, citizen] = [await boot(10, 'dyzurny'), await boot(2, 'Relay'), await boot(3, 'Ola')];
    await office.service.installCert(certify(office, 'Urząd Miasta – WZK'));
    connect(office, relay);
    connect(relay, citizen);
    await settle(5_000);
    // No alert and no message yet: the certificate came with the announce that follows the handshake.
    for (const n of [relay, citizen]) expect(trust(n, office)).toBe('official');

    // The announces of the next 90 s carry no certificate – that must not take the badge away.
    await settle(90_000);
    for (const n of [relay, citizen]) expect(trust(n, office)).toBe('official');
  });

  it('cannot be claimed without a certificate for this very device', async () => {
    const [citizen, other] = [await boot(3, 'Urząd Miasta'), await boot(10, 'dyzurny')];
    await expect(citizen.service.sendAlert('Fałszywy', '', 3_600_000)).resolves.toEqual({ ok: false, reason: 'not_authority' });
    // A certificate issued to somebody else's key is refused.
    await expect(citizen.service.installCert(certify(other, 'Urząd Miasta'))).resolves.toEqual({ ok: false, reason: 'subject' });
    // So is one signed by a key the app does not trust.
    const rogueRoot = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(77));
    const rogue = ca.issueCert(rogueRoot.secretKey, {
      devicePublicKey: citizen.keys.sign.publicKey,
      name: 'Urząd Miasta',
      notBefore: Date.now() - 1,
      notAfter: Date.now() + 86_400_000,
      serial: '00000000000000aa',
    }).cert;
    await expect(citizen.service.installCert(rogue)).resolves.toEqual({ ok: false, reason: 'signature' });
    expect(citizen.identity.getState().authority).toBeNull();

    // A nick that sounds official earns no badge.
    connect(citizen, other);
    await settle();
    expect(trust(other, citizen)).toBe('unverified');
  });
});
