/**
 * Vault entries + the Vault module controller. The ONLY gateway from JS to Vault crypto
 * (docs/ARCHITECTURE.md §2). Plaintext entries exist in JS only while a screen shows them.
 */
import type { PasswordOptions } from 'clipbox-native';

import { AppError } from '../core/errors';
import { ulid } from '../core/ulid';
import { getDb } from '../data/db/database';
import { createSettingsRepo } from '../data/repositories/settingsRepo';
import { createVaultRepo } from '../data/repositories/vaultRepo';
import { newEntry, parseEntry, recordAd, SCHEMA_VERSION, serializeEntry, type VaultEntry, type VaultEntryType } from '../domain/vault/entries';
import { secureError } from './errors';
import { call, createProtectedModule, native } from './protectedModule';

export const vaultModule = createProtectedModule('vault', { title: 'Vault', backgroundLockSec: 0 });

const repo = () => createVaultRepo(getDb());

export type VaultStatus = import('./protectedModule').ModuleStatus;
export const useVaultState = vaultModule.useState;
export const refreshVault = () => vaultModule.refresh();
export const watchVaultLock = () => vaultModule.watch();
export const setupVault = (pw: string, withRecovery: boolean) => vaultModule.setup(pw, withRecovery);
export const unlockDelayMs = () => vaultModule.unlockDelayMs();
export const unlockWithPassword = (pw: string) => vaultModule.unlockWithPassword(pw);
export const unlockWithBiometric = () => vaultModule.unlockWithBiometric();
export const unlockWithRecovery = (key: string, pw: string) => vaultModule.unlockWithRecovery(key, pw);
export const biometricStatus = () => vaultModule.biometricStatus();
export const enableBiometric = () => vaultModule.enableBiometric();
export const disableBiometric = () => vaultModule.disableBiometric();
export const changeMasterPassword = (cur: string, next: string) => vaultModule.changePassword(cur, next);
export const regenerateRecoveryKey = () => vaultModule.regenerateRecoveryKey();
export const removeRecoveryKey = () => vaultModule.removeRecoveryKey();
export const setAutoLock = (sec: number) => vaultModule.setAutoLock(sec);
export const lockVault = () => vaultModule.lock();
export const touchVault = () => vaultModule.touch();

/** Irreversibly destroys the Vault: keys (Keystore + wrapped) and all entries. */
export async function resetVault(): Promise<void> {
  await vaultModule.destroyKeys();
  await repo().wipe('vault');
  await vaultModule.refresh();
}

// ---------------------------------------------------------------- entries

export type LoadedEntry = { ok: true; entry: VaultEntry } | { ok: false; id: string; createdAt: number };

export async function listEntries(): Promise<LoadedEntry[]> {
  const rows = await repo().listEntries();
  if (rows.length === 0) return [];
  const plain = await call(() => native().openMany('vault', rows.map((r) => [r.payload, recordAd(r.id, r.schemaVer)] as [string, string])));
  return rows.map((r, i) => {
    const p = plain[i];
    if (p == null) return { ok: false, id: r.id, createdAt: r.createdAt };
    try {
      const entry = parseEntry(p);
      return entry.id === r.id ? { ok: true, entry } : { ok: false, id: r.id, createdAt: r.createdAt };
    } catch {
      return { ok: false, id: r.id, createdAt: r.createdAt };
    }
  });
}

export async function getEntry(id: string): Promise<VaultEntry | null> {
  const row = (await repo().listEntries()).find((r) => r.id === id);
  if (!row) return null;
  return parseEntry(await call(() => native().open('vault', row.payload, recordAd(row.id, row.schemaVer))));
}

export function draftEntry(type: VaultEntryType): VaultEntry {
  return newEntry(type, ulid(), Date.now());
}

export async function saveEntry(e: VaultEntry): Promise<void> {
  if (!e.title.trim()) throw new AppError('VALIDATION', 'Введите название');
  const entry = { ...e, title: e.title.trim(), updatedAt: Date.now() };
  const payload = await call(() => native().seal('vault', serializeEntry(entry), recordAd(entry.id)));
  await repo().putEntry(entry.id, payload, SCHEMA_VERSION, entry.createdAt);
}

/** Restores an entry from a backup (plaintext JSON) by re-sealing it with this device's key. */
export async function restoreEntryJson(json: string): Promise<void> {
  const entry = parseEntry(json);
  const payload = await call(() => native().seal('vault', serializeEntry(entry), recordAd(entry.id)));
  await repo().putEntry(entry.id, payload, SCHEMA_VERSION, entry.createdAt);
}

export async function deleteEntry(id: string): Promise<void> {
  await repo().deleteEntry(id);
}

export function generatePassword(o: PasswordOptions): string {
  try {
    return native().generatePassword(o);
  } catch (e) {
    throw secureError(e);
  }
}

export async function copySecret(text: string): Promise<number> {
  const sec = await createSettingsRepo(getDb()).get('clipboardClearSec');
  await call(() => native().copySensitive(text, sec * 1000));
  return sec;
}
