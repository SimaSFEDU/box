import { create } from 'zustand';

import { createLogger } from '../core/logger';
import { getDb } from '../data/db/database';
import { createSettingsRepo, DEFAULT_SETTINGS, type SettingsShape } from '../data/repositories/settingsRepo';

const log = createLogger('settings');

interface SettingsState {
  settings: SettingsShape;
  loaded: boolean;
  load(): Promise<void>;
  update<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const settings = await createSettingsRepo(getDb()).getAll();
    set({ settings, loaded: true });
  },
  async update(key, value) {
    const prev = get().settings;
    set({ settings: { ...prev, [key]: value } }); // optimistic
    try {
      await createSettingsRepo(getDb()).set(key, value);
    } catch (e) {
      log.error('persist failed', e);
      set({ settings: prev });
      throw e;
    }
  },
}));
