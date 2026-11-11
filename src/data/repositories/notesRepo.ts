import { AppError } from '../../core/errors';
import { ulid } from '../../core/ulid';
import type { SqlDb } from '../db/types';
import { createItemsRepo, setTagsTx } from './itemsRepo';

export { normalizeTags } from './itemsRepo';

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

export function createNotesRepo(db: SqlDb, now: () => number = Date.now) {
  const items = createItemsRepo(db, now);
  return {
    ...items,
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
      const tags = await items.getTags(id);
      return {
        id: r.id,
        title: r.title,
        format: r.format,
        body: r.body,
        favorite: r.favorite === 1,
        archived: r.archived === 1,
        deletedAt: r.deleted_at,
        sourcePath: r.source_path,
        tags,
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

  };
}

export type NotesRepo = ReturnType<typeof createNotesRepo>;
