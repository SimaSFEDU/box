import { base64ToBytes, bytesToBase64 } from '../../core/base64';
import type { SqlDb } from '../db/types';

/** Ciphertext-only persistence for Private Media rows and private collections. */
export interface MediaRow {
  id: string;
  collectionId: string | null;
  blobName: string;
  thumbName: string | null;
  meta: string; // base64 ciphertext
  createdAt: number;
}

export interface CollectionRow {
  id: string;
  payload: string; // base64 ciphertext
  sort: number;
  createdAt: number;
}

const b64 = (v: Uint8Array | string) => (typeof v === 'string' ? v : bytesToBase64(v));

export function createMediaRepo(db: SqlDb, now: () => number = Date.now) {
  return {
    async list(): Promise<MediaRow[]> {
      const rows = await db.all<{ id: string; collection_id: string | null; blob_name: string; thumb_name: string | null; meta: Uint8Array; created_at: number }>(
        'SELECT id, collection_id, blob_name, thumb_name, meta, created_at FROM private_media ORDER BY created_at DESC',
      );
      return rows.map((r) => ({ id: r.id, collectionId: r.collection_id, blobName: r.blob_name, thumbName: r.thumb_name, meta: b64(r.meta), createdAt: r.created_at }));
    },

    async ids(): Promise<string[]> {
      const a = await db.all<{ id: string }>('SELECT id FROM private_media UNION ALL SELECT id FROM private_collections');
      return a.map((r) => r.id);
    },

    async insert(r: Omit<MediaRow, 'createdAt'> & { sizeBucket: number; createdAt?: number }): Promise<void> {
      await db.run(
        'INSERT INTO private_media (id, collection_id, blob_name, thumb_name, meta, size_bucket, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.id, r.collectionId, r.blobName, r.thumbName, base64ToBytes(r.meta), r.sizeBucket, r.createdAt ?? now()],
      );
    },

    async updateMeta(id: string, meta: string): Promise<void> {
      await db.run('UPDATE private_media SET meta = ? WHERE id = ?', [base64ToBytes(meta), id]);
    },

    async setCollection(ids: string[], collectionId: string | null): Promise<void> {
      await db.transaction(async (tx) => {
        for (const id of ids) await tx.run('UPDATE private_media SET collection_id = ? WHERE id = ?', [collectionId, id]);
      });
    },

    async remove(ids: string[]): Promise<void> {
      await db.transaction(async (tx) => {
        for (const id of ids) await tx.run('DELETE FROM private_media WHERE id = ?', [id]);
      });
    },

    async listCollections(): Promise<CollectionRow[]> {
      const rows = await db.all<{ id: string; payload: Uint8Array; sort: number; created_at: number }>('SELECT * FROM private_collections ORDER BY sort, created_at');
      return rows.map((r) => ({ id: r.id, payload: b64(r.payload), sort: r.sort, createdAt: r.created_at }));
    },

    async putCollection(id: string, payload: string, createdAt?: number): Promise<void> {
      await db.run(
        `INSERT INTO private_collections (id, payload, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
        [id, base64ToBytes(payload), createdAt ?? now()],
      );
    },

    /** Deletes a collection; its media stay (collection_id → NULL via FK). */
    async removeCollection(id: string): Promise<void> {
      await db.run('DELETE FROM private_collections WHERE id = ?', [id]);
    },

    async wipe(): Promise<string[][]> {
      return db.transaction(async (tx) => {
        const files = await tx.all<{ blob_name: string; thumb_name: string | null }>('SELECT blob_name, thumb_name FROM private_media');
        await tx.run('DELETE FROM private_media');
        await tx.run('DELETE FROM private_collections');
        await tx.run("DELETE FROM encryption_metadata WHERE module = 'media'");
        return files.map((f) => [f.blob_name, f.thumb_name ?? '']);
      });
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
