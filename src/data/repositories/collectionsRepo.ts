import { AppError } from '../../core/errors';
import { ulid } from '../../core/ulid';
import type { SqlDb } from '../db/types';

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  count: number;
  updatedAt: number;
}

export function createCollectionsRepo(db: SqlDb, now: () => number = Date.now) {
  return {
    async list(): Promise<Collection[]> {
      const rows = await db.all<{ id: string; name: string; description: string | null; color: string | null; count: number; updated_at: number }>(
        `SELECT c.id, c.name, c.description, c.color, c.updated_at,
           (SELECT COUNT(*) FROM collection_items ci JOIN library_items li ON li.id = ci.item_id
            WHERE ci.collection_id = c.id AND li.deleted_at IS NULL) AS count
         FROM collections c ORDER BY c.sort, c.name COLLATE NOCASE`,
      );
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, color: r.color, count: r.count, updatedAt: r.updated_at }));
    },

    async get(id: string): Promise<Collection | null> {
      return (await this.list()).find((c) => c.id === id) ?? null;
    },

    async create(name: string, description?: string): Promise<string> {
      const n = name.trim();
      if (!n) throw new AppError('VALIDATION', 'Введите название коллекции');
      const t = now();
      const id = ulid(t);
      await db.run('INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, n.slice(0, 100), description?.trim() || null, t, t]);
      return id;
    },

    async rename(id: string, name: string): Promise<void> {
      const n = name.trim();
      if (!n) throw new AppError('VALIDATION', 'Введите название коллекции');
      await db.run('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?', [n.slice(0, 100), now(), id]);
    },

    /** Deletes the collection only; its items stay in the library. */
    async remove(id: string): Promise<void> {
      await db.run('DELETE FROM collections WHERE id = ?', [id]);
    },

    async collectionsOf(itemId: string): Promise<string[]> {
      return (await db.all<{ collection_id: string }>('SELECT collection_id FROM collection_items WHERE item_id = ?', [itemId])).map((r) => r.collection_id);
    },

    /** Replaces the set of collections an item belongs to. */
    async setItemCollections(itemId: string, ids: string[]): Promise<void> {
      await db.transaction(async (tx) => {
        const t = now();
        const keep = new Set(ids);
        const current = (await tx.all<{ collection_id: string }>('SELECT collection_id FROM collection_items WHERE item_id = ?', [itemId])).map((r) => r.collection_id);
        for (const c of current) if (!keep.has(c)) await tx.run('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?', [c, itemId]);
        for (const c of ids) {
          if (current.includes(c)) continue;
          await tx.run(
            `INSERT INTO collection_items (collection_id, item_id, position, added_at)
             VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_items WHERE collection_id = ?), ?)`,
            [c, itemId, c, t],
          );
          await tx.run('UPDATE collections SET updated_at = ? WHERE id = ?', [t, c]);
        }
      });
    },

    /** Searches collections by name (small table → LIKE; see DATABASE_SCHEMA). */
    async search(q: string): Promise<Collection[]> {
      const needle = q.trim().toLowerCase();
      if (!needle) return [];
      return (await this.list()).filter((c) => c.name.toLowerCase().includes(needle));
    },
  };
}

export type CollectionsRepo = ReturnType<typeof createCollectionsRepo>;
