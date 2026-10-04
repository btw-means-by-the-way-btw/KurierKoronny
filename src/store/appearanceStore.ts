import { Appearance } from 'react-native';
import { create } from 'zustand';

import { KV_KEYS, kv } from '../services/storage/kv';

export type ThemePreference = 'system' | 'light' | 'dark';

interface AppearanceState {
  theme: ThemePreference;
  load: () => void;
  setTheme: (theme: ThemePreference) => void;
}

/** Overrides the app-wide color scheme, so `useColorScheme()` and native dialogs follow it. */
const apply = (theme: ThemePreference) => Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);

export const useAppearanceStore = create<AppearanceState>((set) => ({
  theme: 'system',

  load: () => {
    const stored = kv.get(KV_KEYS.theme);
    const theme: ThemePreference = stored === 'light' || stored === 'dark' ? stored : 'system';
    apply(theme);
    set({ theme });
  },

  setTheme: (theme) => {
    kv.set(KV_KEYS.theme, theme);
    apply(theme);
    set({ theme });
  },
}));
