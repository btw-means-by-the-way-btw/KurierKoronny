export type PeripheralOptions = {
  serviceUuid: string;
  rxUuid: string;
  txUuid: string;
  /** 16-bit company id for the manufacturer-specific advertisement field. */
  manufacturerId: number;
  /** Base64-encoded bytes placed in the manufacturer-specific field (short node id). */
  manufacturerData: string;
  /** 0 = low power, 1 = balanced, 2 = low latency. */
  advertiseMode?: number;
  /** 0 = ultra low .. 3 = high. */
  txPowerLevel?: number;
};

export type CentralEvent = { address: string; mtu: number };
export type CentralDisconnectedEvent = { address: string };
export type PacketEvent = { address: string; data: string };
export type AdvertisingStateEvent = { advertising: boolean; error: string | null };

export type MeshPeripheralModuleEvents = {
  onCentralSubscribed: (e: CentralEvent) => void;
  onCentralDisconnected: (e: CentralDisconnectedEvent) => void;
  onMtuChanged: (e: CentralEvent) => void;
  onPacket: (e: PacketEvent) => void;
  onAdvertisingStateChanged: (e: AdvertisingStateEvent) => void;
};
