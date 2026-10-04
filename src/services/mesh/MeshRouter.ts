import { Emitter } from '../../utils/Emitter';
import { KeyedRateLimiter } from '../../utils/RateLimiter';
import { toBase64, toHex } from '../../utils/bytes';
import { createLogger } from '../../utils/logger';
import { sanitizeNick } from '../../utils/nick';
import { randomBytes } from '../../utils/random';
import { jitter } from '../../utils/time';
import type { Link, LinkManager } from '../ble/LinkManager';
import { isValidAlertPayload, MAX_ALERTS_PER_AUTHORITY } from './alertPolicy';
import { type HandshakeState, newHandshake, onHello } from './handshake';
import {
  AlertPayload,
  AnnouncePayload,
  BROADCAST_ID,
  decodeJson,
  decodePacket,
  DEFAULT_TTL,
  encodeJson,
  encodePacket,
  HelloPayload,
  MeshPacket,
  originMatchesKey,
  PacketFlags,
  PacketSigner,
  PacketType,
  PROTOCOL_VERSION,
  rewriteForHandover,
  rewriteForRelay,
  verifyPacket,
} from './packet';
import { SeenCache } from './SeenCache';

const log = createLogger('Router');

/** How long a node stays in the table without being heard from (announce period x3). */
const ROUTE_TTL_MS = 100_000;
/** A worse route replaces the current one if the current one hasn't been refreshed for this long. */
const ROUTE_STALE_MS = 35_000;
/**
 * Replay protection: packets stamped outside this window (either way) are dropped. HELLO is
 * exempt (its challenge gives freshness) and so are alerts (they carry their own expiry).
 * Must stay below the SeenCache TTL.
 */
export const FRESHNESS_MS = 10 * 60_000;
/** Above this difference to the neighbours' clocks the user is warned (see FRESHNESS_MS). */
export const CLOCK_SKEW_WARN_MS = 3 * 60_000;
const HELLO_RETRY_MS = 3_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
/** How often an honest peer can ask for our HELLO reply again before its own handshake deadline. */
const MAX_CERT_REPEATS = HANDSHAKE_TIMEOUT_MS / HELLO_RETRY_MS - 1;
/** Forged packets tolerated from one neighbour before the link is dropped. */
const MAX_STRIKES = 3;
/** Minimum time between two alert re-syncs towards the same neighbour. */
const ALERT_SYNC_COOLDOWN_MS = 60_000;
/**
 * An authority's certificate travels in every CERT_EVERY-th announce (and in the one that follows
 * a new link). It makes the packet need a second BLE frame, and receivers remember it once seen.
 */
export const CERT_EVERY = 4;

export interface MeshNode {
  nodeId: string;
  nick: string;
  /** Link used to reach the node (the first hop). */
  nextHopLinkId: string;
  hops: number;
  lastSeen: number;
  /** Highest announce sequence number seen – older announces are ignored. */
  lastSeq: number;
  direct: boolean;
}

export interface RouterIdentity {
  nodeId: string;
  nick: string;
  /** Box public key (base64), announced for end-to-end encryption. */
  publicKey: string;
  /** Authority certificate of this device, attached to selected ANNOUNCE packets (see CERT_EVERY). */
  cert: string | null;
  signer: PacketSigner;
}

/** Storage side of authority alerts (implemented by the application layer). */
export interface AlertSink {
  /** Cheap pre-check before any signature work: would this version change the store? */
  wants(origin: string, id: string, timestamp: number, cancelled: boolean): boolean;
  /** Validates (certificate) and stores a signature-verified alert. True if the store changed. */
  accept(packet: MeshPacket, alert: AlertPayload, raw: Uint8Array): boolean;
  digest(): string;
  /** Stored signed packets, for a neighbour whose digest differs. */
  packets(): Uint8Array[];
}

export interface RouterHooks {
  /** Data from a signature-verified HELLO / ANNOUNCE of `origin`. */
  onPeerInfo(origin: string, info: { boxKey: unknown; cert: unknown; nick: string }): void;
  alerts: AlertSink;
}

type RouterEvents = {
  /** A directed packet addressed to us that passed all checks (signature included). */
  deliver: [MeshPacket, Link];
  nodesChanged: [MeshNode[]];
  /** Median difference between the neighbours' clocks and ours (ms), null without neighbours. */
  clockSkew: [number | null];
};

export interface RouterStats {
  received: number;
  relayed: number;
  dropped: number;
  duplicates: number;
  /** Packets with a forged origin or signature. */
  forged: number;
  /** Signature verifications done and the time they took – the main CPU cost of the router. */
  verified: number;
  verifyMs: number;
}

interface Handshake {
  state: HandshakeState;
  retry: ReturnType<typeof setInterval>;
  deadline: ReturnType<typeof setTimeout>;
  /** Peer clock minus ours, sampled from the HELLO that bound the link. */
  skewMs: number | null;
  /** Certificate announces repeated for a peer that bound late (at most MAX_CERT_REPEATS per link). */
  certRepeats: number;
}

/**
 * Network layer of the mesh.
 *
 * Routing strategy — "controlled flooding with opportunistic unicast":
 *  1. Every packet carries a random packetId. Each node processes / relays a packet
 *     at most once (SeenCache) → loops are impossible, cycles in the topology are fine.
 *  2. TTL bounds how far a packet travels; relays decrement it and stop at 1.
 *  3. Announces are flooded to all links except the one they came in on, with a small random
 *     delay so neighbours don't all transmit at the same instant.
 *  4. Periodic ANNOUNCE floods let every node learn, for every origin, which link delivered
 *     that origin's packets with the fewest hops (reverse-path learning, like AODV/DSDV-lite).
 *     Directed packets (DMs, ACKs) are unicast along that next hop; if no route is known
 *     (or the sender sets ForceFlood on a retry) they fall back to flooding.
 *  5. Per-origin sequence numbers make announce processing monotonic (stale announces
 *     that arrive over a longer path are ignored).
 *  6. Token buckets per link and per origin drop floods from misbehaving nodes *before*
 *     they are relayed, so one spammer cannot saturate the whole mesh.
 *
 * Authentication — every hop checks every packet:
 *  7. A packet is accepted only with a valid Ed25519 signature of its origin (packet.ts). Cheap
 *     checks run first and the packet id is remembered only after the signature passed. A forged
 *     packet can only come from the neighbour that sent it (it would not have passed any honest
 *     relay), so repeated forgeries close that link.
 *  8. A link carries nothing but HELLO until the challenge-response handshake (handshake.ts)
 *     proved which node is on the other end.
 *  9. Only ANNOUNCE and ALERT may be broadcast. Alerts need a certificate signed by the root key
 *     and spread store-and-forward: a node hands one on only if it was news to its own store.
 */
export class MeshRouter extends Emitter<RouterEvents> {
  private seen = new SeenCache();
  private routes = new Map<string, MeshNode>();
  private handshakes = new Map<string, Handshake>();
  private strikes = new Map<string, number>();
  private alertSyncAt = new Map<string, number>();
  /** Seeded from wall-clock seconds so it keeps increasing across app restarts. */
  private seq = Math.floor(Date.now() / 1000);
  /** Announces handed to a neighbour since the last one with our certificate (Infinity = none yet). */
  private announcesSinceCert = Infinity;
  private linkLimiter = new KeyedRateLimiter(60, 25); // raw packets per link
  private originLimiter = new KeyedRateLimiter(15, 1); // chat/ack packets per origin
  private announceLimiter = new KeyedRateLimiter(2, 0.2); // announces per origin
  // Authority traffic has its own budget; the burst must cover a full re-sync of one author.
  private alertLimiter = new KeyedRateLimiter(MAX_ALERTS_PER_AUTHORITY * 2, 0.1);
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: (() => void)[] = [];
  readonly stats: RouterStats = {
    received: 0,
    relayed: 0,
    dropped: 0,
    duplicates: 0,
    forged: 0,
    verified: 0,
    verifyMs: 0,
  };

  constructor(
    private readonly links: LinkManager,
    private readonly identity: RouterIdentity,
    private readonly hooks: RouterHooks
  ) {
    super();
  }

  start(announceIntervalMs: number) {
    this.unsubs.push(
      this.links.on('packet', (link, raw) => this.onPacket(link, raw)),
      this.links.on('linkUp', (link) => this.onLinkUp(link)),
      this.links.on('linkDown', (link) => this.onLinkDown(link))
    );
    this.setAnnounceInterval(announceIntervalMs);
    this.expiryTimer = setInterval(() => this.expireRoutes(), 10_000);
  }

  stop() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.handshakes.forEach((h) => this.clearHandshakeTimers(h));
    this.handshakes.clear();
    this.routes.clear();
  }

  setNick(nick: string) {
    this.identity.nick = nick;
    void this.announce();
  }

  setCert(cert: string | null) {
    this.identity.cert = cert;
    // A new certificate must not wait for its turn: nobody has seen it yet.
    this.announcesSinceCert = Infinity;
    void this.announce();
  }

  setAnnounceInterval(ms: number) {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = setInterval(() => void this.announce(), ms);
  }

  getNodes(): MeshNode[] {
    return [...this.routes.values()].sort((a, b) => a.hops - b.hops || a.nick.localeCompare(b.nick));
  }

  getNode(nodeId: string): MeshNode | undefined {
    return this.routes.get(nodeId);
  }

  // --------------------------------------------------------------------------------------
  // Origination
  // --------------------------------------------------------------------------------------

  private build(
    type: PacketType,
    destination: string,
    payload: Uint8Array,
    opts: { ttl?: number; flags?: number; timestamp?: number } = {}
  ) {
    const packet: MeshPacket = {
      version: PROTOCOL_VERSION,
      type,
      ttl: opts.ttl ?? DEFAULT_TTL[type],
      hops: 0,
      flags: opts.flags ?? 0,
      packetId: toHex(randomBytes(8)),
      origin: this.identity.nodeId,
      destination,
      seq: this.nextSeq(),
      timestamp: opts.timestamp ?? Date.now(),
      payload,
      signPk: this.identity.signer.publicKey,
    };
    return { packet, raw: encodePacket(packet, this.identity.signer) };
  }

  /**
   * Creates, signs and transmits a new packet authored by this node.
   * @returns number of links the packet was handed to (0 = not transmitted at all).
   */
  async originate(
    type: PacketType,
    destination: string,
    payload: Uint8Array,
    opts: { ttl?: number; flags?: number; onlyLinkId?: string } = {}
  ): Promise<number> {
    const { packet, raw } = this.build(type, destination, payload, opts);
    const targets = opts.onlyLinkId
      ? this.links.getLinks().filter((l) => l.id === opts.onlyLinkId)
      : this.selectTargets(packet, null);
    const results = await Promise.all(targets.map((l) => this.links.send(l.id, raw)));
    return results.filter(Boolean).length;
  }

  /** @param forceCert attach our certificate now (a neighbour that has not seen it is listening). */
  announce(forceCert = false) {
    if (this.links.getLinks().length === 0) return Promise.resolve(0);
    const payload: AnnouncePayload = { n: this.identity.nick, k: this.identity.publicKey };
    // With the certificate an announce no longer fits one BLE frame, so most go without it.
    const cert = this.identity.cert;
    const withCert = !!cert && (forceCert || this.announcesSinceCert >= CERT_EVERY - 1);
    if (withCert) payload.c = cert;
    return this.originate(PacketType.Announce, BROADCAST_ID, encodeJson(payload)).then((n) => {
      // Counted only when it left on a link: without an authenticated neighbour nobody saw it.
      if (n > 0) this.announcesSinceCert = withCert ? 0 : this.announcesSinceCert + 1;
      return n;
    });
  }

  /**
   * Publishes an alert authored by this node: it goes through the same store as received alerts
   * (which checks our own certificate) and is then handed to every neighbour.
   * @param timestamp signed timestamp (a cancellation must be stamped after the alert it cancels)
   * @returns false if the store refused it.
   */
  publishAlert(alert: AlertPayload, timestamp = Date.now()): boolean {
    const { packet, raw } = this.build(PacketType.Alert, BROADCAST_ID, encodeJson(alert), { timestamp });
    if (!this.hooks.alerts.accept(packet, alert, raw)) return false;
    this.handover(raw, null);
    return true;
  }

  private nextSeq() {
    this.seq = (this.seq + 1) >>> 0;
    return this.seq;
  }

  // --------------------------------------------------------------------------------------
  // Receive path
  // --------------------------------------------------------------------------------------

  private onPacket(link: Link, raw: Uint8Array) {
    this.stats.received++;
    // (1) Per-link flood protection – checked before any parsing work.
    if (!this.linkLimiter.tryTake(link.id)) return this.drop('link rate limit', link.id);

    const p = decodePacket(raw);
    if (!p) return this.drop('malformed', link.id);
    if (p.origin === this.identity.nodeId) return; // our own packet came back around

    // (2) Duplicate suppression: the heart of loop-free flooding.
    const seenKey = p.origin + p.packetId;
    if (this.seen.has(seenKey)) {
      this.stats.duplicates++;
      return;
    }

    // (3) Everything that is cheap comes before the signature check.
    const handshake = this.handshakes.get(link.id);
    if (!handshake) return this.drop('unknown link', link.id);
    if (p.type !== PacketType.Hello && !handshake.state.peer) return this.drop('unauthenticated link', link.id);
    const implausible = this.implausible(p);
    if (implausible) return this.drop(implausible, p.origin);
    let alert: AlertPayload | null = null;
    if (p.type === PacketType.Alert) {
      alert = decodeJson<AlertPayload>(p.payload);
      if (!isValidAlertPayload(alert, p.timestamp)) return this.drop('bad alert', p.origin);
      // Old versions and replays end here – before they can use up the author's alert budget.
      if (!this.hooks.alerts.wants(p.origin, alert.id, p.timestamp, alert.x === true)) {
        this.stats.duplicates++;
        return;
      }
    }

    // (4) Authentication: the key belongs to the claimed origin and signed this packet.
    if (!originMatchesKey(p)) return this.strike(link, 'origin does not match key');
    const startedAt = performance.now();
    const authentic = verifyPacket(raw, p);
    this.stats.verified++;
    this.stats.verifyMs += performance.now() - startedAt;
    if (!authentic) return this.strike(link, 'bad signature');
    this.seen.add(seenKey);

    // HELLO is link-local: it binds the physical link to a node identity and is never relayed.
    if (p.type === PacketType.Hello) return this.onHelloPacket(link, handshake, p);

    // (5) Per-origin rate limiting – excess traffic is neither delivered nor relayed.
    const limiter =
      p.type === PacketType.Announce
        ? this.announceLimiter
        : p.type === PacketType.Alert
          ? this.alertLimiter
          : this.originLimiter;
    if (!limiter.tryTake(p.origin)) return this.drop('origin rate limit', p.origin);

    // Alerts hop store-and-forward instead of by TTL: pass one on only if it was news to us.
    if (alert) {
      if (this.hooks.alerts.accept(p, alert, raw)) this.handover(raw, link.id);
      return;
    }

    // (6) Reverse-path route learning.
    const hopsToOrigin = p.hops + 1;
    if (p.type === PacketType.Announce) {
      const a = decodeJson<AnnouncePayload>(p.payload);
      const nick = sanitizeNick(a?.n);
      this.hooks.onPeerInfo(p.origin, { boxKey: a?.k, cert: a?.c, nick });
      this.learnRoute(p.origin, link, hopsToOrigin, p.seq, nick);
    } else {
      this.learnRoute(p.origin, link, hopsToOrigin, undefined, undefined);
    }

    const isForMe = p.destination === this.identity.nodeId;
    if (isForMe) this.emit('deliver', p, link);

    // (7) Relay, unless it was for us only or TTL is exhausted.
    if (!isForMe && p.ttl > 1) this.relay(p, raw, link);
  }

  /** Header checks that need no cryptography. Returns the reason for dropping, or null. */
  private implausible(p: MeshPacket): string | null {
    if (p.ttl < 1 || p.ttl + p.hops > DEFAULT_TTL[p.type]) return 'bad ttl';
    if (p.type === PacketType.Hello) return null;
    const broadcast = p.destination === BROADCAST_ID;
    const mayBroadcast = p.type === PacketType.Announce || p.type === PacketType.Alert;
    if (broadcast !== mayBroadcast) return 'bad destination';
    if (p.type === PacketType.Alert) return null;
    if (Math.abs(Date.now() - p.timestamp) > FRESHNESS_MS) return 'stale timestamp';
    if (p.type === PacketType.Announce && p.seq < (this.routes.get(p.origin)?.lastSeq ?? 0)) return 'stale announce';
    return null;
  }

  /** A forged packet is the sending neighbour's fault – every honest relay would have dropped it. */
  private strike(link: Link, reason: string) {
    this.stats.forged++;
    this.drop(reason, link.id);
    const strikes = (this.strikes.get(link.id) ?? 0) + 1;
    this.strikes.set(link.id, strikes);
    if (strikes >= MAX_STRIKES) this.links.penalize(link.id, `forged packets (${reason})`);
  }

  private relay(p: MeshPacket, raw: Uint8Array, from: Link) {
    const out = rewriteForRelay(raw);
    const targets = this.selectTargets(p, from.id);
    if (targets.length === 0) return;
    // Broadcast storms: random back-off de-synchronises neighbours that heard the same packet.
    const delay = p.destination === BROADCAST_ID ? jitter(15, 90) : jitter(0, 10);
    setTimeout(() => {
      for (const l of targets) {
        void this.links.send(l.id, out).then((ok) => ok && this.stats.relayed++);
      }
    }, delay);
  }

  /** Hands a stored, signed packet (an alert) to every authenticated neighbour but one. */
  private handover(raw: Uint8Array, exceptLinkId: string | null) {
    const out = rewriteForHandover(raw);
    setTimeout(
      () => {
        for (const l of this.links.getLinks()) {
          if (l.id === exceptLinkId || !l.peerNodeId) continue;
          void this.links.send(l.id, out).then((ok) => ok && exceptLinkId && this.stats.relayed++);
        }
      },
      exceptLinkId ? jitter(15, 90) : 0
    );
  }

  /** Chooses outgoing links: unicast along a known route, otherwise flood (split horizon). */
  private selectTargets(p: MeshPacket, fromLinkId: string | null): Link[] {
    // Only links whose peer proved its identity carry mesh traffic.
    const all = this.links
      .getLinks()
      .filter((l) => l.id !== fromLinkId && !!l.peerNodeId && l.peerNodeId !== p.origin);
    // A retry floods even past a "direct" link: adjacency can be faked by relaying the handshake.
    if (p.destination === BROADCAST_ID || p.flags & PacketFlags.ForceFlood) return all;

    const direct = all.find((l) => l.peerNodeId === p.destination);
    if (direct) return [direct];

    const route = this.routes.get(p.destination);
    if (route && route.nextHopLinkId !== fromLinkId) {
      const next = all.find((l) => l.id === route.nextHopLinkId);
      if (next) return [next];
    }
    return all;
  }

  // --------------------------------------------------------------------------------------
  // Link handshake
  // --------------------------------------------------------------------------------------

  private onLinkUp(link: Link) {
    const handshake: Handshake = {
      state: newHandshake(toBase64(randomBytes(16))),
      // A lost HELLO must not leave the link dead: repeat until the peer answered.
      retry: setInterval(() => {
        if (!handshake.state.peer) this.sendHello(link, handshake);
      }, HELLO_RETRY_MS),
      deadline: setTimeout(() => {
        if (!handshake.state.peer) this.links.closeLink(link.id, 'handshake timeout');
      }, HANDSHAKE_TIMEOUT_MS),
      skewMs: null,
      certRepeats: 0,
    };
    this.handshakes.set(link.id, handshake);
    this.sendHello(link, handshake);
  }

  /** Tells the neighbour who we are. ttl=1 → never relayed. With `echo` it answers their challenge. */
  private sendHello(link: Link, handshake: Handshake, echo?: { challenge: string; peer: string }) {
    // No certificate here: it would push every HELLO of an authority into a second BLE frame. It
    // follows in the announce sent once the link is bound.
    const hello: HelloPayload = { n: this.identity.nick, k: this.identity.publicKey, ch: handshake.state.challenge };
    if (echo) {
      hello.re = echo.challenge;
      hello.ad = this.hooks.alerts.digest();
    }
    // The reply names its recipient, so it is useless as an answer to anybody else's challenge.
    void this.originate(PacketType.Hello, echo ? echo.peer : BROADCAST_ID, encodeJson(hello), {
      ttl: 1,
      onlyLinkId: link.id,
    });
  }

  private onHelloPacket(link: Link, handshake: Handshake, p: MeshPacket) {
    if (p.hops !== 0) return this.drop('relayed hello', link.id);
    const hello = decodeJson<HelloPayload>(p.payload);
    if (!hello || typeof hello !== 'object') return this.drop('bad hello', link.id);

    const step = onHello(handshake.state, p.origin, hello, p.destination === this.identity.nodeId);
    if (step.reply) this.sendHello(link, handshake, { challenge: step.reply, peer: p.origin });
    if (!step.bind) {
      // Asked again by a peer we have already bound: our reply was lost, so the peer has not bound
      // us yet and refused the announce that followed our bind – the one with the certificate.
      // Repeat it each time (this reply may get lost as well), but no more often per link than an
      // honest peer asks, so that repeated HELLOs cannot force floods.
      if (step.reply && handshake.state.peer && this.identity.cert && handshake.certRepeats < MAX_CERT_REPEATS) {
        handshake.certRepeats++;
        setTimeout(() => void this.announce(true), jitter(300, 900));
      }
      return;
    }

    this.clearHandshakeTimers(handshake);
    const nick = sanitizeNick(hello.n);
    // Older versions send their certificate in HELLO – still accepted.
    this.hooks.onPeerInfo(p.origin, { boxKey: hello.k, cert: hello.c, nick });
    if (!this.links.bindPeer(link.id, this.identity.nodeId, p.origin, nick)) return;

    handshake.skewMs = p.timestamp - Date.now();
    this.emitClockSkew();
    this.learnRoute(p.origin, link, 1, p.seq, nick);
    if (typeof hello.ad === 'string' && hello.ad !== this.hooks.alerts.digest()) this.syncAlerts(link, p.origin);
    // Flood a fresh announce so the rest of the mesh learns the new path quickly. It carries our
    // certificate, which the new neighbour has had no chance to see yet.
    setTimeout(() => void this.announce(true), jitter(300, 900));
  }

  /** Sends our stored alerts to a neighbour that has a different set (late joiner, merged islands). */
  private syncAlerts(link: Link, peerNodeId: string) {
    const now = Date.now();
    if (now - (this.alertSyncAt.get(peerNodeId) ?? 0) < ALERT_SYNC_COOLDOWN_MS) return;
    if (this.alertSyncAt.size > 512) this.alertSyncAt.clear();
    this.alertSyncAt.set(peerNodeId, now);
    for (const raw of this.hooks.alerts.packets()) void this.links.send(link.id, rewriteForHandover(raw));
  }

  private clearHandshakeTimers(handshake: Handshake) {
    clearInterval(handshake.retry);
    clearTimeout(handshake.deadline);
  }

  private emitClockSkew() {
    const samples = [...this.handshakes.values()]
      .map((h) => h.skewMs)
      .filter((s): s is number => s !== null)
      .sort((a, b) => a - b);
    this.emit('clockSkew', samples.length ? samples[Math.floor(samples.length / 2)] : null);
  }

  // --------------------------------------------------------------------------------------
  // Route table
  // --------------------------------------------------------------------------------------

  private learnRoute(nodeId: string, via: Link, hops: number, seq?: number, nick?: string) {
    const now = Date.now();
    const current = this.routes.get(nodeId);
    const direct = via.peerNodeId === nodeId;

    if (current && seq !== undefined && seq < current.lastSeq) return; // stale announce
    const better =
      !current ||
      hops < current.hops ||
      current.nextHopLinkId === via.id ||
      now - current.lastSeen > ROUTE_STALE_MS ||
      !this.links.getLink(current.nextHopLinkId);

    if (better) {
      this.routes.set(nodeId, {
        nodeId,
        nick: nick || current?.nick || nodeId.slice(0, 8),
        nextHopLinkId: via.id,
        hops,
        lastSeen: now,
        lastSeq: Math.max(seq ?? 0, current?.lastSeq ?? 0),
        direct,
      });
    } else if (current) {
      // Keep the better path but record that the node is alive.
      current.lastSeen = now;
      if (nick) current.nick = nick;
      if (seq !== undefined) current.lastSeq = Math.max(current.lastSeq, seq);
    }
    this.emitNodes();
  }

  private onLinkDown(link: Link) {
    const handshake = this.handshakes.get(link.id);
    if (handshake) {
      this.clearHandshakeTimers(handshake);
      this.handshakes.delete(link.id);
      this.emitClockSkew();
    }
    this.strikes.delete(link.id);
    let changed = false;
    for (const [id, r] of this.routes) {
      if (r.nextHopLinkId === link.id) {
        this.routes.delete(id);
        changed = true;
      }
    }
    this.linkLimiter.delete(link.id);
    if (changed) this.emitNodes();
  }

  private expireRoutes() {
    const now = Date.now();
    let changed = false;
    for (const [id, r] of this.routes) {
      const linkAlive = !!this.links.getLink(r.nextHopLinkId);
      if (!linkAlive || (!r.direct && now - r.lastSeen > ROUTE_TTL_MS)) {
        this.routes.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitNodes();
  }

  private emitNodes() {
    this.emit('nodesChanged', this.getNodes());
  }

  private drop(reason: string, key: string) {
    this.stats.dropped++;
    log.debug('drop:', reason, key);
  }
}
