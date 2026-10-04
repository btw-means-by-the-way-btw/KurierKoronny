/**
 * BLE / mesh constants shared by the central (react-native-ble-plx) and
 * peripheral (native MeshPeripheral module) roles.
 */

/** Custom 128-bit service UUID identifying mesh nodes. */
export const MESH_SERVICE_UUID = '7a3f0001-4d2c-4b8e-9f1a-6c5d3e2b1a00';
/** Central -> peripheral: write frames here. */
export const MESH_RX_CHAR_UUID = '7a3f0002-4d2c-4b8e-9f1a-6c5d3e2b1a00';
/** Peripheral -> central: frames are delivered as notifications. */
export const MESH_TX_CHAR_UUID = '7a3f0003-4d2c-4b8e-9f1a-6c5d3e2b1a00';

/** 0xFFFF = "reserved for testing" company id; the payload is the node's 4-byte short id + protocol version. */
export const MANUFACTURER_ID = 0xffff;
export const SHORT_ID_BYTES = 4;
/** Last byte of the advertisement payload; equals the mesh protocol version (packet.ts). */
export const ADVERT_VERSION = 2;

/** ATT MTU we ask for; Android 14+ always negotiates 517. */
export const REQUESTED_MTU = 517;
export const DEFAULT_MTU = 23;

// --- Topology ---------------------------------------------------------------------------
/** Android supports ~7 simultaneous LE connections in total; leave headroom for incoming ones. */
export const MAX_OUTGOING_LINKS = 4;
export const MAX_TOTAL_LINKS = 7;
/** If a peer that should connect to us (tie-break) hasn't done so in this time, we connect anyway. */
export const TIE_BREAK_GRACE_MS = 20_000;
export const CONNECT_TIMEOUT_MS = 10_000;
/** Nearby entries disappear when not heard from for this long. */
export const NEARBY_TTL_MS = 20_000;
/** Minimum RSSI for automatic connection (avoid flaky edge-of-range links). */
export const MIN_CONNECT_RSSI = -95;

// --- Duty cycling (battery) -------------------------------------------------------------
export const SCAN_PROFILE = {
  /** No links yet – search aggressively. */
  searching: { scanMs: 8_000, pauseMs: 2_000 },
  /** Connected, app in foreground. */
  foreground: { scanMs: 6_000, pauseMs: 4_000 },
  /** App in background (foreground service). Android also throttles >5 scan starts / 30 s. */
  background: { scanMs: 5_000, pauseMs: 40_000 },
} as const;

/** AdvertiseSettings.ADVERTISE_MODE_* */
export const ADVERTISE_MODE = { lowPower: 0, balanced: 1, lowLatency: 2 } as const;

/** Reconnect backoff per peer. */
export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 60_000;
