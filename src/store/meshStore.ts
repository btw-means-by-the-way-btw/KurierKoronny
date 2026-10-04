import { State } from 'react-native-ble-plx';
import { create } from 'zustand';

import type { Link, NearbyDevice, RadioState } from '../services/ble/LinkManager';
import type { MeshNode } from '../services/mesh/MeshRouter';

export interface LinkSummary {
  id: string;
  kind: Link['kind'];
  peerNodeId?: string;
  peerNick?: string;
  mtu: number;
  connectedAt: number;
}

interface MeshState {
  running: boolean;
  radio: RadioState;
  links: LinkSummary[];
  nearby: NearbyDevice[];
  /** All nodes reachable through the mesh (direct + multi-hop). */
  nodes: MeshNode[];
  /** Median difference between the neighbours' clocks and ours (ms); null without neighbours. */
  clockSkewMs: number | null;
  /** The encrypted database could not be opened (its key is gone or does not match). */
  storageError: boolean;
  set: (patch: Partial<Omit<MeshState, 'set'>>) => void;
}

export const useMeshStore = create<MeshState>((set) => ({
  running: false,
  radio: {
    bluetooth: State.Unknown,
    scanning: false,
    advertising: false,
    peripheralSupported: false,
    error: null,
  },
  links: [],
  nearby: [],
  nodes: [],
  clockSkewMs: null,
  storageError: false,
  set: (patch) => set(patch),
}));

export type NetworkStatus = 'bluetooth_off' | 'offline' | 'searching' | 'connected';

export function selectNetworkStatus(s: Pick<MeshState, 'radio' | 'links' | 'running'>): NetworkStatus {
  if (s.radio.bluetooth !== State.PoweredOn) return 'bluetooth_off';
  if (!s.running) return 'offline';
  return s.links.length > 0 ? 'connected' : 'searching';
}
