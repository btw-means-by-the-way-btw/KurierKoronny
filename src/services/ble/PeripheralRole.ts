import MeshPeripheral, {
  MeshPeripheralModuleEvents,
} from "../../../modules/mesh-peripheral";
import { toBase64 } from "../../utils/bytes";
import { createLogger } from "../../utils/logger";
import {
  ADVERTISE_MODE,
  MANUFACTURER_ID,
  MESH_RX_CHAR_UUID,
  MESH_SERVICE_UUID,
  MESH_TX_CHAR_UUID,
} from "./constants";

const log = createLogger("Peripheral");

/**
 * Thin wrapper around the native MeshPeripheral module (GATT server + advertiser).
 * react-native-ble-plx only implements the central role, so the peripheral role lives in
 * modules/mesh-peripheral (Kotlin).
 */
export class PeripheralRole {
  private subs: { remove(): void }[] = [];
  running = false;

  get supported(): boolean {
    try {
      return MeshPeripheral.isPeripheralSupported();
    } catch {
      return false;
    }
  }

  on<K extends keyof MeshPeripheralModuleEvents>(
    event: K,
    fn: MeshPeripheralModuleEvents[K],
  ) {
    this.subs.push(MeshPeripheral.addListener(event, fn));
  }

  async start(
    advertisementPayload: Uint8Array,
    mode: number = ADVERTISE_MODE.balanced,
  ) {
    if (!this.supported) {
      log.warn("Peripheral role not supported – running central-only");
      return false;
    }
    await MeshPeripheral.startPeripheral({
      serviceUuid: MESH_SERVICE_UUID,
      rxUuid: MESH_RX_CHAR_UUID,
      txUuid: MESH_TX_CHAR_UUID,
      manufacturerId: MANUFACTURER_ID,
      manufacturerData: toBase64(advertisementPayload),
      advertiseMode: mode,
      txPowerLevel: 3,
    });
    this.running = true;
    return true;
  }

  async stop() {
    this.running = false;
    try {
      await MeshPeripheral.stopPeripheral();
    } catch (e) {
      log.warn("stop failed", e);
    }
  }

  setAdvertiseMode(mode: number) {
    if (this.running) MeshPeripheral.setAdvertiseMode(mode);
  }

  notify(address: string, frame: Uint8Array): boolean {
    return MeshPeripheral.notify(address, toBase64(frame));
  }

  disconnect(address: string) {
    MeshPeripheral.disconnectCentral(address);
  }

  dispose() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }
}
