import { ulid } from '../../core/ulid';
import type { SqlDb, SqlExecutor } from '../db/types';

/** Normalises user-entered tag names: trims, strips leading '#', collapses spaces, dedupes case-insensitively. */
export function normalizeTags(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 64);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export async function setTagsTx(tx: SqlExecutor, itemId: string, names: string[], now: number) {
  const tags = normalizeTags(names);
  await tx.run('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
  for (const name of tags) {
    await tx.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING', [ulid(now), name, now]);
    await tx.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?, id FROM tags WHERE name = ?', [itemId, name]);
  }
}

export type ItemFlag = 'favorite' | 'archived' | 'inbox';

/** Operations shared by every library item kind (notes, clips). */
export function createItemsRepo(db: SqlDb, now: () => number = Date.now) {
  return {
    async getTags(id: string): Promise<string[]> {
      const rows = await db.all<{ name: string }>(
        'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE',
        [id],
      );
      return rows.map((r) => r.name);
    },

    async setTags(id: string, names: string[]): Promise<void> {
      await db.transaction(async (tx) => {
        const t = now();
        await setTagsTx(tx, id, names, t);
        await tx.run('UPDATE library_items SET updated_at = ? WHERE id = ?', [t, id]);
      });
    },

    async setFlag(id: string, flag: ItemFlag, value: boolean): Promise<void> {
      // Column name comes from a closed union, never from user input.
      const col = ({ favorite: 'favorite', archived: 'archived', inbox: 'inbox' } as const)[flag];
      await db.run(`UPDATE library_items SET ${col} = ? WHERE id = ?`, [value ? 1 : 0, id]);
    },

    async setTitle(id: string, title: string): Promise<void> {
      await db.run('UPDATE library_items SET title = ?, updated_at = ? WHERE id = ?', [title, now(), id]);
    },

    /** Sets updated_at explicitly (used when restoring archives to keep original timestamps). */
    async touch(id: string, updatedAt: number): Promise<void> {
      await db.run('UPDATE library_items SET updated_at = ? WHERE id = ?', [updatedAt, id]);
    },

    async softDelete(id: string): Promise<void> {
      await db.run('UPDATE library_items SET deleted_at = ? WHERE id = ?', [now(), id]);
    },

    async restore(id: string): Promise<void> {
      await db.run('UPDATE library_items SET deleted_at = NULL WHERE id = ?', [id]);
    },

    /** Hard delete; attachment and preview files are queued in file_gc and removed after commit. */
    async purge(id: string): Promise<string[]> {
      return db.transaction(async (tx) => {
        const files = await tx.all<{ rel_path: string }>(
          `SELECT rel_path FROM attachments WHERE item_id = ?
           UNION SELECT preview_path FROM clips WHERE item_id = ? AND preview_path IS NOT NULL`,
          [id, id],
        );
        const t = now();
        for (const f of files) await tx.run('INSERT OR IGNORE INTO file_gc (rel_path, queued_at) VALUES (?, ?)', [f.rel_path, t]);
        await tx.run('DELETE FROM library_items WHERE id = ?', [id]);
        return files.map((f) => f.rel_path);
      });
    },

    /** Deletes trashed items older than `olderThanMs`. Returns number purged. */
    async purgeTrash(olderThanMs: number): Promise<number> {
      const rows = await db.all<{ id: string }>('SELECT id FROM library_items WHERE deleted_at IS NOT NULL AND deleted_at < ?', [now() - olderThanMs]);
      for (const r of rows) await this.purge(r.id);
      return rows.length;
    },

    async addAttachment(a: { itemId: string | null; relPath: string; originalName: string | null; mime: string; size: number; sha256: string }): Promise<string> {
      const id = ulid(now());
      await db.run(
        'INSERT INTO attachments (id, item_id, rel_path, original_name, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, a.itemId, a.relPath, a.originalName, a.mime, a.size, a.sha256, now()],
      );
      return id;
    },

    async listAttachments(itemId: string): Promise<{ id: string; relPath: string; originalName: string | null; mime: string; size: number }[]> {
      const rows = await db.all<{ id: string; rel_path: string; original_name: string | null; mime: string; size: number }>(
        'SELECT id, rel_path, original_name, mime, size FROM attachments WHERE item_id = ? ORDER BY created_at',
        [itemId],
      );
      return rows.map((r) => ({ id: r.id, relPath: r.rel_path, originalName: r.original_name, mime: r.mime, size: r.size }));
    },
  };
}

export type ItemsRepo = ReturnType<typeof createItemsRepo>;
