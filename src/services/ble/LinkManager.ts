import { BleManager, ConnectionPriority, Device, ScanMode, State, Subscription } from 'react-native-ble-plx';

import { Emitter } from '../../utils/Emitter';
import { fromBase64, fromHex, toBase64 } from '../../utils/bytes';
import { createLogger } from '../../utils/logger';
import {
  ADVERT_VERSION,
  ADVERTISE_MODE,
  CONNECT_TIMEOUT_MS,
  DEFAULT_MTU,
  MANUFACTURER_ID,
  MAX_OUTGOING_LINKS,
  MAX_TOTAL_LINKS,
  MESH_RX_CHAR_UUID,
  MESH_SERVICE_UUID,
  MESH_TX_CHAR_UUID,
  MIN_CONNECT_RSSI,
  NEARBY_TTL_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  REQUESTED_MTU,
  SCAN_PROFILE,
  SHORT_ID_BYTES,
  TIE_BREAK_GRACE_MS,
} from './constants';
import { fragment, Reassembler } from './fragmenter';
import { PeripheralRole } from './PeripheralRole';

const log = createLogger('LinkManager');

export type LinkKind = 'central' | 'peripheral';
export type PowerProfile = keyof typeof SCAN_PROFILE;

/** A direct BLE connection to a neighbour, in either GATT role. */
export interface Link {
  id: string;
  kind: LinkKind;
  /** BLE address of the remote (may be a rotating private address). */
  address: string;
  mtu: number;
  connectedAt: number;
  /** Node id learned from the HELLO handshake. */
  peerNodeId?: string;
  peerNick?: string;
  /** Short id seen in the advertisement (central links only, before HELLO). */
  expectedShortId?: string;
}

export interface NearbyDevice {
  shortId: string;
  address: string;
  rssi: number;
  firstSeen: number;
  lastSeen: number;
  /** Set when a link to this node is up. */
  linkId?: string;
  nodeId?: string;
  nick?: string;
}

export interface RadioState {
  bluetooth: State;
  scanning: boolean;
  advertising: boolean;
  peripheralSupported: boolean;
  error: string | null;
}

type LinkEvents = {
  linkUp: [Link];
  linkDown: [Link];
  packet: [Link, Uint8Array];
  nearbyChanged: [NearbyDevice[]];
  radioChanged: [RadioState];
};

interface CentralLinkInternals {
  writeChain: Promise<unknown>;
  subs: Subscription[];
}

/**
 * Owns every physical BLE link and turns them into a uniform "send packet / receive packet"
 * interface for the mesh router.
 *
 * Topology rules:
 *  - Every node advertises and runs a GATT server (peripheral) AND scans/connects (central).
 *  - To avoid two links between the same pair, only the node with the *smaller* short id
 *    initiates. The other side waits TIE_BREAK_GRACE_MS before connecting anyway (covers
 *    peers that cannot accept connections). Remaining duplicates are resolved after HELLO.
 *  - Outgoing links are capped, so large crowds form a partial mesh rather than a clique;
 *    multi-hop relaying in the router takes care of the rest.
 */
export class LinkManager extends Emitter<LinkEvents> {
  private ble: BleManager | null = null;
  private peripheral = new PeripheralRole();
  private links = new Map<string, Link>();
  private centralInternals = new Map<string, CentralLinkInternals>();
  private reassemblers = new Map<string, Reassembler>();
  private streamIds = new Map<string, number>();
  private nearby = new Map<string, NearbyDevice>();
  private pendingConnects = new Set<string>();
  private backoff = new Map<string, { attempts: number; nextTryAt: number }>();
  private peripheralMtu = new Map<string, number>();
  /** BLE addresses of penalised neighbours → time until which their connections are refused. */
  private blocked = new Map<string, number>();

  private myShortId = '';
  private advertisementPayload = new Uint8Array(0);
  private profile: PowerProfile = 'searching';
  private backgrounded = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private housekeepingTimer: ReturnType<typeof setInterval> | null = null;
  private connectQueueBusy = false;
  private stateSub: Subscription | null = null;
  private started = false;
  private radio: RadioState = {
    bluetooth: State.Unknown,
    scanning: false,
    advertising: false,
    peripheralSupported: false,
    error: null,
  };

  // --------------------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------------------

  start(nodeId: string) {
    if (this.started) return;
    this.started = true;
    const idBytes = fromHex(nodeId).subarray(0, SHORT_ID_BYTES);
    this.myShortId = shortIdFromNodeId(nodeId);
    // Manufacturer payload: [shortId x4][protocol version]
    this.advertisementPayload = new Uint8Array([...idBytes, ADVERT_VERSION]);

    this.ble = new BleManager();
    this.radio.peripheralSupported = this.peripheral.supported;
    this.bindPeripheralEvents();

    this.stateSub = this.ble.onStateChange((state) => {
      this.updateRadio({ bluetooth: state });
      if (state === State.PoweredOn) void this.startRoles();
      else this.stopRoles();
    }, true);

    this.housekeepingTimer = setInterval(() => this.housekeeping(), 2_000);
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    if (this.housekeepingTimer) clearInterval(this.housekeepingTimer);
    this.stateSub?.remove();
    this.stopRoles();
    this.peripheral.dispose();
    await this.ble?.destroy();
    this.ble = null;
  }

  /** Battery profile: background uses low-power scan/advertise and long scan pauses. */
  setBackground(background: boolean) {
    this.backgrounded = background;
    this.peripheral.setAdvertiseMode(background ? ADVERTISE_MODE.lowPower : ADVERTISE_MODE.balanced);
    this.recomputeProfile();
  }

  getLinks(): Link[] {
    return [...this.links.values()];
  }

  getLink(id: string): Link | undefined {
    return this.links.get(id);
  }

  getNearby(): NearbyDevice[] {
    return [...this.nearby.values()].sort((a, b) => b.rssi - a.rssi);
  }

  getRadio(): RadioState {
    return this.radio;
  }

  /** Kick the scanner now (e.g. pull-to-refresh). */
  rescan() {
    if (this.radio.bluetooth !== State.PoweredOn) return;
    this.clearScanTimer();
    this.stopScan();
    this.scanCycle();
  }

  private async startRoles() {
    this.updateRadio({ error: null });
    try {
      const ok = await this.peripheral.start(
        this.advertisementPayload,
        this.backgrounded ? ADVERTISE_MODE.lowPower : ADVERTISE_MODE.balanced
      );
      if (!ok) this.updateRadio({ error: 'Urządzenie nie obsługuje trybu Peripheral – tylko Central.' });
    } catch (e) {
      log.error('Peripheral start failed', e);
      this.updateRadio({ error: `Nie udało się uruchomić serwera GATT: ${String(e)}` });
    }
    this.scanCycle();
  }

  private stopRoles() {
    this.clearScanTimer();
    this.stopScan();
    void this.peripheral.stop();
    for (const link of [...this.links.values()]) this.closeLink(link.id, 'bluetooth off');
    this.pendingConnects.clear();
    this.updateRadio({ advertising: false });
  }

  // --------------------------------------------------------------------------------------
  // Scanning (duty-cycled for battery)
  // --------------------------------------------------------------------------------------

  private recomputeProfile() {
    const next: PowerProfile = this.backgrounded
      ? 'background'
      : this.links.size === 0
        ? 'searching'
        : 'foreground';
    if (next !== this.profile) {
      this.profile = next;
      log.debug('Power profile ->', next);
    }
  }

  private scanCycle = () => {
    if (!this.ble || this.radio.bluetooth !== State.PoweredOn) return;
    const { scanMs, pauseMs } = SCAN_PROFILE[this.profile];
    const scanMode =
      this.profile === 'background'
        ? ScanMode.LowPower
        : this.profile === 'searching'
          ? ScanMode.LowLatency
          : ScanMode.Balanced;

    this.ble
      .startDeviceScan([MESH_SERVICE_UUID], { scanMode, allowDuplicates: true }, (error, device) => {
        if (error) {
          log.warn('Scan error', error.message);
          this.updateRadio({ scanning: false, error: `Błąd skanowania: ${error.message}` });
          return;
        }
        if (device) this.onDiscovered(device);
      })
      .then(() => this.updateRadio({ scanning: true }))
      .catch((e) => {
        log.warn('startDeviceScan failed', e);
        this.updateRadio({ scanning: false });
      });

    this.scanTimer = setTimeout(() => {
      this.stopScan();
      this.maybeConnect();
      this.scanTimer = setTimeout(this.scanCycle, pauseMs);
    }, scanMs);
  };

  private stopScan() {
    if (!this.ble) return;
    this.ble.stopDeviceScan().catch(() => undefined);
    if (this.radio.scanning) this.updateRadio({ scanning: false });
  }

  private clearScanTimer() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  private onDiscovered(device: Device) {
    const shortId = parseShortId(device.manufacturerData);
    if (!shortId || shortId === this.myShortId) return;
    const now = Date.now();
    const existing = this.nearby.get(shortId);
    const rssi = device.rssi ?? -127;
    if (existing) {
      existing.address = device.id;
      // Exponential smoothing – raw RSSI is very noisy.
      existing.rssi = Math.round(existing.rssi * 0.6 + rssi * 0.4);
      existing.lastSeen = now;
    } else {
      this.nearby.set(shortId, { shortId, address: device.id, rssi, firstSeen: now, lastSeen: now });
      this.emitNearby();
      this.maybeConnect();
    }
  }

  // --------------------------------------------------------------------------------------
  // Connection management (central role)
  // --------------------------------------------------------------------------------------

  private isLinkedTo(shortId: string): boolean {
    for (const l of this.links.values()) {
      if (l.expectedShortId === shortId) return true;
      if (l.peerNodeId && shortIdFromNodeId(l.peerNodeId) === shortId) return true;
    }
    return false;
  }

  private shouldInitiate(n: NearbyDevice): boolean {
    if (!this.peripheral.running) return true; // we can't be connected to – must initiate
    if (this.myShortId < n.shortId) return true;
    return Date.now() - n.firstSeen > TIE_BREAK_GRACE_MS;
  }

  /** Picks the best candidates and connects to them one at a time. */
  private maybeConnect() {
    if (this.connectQueueBusy || !this.ble || this.radio.bluetooth !== State.PoweredOn) return;
    const outgoing = [...this.links.values()].filter((l) => l.kind === 'central').length;
    if (outgoing >= MAX_OUTGOING_LINKS || this.links.size >= MAX_TOTAL_LINKS) return;

    const now = Date.now();
    const candidate = [...this.nearby.values()]
      .filter(
        (n) =>
          now - n.lastSeen < 15_000 &&
          n.rssi >= MIN_CONNECT_RSSI &&
          !this.pendingConnects.has(n.shortId) &&
          !this.isLinkedTo(n.shortId) &&
          (this.backoff.get(n.shortId)?.nextTryAt ?? 0) <= now &&
          this.shouldInitiate(n)
      )
      .sort((a, b) => b.rssi - a.rssi)[0];
    if (!candidate) return;

    this.connectQueueBusy = true;
    this.connectCentral(candidate).finally(() => {
      this.connectQueueBusy = false;
      // Chain the next candidate, if any.
      setTimeout(() => this.maybeConnect(), 250);
    });
  }

  private async connectCentral(n: NearbyDevice) {
    const ble = this.ble;
    if (!ble) return;
    const address = n.address;
    this.pendingConnects.add(n.shortId);
    log.info('Connecting to', n.shortId, address, `${n.rssi} dBm`);
    try {
      const device = await ble.connectToDevice(address, {
        requestMTU: REQUESTED_MTU,
        timeout: CONNECT_TIMEOUT_MS,
        autoConnect: false,
      });
      await device.discoverAllServicesAndCharacteristics();
      await ble.requestConnectionPriorityForDevice(address, ConnectionPriority.Balanced).catch(() => undefined);

      const link: Link = {
        id: `c:${address}`,
        kind: 'central',
        address,
        mtu: device.mtu || DEFAULT_MTU,
        connectedAt: Date.now(),
        expectedShortId: n.shortId,
      };
      const internals: CentralLinkInternals = { writeChain: Promise.resolve(), subs: [] };
      this.centralInternals.set(link.id, internals);

      internals.subs.push(
        ble.monitorCharacteristicForDevice(address, MESH_SERVICE_UUID, MESH_TX_CHAR_UUID, (error, ch) => {
          if (error) {
            // Disconnection is handled by onDeviceDisconnected; other errors are fatal for the link.
            if (this.links.has(link.id)) log.debug('monitor error', error.message);
            return;
          }
          if (ch?.value) this.onFrame(link.id, fromBase64(ch.value));
        })
      );
      internals.subs.push(
        ble.onDeviceDisconnected(address, (error) => {
          this.closeLink(link.id, error?.message ?? 'remote disconnected');
        })
      );

      this.backoff.delete(n.shortId);
      this.registerLink(link);
    } catch (e) {
      const prev = this.backoff.get(n.shortId)?.attempts ?? 0;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** prev);
      this.backoff.set(n.shortId, { attempts: prev + 1, nextTryAt: Date.now() + delay });
      log.warn(`Connect to ${n.shortId} failed (retry in ${delay} ms)`, String(e));
      ble.cancelDeviceConnection(address).catch(() => undefined);
    } finally {
      this.pendingConnects.delete(n.shortId);
    }
  }

  // --------------------------------------------------------------------------------------
  // Peripheral role events
  // --------------------------------------------------------------------------------------

  private bindPeripheralEvents() {
    this.peripheral.on('onAdvertisingStateChanged', ({ advertising, error }) => {
      this.updateRadio({ advertising, ...(error ? { error } : {}) });
    });
    this.peripheral.on('onCentralSubscribed', ({ address, mtu }) => {
      this.ensurePeripheralLink(address, mtu);
    });
    this.peripheral.on('onMtuChanged', ({ address, mtu }) => {
      this.peripheralMtu.set(address, mtu);
      const link = this.links.get(`p:${address}`);
      if (link) link.mtu = mtu;
    });
    this.peripheral.on('onCentralDisconnected', ({ address }) => {
      this.peripheralMtu.delete(address);
      this.closeLink(`p:${address}`, 'central left');
    });
    this.peripheral.on('onPacket', ({ address, data }) => {
      const link = this.ensurePeripheralLink(address);
      if (link) this.onFrame(link.id, fromBase64(data));
    });
  }

  private ensurePeripheralLink(address: string, mtu?: number): Link | null {
    const id = `p:${address}`;
    const existing = this.links.get(id);
    if (existing) {
      if (mtu) existing.mtu = mtu;
      return existing;
    }
    if ((this.blocked.get(address) ?? 0) > Date.now()) {
      this.peripheral.disconnect(address);
      return null;
    }
    if (this.links.size >= MAX_TOTAL_LINKS) {
      log.warn('Link limit reached – rejecting central', address);
      this.peripheral.disconnect(address);
      return null;
    }
    const link: Link = {
      id,
      kind: 'peripheral',
      address,
      mtu: mtu ?? this.peripheralMtu.get(address) ?? DEFAULT_MTU,
      connectedAt: Date.now(),
    };
    this.registerLink(link);
    return link;
  }

  // --------------------------------------------------------------------------------------
  // Link bookkeeping
  // --------------------------------------------------------------------------------------

  private registerLink(link: Link) {
    this.links.set(link.id, link);
    this.reassemblers.set(link.id, new Reassembler());
    this.recomputeProfile();
    log.info('Link up', link.id, `mtu=${link.mtu}`);
    this.emit('linkUp', link);
    this.syncNearbyLinks();
  }

  closeLink(linkId: string, reason: string) {
    const link = this.links.get(linkId);
    if (!link) return;
    this.links.delete(linkId);
    this.reassemblers.delete(linkId);
    this.streamIds.delete(linkId);
    const internals = this.centralInternals.get(linkId);
    if (internals) {
      internals.subs.forEach((s) => s.remove());
      this.centralInternals.delete(linkId);
      this.ble?.cancelDeviceConnection(link.address).catch(() => undefined);
    } else if (link.kind === 'peripheral') {
      this.peripheral.disconnect(link.address);
    }
    log.info('Link down', linkId, reason);
    this.recomputeProfile();
    this.emit('linkDown', link);
    this.syncNearbyLinks();
    // A lost neighbour may be reachable again right away (e.g. after a glitch).
    setTimeout(() => this.maybeConnect(), 1_000);
  }

  /**
   * Called by the router once the HELLO handshake proved who is on the other end. A link is
   * bound exactly once. Resolves duplicate links between the same pair of nodes
   * deterministically: both ends keep the link whose central is the node with the smaller id,
   * so they always agree on which one to drop.
   * @returns false if the link did not survive (unknown, mismatching, or dropped as a duplicate).
   */
  bindPeer(linkId: string, myNodeId: string, peerNodeId: string, nick: string): boolean {
    const link = this.links.get(linkId);
    if (!link) return false;
    if (link.peerNodeId) return link.peerNodeId === peerNodeId;
    // We dialled an advertisement carrying a short id – the node behind it must own that id.
    if (link.expectedShortId && shortIdFromNodeId(peerNodeId) !== link.expectedShortId) {
      this.closeLink(linkId, 'node id does not match advertisement');
      return false;
    }
    link.peerNodeId = peerNodeId;
    link.peerNick = nick;
    const duplicates = [...this.links.values()].filter((l) => l.peerNodeId === peerNodeId);
    if (duplicates.length > 1) {
      const iAmSmaller = myNodeId < peerNodeId;
      for (const l of duplicates) {
        const keep = (l.kind === 'central') === iAmSmaller;
        if (!keep) this.closeLink(l.id, 'duplicate link');
      }
    }
    this.syncNearbyLinks();
    return this.links.has(linkId);
  }

  /** Drops a misbehaving neighbour (e.g. forged packets) and keeps it away for a while. */
  penalize(linkId: string, reason: string) {
    const link = this.links.get(linkId);
    if (!link) return;
    const until = Date.now() + RECONNECT_MAX_MS;
    const shortId = link.peerNodeId ? shortIdFromNodeId(link.peerNodeId) : link.expectedShortId;
    if (shortId) this.backoff.set(shortId, { attempts: 6, nextTryAt: until });
    this.blocked.set(link.address, until);
    this.closeLink(linkId, reason);
  }

  // --------------------------------------------------------------------------------------
  // Data path
  // --------------------------------------------------------------------------------------

  private onFrame(linkId: string, frame: Uint8Array) {
    const link = this.links.get(linkId);
    const reassembler = this.reassemblers.get(linkId);
    if (!link || !reassembler) return;
    const packet = reassembler.push(frame);
    if (packet) this.emit('packet', link, packet);
  }

  /** Sends one mesh packet over a link (fragmenting as needed). Resolves false on failure. */
  async send(linkId: string, packet: Uint8Array): Promise<boolean> {
    const link = this.links.get(linkId);
    if (!link) return false;
    const streamId = ((this.streamIds.get(linkId) ?? 0) + 1) & 0xff;
    this.streamIds.set(linkId, streamId);
    let frames: Uint8Array[];
    try {
      frames = fragment(packet, streamId, link.mtu);
    } catch (e) {
      log.warn('fragment failed', e);
      return false;
    }

    if (link.kind === 'peripheral') {
      for (const f of frames) {
        if (!this.peripheral.notify(link.address, f)) return false;
      }
      return true;
    }

    const internals = this.centralInternals.get(linkId);
    const ble = this.ble;
    if (!internals || !ble) return false;
    // Writes on one link are serialised; with-response writes give us natural flow control.
    const result = internals.writeChain.then(async () => {
      for (const f of frames) {
        await ble.writeCharacteristicWithResponseForDevice(
          link.address,
          MESH_SERVICE_UUID,
          MESH_RX_CHAR_UUID,
          toBase64(f)
        );
      }
      return true;
    });
    internals.writeChain = result.catch(() => undefined);
    try {
      return await result;
    } catch (e) {
      log.warn('write failed on', linkId, String(e));
      this.closeLink(linkId, 'write failed');
      return false;
    }
  }

  // --------------------------------------------------------------------------------------
  // Housekeeping & state
  // --------------------------------------------------------------------------------------

  private housekeeping() {
    const now = Date.now();
    let changed = false;
    for (const [id, n] of this.nearby) {
      if (!n.linkId && now - n.lastSeen > NEARBY_TTL_MS) {
        this.nearby.delete(id);
        this.backoff.delete(id);
        changed = true;
      }
    }
    for (const [address, until] of this.blocked) {
      if (until <= now) this.blocked.delete(address);
    }
    if (changed) this.syncNearbyLinks();
    else this.emitNearby();
    this.maybeConnect();
  }

  /** Mirrors link state (node id / nick) into the nearby list shown in the UI. */
  private syncNearbyLinks() {
    for (const n of this.nearby.values()) {
      n.linkId = undefined;
    }
    for (const l of this.links.values()) {
      const shortId = l.peerNodeId ? shortIdFromNodeId(l.peerNodeId) : l.expectedShortId;
      if (!shortId) continue;
      let n = this.nearby.get(shortId);
      if (!n) {
        // Connected to us before we ever scanned it.
        const now = Date.now();
        n = { shortId, address: l.address, rssi: -127, firstSeen: now, lastSeen: now };
        this.nearby.set(shortId, n);
      }
      n.linkId = l.id;
      if (l.peerNodeId) n.nodeId = l.peerNodeId;
      if (l.peerNick) n.nick = l.peerNick;
    }
    this.emitNearby();
  }

  private emitNearby() {
    this.emit('nearbyChanged', this.getNearby());
  }

  private updateRadio(patch: Partial<RadioState>) {
    this.radio = { ...this.radio, ...patch };
    this.emit('radioChanged', this.radio);
  }
}

// ----------------------------------------------------------------------------------------

export function shortIdFromNodeId(nodeId: string): string {
  return nodeId.replace(/-/g, '').slice(0, SHORT_ID_BYTES * 2).toLowerCase();
}

/**
 * Manufacturer data as delivered by ble-plx: [companyId LE u16][shortId x4][version].
 * Nodes speaking another protocol version are ignored – a link to them would only waste a slot.
 */
function parseShortId(manufacturerData: string | null): string | null {
  if (!manufacturerData) return null;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(manufacturerData);
  } catch {
    return null;
  }
  if (bytes.length < 2 + SHORT_ID_BYTES + 1) return null;
  const company = bytes[0] | (bytes[1] << 8);
  if (company !== MANUFACTURER_ID || bytes[2 + SHORT_ID_BYTES] !== ADVERT_VERSION) return null;
  let hex = '';
  for (let i = 2; i < 2 + SHORT_ID_BYTES; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}
