import { NativeModule, requireNativeModule } from 'expo';

import { CentralEvent, MeshPeripheralModuleEvents, PeripheralOptions } from './MeshPeripheral.types';

declare class MeshPeripheralModule extends NativeModule<MeshPeripheralModuleEvents> {
  isPeripheralSupported(): boolean;
  isBluetoothEnabled(): boolean;
  isRunning(): boolean;
  requestEnableBluetooth(): boolean;
  startPeripheral(options: PeripheralOptions): Promise<void>;
  stopPeripheral(): Promise<void>;
  setAdvertiseMode(mode: number): void;
  /** Queue a base64 frame as a TX notification. Returns false when the central is gone or its queue is full. */
  notify(address: string, base64: string): boolean;
  disconnectCentral(address: string): void;
  getSubscribedCentrals(): CentralEvent[];
  startForegroundService(title: string, text: string): boolean;
  updateForegroundService(title: string, text: string): boolean;
  stopForegroundService(): void;
}

export default requireNativeModule<MeshPeripheralModule>('MeshPeripheral');
