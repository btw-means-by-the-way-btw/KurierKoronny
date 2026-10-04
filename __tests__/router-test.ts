import nacl from 'tweetnacl';

import * as ca from '../scripts/authority-ca';
import { fragment } from '../src/services/ble/fragmenter';
import type { Link, LinkManager } from '../src/services/ble/LinkManager';
import { CERT_NAME_MAX, TrustAnchors, verifyCert } from '../src/services/crypto/cert';
import { deriveIdentity } from '../src/services/crypto/keys';
import { ALERT_RELAY_GRACE_MS, alertDigest, applyAlert, StoredAlert, wantsAlert } from '../src/services/mesh/alertPolicy';
import { AlertSink, CERT_EVERY, FRESHNESS_MS, MeshRouter } from '../src/services/mesh/MeshRouter';
import {
  AlertPayload,
  AnnouncePayload,
  BROADCAST_ID,
  decodeJson,
  decodePacket,
  encodeJson,
  encodePacket,
  HelloPayload,
  MeshPacket,
  PacketType,
  PROTOCOL_VERSION,
} from '../src/services/mesh/packet';
import { Emitter } from '../src/utils/Emitter';
import { toBase64, toHex } from '../src/utils/bytes';

// Minutes of simulated mesh traffic are replayed with real Ed25519 signatures – slow on a busy machine.
jest.setTimeout(60_000);

jest.mock('../src/utils/random', () => {
  const crypto = jest.requireActual('crypto');
  return {
    randomBytes: (n: number) => new Uint8Array(crypto.randomBytes(n)),
    randomId: () => crypto.randomUUID(),
  };
});

/**
 * In-memory stand-in for the BLE layer: links are pairs of queues, delivery takes 1 ms.
 * Only what MeshRouter uses from LinkManager is implemented.
 */
class FakeLinks extends Emitter<{ linkUp: [Link]; linkDown: [Link]; packet: [Link, Uint8Array] }> {
  links = new Map<string, Link>();
  remotes = new Map<string, FakeLinks>();
  penalized: string[] = [];
  sent: Uint8Array[] = [];
  /** Number of upcoming transmissions that get lost on the air (the sender still sees success). */
  drop = 0;
  /** Number of upcoming transmissions the radio refuses (the sender sees the failure). */
  fail = 0;

  getLinks = () => [...this.links.values()];
  getLink = (id: string) => this.links.get(id);

  async send(linkId: string, raw: Uint8Array) {
    const remote = this.remotes.get(linkId);
    if (!remote || !this.links.has(linkId)) return false;
    if (this.fail > 0) {
      this.fail--;
      return false;
    }
    this.sent.push(raw.slice());
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
    this.penalized.push(linkId);
    this.closeLink(linkId);
  }
}

let linkCounter = 0;
function connect(a: FakeLinks, b: FakeLinks): string {
  const id = `link${++linkCounter}`;
  for (const [self, other] of [
    [a, b],
    [b, a],
  ]) {
    const link: Link = { id, kind: 'central', address: id, mtu: 517, connectedAt: Date.now() };
    self.links.set(id, link);
    self.remotes.set(id, other);
  }
  a.emit('linkUp', a.links.get(id)!);
  b.emit('linkUp', b.links.get(id)!);
  return id;
}

const root = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(200));
const anchors: TrustAnchors = { roots: [toBase64(root.publicKey)], revokedSerials: [], revokedKeys: [] };
const routers: MeshRouter[] = [];

function makeNode(seedByte: number, opts: { authority?: string; nick?: string } = {}) {
  const keys = deriveIdentity(new Uint8Array(32).fill(seedByte));
  const signer = { publicKey: keys.sign.publicKey, sign: (m: Uint8Array) => nacl.sign.detached(m, keys.sign.secretKey) };
  const cert = opts.authority
    ? ca.issueCert(root.secretKey, {
        devicePublicKey: keys.sign.publicKey,
        name: opts.authority,
        notBefore: Date.now() - 3_600_000,
        notAfter: Date.now() + 30 * 86_400_000,
        serial: toHex(new Uint8Array(8).fill(seedByte)),
      }).cert
    : null;
  const nick = opts.nick ?? `node${seedByte}`;
  const links = new FakeLinks();
  const state = { alerts: [] as StoredAlert[] };
  const delivered: MeshPacket[] = [];
  const peers = new Map<string, { boxKey: unknown; cert: unknown; nick: string }>();
  /** Like the application layer: a certificate once seen stays known (`peers` only holds the latest packet). */
  const certs = new Map<string, unknown>();

  const sink: AlertSink = {
    wants: (origin, id, timestamp, cancelled) => wantsAlert(state.alerts, { origin, id, timestamp, cancelled }),
    accept: (packet, alert, raw) => {
      const checked = verifyCert(alert.c, packet.origin, Date.now(), anchors, ALERT_RELAY_GRACE_MS);
      if (!checked.ok) return false;
      const next = applyAlert(state.alerts, {
        origin: packet.origin,
        id: alert.id,
        timestamp: packet.timestamp,
        exp: alert.exp,
        headline: alert.h,
        text: alert.t,
        authority: checked.cert.name,
        certExp: checked.cert.exp,
        cancelled: alert.x === true,
        raw,
      });
      if (next === state.alerts) return false;
      state.alerts = next;
      return true;
    },
    digest: () => alertDigest(state.alerts),
    packets: () => state.alerts.map((a) => a.raw),
  };

  const router = new MeshRouter(
    links as unknown as LinkManager,
    { nodeId: keys.nodeId, nick, publicKey: toBase64(keys.box.publicKey), cert, signer },
    {
      onPeerInfo: (origin, info) => {
        peers.set(origin, info);
        if (info.cert !== undefined) certs.set(origin, info.cert);
      },
      alerts: sink,
    }
  );
  router.on('deliver', (p) => delivered.push(p));
  router.start(30_000);
  routers.push(router);

  /** Signs a packet as this node with arbitrary header fields – what a modified app could send. */
  const craft = (fields: Partial<MeshPacket> & Pick<MeshPacket, 'type' | 'destination'>, payload: unknown = {}) =>
    encodePacket(
      {
        version: PROTOCOL_VERSION,
        ttl: 1,
        hops: 0,
        flags: 0,
        packetId: toHex(jest.requireActual('crypto').randomBytes(8)),
        origin: keys.nodeId,
        seq: Math.floor(Date.now() / 1000) + 1_000_000,
        timestamp: Date.now(),
        payload: encodeJson(payload),
        ...fields,
      },
      signer
    );

  return { id: keys.nodeId, keys, signer, cert, links, router, delivered, peers, certs, state, craft };
}

const settle = (ms = 2_500) => jest.advanceTimersByTimeAsync(ms);
/** Packets of one type authored by `node`, as it handed them to its links (lost ones included). */
const sentBy = <T>(node: ReturnType<typeof makeNode>, type: PacketType) =>
  node.links.sent.flatMap((raw) => {
    const p = decodePacket(raw);
    return p?.type === type && p.origin === node.id ? [{ raw, payload: decodeJson<T>(p.payload)! }] : [];
  });
const alertOf = (node: ReturnType<typeof makeNode>, o: Partial<AlertPayload> = {}): AlertPayload => ({
  id: 'alert-1',
  h: 'Ewakuacja',
  t: 'Punkt zbiórki: szkoła nr 3',
  exp: Date.now() + 6 * 3_600_000,
  c: node.cert ?? 'none',
  ...o,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_800_000_000_000);
});

afterEach(() => {
  routers.splice(0).forEach((r) => r.stop());
  jest.useRealTimers();
});

describe('link handshake', () => {
  it('authenticates both ends before any traffic flows', async () => {
    const a = makeNode(1);
    const b = makeNode(2);
    const link = connect(a.links, b.links);
    await settle();

    expect(a.links.getLink(link)?.peerNodeId).toBe(b.id);
    expect(b.links.getLink(link)?.peerNodeId).toBe(a.id);
    expect(a.router.getNodes().map((n) => n.nodeId)).toEqual([b.id]);
    expect(a.peers.get(b.id)?.boxKey).toBe(toBase64(b.keys.box.publicKey));
    expect(a.router.stats.forged).toBe(0);
  });

  it('carries nothing but HELLO on a link whose peer has not proved its identity', async () => {
    const b = makeNode(2);
    const silent = new FakeLinks(); // connects but never answers the challenge
    const stranger = makeNode(9); // only used to sign a perfectly valid announce
    const link = connect(silent, b.links);

    await silent.send(link, stranger.craft({ type: PacketType.Announce, destination: BROADCAST_ID, ttl: 5 }, { n: 'x', k: 'y' }));
    await settle(100);
    expect(b.router.getNodes()).toEqual([]);
    expect(b.peers.size).toBe(0);

    // …and the link is closed once the handshake deadline passes.
    await settle(16_000);
    expect(b.links.getLink(link)).toBeUndefined();
  });

  it('does not bind a link to a replayed HELLO', async () => {
    const a = makeNode(1);
    const b = makeNode(2);
    connect(a.links, b.links);
    await settle();
    const recordedHellos = a.links.sent.filter((raw) => raw[1] === PacketType.Hello);
    expect(recordedHellos.length).toBeGreaterThan(0);

    // Mallory replays everything A ever said in a handshake to a third node.
    const c = makeNode(3);
    const mallory = new FakeLinks();
    const link = connect(mallory, c.links);
    for (const raw of recordedHellos) await mallory.send(link, raw);
    await settle(1_000);

    expect(c.links.getLink(link)?.peerNodeId).toBeUndefined();
    expect(c.router.getNodes()).toEqual([]);
  });
});

describe('packet authentication on every hop', () => {
  it('delivers a directed packet through a relay that cannot be the recipient', async () => {
    const [a, b, c] = [makeNode(1), makeNode(2), makeNode(3)];
    connect(a.links, b.links);
    connect(b.links, c.links);
    await settle(4_000);

    await a.router.originate(PacketType.Chat, c.id, encodeJson({ sealed: true }));
    await settle(500);

    expect(c.delivered).toHaveLength(1);
    expect(c.delivered[0]).toMatchObject({ origin: a.id, destination: c.id, hops: 1 });
    expect(b.delivered).toHaveLength(0);
  });

  it('drops forged packets at the first hop and cuts the forger off', async () => {
    const [victim, mallory, b, c] = [makeNode(1), makeNode(66), makeNode(2), makeNode(3)];
    const link = connect(mallory.links, b.links);
    connect(b.links, c.links);
    await settle(4_000);

    // 1) Mallory's own key, the victim's id.
    await mallory.links.send(link, mallory.craft({ type: PacketType.Chat, destination: c.id, origin: victim.id, ttl: 7 }));
    // 2) The victim's public key in the trailer – but Mallory cannot produce the signature.
    const withVictimKey = mallory.craft({ type: PacketType.Chat, destination: c.id, origin: victim.id, ttl: 7 });
    withVictimKey.set(victim.keys.sign.publicKey, withVictimKey.length - 96);
    await mallory.links.send(link, withVictimKey);
    // 3) A genuine packet of Mallory's, altered after signing.
    const altered = mallory.craft({ type: PacketType.Chat, destination: c.id, ttl: 7 }, { text: 'a' });
    altered[60] ^= 0xff;
    await mallory.links.send(link, altered);
    await settle(500);

    expect(c.delivered).toHaveLength(0);
    expect(c.router.stats.received).toBeGreaterThan(0); // c did get b's announces…
    expect(c.router.stats.forged).toBe(0); // …but none of the forgeries
    expect(b.router.stats.forged).toBe(3);
    expect(b.links.penalized).toEqual([link]);
    expect(b.links.getLink(link)).toBeUndefined();
  });

  it('refuses broadcast content from ordinary nodes', async () => {
    const [m, b, c] = [makeNode(66), makeNode(2), makeNode(3)];
    const link = connect(m.links, b.links);
    connect(b.links, c.links);
    await settle(4_000);
    const relayedBefore = b.router.stats.relayed;

    await m.links.send(link, m.craft({ type: PacketType.Chat, destination: BROADCAST_ID, ttl: 7 }, { t: 'spam' }));
    await settle(500);

    expect(b.delivered).toHaveLength(0);
    expect(c.delivered).toHaveLength(0);
    expect(b.router.stats.relayed).toBe(relayedBefore);
  });

  it('rejects replays and stale packets', async () => {
    const [a, b] = [makeNode(1), makeNode(2)];
    const link = connect(a.links, b.links);
    await settle();

    const chat = a.craft({ type: PacketType.Chat, destination: b.id, ttl: 7 });
    await a.links.send(link, chat);
    await a.links.send(link, chat);
    await settle(100);
    expect(b.delivered).toHaveLength(1);

    // Still refused long after, when the freshness window has passed.
    await settle(FRESHNESS_MS + 60_000);
    await a.links.send(link, chat);
    // A packet signed with an old or a future timestamp is refused as well.
    await a.links.send(link, a.craft({ type: PacketType.Chat, destination: b.id, ttl: 7, timestamp: Date.now() - FRESHNESS_MS - 1_000 }));
    await a.links.send(link, a.craft({ type: PacketType.Chat, destination: b.id, ttl: 7, timestamp: Date.now() + FRESHNESS_MS + 1_000 }));
    await settle(100);
    expect(b.delivered).toHaveLength(1);
  });

  it('refuses a packet whose ttl was raised beyond what its type allows', async () => {
    const [a, b] = [makeNode(1), makeNode(2)];
    const link = connect(a.links, b.links);
    await settle();
    await a.links.send(link, a.craft({ type: PacketType.Chat, destination: b.id, ttl: 200 }));
    await settle(100);
    expect(b.delivered).toHaveLength(0);
  });
});

describe('authority alerts', () => {
  it('spread hop by hop and reach nodes that join later', async () => {
    const [office, b, c] = [makeNode(10, { authority: 'Urząd Miasta' }), makeNode(2), makeNode(3)];
    connect(office.links, b.links);
    connect(b.links, c.links);
    await settle(4_000);

    expect(office.router.publishAlert(alertOf(office))).toBe(true);
    await settle(1_000);
    for (const node of [office, b, c]) {
      expect(node.state.alerts).toHaveLength(1);
      expect(node.state.alerts[0]).toMatchObject({ origin: office.id, authority: 'Urząd Miasta', headline: 'Ewakuacja' });
    }

    // A phone that was not in the mesh at the time gets it from whoever it meets first.
    const late = makeNode(4);
    connect(c.links, late.links);
    await settle(4_000);
    expect(late.state.alerts).toHaveLength(1);

    // …and passes it on in turn: two islands merge beyond the border node.
    const island = makeNode(5);
    connect(late.links, island.links);
    await settle(4_000);
    expect(island.state.alerts).toHaveLength(1);
  });

  it('are refused from nodes without a certificate of their own', async () => {
    const [office, m, b, c] = [makeNode(10, { authority: 'Urząd Miasta' }), makeNode(66), makeNode(2), makeNode(3)];
    const link = connect(m.links, b.links);
    connect(b.links, c.links);
    await settle(4_000);

    // Through the normal API: the node's own store refuses.
    expect(m.router.publishAlert(alertOf(m))).toBe(false);
    // A modified app: no certificate, then the office's certificate copied from the air.
    const exp = Date.now() + 3_600_000;
    await m.links.send(link, m.craft({ type: PacketType.Alert, destination: BROADCAST_ID }, { id: 'f1', h: 'Fałszywy', t: '', exp, c: 'MC1:CERT:AAAA.BBBB' }));
    await m.links.send(link, m.craft({ type: PacketType.Alert, destination: BROADCAST_ID }, { id: 'f2', h: 'Fałszywy', t: '', exp, c: office.cert }));
    await settle(1_000);

    expect(b.state.alerts).toHaveLength(0);
    expect(c.state.alerts).toHaveLength(0);
  });

  it('can be cancelled, and the original packet cannot bring them back', async () => {
    const [office, b, c] = [makeNode(10, { authority: 'Urząd Miasta' }), makeNode(2), makeNode(3)];
    const link = connect(office.links, b.links);
    connect(b.links, c.links);
    await settle(4_000);

    const alert = alertOf(office);
    office.router.publishAlert(alert);
    await settle(1_000);
    const original = office.state.alerts[0].raw;

    await settle(60_000);
    expect(office.router.publishAlert({ ...alert, t: '', x: true })).toBe(true);
    await settle(1_000);
    for (const node of [office, b, c]) expect(node.state.alerts).toMatchObject([{ id: 'alert-1', cancelled: true }]);

    await office.links.send(link, original);
    await settle(1_000);
    for (const node of [b, c]) expect(node.state.alerts).toMatchObject([{ id: 'alert-1', cancelled: true }]);
  });
});

describe('authority certificate', () => {
  // The longest office name and the longest nick allowed, counted in characters (a nick of three-byte
  // characters adds 43 bytes: still one frame).
  const OFFICE = 'Wojewódzkie Centrum Zarządzania Kryzysowego Łódź';
  const NICK = 'Dyżurny WZK Łódź-Górna 2';
  const makeOffice = () => makeNode(10, { authority: OFFICE, nick: NICK });
  /** BLE frames a packet takes at the usual MTU. */
  const frames = (raw: Uint8Array) => fragment(raw, 0, 517).length;
  const announcesOf = (node: ReturnType<typeof makeNode>) => sentBy<AnnouncePayload>(node, PacketType.Announce);
  const certify = (node: ReturnType<typeof makeNode>, days: number) =>
    ca.issueCert(root.secretKey, {
      devicePublicKey: node.keys.sign.publicKey,
      name: OFFICE,
      notBefore: Date.now() - 3_600_000,
      notAfter: Date.now() + days * 86_400_000,
      serial: toHex(new Uint8Array(8).fill(days)),
    }).cert;

  it('is not sent in HELLO, which fits one BLE frame', async () => {
    expect([OFFICE.length, NICK.length]).toEqual([CERT_NAME_MAX, 24]);
    const [office, b] = [makeOffice(), makeNode(2)];
    const link = connect(office.links, b.links);
    await settle();

    const hellos = sentBy<HelloPayload>(office, PacketType.Hello);
    expect(hellos.map((h) => h.payload.re !== undefined)).toEqual([false, true]); // the bare one and the reply
    for (const hello of hellos) {
      expect(hello.payload.c).toBeUndefined();
      expect(frames(hello.raw)).toBe(1);
    }
    expect(office.links.getLink(link)?.peerNodeId).toBe(b.id);
    expect(b.links.getLink(link)?.peerNodeId).toBe(office.id);
  });

  it('follows a handshake in an announce, and otherwise travels only in every fourth one', async () => {
    const [office, b] = [makeOffice(), makeNode(2)];
    connect(office.links, b.links);
    await settle();
    expect(b.certs.get(office.id)).toBe(office.cert);
    expect(announcesOf(office).map((a) => a.payload.c)).toEqual([office.cert]);

    for (let i = 1; i < CERT_EVERY; i++) {
      await settle(30_000);
      const announces = announcesOf(office);
      expect(announces).toHaveLength(1 + i);
      expect(announces[i].payload.c).toBeUndefined();
      expect(frames(announces[i].raw)).toBe(1);
    }
    await settle(30_000);
    expect(announcesOf(office)).toHaveLength(1 + CERT_EVERY);
    expect(announcesOf(office)[CERT_EVERY].payload.c).toBe(office.cert);

    // A neighbour that turns up between two repeats does not wait for the next one.
    const late = makeNode(3);
    connect(office.links, late.links);
    await settle();
    expect(late.certs.get(office.id)).toBe(office.cert);
  });

  it('stays due when the announce that carried it could not be sent', async () => {
    const [office, b] = [makeOffice(), makeNode(2)];
    connect(office.links, b.links);
    await settle();
    for (let i = 1; i < CERT_EVERY; i++) await settle(30_000);
    expect(announcesOf(office)).toHaveLength(CERT_EVERY);
    office.links.fail = 1; // the announce with the certificate does not leave the phone
    await settle(30_000);
    expect(office.links.fail).toBe(0);
    expect(announcesOf(office)).toHaveLength(CERT_EVERY);
    await settle(30_000);
    expect(announcesOf(office).at(-1)!.payload.c).toBe(office.cert);
  });

  it('reaches a node that joined two hops away with the periodic repeat, not before', async () => {
    const [office, b, c] = [makeOffice(), makeNode(2), makeNode(3)];
    connect(office.links, b.links);
    await settle(28_000);
    connect(b.links, c.links);
    // The office's next announce gets through to c – without the certificate.
    await settle(5_000);
    expect(c.router.getNode(office.id)?.hops).toBe(2);
    expect(c.certs.has(office.id)).toBe(false);

    await settle(CERT_EVERY * 30_000);
    expect(c.certs.get(office.id)).toBe(office.cert);
  });

  it('waits for a neighbour when installed without one, and is announced at once when renewed', async () => {
    const [office, b] = [makeNode(10), makeNode(2)];
    const first = certify(office, 30);
    office.router.setCert(first);
    await settle(1_000);
    expect(office.links.sent).toHaveLength(0);

    connect(office.links, b.links);
    await settle();
    expect(announcesOf(office).map((a) => a.payload.c)).toEqual([first]);
    expect(b.certs.get(office.id)).toBe(first);

    const renewed = certify(office, 60);
    office.router.setCert(renewed);
    await settle(100);
    expect(b.certs.get(office.id)).toBe(renewed);
  });

  it('is still accepted from the HELLO of a neighbour running an older version', async () => {
    const b = makeNode(2);
    const old = makeOffice(); // only signs – the handshake below is what the older version sends
    const radio = new FakeLinks();
    const link = connect(radio, b.links);
    const { ch } = sentBy<HelloPayload>(b, PacketType.Hello)[0].payload;

    const hello: HelloPayload = {
      n: NICK,
      k: toBase64(old.keys.box.publicKey),
      ch: toBase64(new Uint8Array(16).fill(7)),
      re: ch,
      ad: alertDigest([]),
      c: old.cert!,
    };
    await radio.send(link, old.craft({ type: PacketType.Hello, destination: b.id }, hello));
    await settle(100);

    expect(b.links.getLink(link)?.peerNodeId).toBe(old.id);
    expect(b.certs.get(old.id)).toBe(old.cert);
  });

  it('is repeated for a neighbour that bound the link late because a HELLO was lost', async () => {
    const [office, b] = [makeOffice(), makeNode(2)];
    const link = connect(office.links, b.links);
    office.links.drop = 1; // the office's bare HELLO is out; next comes its reply to b's
    await settle();
    const hellos = sentBy<HelloPayload>(office, PacketType.Hello);
    expect(hellos.map((h) => h.payload.re !== undefined)).toEqual([false, true]);
    // The office bound the link and announced, but b – still waiting for the reply – refused it.
    expect(announcesOf(office)).toHaveLength(1);
    expect(b.links.getLink(link)?.peerNodeId).toBeUndefined();
    expect(b.certs.has(office.id)).toBe(false);

    // b asks again 3 s after the first HELLO; this time the reply arrives, and the certificate after it.
    await settle();
    expect(b.links.getLink(link)?.peerNodeId).toBe(office.id);
    expect(b.certs.get(office.id)).toBe(office.cert);
    expect(announcesOf(office)).toHaveLength(2);

    // More HELLOs on the same link are all answered, but make the office flood only as often as an
    // honest neighbour can ask before its handshake deadline: four times, one of them used above.
    for (let i = 0; i < 6; i++) {
      const bare = { n: 'node2', k: toBase64(b.keys.box.publicKey), ch: toBase64(new Uint8Array(16).fill(i)) };
      await b.links.send(link, b.craft({ type: PacketType.Hello, destination: BROADCAST_ID }, bare));
    }
    await settle();
    expect(sentBy(office, PacketType.Hello)).toHaveLength(9);
    expect(announcesOf(office)).toHaveLength(5);
  });

  it('is repeated again when the reply to the repeated HELLO is lost as well', async () => {
    const [office, b] = [makeOffice(), makeNode(2)];
    const link = connect(office.links, b.links);
    office.links.drop = 1;
    await settle();
    office.links.drop = 1; // b asks again at 3 s – that reply is lost too
    await settle();
    // The repeat that followed it was refused like the first announce: b is still not bound.
    expect(announcesOf(office)).toHaveLength(2);
    expect(b.links.getLink(link)?.peerNodeId).toBeUndefined();
    expect(b.certs.has(office.id)).toBe(false);

    // The third reply (6 s) arrives, and the certificate once more after it.
    await settle();
    expect(b.links.getLink(link)?.peerNodeId).toBe(office.id);
    expect(b.certs.get(office.id)).toBe(office.cert);
  });

  it('refused by the announce rate limit is made up for by the next repeat', async () => {
    const [office, b] = [makeOffice(), makeNode(2)];
    const link = connect(office.links, b.links);
    await settle(100); // bound; the announce with the certificate is still to come
    // Two plain announces use up what b takes from this origin. They carry the office's current
    // sequence number: the default of craft() would make its real announces look stale.
    const { seq } = decodePacket(office.links.sent.at(-1)!)!;
    const header = { type: PacketType.Announce, destination: BROADCAST_ID, ttl: 5, seq };
    const plain = { n: NICK, k: toBase64(office.keys.box.publicKey) };
    for (let i = 0; i < 2; i++) await office.links.send(link, office.craft(header, plain));
    await settle(5_000);
    expect(announcesOf(office).filter((a) => a.payload.c)).toHaveLength(1);
    expect(b.certs.has(office.id)).toBe(false);

    await settle(CERT_EVERY * 30_000);
    expect(b.certs.get(office.id)).toBe(office.cert);
  });
});
