import { useCallback, useEffect, useRef, useState } from 'react';

import { toAppError, type AppError } from '../../core/errors';
import { getDb } from '../../data/db/database';
import { createLibraryRepo, type ItemKind, type LibraryItemSummary } from '../../data/repositories/libraryRepo';

export type LibraryScope = 'all' | ItemKind;
export type LibraryFilter = 'none' | 'favorites' | 'archive' | 'trash';

/** Lists library items, or runs FTS search when `query` is non-empty. Debounced, stale responses dropped. */
export function useLibraryQuery(scope: LibraryScope, query: string, filter: LibraryFilter = 'none') {
  const [items, setItems] = useState<LibraryItemSummary[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const repo = createLibraryRepo(getDb());
      const kind = scope === 'all' ? undefined : scope;
      const res =
        query.trim() && filter === 'none'
          ? (await repo.search(query, 100)).filter((i) => !kind || i.kind === kind)
          : await repo.list({
              kind,
              limit: 300,
              favorite: filter === 'favorites',
              archived: filter === 'archive',
              trash: filter === 'trash',
            });
      if (id !== seq.current) return;
      setItems(res);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      setError(toAppError(e, 'DB_QUERY_FAILED', 'Не удалось загрузить библиотеку'));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [scope, query, filter]);

  useEffect(() => {
    const t = setTimeout(load, query ? 150 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  return { items, error, loading, reload: load };
}
