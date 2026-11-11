import { ulid } from '../../core/ulid';
import type { ClipContentType } from '../../domain/clips/url';
import type { SqlDb } from '../db/types';
import { createItemsRepo, setTagsTx } from './itemsRepo';

export type MetaStatus = 'pending' | 'ok' | 'failed' | 'skipped';

export interface ClipDetail {
  id: string;
  title: string;
  url: string | null;
  canonicalUrl: string | null;
  contentType: ClipContentType;
  description: string | null;
  siteName: string | null;
  previewPath: string | null;
  attachmentId: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  note: string | null;
  metaStatus: MetaStatus;
  metaAttempts: number;
  favorite: boolean;
  archived: boolean;
  inbox: boolean;
  deletedAt: number | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  title: string;
  url: string | null;
  canonical_url: string | null;
  content_type: ClipContentType;
  description: string | null;
  site_name: string | null;
  preview_path: string | null;
  attachment_id: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  note: string | null;
  meta_status: MetaStatus;
  meta_attempts: number;
  favorite: number;
  archived: number;
  inbox: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface NewLinkClip {
  url: string;
  canonicalUrl: string | null;
  contentType: ClipContentType;
  title?: string;
  note?: string | null;
  inbox?: boolean;
  tags?: string[];
  collectionIds?: string[];
}

export interface NewFileClip {
  title: string;
  contentType: ClipContentType;
  attachment: { relPath: string; originalName: string | null; mime: string; size: number; sha256: string };
  note?: string | null;
  inbox?: boolean;
  tags?: string[];
  collectionIds?: string[];
}

export const MAX_META_ATTEMPTS = 3;

export function createClipsRepo(db: SqlDb, now: () => number = Date.now) {
  const items = createItemsRepo(db, now);

  async function addToCollections(tx: Pick<SqlDb, 'run'>, id: string, ids: string[] | undefined, t: number) {
    for (const cid of ids ?? []) {
      await tx.run(
        `INSERT OR IGNORE INTO collection_items (collection_id, item_id, position, added_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_items WHERE collection_id = ?), ?)`,
        [cid, id, cid, t],
      );
    }
  }

  return {
    ...items,

    async createLink(c: NewLinkClip): Promise<string> {
      const t = now();
      const id = ulid(t);
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO library_items (id, kind, title, inbox, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
          id,
          'clip',
          c.title ?? '',
          c.inbox === false ? 0 : 1,
          t,
          t,
        ]);
        await tx.run('INSERT INTO clips (item_id, url, canonical_url, content_type, note, meta_status) VALUES (?, ?, ?, ?, ?, ?)', [
          id,
          c.url,
          c.canonicalUrl,
          c.contentType,
          c.note ?? null,
          'pending',
        ]);
        if (c.tags?.length) await setTagsTx(tx, id, c.tags, t);
        await addToCollections(tx, id, c.collectionIds, t);
      });
      return id;
    },

    async createFile(c: NewFileClip): Promise<string> {
      const t = now();
      const id = ulid(t);
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO library_items (id, kind, title, inbox, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
          id,
          'clip',
          c.title,
          c.inbox === false ? 0 : 1,
          t,
          t,
        ]);
        const attId = ulid(t);
        await tx.run(
          'INSERT INTO attachments (id, item_id, rel_path, original_name, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [attId, id, c.attachment.relPath, c.attachment.originalName, c.attachment.mime, c.attachment.size, c.attachment.sha256, t],
        );
        await tx.run('INSERT INTO clips (item_id, content_type, attachment_id, note, meta_status) VALUES (?, ?, ?, ?, ?)', [
          id,
          c.contentType,
          attId,
          c.note ?? null,
          'skipped',
        ]);
        if (c.tags?.length) await setTagsTx(tx, id, c.tags, t);
        await addToCollections(tx, id, c.collectionIds, t);
      });
      return id;
    },

    async get(id: string): Promise<ClipDetail | null> {
      const r = await db.first<Row>(
        `SELECT li.id, li.title, c.url, c.canonical_url, c.content_type, c.description, c.site_name, c.preview_path,
                c.attachment_id, a.rel_path AS attachment_path, a.original_name AS attachment_name, a.mime AS attachment_mime,
                c.note, c.meta_status, c.meta_attempts, li.favorite, li.archived, li.inbox, li.deleted_at, li.created_at, li.updated_at
         FROM library_items li JOIN clips c ON c.item_id = li.id
         LEFT JOIN attachments a ON a.id = c.attachment_id
         WHERE li.id = ?`,
        [id],
      );
      if (!r) return null;
      return {
        id: r.id,
        title: r.title,
        url: r.url,
        canonicalUrl: r.canonical_url,
        contentType: r.content_type,
        description: r.description,
        siteName: r.site_name,
        previewPath: r.preview_path,
        attachmentId: r.attachment_id,
        attachmentPath: r.attachment_path,
        attachmentName: r.attachment_name,
        attachmentMime: r.attachment_mime,
        note: r.note,
        metaStatus: r.meta_status,
        metaAttempts: r.meta_attempts,
        favorite: r.favorite === 1,
        archived: r.archived === 1,
        inbox: r.inbox === 1,
        deletedAt: r.deleted_at,
        tags: await items.getTags(id),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },

    /** Live clip with the same canonical URL, for "already saved" detection. */
    async findByCanonical(canonical: string): Promise<{ id: string; title: string } | null> {
      return db.first<{ id: string; title: string }>(
        `SELECT li.id, li.title FROM clips c JOIN library_items li ON li.id = c.item_id
         WHERE c.canonical_url = ? AND li.deleted_at IS NULL ORDER BY li.created_at DESC LIMIT 1`,
        [canonical],
      );
    },

    async setNote(id: string, note: string): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.run('UPDATE clips SET note = ? WHERE item_id = ?', [note.trim() || null, id]);
        await tx.run('UPDATE library_items SET updated_at = ? WHERE id = ?', [now(), id]);
      });
    },

    /** Clips whose metadata should be (re)fetched. */
    async listPendingMeta(limit = 10): Promise<{ id: string; url: string; title: string }[]> {
      return db.all<{ id: string; url: string; title: string }>(
        `SELECT li.id, c.url, li.title FROM clips c JOIN library_items li ON li.id = c.item_id
         WHERE c.meta_status = 'pending' AND c.url IS NOT NULL AND li.deleted_at IS NULL AND c.meta_attempts < ?
         ORDER BY li.created_at LIMIT ?`,
        [MAX_META_ATTEMPTS, limit],
      );
    },

    /** Records metadata. A user-edited (non-empty) title is never overwritten. */
    async applyMeta(
      id: string,
      m: { title: string | null; description: string | null; siteName: string | null; previewPath: string | null; contentType?: ClipContentType },
    ): Promise<void> {
      await db.transaction(async (tx) => {
        if (m.previewPath) {
          const old = await tx.first<{ preview_path: string | null }>('SELECT preview_path FROM clips WHERE item_id = ?', [id]);
          if (old?.preview_path && old.preview_path !== m.previewPath) {
            await tx.run('INSERT OR IGNORE INTO file_gc (rel_path, queued_at) VALUES (?, ?)', [old.preview_path, now()]);
          }
        }
        await tx.run(
          `UPDATE clips SET description = ?, site_name = ?, preview_path = COALESCE(?, preview_path),
             content_type = COALESCE(?, content_type), meta_status = 'ok', meta_fetched_at = ? WHERE item_id = ?`,
          [m.description, m.siteName, m.previewPath, m.contentType ?? null, now(), id],
        );
        if (m.title) await tx.run("UPDATE library_items SET title = ? WHERE id = ? AND title = ''", [m.title, id]);
      });
    },

    /** Counts a failed attempt; after MAX_META_ATTEMPTS the clip is marked failed (still fully usable). */
    async markMetaAttemptFailed(id: string): Promise<void> {
      await db.run(
        `UPDATE clips SET meta_attempts = meta_attempts + 1,
           meta_status = CASE WHEN meta_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END WHERE item_id = ?`,
        [MAX_META_ATTEMPTS, id],
      );
    },

    async retryMeta(id: string): Promise<void> {
      await db.run("UPDATE clips SET meta_status = 'pending', meta_attempts = 0 WHERE item_id = ? AND url IS NOT NULL", [id]);
    },
  };
}

export type ClipsRepo = ReturnType<typeof createClipsRepo>;
