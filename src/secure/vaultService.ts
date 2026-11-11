/**
 * The ONLY gateway from JS to the Vault native crypto (docs/ARCHITECTURE.md §2).
 * Plaintext entries exist in JS only while a screen shows them; nothing here is persisted
 * outside ciphertext, and nothing secret is logged.
 */
import { ClipboxVault, type ClipboxVaultNative, type PasswordOptions, type UnlockMeta } from 'clipbox-native';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { AppError } from '../core/errors';
import { ulid } from '../core/ulid';
import { getDb } from '../data/db/database';
import { createSettingsRepo } from '../data/repositories/settingsRepo';
import { createVaultRepo, type ModuleMeta } from '../data/repositories/vaultRepo';
import { newEntry, parseEntry, recordAd, SCHEMA_VERSION, serializeEntry, type VaultEntry, type VaultEntryType } from '../domain/vault/entries';
import { masterPasswordProblem } from '../domain/vault/strength';
import { nativeCode, secureError } from './errors';

const M = 'vault' as const;
const repo = () => createVaultRepo(getDb());
const settings = () => createSettingsRepo(getDb());

function native(): ClipboxVaultNative {
  if (!ClipboxVault) throw new AppError('UNKNOWN', 'Защищённое хранилище недоступно в этой сборке приложения');
  return ClipboxVault;
}

async function call<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw secureError(e);
  }
}

export type VaultStatus = 'loading' | 'unavailable' | 'not_setup' | 'locked' | 'unlocked';

interface VaultState {
  status: VaultStatus;
  biometricEnabled: boolean;
  hasRecovery: boolean;
  autoLockSec: number;
}

export const useVaultState = create<VaultState>(() => ({ status: 'loading', biometricEnabled: false, hasRecovery: false, autoLockSec: 60 }));

function applyPolicy(meta: ModuleMeta) {
  // Idle lock from settings; background lock is immediate for the Vault.
  ClipboxVault?.setLockPolicy(M, meta.autoLockSec * 1000, 0);
}

export async function refreshVault(): Promise<VaultStatus> {
  if (!ClipboxVault) {
    useVaultState.setState({ status: 'unavailable' });
    return 'unavailable';
  }
  const meta = await repo().getMeta(M);
  if (!meta) {
    useVaultState.setState({ status: 'not_setup', biometricEnabled: false, hasRecovery: false });
    return 'not_setup';
  }
  applyPolicy(meta);
  const status: VaultStatus = ClipboxVault.isUnlocked(M) ? 'unlocked' : 'locked';
  useVaultState.setState({ status, biometricEnabled: !!meta.wrappedBio && ClipboxVault.hasBiometricKey(M), hasRecovery: !!meta.wrappedRecovery, autoLockSec: meta.autoLockSec });
  return status;
}

let appStateSub: { remove(): void } | null = null;
/** Keeps JS lock state in sync with native auto-lock (background / idle). */
export function watchVaultLock() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', () => void refreshVault());
}

async function requireMeta(): Promise<ModuleMeta> {
  const meta = await repo().getMeta(M);
  if (!meta) throw new AppError('AUTH_REQUIRED', 'Vault ещё не настроен');
  return meta;
}

const unlockMeta = (m: ModuleMeta): UnlockMeta => ({ kdfParams: m.kdfParams, wrappedPw: m.wrappedPw, wrappedRecovery: m.wrappedRecovery, wrappedBio: m.wrappedBio, dekCheck: m.dekCheck });

// ---------------------------------------------------------------- lifecycle

/** First-time setup. Returns the recovery key to show ONCE (or null if the user declined it). */
export async function setupVault(password: string, withRecovery: boolean): Promise<string | null> {
  const problem = masterPasswordProblem(password);
  if (problem) throw new AppError('VALIDATION', problem);
  if (await repo().getMeta(M)) throw new AppError('VALIDATION', 'Vault уже настроен');
  const r = await call(() => native().setup(M, password, withRecovery));
  await repo().createMeta(M, { kdfParams: r.kdfParams, wrappedPw: r.wrappedPw, wrappedRecovery: r.wrappedRecovery ?? null, dekCheck: r.dekCheck });
  await refreshVault();
  return r.recoveryKey ?? null;
}

const MAX_FREE_ATTEMPTS = 5;

export async function unlockDelayMs(now = Date.now()): Promise<number> {
  const f = await settings().get('vaultUnlockFailures');
  return Math.max(0, f.until - now);
}

export async function unlockWithPassword(password: string): Promise<void> {
  const wait = await unlockDelayMs();
  if (wait > 0) throw new AppError('AUTH_REQUIRED', `Слишком много попыток. Подождите ${Math.ceil(wait / 1000)} с`);
  const meta = await requireMeta();
  try {
    await call(() => native().unlockWithPassword(M, password, unlockMeta(meta)));
    await settings().set('vaultUnlockFailures', { count: 0, until: 0 });
  } catch (e) {
    const err = secureError(e);
    if (err.code === 'CRYPTO_AUTH_FAILED') {
      const f = await settings().get('vaultUnlockFailures');
      const count = f.count + 1;
      const delay = count < MAX_FREE_ATTEMPTS ? 0 : Math.min(15 * 60_000, 1000 * 2 ** (count - MAX_FREE_ATTEMPTS + 2));
      await settings().set('vaultUnlockFailures', { count, until: Date.now() + delay });
    }
    throw err;
  } finally {
    await refreshVault();
  }
}

const PROMPT = { title: 'Открыть Vault', subtitle: 'Подтвердите личность', negative: 'Мастер-пароль' };

export async function unlockWithBiometric(): Promise<void> {
  const meta = await requireMeta();
  try {
    await call(() => native().unlockWithBiometric(M, unlockMeta(meta), PROMPT));
  } catch (e) {
    if (nativeCode(e) === 'BIO_INVALIDATED') await repo().setWrappedBio(M, null);
    throw e;
  } finally {
    await refreshVault();
  }
}

export async function unlockWithRecovery(recoveryKey: string, newPassword: string): Promise<void> {
  const problem = masterPasswordProblem(newPassword);
  if (problem) throw new AppError('VALIDATION', problem);
  const meta = await requireMeta();
  await call(() => native().unlockWithRecovery(M, recoveryKey, unlockMeta(meta)));
  const r = await call(() => native().changePassword(M, newPassword));
  await repo().updatePassword(M, r.kdfParams, r.wrappedPw);
  await settings().set('vaultUnlockFailures', { count: 0, until: 0 });
  await refreshVault();
}

export function biometricStatus() {
  return ClipboxVault?.biometricStatus() ?? 'unavailable';
}

export async function enableBiometric(): Promise<void> {
  const wrapped = await call(() => native().enableBiometric(M, { title: 'Включить вход по биометрии', subtitle: null, negative: 'Отмена' }));
  await repo().setWrappedBio(M, wrapped);
  await refreshVault();
}

export async function disableBiometric(): Promise<void> {
  native().disableBiometric(M);
  await repo().setWrappedBio(M, null);
  await refreshVault();
}

/** Verifies the current password, then re-wraps the DEK with the new one (entries are untouched). */
export async function changeMasterPassword(current: string, next: string): Promise<void> {
  const problem = masterPasswordProblem(next);
  if (problem) throw new AppError('VALIDATION', problem);
  await unlockWithPassword(current);
  const r = await call(() => native().changePassword(M, next));
  await repo().updatePassword(M, r.kdfParams, r.wrappedPw);
}

export async function regenerateRecoveryKey(): Promise<string> {
  const r = await call(() => native().newRecoveryKey(M));
  await repo().setWrappedRecovery(M, r.wrappedRecovery);
  await refreshVault();
  return r.recoveryKey;
}

export async function removeRecoveryKey(): Promise<void> {
  await repo().setWrappedRecovery(M, null);
  await refreshVault();
}

export async function setAutoLock(sec: number): Promise<void> {
  await repo().setAutoLock(M, sec);
  await refreshVault();
}

export async function lockVault(): Promise<void> {
  ClipboxVault?.lock(M);
  await ClipboxVault?.clearClipboardIfOurs().catch(() => false);
  await refreshVault();
}

export function touchVault() {
  ClipboxVault?.touch(M);
}

/** Irreversibly destroys the Vault: keys (Keystore + wrapped) and all entries. */
export async function resetVault(): Promise<void> {
  native().destroyModuleKeys(M);
  await repo().wipe(M);
  await settings().set('vaultUnlockFailures', { count: 0, until: 0 });
  await refreshVault();
}

// ---------------------------------------------------------------- entries

export type LoadedEntry = { ok: true; entry: VaultEntry } | { ok: false; id: string; createdAt: number };

export async function listEntries(): Promise<LoadedEntry[]> {
  const rows = await repo().listEntries();
  if (rows.length === 0) return [];
  const plain = await call(() => native().openMany(M, rows.map((r) => [r.payload, recordAd(r.id, r.schemaVer)] as [string, string])));
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
  return parseEntry(await call(() => native().open(M, row.payload, recordAd(row.id, row.schemaVer))));
}

export function draftEntry(type: VaultEntryType): VaultEntry {
  return newEntry(type, ulid(), Date.now());
}

export async function saveEntry(e: VaultEntry): Promise<void> {
  if (!e.title.trim()) throw new AppError('VALIDATION', 'Введите название');
  const entry = { ...e, title: e.title.trim(), updatedAt: Date.now() };
  const payload = await call(() => native().seal(M, serializeEntry(entry), recordAd(entry.id)));
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
  const sec = await settings().get('clipboardClearSec');
  await call(() => native().copySensitive(text, sec * 1000));
  return sec;
}
