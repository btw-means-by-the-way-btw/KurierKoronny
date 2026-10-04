import * as LocalAuthentication from 'expo-local-authentication';

/** True when the phone has a screen lock (PIN, pattern, password or biometrics). */
export async function hasDeviceLock(): Promise<boolean> {
  return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
}

/**
 * Asks the person holding the phone to prove it is theirs (biometrics, or the device PIN as a
 * fallback). This is a gate in the UI, not cryptography: the signing key is already in memory.
 * It stops someone who picked up an unlocked phone, not someone who controls the process.
 */
export async function confirmPresence(promptMessage: string): Promise<boolean> {
  if (!(await hasDeviceLock())) return false;
  const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Anuluj' });
  return result.success;
}
