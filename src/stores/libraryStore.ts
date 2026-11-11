import { create } from 'zustand';

import { toAppError, type AppError } from '../core/errors';
import { getDb } from '../data/db/database';
import { createLibraryRepo, type LibraryItemSummary } from '../data/repositories/libraryRepo';
import { createRemindersRepo, type Reminder } from '../data/repositories/remindersRepo';

interface HomeData {
  counts: { notes: number; clips: number; inbox: number; favorites: number };
  recent: LibraryItemSummary[];
  inbox: LibraryItemSummary[];
  favorites: LibraryItemSummary[];
  reminders: Reminder[];
}

interface LibraryState {
  home: HomeData | null;
  error: AppError | null;
  loading: boolean;
  refreshHome(): Promise<void>;
}

/** Read-model cache for Home. Data lives in SQLite; this store only holds the last query result. */
export const useLibraryStore = create<LibraryState>((set) => ({
  home: null,
  error: null,
  loading: false,
  async refreshHome() {
    set({ loading: true });
    try {
      const repo = createLibraryRepo(getDb());
      const [counts, recent, inbox, favorites, reminders] = await Promise.all([
        repo.counts(),
        repo.list({ limit: 8 }),
        repo.list({ inbox: true, limit: 5 }),
        repo.list({ favorite: true, limit: 8 }),
        createRemindersRepo(getDb()).upcoming(3),
      ]);
      set({ home: { counts, recent, inbox, favorites, reminders }, error: null, loading: false });
    } catch (e) {
      set({ error: toAppError(e, 'DB_QUERY_FAILED', 'Не удалось загрузить данные'), loading: false });
    }
  },
}));
