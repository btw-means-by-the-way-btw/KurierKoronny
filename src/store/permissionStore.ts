import { create } from 'zustand';

import {
  allRequiredGranted,
  checkPermissions,
  PermissionSnapshot,
  requestPermissions,
} from '../services/permissions/permissions';

interface PermissionStoreState {
  checked: boolean;
  granted: boolean;
  blocked: boolean;
  requesting: boolean;
  snapshot: PermissionSnapshot;
  check: () => Promise<boolean>;
  request: () => Promise<{ granted: boolean; blocked: boolean }>;
}

export const usePermissionStore = create<PermissionStoreState>((set, get) => ({
  checked: false,
  granted: false,
  blocked: false,
  requesting: false,
  snapshot: {},

  check: async () => {
    const snapshot = await checkPermissions();
    const granted = allRequiredGranted(snapshot);
    // Keep "blocked" until the user actually grants in Settings.
    set({ snapshot, granted, checked: true, blocked: granted ? false : get().blocked });
    return granted;
  },

  request: async () => {
    if (get().requesting) return { granted: get().granted, blocked: get().blocked };
    set({ requesting: true });
    try {
      const res = await requestPermissions();
      set({ snapshot: res.snapshot, granted: res.allGranted, blocked: res.blocked, checked: true });
      return { granted: res.allGranted, blocked: res.blocked };
    } finally {
      set({ requesting: false });
    }
  },
}));
