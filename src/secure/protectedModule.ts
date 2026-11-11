/**
 * Generic controller for a protected module ('vault' | 'media'): setup, unlock (password /
 * biometrics / recovery key), lock policy and key management. Each module has its own DEK,
 * wrapped keys, Keystore alias and lock policy (SECURITY_DESIGN §4).
 */
import { ClipboxVault, type ClipboxVaultNative, type ProtectedModule, type UnlockMeta } from 'clipbox-native';
import { AppState } from 'react-native';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { AppError } from '../core/errors';
import { getDb } from '../data/db/database';
import { createSettingsRepo } from '../data/repositories/settingsRepo';
import { createVaultRepo, type ModuleMeta } from '../data/repositories/vaultRepo';
import { masterPasswordProblem } from '../domain/vault/strength';
import { nativeCode, secureError } from './errors';

export type ModuleStatus = 'loading' | 'unavailable' | 'not_setup' | 'locked' | 'unlocked';

export interface ModuleState {
  status: ModuleStatus;
  biometricEnabled: boolean;
  hasRecovery: boolean;
  autoLockSec: number;
  backgroundLockSec: number;
}

export function native(): ClipboxVaultNative {
  if (!ClipboxVault) throw new AppError('UNKNOWN', 'Защищённое хранилище недоступно в этой сборке приложения');
  return ClipboxVault;
}

export async function call<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw secureError(e);
  }
}

const repo = () => createVaultRepo(getDb());
const settings = () => createSettingsRepo(getDb());
const unlockMeta = (m: ModuleMeta): UnlockMeta => ({ kdfParams: m.kdfParams, wrappedPw: m.wrappedPw, wrappedRecovery: m.wrappedRecovery, wrappedBio: m.wrappedBio, dekCheck: m.dekCheck });

const MAX_FREE_ATTEMPTS = 5;
const FAILURE_KEY = { vault: 'vaultUnlockFailures', media: 'mediaUnlockFailures' } as const;

export interface ProtectedModuleController {
  module: ProtectedModule;
  useState: UseBoundStore<StoreApi<ModuleState>>;
  refresh(): Promise<ModuleStatus>;
  watch(): void;
  setup(password: string, withRecovery: boolean): Promise<string | null>;
  unlockDelayMs(): Promise<number>;
  unlockWithPassword(password: string): Promise<void>;
  unlockWithBiometric(): Promise<void>;
  unlockWithRecovery(recoveryKey: string, newPassword: string): Promise<void>;
  biometricStatus(): 'available' | 'none_enrolled' | 'unavailable';
  enableBiometric(): Promise<void>;
  disableBiometric(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  regenerateRecoveryKey(): Promise<string>;
  removeRecoveryKey(): Promise<void>;
  setAutoLock(sec: number): Promise<void>;
  lock(): Promise<void>;
  touch(): void;
  destroyKeys(): Promise<void>;
}

export function createProtectedModule(m: ProtectedModule, opts: { title: string; backgroundLockSec: number }): ProtectedModuleController {
  const useState = create<ModuleState>(() => ({ status: 'loading', biometricEnabled: false, hasRecovery: false, autoLockSec: 60, backgroundLockSec: opts.backgroundLockSec }));
  let sub: { remove(): void } | null = null;

  const requireMeta = async () => {
    const meta = await repo().getMeta(m);
    if (!meta) throw new AppError('AUTH_REQUIRED', 'Раздел ещё не настроен');
    return meta;
  };
  const failures = () => settings().get(FAILURE_KEY[m]);
  const setFailures = (v: { count: number; until: number }) => settings().set(FAILURE_KEY[m], v);

  const ctl: ProtectedModuleController = {
    module: m,
    useState,

    async refresh() {
      if (!ClipboxVault) {
        useState.setState({ status: 'unavailable' });
        return 'unavailable';
      }
      const meta = await repo().getMeta(m);
      if (!meta) {
        useState.setState({ status: 'not_setup', biometricEnabled: false, hasRecovery: false });
        return 'not_setup';
      }
      ClipboxVault.setLockPolicy(m, meta.autoLockSec * 1000, opts.backgroundLockSec * 1000);
      const status: ModuleStatus = ClipboxVault.isUnlocked(m) ? 'unlocked' : 'locked';
      useState.setState({ status, biometricEnabled: !!meta.wrappedBio && ClipboxVault.hasBiometricKey(m), hasRecovery: !!meta.wrappedRecovery, autoLockSec: meta.autoLockSec });
      return status;
    },

    watch() {
      if (!sub) sub = AppState.addEventListener('change', () => void ctl.refresh());
    },

    async setup(password, withRecovery) {
      const problem = masterPasswordProblem(password);
      if (problem) throw new AppError('VALIDATION', problem);
      if (await repo().getMeta(m)) throw new AppError('VALIDATION', 'Раздел уже настроен');
      const r = await call(() => native().setup(m, password, withRecovery));
      await repo().createMeta(m, { kdfParams: r.kdfParams, wrappedPw: r.wrappedPw, wrappedRecovery: r.wrappedRecovery ?? null, dekCheck: r.dekCheck, autoLockSec: m === 'media' ? 300 : 60 });
      await ctl.refresh();
      return r.recoveryKey ?? null;
    },

    async unlockDelayMs() {
      return Math.max(0, (await failures()).until - Date.now());
    },

    async unlockWithPassword(password) {
      const wait = await ctl.unlockDelayMs();
      if (wait > 0) throw new AppError('AUTH_REQUIRED', `Слишком много попыток. Подождите ${Math.ceil(wait / 1000)} с`);
      const meta = await requireMeta();
      try {
        await call(() => native().unlockWithPassword(m, password, unlockMeta(meta)));
        await setFailures({ count: 0, until: 0 });
      } catch (e) {
        const err = secureError(e);
        if (err.code === 'CRYPTO_AUTH_FAILED') {
          const count = (await failures()).count + 1;
          const delay = count < MAX_FREE_ATTEMPTS ? 0 : Math.min(15 * 60_000, 1000 * 2 ** (count - MAX_FREE_ATTEMPTS + 2));
          await setFailures({ count, until: Date.now() + delay });
        }
        throw err;
      } finally {
        await ctl.refresh();
      }
    },

    async unlockWithBiometric() {
      const meta = await requireMeta();
      try {
        await call(() => native().unlockWithBiometric(m, unlockMeta(meta), { title: `Открыть ${opts.title}`, subtitle: 'Подтвердите личность', negative: 'Мастер-пароль' }));
      } catch (e) {
        if (nativeCode(e) === 'BIO_INVALIDATED') await repo().setWrappedBio(m, null);
        throw e;
      } finally {
        await ctl.refresh();
      }
    },

    async unlockWithRecovery(recoveryKey, newPassword) {
      const problem = masterPasswordProblem(newPassword);
      if (problem) throw new AppError('VALIDATION', problem);
      const meta = await requireMeta();
      await call(() => native().unlockWithRecovery(m, recoveryKey, unlockMeta(meta)));
      const r = await call(() => native().changePassword(m, newPassword));
      await repo().updatePassword(m, r.kdfParams, r.wrappedPw);
      await setFailures({ count: 0, until: 0 });
      await ctl.refresh();
    },

    biometricStatus() {
      return ClipboxVault?.biometricStatus() ?? 'unavailable';
    },

    async enableBiometric() {
      const wrapped = await call(() => native().enableBiometric(m, { title: 'Включить вход по биометрии', subtitle: opts.title, negative: 'Отмена' }));
      await repo().setWrappedBio(m, wrapped);
      await ctl.refresh();
    },

    async disableBiometric() {
      native().disableBiometric(m);
      await repo().setWrappedBio(m, null);
      await ctl.refresh();
    },

    async changePassword(current, next) {
      const problem = masterPasswordProblem(next);
      if (problem) throw new AppError('VALIDATION', problem);
      await ctl.unlockWithPassword(current);
      const r = await call(() => native().changePassword(m, next));
      await repo().updatePassword(m, r.kdfParams, r.wrappedPw);
    },

    async regenerateRecoveryKey() {
      const r = await call(() => native().newRecoveryKey(m));
      await repo().setWrappedRecovery(m, r.wrappedRecovery);
      await ctl.refresh();
      return r.recoveryKey;
    },

    async removeRecoveryKey() {
      await repo().setWrappedRecovery(m, null);
      await ctl.refresh();
    },

    async setAutoLock(sec) {
      await repo().setAutoLock(m, sec);
      await ctl.refresh();
    },

    async lock() {
      ClipboxVault?.lock(m);
      await ClipboxVault?.clearClipboardIfOurs().catch(() => false);
      await ctl.refresh();
    },

    touch() {
      ClipboxVault?.touch(m);
    },

    async destroyKeys() {
      native().destroyModuleKeys(m);
      await setFailures({ count: 0, until: 0 });
    },
  };
  return ctl;
}
