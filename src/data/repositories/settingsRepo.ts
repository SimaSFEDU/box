import type { SqlExecutor } from '../db/types';

/** Typed key/value settings stored as JSON in the `settings` table. */
export interface SettingsShape {
  themeMode: 'system' | 'light' | 'dark';
  homeBlocks: { id: HomeBlockId; visible: boolean }[];
  /** Failed master-password attempts (UI throttling against shoulder-surfing/T1, not offline attacks). */
  vaultUnlockFailures: { count: number; until: number };
  mediaUnlockFailures: { count: number; until: number };
  /** Seconds before a copied secret is cleared from the clipboard. */
  clipboardClearSec: number;
}

export type HomeBlockId = 'inbox' | 'reminders' | 'recent' | 'favorites' | 'private';

export const DEFAULT_SETTINGS: SettingsShape = {
  themeMode: 'system',
  homeBlocks: [
    { id: 'inbox', visible: true },
    { id: 'reminders', visible: true },
    { id: 'recent', visible: true },
    { id: 'favorites', visible: true },
    { id: 'private', visible: true },
  ],
  vaultUnlockFailures: { count: 0, until: 0 },
  mediaUnlockFailures: { count: 0, until: 0 },
  clipboardClearSec: 30,
};

export function createSettingsRepo(db: SqlExecutor) {
  return {
    async get<K extends keyof SettingsShape>(key: K): Promise<SettingsShape[K]> {
      const row = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
      if (!row) return DEFAULT_SETTINGS[key];
      try {
        return JSON.parse(row.value) as SettingsShape[K];
      } catch {
        return DEFAULT_SETTINGS[key];
      }
    },
    async set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): Promise<void> {
      await db.run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, JSON.stringify(value)],
      );
    },
    async getAll(): Promise<SettingsShape> {
      const keys = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsShape)[];
      const out = { ...DEFAULT_SETTINGS };
      for (const k of keys) {
        (out as Record<string, unknown>)[k] = await this.get(k);
      }
      return out;
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
