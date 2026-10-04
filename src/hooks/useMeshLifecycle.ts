import { useEffect } from 'react';
import { AppState } from 'react-native';

import { MeshService } from '../services/mesh/MeshService';
import { DatabaseKeyError } from '../services/storage/db';
import { useIdentityStore } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import { usePermissionStore } from '../store/permissionStore';

/**
 * Starts the mesh once permissions are granted, the identity keys are available and a nick
 * exists; stops it if permissions get revoked (the user can do that from system settings while
 * the app is running).
 */
export function useMeshLifecycle() {
  const granted = usePermissionStore((s) => s.granted);
  const check = usePermissionStore((s) => s.check);
  const nick = useIdentityStore((s) => s.nick);
  const ready = useIdentityStore((s) => s.status === 'ready');
  const storageError = useMeshStore((s) => s.storageError);

  useEffect(() => {
    if (granted && nick && ready && !storageError) {
      MeshService.start().catch((e) => {
        console.error('Mesh start failed', e);
        // Never "fix" this by deleting data: the user decides on the recovery screen.
        if (e instanceof DatabaseKeyError) useMeshStore.getState().set({ storageError: true });
      });
    } else if (MeshService.isStarted) {
      void MeshService.stop();
    }
  }, [granted, nick, ready, storageError]);

  // Re-verify permissions whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);
}
