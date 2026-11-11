import type { SqlExecutor } from '../db/types';

export type ItemKind = 'note' | 'clip';

export interface LibraryItemSummary {
  id: string;
  kind: ItemKind;
  title: string;
  favorite: boolean;
  inbox: boolean;
  updatedAt: number;
  previewPath: string | null;
  /** Note excerpt or clip URL/description, for list rows. */
  subtitle: string | null;
  contentType: string | null;
}

interface Row {
  id: string;
  kind: ItemKind;
  title: string;
  favorite: number;
  inbox: number;
  updated_at: number;
  subtitle: string | null;
  content_type: string | null;
  preview_path: string | null;
}

const SELECT = `
SELECT li.id, li.kind, li.title, li.favorite, li.inbox, li.updated_at,
  CASE li.kind
    WHEN 'note' THEN substr(n.body, 1, 160)
    ELSE COALESCE(c.site_name, c.url, c.description)
  END AS subtitle,
  c.content_type AS content_type,
  c.preview_path AS preview_path
FROM library_items li
LEFT JOIN notes n ON n.item_id = li.id
LEFT JOIN clips c ON c.item_id = li.id`;

const map = (r: Row): LibraryItemSummary => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  favorite: r.favorite === 1,
  inbox: r.inbox === 1,
  updatedAt: r.updated_at,
  previewPath: r.preview_path,
  subtitle: r.subtitle,
  contentType: r.content_type,
});

export interface ListFilter {
  kind?: ItemKind;
  favorite?: boolean;
  inbox?: boolean;
  archived?: boolean;
  /** Show trashed items instead of live ones. */
  trash?: boolean;
  collectionId?: string;
  limit?: number;
  offset?: number;
}

/** Escapes user input into a safe FTS5 prefix query: each token quoted, last token prefix-matched. */
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export function createLibraryRepo(db: SqlExecutor) {
  return {
    async list(f: ListFilter = {}): Promise<LibraryItemSummary[]> {
      const where = f.trash ? ['li.deleted_at IS NOT NULL'] : ['li.deleted_at IS NULL', 'li.archived = ?'];
      const params: (string | number)[] = f.trash ? [] : [f.archived ? 1 : 0];
      if (f.kind) {
        where.push('li.kind = ?');
        params.push(f.kind);
      }
      if (f.favorite) where.push('li.favorite = 1');
      if (f.inbox) where.push('li.inbox = 1');
      if (f.collectionId) {
        where.push('li.id IN (SELECT item_id FROM collection_items WHERE collection_id = ?)');
        params.push(f.collectionId);
      }
      params.push(f.limit ?? 50, f.offset ?? 0);
      const rows = await db.all<Row>(
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY li.updated_at DESC LIMIT ? OFFSET ?`,
        params,
      );
      return rows.map(map);
    },

    async counts(): Promise<{ notes: number; clips: number; inbox: number; favorites: number }> {
      const r = await db.first<{ notes: number; clips: number; inbox: number; favorites: number }>(`
        SELECT
          COALESCE(SUM(kind = 'note'), 0) AS notes,
          COALESCE(SUM(kind = 'clip'), 0) AS clips,
          COALESCE(SUM(inbox = 1), 0)     AS inbox,
          COALESCE(SUM(favorite = 1), 0)  AS favorites
        FROM library_items WHERE deleted_at IS NULL AND archived = 0`);
      return r ?? { notes: 0, clips: 0, inbox: 0, favorites: 0 };
    },

    async search(query: string, limit = 50): Promise<LibraryItemSummary[]> {
      const q = toFtsQuery(query);
      if (!q) return [];
      const rows = await db.all<Row>(
        `${SELECT}
         JOIN search_items s ON s.rowid = li.rowid
         WHERE search_items MATCH ? AND li.deleted_at IS NULL
         ORDER BY bm25(search_items, 5.0, 1.0, 2.0) LIMIT ?`,
        [q, limit],
      );
      return rows.map(map);
    },
  };
}

export type LibraryRepo = ReturnType<typeof createLibraryRepo>;
