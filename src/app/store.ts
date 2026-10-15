import { create } from 'zustand';
import type { ThemeName } from '../shared/ui/tokens';

export type Density = 'comfortable' | 'compact';

export interface ExportPayload {
  name: string;
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

interface UiState {
  theme: ThemeName;
  navCollapsed: boolean;
  navOpen: boolean;
  density: Density;
  paletteOpen: boolean;
  chaosOpen: boolean;
  exportOpen: boolean;
  addBackendOpen: boolean;
  overrideColumnId: string | null;
  exportProvider: (() => ExportPayload) | null;
  boot: { label: string; pct: number; ready: boolean; error: string | null };
  setTheme: (t: ThemeName) => void;
  toggleTheme: () => void;
  setNavCollapsed: (v: boolean) => void;
  setNavOpen: (v: boolean) => void;
  setDensity: (d: Density) => void;
  setPaletteOpen: (v: boolean) => void;
  setChaosOpen: (v: boolean) => void;
  setExportOpen: (v: boolean) => void;
  setAddBackendOpen: (v: boolean) => void;
  setOverrideColumn: (id: string | null) => void;
  setExportProvider: (fn: (() => ExportPayload) | null) => void;
  setBoot: (b: Partial<UiState['boot']>) => void;
}

const safeGet = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string): void => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage unavailable (private mode): the preference simply is not persisted */
  }
};

function initialTheme(): ThemeName {
  const fromUrl = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('theme');
  if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl;
  const saved = safeGet('sm-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme(),
  navCollapsed: safeGet('sm-nav-collapsed') === '1',
  navOpen: false,
  density: (safeGet('sm-density') as Density | null) ?? 'comfortable',
  paletteOpen: false,
  chaosOpen: false,
  exportOpen: false,
  addBackendOpen: false,
  overrideColumnId: null,
  exportProvider: null,
  boot: { label: 'Starting', pct: 0, ready: false, error: null },
  setTheme: (theme) => {
    safeSet('sm-theme', theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setNavCollapsed: (navCollapsed) => {
    safeSet('sm-nav-collapsed', navCollapsed ? '1' : '0');
    set({ navCollapsed });
  },
  setNavOpen: (navOpen) => set({ navOpen }),
  setDensity: (density) => {
    safeSet('sm-density', density);
    set({ density });
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setChaosOpen: (chaosOpen) => set({ chaosOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setAddBackendOpen: (addBackendOpen) => set({ addBackendOpen }),
  setOverrideColumn: (overrideColumnId) => set({ overrideColumnId }),
  setExportProvider: (exportProvider) => set({ exportProvider }),
  setBoot: (b) => set((s) => ({ boot: { ...s.boot, ...b } })),
}));
