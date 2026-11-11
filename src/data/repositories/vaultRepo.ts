import { base64ToBytes, bytesToBase64 } from '../../core/base64';
import type { SqlDb } from '../db/types';

/** Protected-tier persistence. Stores only ciphertext and wrapped keys; never plaintext. */
export type ModuleName = 'vault' | 'media';

export interface ModuleMeta {
  kdfParams: string;
  wrappedPw: string;
  wrappedBio: string | null;
  wrappedRecovery: string | null;
  dekCheck: string;
  autoLockSec: number;
}

export interface StoredRecord {
  id: string;
  payload: string;
  schemaVer: number;
  createdAt: number;
  updatedAt: number;
}

const toB64 = (v: unknown): string | null => (v == null ? null : v instanceof Uint8Array ? bytesToBase64(v) : String(v));

export function createVaultRepo(db: SqlDb, now: () => number = Date.now) {
  return {
    async getMeta(m: ModuleName): Promise<ModuleMeta | null> {
      const r = await db.first<{ kdf_params: string; wrapped_dek_pw: Uint8Array; wrapped_dek_bio: Uint8Array | null; wrapped_dek_recovery: Uint8Array | null; dek_check: Uint8Array; auto_lock_sec: number }>(
        'SELECT kdf_params, wrapped_dek_pw, wrapped_dek_bio, wrapped_dek_recovery, dek_check, auto_lock_sec FROM encryption_metadata WHERE module = ?',
        [m],
      );
      if (!r) return null;
      return {
        kdfParams: r.kdf_params,
        wrappedPw: toB64(r.wrapped_dek_pw)!,
        wrappedBio: toB64(r.wrapped_dek_bio),
        wrappedRecovery: toB64(r.wrapped_dek_recovery),
        dekCheck: toB64(r.dek_check)!,
        autoLockSec: r.auto_lock_sec,
      };
    },

    async createMeta(m: ModuleName, meta: Omit<ModuleMeta, 'wrappedBio' | 'autoLockSec'> & { autoLockSec?: number }): Promise<void> {
      const t = now();
      await db.run(
        `INSERT INTO encryption_metadata (module, format_version, kdf, kdf_params, wrapped_dek_pw, wrapped_dek_recovery, dek_check, auto_lock_sec, created_at, updated_at)
         VALUES (?, 1, 'argon2id', ?, ?, ?, ?, ?, ?, ?)`,
        [m, meta.kdfParams, base64ToBytes(meta.wrappedPw), meta.wrappedRecovery ? base64ToBytes(meta.wrappedRecovery) : null, base64ToBytes(meta.dekCheck), meta.autoLockSec ?? 60, t, t],
      );
    },

    async updatePassword(m: ModuleName, kdfParams: string, wrappedPw: string): Promise<void> {
      await db.run('UPDATE encryption_metadata SET kdf_params = ?, wrapped_dek_pw = ?, updated_at = ? WHERE module = ?', [kdfParams, base64ToBytes(wrappedPw), now(), m]);
    },

    async setWrappedBio(m: ModuleName, wrapped: string | null): Promise<void> {
      await db.run('UPDATE encryption_metadata SET wrapped_dek_bio = ?, updated_at = ? WHERE module = ?', [wrapped ? base64ToBytes(wrapped) : null, now(), m]);
    },

    async setWrappedRecovery(m: ModuleName, wrapped: string | null): Promise<void> {
      await db.run('UPDATE encryption_metadata SET wrapped_dek_recovery = ?, updated_at = ? WHERE module = ?', [wrapped ? base64ToBytes(wrapped) : null, now(), m]);
    },

    async setAutoLock(m: ModuleName, sec: number): Promise<void> {
      await db.run('UPDATE encryption_metadata SET auto_lock_sec = ? WHERE module = ?', [sec, m]);
    },

    async listEntries(): Promise<StoredRecord[]> {
      const rows = await db.all<{ id: string; payload: Uint8Array; schema_ver: number; created_at: number; updated_at: number }>('SELECT * FROM vault_entries ORDER BY created_at');
      return rows.map((r) => ({ id: r.id, payload: toB64(r.payload)!, schemaVer: r.schema_ver, createdAt: r.created_at, updatedAt: r.updated_at }));
    },

    async putEntry(id: string, payload: string, schemaVer: number, createdAt: number): Promise<void> {
      await db.run(
        `INSERT INTO vault_entries (id, payload, schema_ver, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, schema_ver = excluded.schema_ver, updated_at = excluded.updated_at`,
        [id, base64ToBytes(payload), schemaVer, createdAt, now()],
      );
    },

    async deleteEntry(id: string): Promise<void> {
      await db.run('DELETE FROM vault_entries WHERE id = ?', [id]);
    },

    /** Irreversible: removes the module's wrapped keys and (for vault) all entries. */
    async wipe(m: ModuleName): Promise<void> {
      await db.transaction(async (tx) => {
        if (m === 'vault') await tx.run('DELETE FROM vault_entries');
        await tx.run('DELETE FROM encryption_metadata WHERE module = ?', [m]);
      });
    },
  };
}

export type VaultRepo = ReturnType<typeof createVaultRepo>;
