import { AppError } from '../../core/errors';
import { ulid } from '../../core/ulid';
import type { SqlDb, SqlExecutor } from '../db/types';

export type NoteFormat = 'text' | 'markdown' | 'checklist';

export interface NoteDetail {
  id: string;
  title: string;
  format: NoteFormat;
  body: string;
  favorite: boolean;
  archived: boolean;
  deletedAt: number | null;
  sourcePath: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface NoteRow {
  id: string;
  title: string;
  format: NoteFormat;
  body: string;
  favorite: number;
  archived: number;
  deleted_at: number | null;
  source_path: string | null;
  created_at: number;
  updated_at: number;
}

export interface NewNote {
  /** Explicit id (restoring a Clipbox archive keeps original ids). */
  id?: string;
  title?: string;
  body?: string;
  format?: NoteFormat;
  sourcePath?: string | null;
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

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

async function setTagsTx(tx: SqlExecutor, itemId: string, names: string[], now: number) {
  const tags = normalizeTags(names);
  await tx.run('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
  for (const name of tags) {
    await tx.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING', [ulid(now), name, now]);
    await tx.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?, id FROM tags WHERE name = ?', [itemId, name]);
  }
}

export function createNotesRepo(db: SqlDb, now: () => number = Date.now) {
  return {
    async create(n: NewNote = {}): Promise<string> {
      const t = n.createdAt ?? now();
      const id = n.id ?? ulid(t);
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO library_items (id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
          id,
          'note',
          n.title ?? '',
          t,
          n.updatedAt ?? t,
        ]);
        await tx.run('INSERT INTO notes (item_id, format, body, source_path) VALUES (?, ?, ?, ?)', [
          id,
          n.format ?? 'markdown',
          n.body ?? '',
          n.sourcePath ?? null,
        ]);
        if (n.tags?.length) await setTagsTx(tx, id, n.tags, t);
        if (n.favorite || n.archived) {
          await tx.run('UPDATE library_items SET favorite = ?, archived = ? WHERE id = ?', [n.favorite ? 1 : 0, n.archived ? 1 : 0, id]);
        }
      });
      return id;
    },

    async get(id: string): Promise<NoteDetail | null> {
      const r = await db.first<NoteRow>(
        `SELECT li.id, li.title, n.format, n.body, li.favorite, li.archived, li.deleted_at, n.source_path, li.created_at, li.updated_at
         FROM library_items li JOIN notes n ON n.item_id = li.id WHERE li.id = ?`,
        [id],
      );
      if (!r) return null;
      const tags = await db.all<{ name: string }>(
        'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name COLLATE NOCASE',
        [id],
      );
      return {
        id: r.id,
        title: r.title,
        format: r.format,
        body: r.body,
        favorite: r.favorite === 1,
        archived: r.archived === 1,
        deletedAt: r.deleted_at,
        sourcePath: r.source_path,
        tags: tags.map((t) => t.name),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },

    /** Saves title/body. No-op (and no updated_at bump) when nothing changed. */
    async save(id: string, patch: { title?: string; body?: string; format?: NoteFormat }): Promise<boolean> {
      return db.transaction(async (tx) => {
        const cur = await tx.first<{ title: string; body: string; format: NoteFormat }>(
          'SELECT li.title, n.body, n.format FROM library_items li JOIN notes n ON n.item_id = li.id WHERE li.id = ?',
          [id],
        );
        if (!cur) throw new AppError('DB_QUERY_FAILED', 'Заметка не найдена');
        const title = patch.title ?? cur.title;
        const body = patch.body ?? cur.body;
        const format = patch.format ?? cur.format;
        if (title === cur.title && body === cur.body && format === cur.format) return false;
        const t = now();
        if (body !== cur.body || format !== cur.format) {
          await tx.run('UPDATE notes SET body = ?, format = ? WHERE item_id = ?', [body, format, id]);
        }
        await tx.run('UPDATE library_items SET title = ?, updated_at = ? WHERE id = ?', [title, t, id]);
        return true;
      });
    },

    async setTags(id: string, names: string[]): Promise<void> {
      await db.transaction(async (tx) => {
        const t = now();
        await setTagsTx(tx, id, names, t);
        await tx.run('UPDATE library_items SET updated_at = ? WHERE id = ?', [t, id]);
      });
    },

    async setFlag(id: string, flag: 'favorite' | 'archived' | 'inbox', value: boolean): Promise<void> {
      // Column name is from a closed union, never user input.
      await db.run(`UPDATE library_items SET ${flag} = ? WHERE id = ?`, [value ? 1 : 0, id]);
    },

    async softDelete(id: string): Promise<void> {
      await db.run('UPDATE library_items SET deleted_at = ? WHERE id = ?', [now(), id]);
    },

    async restore(id: string): Promise<void> {
      await db.run('UPDATE library_items SET deleted_at = NULL WHERE id = ?', [id]);
    },

    /** Hard delete; attachment files are queued for GC and removed after commit by the caller. */
    async purge(id: string): Promise<string[]> {
      return db.transaction(async (tx) => {
        const files = await tx.all<{ rel_path: string }>('SELECT rel_path FROM attachments WHERE item_id = ?', [id]);
        const t = now();
        for (const f of files) {
          await tx.run('INSERT OR IGNORE INTO file_gc (rel_path, queued_at) VALUES (?, ?)', [f.rel_path, t]);
        }
        await tx.run('DELETE FROM library_items WHERE id = ?', [id]);
        return files.map((f) => f.rel_path);
      });
    },

    /** Deletes trashed notes older than `olderThanMs`. Returns number purged. */
    async purgeTrash(olderThanMs: number): Promise<number> {
      const rows = await db.all<{ id: string }>(
        "SELECT id FROM library_items WHERE kind = 'note' AND deleted_at IS NOT NULL AND deleted_at < ?",
        [now() - olderThanMs],
      );
      for (const r of rows) await this.purge(r.id);
      return rows.length;
    },

    /** Sets updated_at explicitly (used when restoring archives to keep original timestamps). */
    async touch(id: string, updatedAt: number): Promise<void> {
      await db.run('UPDATE library_items SET updated_at = ? WHERE id = ?', [updatedAt, id]);
    },

    async exists(id: string): Promise<boolean> {
      return (await db.first('SELECT 1 AS x FROM library_items WHERE id = ?', [id])) !== null;
    },

    async existsBySourcePath(path: string): Promise<boolean> {
      return (
        (await db.first(
          'SELECT 1 AS x FROM notes n JOIN library_items li ON li.id = n.item_id WHERE n.source_path = ? AND li.deleted_at IS NULL',
          [path],
        )) !== null
      );
    },

    /** All live notes, for export. */
    async listForExport(): Promise<NoteDetail[]> {
      const ids = await db.all<{ id: string }>(
        "SELECT id FROM library_items WHERE kind = 'note' AND deleted_at IS NULL ORDER BY created_at",
      );
      const out: NoteDetail[] = [];
      for (const { id } of ids) {
        const n = await this.get(id);
        if (n) out.push(n);
      }
      return out;
    },

    async addAttachment(a: { itemId: string | null; relPath: string; originalName: string | null; mime: string; size: number; sha256: string }): Promise<string> {
      const id = ulid(now());
      await db.run(
        'INSERT INTO attachments (id, item_id, rel_path, original_name, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, a.itemId, a.relPath, a.originalName, a.mime, a.size, a.sha256, now()],
      );
      return id;
    },

    async listAttachments(itemId: string): Promise<{ relPath: string; originalName: string | null; mime: string }[]> {
      const rows = await db.all<{ rel_path: string; original_name: string | null; mime: string }>(
        'SELECT rel_path, original_name, mime FROM attachments WHERE item_id = ? ORDER BY created_at',
        [itemId],
      );
      return rows.map((r) => ({ relPath: r.rel_path, originalName: r.original_name, mime: r.mime }));
    },
  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
