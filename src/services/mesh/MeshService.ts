import { AppState, AppStateStatus } from 'react-native';

import MeshPeripheral from '../../../modules/mesh-peripheral';
import { useAlertStore } from '../../store/alertStore';
import { useChatStore } from '../../store/chatStore';
import { authorityName, useContactsStore } from '../../store/contactsStore';
import { selectIsAuthority, useIdentityStore } from '../../store/identityStore';
import { useMeshStore } from '../../store/meshStore';
import { useVerifyStore } from '../../store/verifyStore';
import { ChatMessage, Conversation, dmConversationId } from '../../store/types';
import { TokenBucket } from '../../utils/RateLimiter';
import { toBase64 } from '../../utils/bytes';
import { createLogger } from '../../utils/logger';
import { sanitizeLine, sanitizeNick } from '../../utils/nick';
import { randomBytes, randomId } from '../../utils/random';
import { sleep } from '../../utils/time';
import { Link, LinkManager } from '../ble/LinkManager';
import { peerAuthority } from '../crypto/authorities';
import { AckPlain, isEnvelope, MessagePlain, SealedPayload, VerifyPlain } from '../crypto/box';
import { type CertFailure, parseIdentityQr, VERIFY_TOKEN_BYTES } from '../crypto/cert';
import { getPeerBoxKey, openJson, rememberPeerKey, sealJson } from '../crypto/e2e';
import { getIdentityKeys, signBytes } from '../crypto/identity';
import { confirmPresence, hasDeviceLock } from '../security/deviceLock';
import { alertRepository } from '../storage/alertRepository';
import { chatRepository } from '../storage/chatRepository';
import {
  ALERT_HEADLINE_MAX,
  ALERT_RELAY_GRACE_MS,
  ALERT_TEXT_MAX,
  alertDigest,
  applyAlert,
  isAlertRelayable,
  MAX_ALERT_LIFETIME_MS,
  pruneAlerts,
  StoredAlert,
  wantsAlert,
} from './alertPolicy';
import { AlertSink, MeshRouter } from './MeshRouter';
import { AlertPayload, decodeJson, encodeJson, MeshPacket, PacketFlags, PacketType } from './packet';
import { acceptProof, closeOffer, forgetAccepted, newOfferState, openOffer } from './verifyOffer';

const log = createLogger('MeshService');

export const MAX_MESSAGE_LENGTH = 500;
const ANNOUNCE_FOREGROUND_MS = 30_000;
const ANNOUNCE_BACKGROUND_MS = 60_000;
/** Retry schedule for messages without an ACK. */
const RETRY_DELAYS_MS = [4_000, 10_000, 20_000];
/** After the retries an undelivered message waits on this device, this long, for its recipient to show up. */
const WAIT_LIMIT_MS = 24 * 3_600_000;
/** Waiting messages are offered again this often while their recipient is in the node list. */
const WAIT_FLUSH_INTERVAL_MS = 60_000;
/**
 * Pause between two re-sent messages: past a burst of 15, receivers take one packet per second (chats
 * and acks together) from one origin. Two phones flushing to each other exceed that after about 17
 * messages; the acks lost then are made up for by the next cycle.
 */
const WAIT_FLUSH_GAP_MS = 1_200;
/** A message transmitted later than this after it was written carries the time of writing. */
const WRITTEN_AT_AFTER_MS = 60_000;
/** How long before its packet a message may claim to have been written (WAIT_LIMIT_MS plus slack). */
const MAX_WRITTEN_AGE_MS = 25 * 3_600_000;
/** Clock skew tolerance for incoming timestamps. */
const MAX_FUTURE_SKEW_MS = 60_000;
const ALERT_PRUNE_INTERVAL_MS = 10 * 60_000;
/** How long to wait for the acknowledgement of the last verification-proof transmission. */
const PROOF_FINAL_WAIT_MS = 6_000;

interface Outgoing {
  message: ChatMessage;
  conversation: Conversation;
  attempt: number;
  transmitted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** When the message is given up on (see WAIT_LIMIT_MS). */
  deadline: number;
}

/** A verification proof on its way to the peer whose code was scanned. */
interface PendingProof {
  peerId: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (confirmed: boolean) => void;
}

export type SendResult = { ok: true } | { ok: false; reason: 'empty' | 'too_long' | 'rate_limited'; retryInMs?: number };
export type AlertResult = { ok: true } | { ok: false; reason: 'not_authority' | 'not_confirmed' | 'invalid' | 'offline' };
export type InstallCertResult = { ok: true; name: string } | { ok: false; reason: CertFailure | 'no_device_lock' };
/**
 * Outcome of scanning a code on the verify screen. `confirmation` resolves true once the owner of
 * the code confirmed it now sees this device as verified; null when the code carried no token.
 */
export type ScanResult =
  | { result: 'not_a_key' | 'mismatch' }
  | { result: 'match'; confirmation: Promise<boolean> | null };

/**
 * Application layer: chat semantics on top of the mesh router.
 *  - Messages are 1:1, directed, end-to-end encrypted packets; the recipient answers with an
 *    encrypted ACK → "delivered". There is no group chat: nobody can broadcast content except
 *    certified authority accounts (alerts).
 *  - Unacknowledged messages are retried with ForceFlood (a route may be stale). After that they
 *    wait on this device – never on other phones – for up to 24 h and go out again when the
 *    recipient shows up in the node list; after those 24 h they are marked failed.
 *  - Message ids are UUIDs; SQLite INSERT OR IGNORE makes delivery idempotent end to end.
 *  - Alerts are signed public notices; this layer stores them, the router spreads them.
 */
class MeshServiceImpl {
  private links = new LinkManager();
  private router: MeshRouter | null = null;
  private outgoing = new Map<string, Outgoing>();
  /** Verification proofs awaiting the acknowledgement of the peer, keyed by token. */
  private proofs = new Map<string, PendingProof>();
  private sendLimiter = new TokenBucket(5, 1); // max burst 5, then 1 msg/s
  private unsubs: (() => void)[] = [];
  private appStateSub: { remove(): void } | null = null;
  private notificationTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private waitTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private background = false;
  /** Node ids of the last 'nodesChanged' – a recipient counts as arriving only if it was not in here. */
  private listedNodes = new Set<string>();
  private started = false;
  private starting: Promise<void> | null = null;

  get isStarted() {
    return this.started;
  }

  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.starting ??= this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart() {
    const identity = useIdentityStore.getState();
    if (identity.status !== 'ready' || !identity.nick) throw new Error('Identity not initialised');

    // Everything that can fail (opening the encrypted database) happens before the mesh counts
    // as started, so a failed start can simply be retried.
    const waitingSince = Date.now() - WAIT_LIMIT_MS;
    await chatRepository.failPendingMessages(waitingSince);
    await useChatStore.getState().loadConversations();
    await this.restoreWaiting(waitingSince);
    await useContactsStore.getState().load();
    for (const c of Object.values(useContactsStore.getState().contacts)) rememberPeerKey(c.nodeId, c.boxKey);
    this.setAlerts(pruneAlerts(await alertRepository.list(), Date.now()), false);
    this.started = true;

    const keys = getIdentityKeys();
    this.router = new MeshRouter(
      this.links,
      {
        nodeId: identity.nodeId,
        nick: identity.nick,
        publicKey: identity.publicKey,
        cert: selectIsAuthority(identity) ? identity.cert : null,
        signer: { publicKey: keys.sign.publicKey, sign: signBytes },
      },
      { onPeerInfo: this.onPeerInfo, alerts: this.alertSink }
    );
    this.wireEvents(this.router);
    this.links.start(identity.nodeId);
    this.router.start(ANNOUNCE_FOREGROUND_MS);
    this.pruneTimer = setInterval(() => {
      const { alerts } = useAlertStore.getState();
      const pruned = pruneAlerts(alerts, Date.now());
      if (pruned !== alerts) this.setAlerts(pruned);
    }, ALERT_PRUNE_INTERVAL_MS);
    this.waitTimer = setInterval(() => void this.flushWaiting(), WAIT_FLUSH_INTERVAL_MS);

    // Foreground service keeps the process (JS engine + BLE) alive in the background.
    try {
      MeshPeripheral.startForegroundService('Mesh Chat', 'Szukam urządzeń w pobliżu…');
    } catch (e) {
      log.warn('Foreground service failed', e);
    }
    this.appStateSub = AppState.addEventListener('change', this.onAppState);
    useMeshStore.getState().set({ running: true });
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    this.appStateSub?.remove();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.waitTimer) clearInterval(this.waitTimer);
    this.listedNodes.clear();
    this.outgoing.forEach((o) => o.timer && clearTimeout(o.timer));
    this.outgoing.clear();
    this.proofs.forEach((p) => {
      if (p.timer) clearTimeout(p.timer);
      p.resolve(false);
    });
    this.proofs.clear();
    useVerifyStore.getState().set({ machine: newOfferState(), outcome: null });
    this.router?.stop();
    this.router = null;
    await this.links.stop();
    // A fresh LinkManager for a possible restart (BleManager can't be reused after destroy).
    this.links = new LinkManager();
    try {
      MeshPeripheral.stopForegroundService();
    } catch {}
    useMeshStore.getState().set({ running: false, links: [], nearby: [], nodes: [], clockSkewMs: null });
  }

  private wireEvents(router: MeshRouter) {
    const mesh = useMeshStore.getState();
    const syncLinks = () => {
      mesh.set({
        links: this.links.getLinks().map((l) => ({
          id: l.id,
          kind: l.kind,
          peerNodeId: l.peerNodeId,
          peerNick: l.peerNick,
          mtu: l.mtu,
          connectedAt: l.connectedAt,
        })),
      });
      this.scheduleNotificationUpdate();
    };
    this.unsubs.push(
      this.links.on('radioChanged', (radio) => mesh.set({ radio })),
      this.links.on('nearbyChanged', (nearby) => {
        mesh.set({ nearby });
        syncLinks(); // nick/node id binding happens after HELLO
      }),
      this.links.on('linkUp', syncLinks),
      this.links.on('linkDown', syncLinks),
      router.on('nodesChanged', (nodes) => {
        mesh.set({ nodes });
        this.scheduleNotificationUpdate();
        this.refreshDmTitles(nodes);
        this.noteArrivals(nodes);
      }),
      router.on('clockSkew', (clockSkewMs) => mesh.set({ clockSkewMs })),
      router.on('deliver', (packet, link) => {
        void this.onDeliver(packet, link).catch((e) => log.error('deliver failed', e));
      })
    );
    mesh.set({ radio: this.links.getRadio() });
  }

  // --------------------------------------------------------------------------------------
  // Public API used by the UI
  // --------------------------------------------------------------------------------------

  async sendMessage(conversationId: string, rawText: string): Promise<SendResult> {
    const text = rawText.trim();
    if (!text) return { ok: false, reason: 'empty' };
    if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too_long' };
    if (!this.sendLimiter.tryTake()) {
      return { ok: false, reason: 'rate_limited', retryInMs: this.sendLimiter.msUntilAvailable() };
    }
    const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId);
    if (!conversation) throw new Error(`Unknown conversation ${conversationId}`);

    const identity = useIdentityStore.getState();
    const message: ChatMessage = {
      id: randomId(),
      conversationId,
      senderId: identity.nodeId,
      senderNick: identity.nick ?? '',
      text,
      timestamp: Date.now(),
      status: 'sending',
      direction: 'out',
      deliveredCount: 0,
      hops: null,
      authority: selectIsAuthority(identity) ? identity.authority!.name : null,
    };
    await chatRepository.insertMessage(message);
    useChatStore.getState().addMessage(message);
    await this.touchConversation(conversation, message, false);

    this.outgoing.set(message.id, {
      message,
      conversation,
      attempt: 0,
      transmitted: false,
      timer: null,
      deadline: message.timestamp + WAIT_LIMIT_MS,
    });
    void this.transmit(message.id);
    return { ok: true };
  }

  /** Manual retry of a failed message (tap on the bubble). */
  async resend(messageId: string) {
    const message = await chatRepository.getMessage(messageId);
    if (!message || message.direction !== 'out') return;
    const conversation = useChatStore.getState().conversations.find((c) => c.id === message.conversationId);
    if (!conversation) return;
    await this.setStatus(message, 'sending');
    this.outgoing.set(message.id, {
      message: { ...message, status: 'sending' },
      conversation,
      attempt: 0,
      transmitted: false,
      timer: null,
      // Asked for again by the user: it gets the full waiting time once more – in memory only; after
      // an app restart a message written more than WAIT_LIMIT_MS ago is failed again (see doStart).
      deadline: Date.now() + WAIT_LIMIT_MS,
    });
    void this.transmit(message.id);
  }

  async openDirectConversation(nodeId: string, nick: string): Promise<string> {
    const id = dmConversationId(nodeId);
    const title = authorityName(useContactsStore.getState(), nodeId) ?? (nick || nodeId.slice(0, 8));
    await this.ensureConversation({ id, type: 'dm', title, peerId: nodeId });
    this.rememberContact(nodeId, nick);
    return id;
  }

  async deleteConversation(id: string) {
    // Nothing of a deleted conversation may go out later – neither a retry nor a waiting message.
    for (const [messageId, out] of this.outgoing) {
      if (out.conversation.id !== id) continue;
      if (out.timer) clearTimeout(out.timer);
      this.outgoing.delete(messageId);
    }
    await chatRepository.deleteConversation(id);
    useChatStore.getState().removeConversation(id);
  }

  async markRead(conversationId: string) {
    const c = useChatStore.getState().conversations.find((x) => x.id === conversationId);
    if (!c || c.unread === 0) return;
    const next = { ...c, unread: 0 };
    await chatRepository.upsertConversation(next);
    useChatStore.getState().upsertConversation(next);
  }

  setNick(nick: string) {
    useIdentityStore.getState().setNick(nick);
    this.router?.setNick(nick.trim());
  }

  async clearHistory() {
    this.outgoing.forEach((o) => o.timer && clearTimeout(o.timer));
    this.outgoing.clear();
    await chatRepository.clearAll();
    useChatStore.getState().reset();
  }

  rescan() {
    this.links.rescan();
  }

  getStats() {
    return this.router?.stats;
  }

  // --------------------------------------------------------------------------------------
  // Trust: key verification and authority certificate
  // --------------------------------------------------------------------------------------

  /** It was confirmed in person (QR / fingerprint) that this node id belongs to the peer. */
  markVerified(nodeId: string, at = Date.now()) {
    const title = useChatStore.getState().conversations.find((c) => c.peerId === nodeId)?.title;
    const nick =
      useContactsStore.getState().contacts[nodeId]?.nick ||
      title ||
      this.router?.getNode(nodeId)?.nick ||
      nodeId.slice(0, 8);
    useContactsStore.getState().remember(nodeId, { verifiedAt: at, nick, boxKey: getPeerBoxKey(nodeId) });
  }

  /** Undoes a verification (the user no longer vouches for this node id). */
  clearVerification(nodeId: string) {
    useContactsStore.getState().remember(nodeId, { verifiedAt: null });
    // The decision is final: a late retry must not be acknowledged, a late conflict must not "restore" anything.
    const { machine, outcome, set } = useVerifyStore.getState();
    const next = { ...machine };
    forgetAccepted(next, nodeId);
    set({ machine: next, outcome: outcome?.peerId === nodeId ? null : outcome });
  }

  /**
   * What the scanning phone does with a code read on the verify screen of the conversation with
   * `peerId`. A matching key verifies the peer here; a one-time token in the code is sent back
   * so that the owner of the code verifies this device too.
   */
  scanVerificationCode(peerId: string, text: string): ScanResult {
    const scanned = parseIdentityQr(text);
    if (!scanned) return { result: 'not_a_key' };
    if (scanned.nodeId !== peerId) {
      // Not the key of this conversation – somebody may sit between the two phones. The owner of
      // the code must learn that a device it was not showing the code to has read it: the proof
      // still goes out, and on its side that raises the conflict warning (see verifyOffer.ts).
      if (scanned.token && scanned.nodeId !== useIdentityStore.getState().nodeId) {
        void this.sendVerificationProof(scanned.nodeId, scanned.token);
      }
      return { result: 'mismatch' };
    }
    this.markVerified(peerId);
    return { result: 'match', confirmation: scanned.token ? this.sendVerificationProof(peerId, scanned.token) : null };
  }

  /**
   * Shows a one-time verification code for the conversation with `peerId` (see verifyOffer.ts):
   * only that peer can use it. The code is rendered from the verify store.
   */
  openVerificationOffer(peerId: string) {
    const { machine, outcome, set } = useVerifyStore.getState();
    const next = { ...machine };
    openOffer(next, peerId, toBase64(randomBytes(VERIFY_TOKEN_BYTES)), Date.now());
    set({ machine: next, outcome: outcome?.peerId === peerId ? null : outcome });
  }

  /** Withdraws the code (hidden by the user, or the app left the screen). */
  closeVerificationOffer() {
    const machine = { ...useVerifyStore.getState().machine };
    if (!machine.offer) return;
    closeOffer(machine);
    useVerifyStore.getState().set({ machine });
  }

  /**
   * After scanning the code of a peer: tells the peer "I saw the token on your screen", so that
   * the peer marks this device as verified too – one scan verifies both sides.
   * @returns true once the peer acknowledged; false if it did not (unreachable, it refused the
   *          token, a newer proof with the same token replaced this one, or the mesh stopped).
   */
  sendVerificationProof(peerId: string, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const previous = this.proofs.get(token);
      if (previous) {
        if (previous.timer) clearTimeout(previous.timer);
        previous.resolve(false);
      }
      this.proofs.set(token, { peerId, attempt: 0, timer: null, resolve });
      this.transmitProof(token);
    });
  }

  private transmitProof(token: string) {
    const proof = this.proofs.get(token);
    if (!proof) return;
    if (proof.attempt > RETRY_DELAYS_MS.length) {
      this.proofs.delete(token);
      proof.resolve(false);
      return;
    }
    const me = useIdentityStore.getState().nodeId;
    const plain: VerifyPlain = { y: 'v', id: token, from: me, to: proof.peerId };
    const sealed = sealJson(proof.peerId, plain);
    const flags = proof.attempt > 0 ? PacketFlags.ForceFlood : 0;
    if (sealed) {
      void this.router
        ?.originate(PacketType.Chat, proof.peerId, encodeJson(sealed), { flags })
        .catch((e) => log.warn('proof originate failed', e));
    }
    proof.timer = setTimeout(() => {
      proof.attempt++;
      this.transmitProof(token);
    }, RETRY_DELAYS_MS[proof.attempt] ?? PROOF_FINAL_WAIT_MS);
  }

  /**
   * A peer claims to have scanned the code on the screen of this device. Synchronous on purpose:
   * the token is checked and spent in one step, so two proofs can never both use it.
   */
  private onVerificationProof(origin: string, token: string) {
    const now = Date.now();
    const contacts = useContactsStore.getState();
    const machine = { ...useVerifyStore.getState().machine };
    const result = acceptProof(machine, origin, token, now, contacts.contacts[origin]?.verifiedAt ?? null);
    if (result.kind === 'ignored') return; // unknown or expired token – stay silent

    if (result.kind === 'conflict') {
      // The right code from the wrong device: it leaked, or this conversation is not with the
      // person who scanned. Nothing is acknowledged, and what the code granted is undone – but
      // only that: a verification the user made or removed by hand since then is left alone.
      const { revoke } = result;
      if (revoke && contacts.contacts[revoke.by]?.verifiedAt === revoke.grantedAt) {
        contacts.remember(revoke.by, { verifiedAt: revoke.previousVerifiedAt });
      }
      useVerifyStore.getState().set({ machine, outcome: { kind: 'conflict', peerId: result.peerId, by: origin, at: now } });
      return;
    }

    if (result.kind === 'verified') {
      this.markVerified(origin, now);
      useVerifyStore.getState().set({ machine, outcome: { kind: 'verified', peerId: result.peerId, by: origin, at: now } });
    }
    const ack: AckPlain = { y: 'a', id: token, from: useIdentityStore.getState().nodeId, to: origin };
    const sealed = sealJson(origin, ack);
    if (sealed) void this.router?.originate(PacketType.Ack, origin, encodeJson(sealed));
  }

  /**
   * Installs an authority certificate issued to this device. Refused on a phone without a screen
   * lock: anyone picking it up could then broadcast alerts.
   */
  async installCert(cert: string): Promise<InstallCertResult> {
    if (!(await hasDeviceLock())) return { ok: false, reason: 'no_device_lock' };
    const result = useIdentityStore.getState().installCert(cert);
    if (!result.ok) return result;
    this.router?.setCert(cert);
    return { ok: true, name: result.cert.name };
  }

  removeCert() {
    useIdentityStore.getState().removeCert();
    this.router?.setCert(null);
  }

  // --------------------------------------------------------------------------------------
  // Alerts (authority accounts only)
  // --------------------------------------------------------------------------------------

  async sendAlert(headline: string, text: string, lifetimeMs: number): Promise<AlertResult> {
    const identity = useIdentityStore.getState();
    if (!identity.cert || !selectIsAuthority(identity)) return { ok: false, reason: 'not_authority' };
    const h = sanitizeLine(headline, ALERT_HEADLINE_MAX);
    const t = text.trim();
    if (!h || t.length > ALERT_TEXT_MAX || lifetimeMs <= 0) return { ok: false, reason: 'invalid' };
    if (!this.router) return { ok: false, reason: 'offline' };
    if (!(await confirmPresence('Potwierdź nadanie alertu do wszystkich'))) return { ok: false, reason: 'not_confirmed' };

    const now = Date.now();
    const alert: AlertPayload = {
      id: randomId(),
      h,
      t,
      exp: now + Math.min(lifetimeMs, MAX_ALERT_LIFETIME_MS),
      c: identity.cert,
    };
    return this.router?.publishAlert(alert, now) ? { ok: true } : { ok: false, reason: 'invalid' };
  }

  /** Withdraws one of this device's own alerts everywhere it has spread to. */
  async cancelAlert(id: string): Promise<AlertResult> {
    const identity = useIdentityStore.getState();
    if (!identity.cert || !selectIsAuthority(identity)) return { ok: false, reason: 'not_authority' };
    const mine = useAlertStore.getState().alerts.find((a) => a.origin === identity.nodeId && a.id === id);
    if (!mine || mine.cancelled) return { ok: false, reason: 'invalid' };
    if (!this.router) return { ok: false, reason: 'offline' };
    if (!(await confirmPresence('Potwierdź odwołanie alertu'))) return { ok: false, reason: 'not_confirmed' };

    // The tombstone keeps the alert's expiry (so it outlives every copy of the original) and is
    // stamped after it even if this phone's clock was set back in the meantime.
    const alert: AlertPayload = { id, h: mine.headline, t: '', exp: mine.exp, c: identity.cert, x: true };
    const timestamp = Math.max(Date.now(), mine.timestamp + 1);
    return this.router?.publishAlert(alert, timestamp) ? { ok: true } : { ok: false, reason: 'invalid' };
  }

  private setAlerts(alerts: StoredAlert[], persist = true) {
    useAlertStore.getState().set(alerts);
    if (persist) void alertRepository.replaceAll(alerts).catch((e) => log.error('alert save failed', e));
  }

  private relayableAlerts() {
    const now = Date.now();
    return useAlertStore.getState().alerts.filter((a) => isAlertRelayable(a, now));
  }

  private alertSink: AlertSink = {
    wants: (origin, id, timestamp, cancelled) =>
      wantsAlert(useAlertStore.getState().alerts, { origin, id, timestamp, cancelled }),

    accept: (packet, alert, raw) => {
      const now = Date.now();
      // Lenient about time here – a relay with a wrong clock must not black-hole alerts.
      // Whether an alert is shown is decided strictly at display time (isAlertActive).
      const cert = peerAuthority(alert.c, packet.origin, now, ALERT_RELAY_GRACE_MS);
      if (!cert || !isAlertRelayable(alert, now)) return false;
      const current = useAlertStore.getState().alerts;
      const applied = applyAlert(current, {
        origin: packet.origin,
        id: alert.id,
        timestamp: packet.timestamp,
        exp: alert.exp,
        headline: sanitizeLine(alert.h, ALERT_HEADLINE_MAX),
        text: alert.t.trim(),
        authority: cert.name,
        certExp: cert.exp,
        cancelled: alert.x === true,
        raw,
      });
      if (applied === current) return false;
      this.setAlerts(pruneAlerts(applied, now));
      if (cert.exp >= now && packet.origin !== useIdentityStore.getState().nodeId) {
        useContactsStore.getState().noteAuthority(packet.origin, alert.c, { name: cert.name, exp: cert.exp }, '');
      }
      return true;
    },

    digest: () => alertDigest(this.relayableAlerts()),
    packets: () => this.relayableAlerts().map((a) => a.raw),
  };

  // --------------------------------------------------------------------------------------
  // Peers
  // --------------------------------------------------------------------------------------

  /** Called by the router with the content of a signature-verified HELLO / ANNOUNCE. */
  private onPeerInfo = (origin: string, info: { boxKey: unknown; cert: unknown; nick: string }) => {
    rememberPeerKey(origin, info.boxKey);
    const contacts = useContactsStore.getState();
    const cert = info.cert === undefined ? null : peerAuthority(info.cert, origin);
    if (cert) {
      contacts.noteAuthority(origin, info.cert as string, { name: cert.name, exp: cert.exp }, info.nick);
    } else if (contacts.contacts[origin] && !contacts.contacts[origin].boxKey) {
      contacts.remember(origin, { boxKey: getPeerBoxKey(origin) });
    }
  };

  /** Persists a peer once there is a reason to (a conversation exists). */
  private rememberContact(nodeId: string, nick: string) {
    const contacts = useContactsStore.getState();
    const known = contacts.contacts[nodeId];
    contacts.remember(nodeId, {
      boxKey: known?.boxKey ?? getPeerBoxKey(nodeId),
      // A verified contact keeps the name it was verified under.
      nick: known?.verifiedAt ? known.nick : nick || known?.nick || '',
    });
  }

  // --------------------------------------------------------------------------------------
  // Transmission, ACKs and retries
  // --------------------------------------------------------------------------------------

  /**
   * Encrypts one chat message and hands it to the router.
   * @returns number of links it left on (0 = not transmitted at all).
   */
  private async sendChat(out: Outgoing, flags: number): Promise<number> {
    const router = this.router;
    if (!router) return 0;
    const { message, conversation } = out;
    const destination = conversation.peerId!;
    const identity = useIdentityStore.getState();

    const plain: MessagePlain = {
      y: 'm',
      id: message.id,
      n: message.senderNick,
      t: message.text,
      from: identity.nodeId,
      to: destination,
    };
    // The packet is stamped when it is sent, so a message that waited says itself when it was written.
    if (Date.now() - message.timestamp > WRITTEN_AT_AFTER_MS) plain.s = message.timestamp;
    // Messages never leave the device in the clear. No key yet (peer's announce not seen) → retry later.
    const sealed = sealJson(destination, plain);
    // An authority attaches its certificate so the recipient can verify it from this packet alone.
    if (sealed && identity.cert && selectIsAuthority(identity)) sealed.a = identity.cert;

    try {
      if (sealed) return await router.originate(PacketType.Chat, destination, encodeJson(sealed), { flags });
    } catch (e) {
      log.warn('originate failed', e);
    }
    return 0;
  }

  private async transmit(messageId: string) {
    const out = this.outgoing.get(messageId);
    if (!out || !this.router) return;
    // First attempt trusts the route table; retries flood in case the route went stale.
    const sentOn = await this.sendChat(out, out.attempt > 0 ? PacketFlags.ForceFlood : 0);
    if (!this.outgoing.has(messageId)) return; // acknowledged or cleared meanwhile

    if (sentOn > 0 && !out.transmitted) {
      out.transmitted = true;
      await this.setStatus(out.message, 'sent');
    }
    if (!this.outgoing.has(messageId)) return;

    if (out.attempt >= RETRY_DELAYS_MS.length) {
      // Not given up on: the entry stays without a timer, so a late ACK still counts, and
      // flushWaiting() sends the message again once its recipient is in the node list.
      out.timer = null;
      if (!(await this.expire(out))) await this.setStatus(out.message, 'waiting');
      return;
    }
    out.timer = setTimeout(() => {
      out.attempt++;
      void this.transmit(messageId);
    }, RETRY_DELAYS_MS[out.attempt]);
  }

  /** Gives up on a message whose waiting time is over. Returns true if it did. */
  private async expire(out: Outgoing): Promise<boolean> {
    if (Date.now() < out.deadline) return false;
    this.outgoing.delete(out.message.id);
    await this.setStatus(out.message, 'failed');
    return true;
  }

  /**
   * Sends the waiting messages whose recipient is in the node list once more, oldest first, and
   * gives up on those that waited too long. Nothing goes out for a recipient that is not listed:
   * flooding the mesh for somebody who is not there only costs airtime.
   */
  private async flushWaiting() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const done = new Set<Outgoing>();
      for (;;) {
        // Chosen anew for every packet: messages get acknowledged or deleted, and further
        // recipients arrive, while a flush is under way.
        const now = Date.now();
        const [out] = [...this.outgoing.values()]
          .filter((o) => o.message.status === 'waiting' && !done.has(o))
          .filter((o) => now >= o.deadline || this.router?.getNode(o.conversation.peerId!))
          .sort((a, b) => a.message.timestamp - b.message.timestamp);
        if (!out) return;
        done.add(out);
        if (await this.expire(out)) continue;
        // Flooded like a retry: the route to a node that has just come back may be stale. The status
        // stays 'waiting' until the ACK – a lost packet is simply sent again by the next flush.
        const sentOn = await this.sendChat(out, PacketFlags.ForceFlood);
        // No pause in the background: React Native fires no JS timers there, so it would never end.
        // The receivers' burst of 15 per origin covers the unpaced flush; what exceeds it stays 'waiting'.
        if (sentOn > 0 && !this.background) await sleep(WAIT_FLUSH_GAP_MS);
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Starts a flush as soon as the recipient of a waiting message comes into range. 'nodesChanged'
   * fires on almost every received packet, hence the comparison with the previous list.
   */
  private noteArrivals(nodes: { nodeId: string }[]) {
    const previous = this.listedNodes;
    this.listedNodes = new Set(nodes.map((n) => n.nodeId));
    for (const out of this.outgoing.values()) {
      const peerId = out.conversation.peerId!;
      if (out.message.status === 'waiting' && this.listedNodes.has(peerId) && !previous.has(peerId)) {
        void this.flushWaiting();
        return;
      }
    }
  }

  /**
   * After an app restart: own messages that nobody acknowledged and that are not too old wait for
   * their recipient again (whatever was pending in memory – retries, a late ACK – is gone).
   */
  private async restoreWaiting(since: number) {
    const { conversations } = useChatStore.getState();
    for (const message of await chatRepository.listUnacknowledged(since)) {
      const conversation = conversations.find((c) => c.id === message.conversationId);
      if (!conversation) continue;
      if (message.status !== 'waiting') await this.setStatus(message, 'waiting');
      this.outgoing.set(message.id, {
        message,
        conversation,
        attempt: 0,
        transmitted: false,
        timer: null,
        deadline: message.timestamp + WAIT_LIMIT_MS,
      });
    }
  }

  private async onAck(packet: MeshPacket) {
    const me = useIdentityStore.getState().nodeId;
    const ack = openJson(packet.origin, decodeJson<SealedPayload>(packet.payload));
    if (!isEnvelope(ack, 'a', packet.origin, me)) return;
    const proof = this.proofs.get(ack.id);
    if (proof) {
      if (proof.peerId !== packet.origin) return;
      if (proof.timer) clearTimeout(proof.timer);
      this.proofs.delete(ack.id);
      return proof.resolve(true);
    }
    const out = this.outgoing.get(ack.id);
    // Late ACK for a message we've given up on, or an ACK from someone who is not the recipient.
    if (!out || out.conversation.peerId !== packet.origin) return;
    if (out.timer) clearTimeout(out.timer);
    this.outgoing.delete(ack.id);
    await chatRepository.updateStatus(ack.id, 'delivered', 1);
    useChatStore.getState().updateMessage(ack.id, out.message.conversationId, {
      status: 'delivered',
      deliveredCount: 1,
    });
  }

  private async setStatus(message: ChatMessage, status: ChatMessage['status']) {
    message.status = status;
    await chatRepository.updateStatus(message.id, status);
    useChatStore.getState().updateMessage(message.id, message.conversationId, { status });
  }

  // --------------------------------------------------------------------------------------
  // Incoming
  // --------------------------------------------------------------------------------------

  /** The router only delivers directed packets whose origin signature it has verified. */
  private async onDeliver(packet: MeshPacket, _link: Link) {
    if (packet.type === PacketType.Ack) return this.onAck(packet);
    if (packet.type !== PacketType.Chat) return;

    const me = useIdentityStore.getState().nodeId;
    const sealed = decodeJson<SealedPayload>(packet.payload);
    // Must be encrypted for us by the origin, and say so inside the ciphertext (see crypto/box).
    const chat = openJson(packet.origin, sealed);
    if (isEnvelope(chat, 'v', packet.origin, me)) return this.onVerificationProof(packet.origin, chat.id);
    if (!isEnvelope(chat, 'm', packet.origin, me)) return;
    const text = chat.t.slice(0, MAX_MESSAGE_LENGTH);
    if (!text.trim()) return;
    const senderNick = sanitizeNick(chat.n) || packet.origin.slice(0, 8);

    // Authority status comes from a certificate only – never from the nick.
    const cert = sealed?.a === undefined ? null : peerAuthority(sealed.a, packet.origin);
    if (cert) {
      useContactsStore
        .getState()
        .noteAuthority(packet.origin, sealed!.a!, { name: cert.name, exp: cert.exp }, senderNick);
    }
    const authority = cert?.name ?? authorityName(useContactsStore.getState(), packet.origin);

    const conversation = await this.ensureConversation({
      id: dmConversationId(packet.origin),
      type: 'dm',
      title: authority ?? senderNick,
      peerId: packet.origin,
    });
    this.rememberContact(packet.origin, senderNick);

    // A message that waited at the sender names the time it was written. That is the sender's own
    // claim: believed only as far back as a message may wait, and never as later than the packet.
    const { s } = chat;
    const writtenAt =
      s !== undefined && Number.isSafeInteger(s) && s <= packet.timestamp && packet.timestamp - s <= MAX_WRITTEN_AGE_MS
        ? s
        : packet.timestamp;

    const message: ChatMessage = {
      id: chat.id,
      conversationId: conversation.id,
      senderId: packet.origin,
      senderNick,
      text,
      timestamp: Math.min(writtenAt, Date.now() + MAX_FUTURE_SKEW_MS),
      status: 'delivered',
      direction: 'in',
      deliveredCount: 0,
      hops: packet.hops + 1,
      authority,
    };

    const isNew = await chatRepository.insertMessage(message);
    if (isNew) {
      useChatStore.getState().addMessage(message);
      const active = useChatStore.getState().activeConversationId === conversation.id;
      // The list is ordered by when a message arrived, not by when a waited one was written.
      const arrivedAt = Math.min(packet.timestamp, Date.now() + MAX_FUTURE_SKEW_MS);
      await this.touchConversation(conversation, { ...message, timestamp: arrivedAt }, !active);
    }

    // Always ACK – even duplicates: our previous ACK may have been lost, causing the retry.
    const ack: AckPlain = { y: 'a', id: chat.id, from: me, to: packet.origin };
    const sealedAck = sealJson(packet.origin, ack);
    if (sealedAck) void this.router?.originate(PacketType.Ack, packet.origin, encodeJson(sealedAck));
  }

  // --------------------------------------------------------------------------------------
  // Conversations
  // --------------------------------------------------------------------------------------

  private async ensureConversation(
    c: Pick<Conversation, 'id' | 'type' | 'title' | 'peerId'>
  ): Promise<Conversation> {
    const existing = useChatStore.getState().conversations.find((x) => x.id === c.id);
    if (existing) return existing;
    const all = await chatRepository.listConversations();
    const stored = all.find((x) => x.id === c.id);
    if (stored) {
      useChatStore.getState().upsertConversation(stored);
      return stored;
    }
    const created: Conversation = {
      ...c,
      createdAt: Date.now(),
      lastMessageAt: 0,
      lastMessagePreview: '',
      unread: 0,
    };
    await chatRepository.upsertConversation(created);
    useChatStore.getState().upsertConversation(created);
    return created;
  }

  private async touchConversation(c: Conversation, m: ChatMessage, incrementUnread: boolean) {
    const current = useChatStore.getState().conversations.find((x) => x.id === c.id) ?? c;
    const preview = m.direction === 'out' ? `Ty: ${m.text}` : m.text;
    const next: Conversation = {
      ...current,
      lastMessageAt: Math.max(current.lastMessageAt, m.timestamp),
      lastMessagePreview: preview.slice(0, 120),
      unread: current.unread + (incrementUnread ? 1 : 0),
    };
    await chatRepository.upsertConversation(next);
    useChatStore.getState().upsertConversation(next);
  }

  /**
   * Keep DM titles in sync with nicks announced in the mesh. Nicks are self-declared, so they
   * never replace a certified office name or the name a contact was verified under.
   */
  private refreshDmTitles(nodes: { nodeId: string; nick: string }[]) {
    const { conversations, upsertConversation } = useChatStore.getState();
    const contacts = useContactsStore.getState();
    for (const n of nodes) {
      const c = conversations.find((x) => x.id === dmConversationId(n.nodeId));
      if (!c) continue;
      const title =
        authorityName(contacts, n.nodeId) ?? (contacts.contacts[n.nodeId]?.verifiedAt ? c.title : n.nick);
      if (title && c.title !== title) {
        const next = { ...c, title };
        upsertConversation(next);
        void chatRepository.upsertConversation(next);
      }
    }
  }

  // --------------------------------------------------------------------------------------
  // Background / battery
  // --------------------------------------------------------------------------------------

  private onAppState = (state: AppStateStatus) => {
    const background = state !== 'active';
    this.background = background;
    // A code is only good while its owner is looking at it – not after switching to another app.
    if (background) this.closeVerificationOffer();
    this.links.setBackground(background);
    this.router?.setAnnounceInterval(background ? ANNOUNCE_BACKGROUND_MS : ANNOUNCE_FOREGROUND_MS);
    if (!background) this.links.rescan();
  };

  private scheduleNotificationUpdate() {
    if (this.notificationTimer) return;
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = null;
      const links = this.links.getLinks().length;
      const nodes = this.router?.getNodes().length ?? 0;
      const text =
        links === 0
          ? 'Szukam urządzeń w pobliżu…'
          : `Połączenia: ${links} · węzły w sieci: ${nodes}`;
      try {
        MeshPeripheral.updateForegroundService('Mesh Chat aktywny', text);
      } catch {}
    }, 2_000);
  }
}

export const MeshService = new MeshServiceImpl();
