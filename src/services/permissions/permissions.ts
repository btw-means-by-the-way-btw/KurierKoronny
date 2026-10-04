import { Linking, Permission, PermissionsAndroid, Platform } from 'react-native';

export type PermissionState = 'granted' | 'denied' | 'blocked' | 'install_time' | 'not_applicable';

export interface PermissionInfo {
  /** Android manifest name, e.g. android.permission.BLUETOOTH_SCAN */
  name: string;
  label: string;
  reason: string;
  /** Runtime permissions show a system dialog; install-time ones are granted from the manifest. */
  runtime: boolean;
  minSdk?: number;
  maxSdk?: number;
}

const P = PermissionsAndroid.PERMISSIONS;

/**
 * Every permission the app declares. Runtime ones are requested through system dialogs on
 * first launch; install-time ones (normal permissions) are granted automatically and are
 * listed only so the user can see the full picture.
 */
export const PERMISSIONS: PermissionInfo[] = [
  {
    name: P.BLUETOOTH_SCAN,
    label: 'Skanowanie Bluetooth',
    reason: 'Wyszukiwanie pobliskich węzłów sieci mesh.',
    runtime: true,
    minSdk: 31,
  },
  {
    name: P.BLUETOOTH_CONNECT,
    label: 'Połączenia Bluetooth',
    reason: 'Łączenie się z węzłami i przyjmowanie połączeń.',
    runtime: true,
    minSdk: 31,
  },
  {
    name: P.BLUETOOTH_ADVERTISE,
    label: 'Rozgłaszanie Bluetooth',
    reason: 'Pozwala innym urządzeniom znaleźć Twój węzeł.',
    runtime: true,
    minSdk: 31,
  },
  {
    name: P.ACCESS_FINE_LOCATION,
    label: 'Dokładna lokalizacja',
    reason: 'Android wymaga jej do odbierania wyników skanowania BLE. Aplikacja nie używa GPS.',
    runtime: true,
  },
  {
    name: P.ACCESS_COARSE_LOCATION,
    label: 'Przybliżona lokalizacja',
    reason: 'Wymagana razem z dokładną lokalizacją przy skanowaniu BLE.',
    runtime: true,
  },
  {
    name: P.POST_NOTIFICATIONS,
    label: 'Powiadomienia',
    reason: 'Stałe powiadomienie usługi mesh działającej w tle.',
    runtime: true,
    minSdk: 33,
  },
  {
    name: 'android.permission.BLUETOOTH',
    label: 'Bluetooth (starsze Androidy)',
    reason: 'Podstawowy dostęp do Bluetooth na Androidzie 11 i starszym.',
    runtime: false,
    maxSdk: 30,
  },
  {
    name: 'android.permission.BLUETOOTH_ADMIN',
    label: 'Administracja Bluetooth (starsze Androidy)',
    reason: 'Skanowanie i rozgłaszanie na Androidzie 11 i starszym.',
    runtime: false,
    maxSdk: 30,
  },
  {
    name: 'android.permission.FOREGROUND_SERVICE',
    label: 'Usługa pierwszoplanowa',
    reason: 'Utrzymywanie połączeń mesh, gdy aplikacja jest w tle.',
    runtime: false,
  },
  {
    name: 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
    label: 'Usługa: połączone urządzenia',
    reason: 'Typ usługi w tle wymagany od Androida 14.',
    runtime: false,
    minSdk: 34,
  },
];

export const sdkInt = (): number => (Platform.OS === 'android' ? Number(Platform.Version) : 0);

function applies(p: PermissionInfo, sdk = sdkInt()) {
  if (p.minSdk && sdk < p.minSdk) return false;
  if (p.maxSdk && sdk > p.maxSdk) return false;
  return true;
}

/** Runtime permissions that must be granted on this Android version before the app can continue. */
export function requiredRuntimePermissions(): Permission[] {
  return PERMISSIONS.filter((p) => p.runtime && applies(p)).map((p) => p.name as Permission);
}

export type PermissionSnapshot = Record<string, PermissionState>;

export async function checkPermissions(): Promise<PermissionSnapshot> {
  const snapshot: PermissionSnapshot = {};
  for (const p of PERMISSIONS) {
    if (!applies(p)) snapshot[p.name] = 'not_applicable';
    else if (!p.runtime) snapshot[p.name] = 'install_time';
    else snapshot[p.name] = (await PermissionsAndroid.check(p.name as Permission)) ? 'granted' : 'denied';
  }
  return snapshot;
}

export function allRequiredGranted(snapshot: PermissionSnapshot): boolean {
  return requiredRuntimePermissions().every((name) => snapshot[name] === 'granted');
}

export interface RequestResult {
  allGranted: boolean;
  /** At least one permission was denied with "don't ask again" – only Settings can fix it. */
  blocked: boolean;
  snapshot: PermissionSnapshot;
}

/** Shows the Android system permission dialogs for everything still missing. */
export async function requestPermissions(): Promise<RequestResult> {
  const required = requiredRuntimePermissions();
  const results = await PermissionsAndroid.requestMultiple(required);
  const snapshot = await checkPermissions();
  let blocked = false;
  for (const name of required) {
    if (results[name] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      snapshot[name] = 'blocked';
      blocked = true;
    }
  }
  return { allGranted: allRequiredGranted(snapshot), blocked, snapshot };
}

export function openAppSettings() {
  return Linking.openSettings();
}
