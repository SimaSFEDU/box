import { getDb } from '../../data/db/database';
import { createLibraryRepo, type ListFilter } from '../../data/repositories/libraryRepo';
import { createRemindersRepo } from '../../data/repositories/remindersRepo';
import { createSettingsRepo, type SettingsShape } from '../../data/repositories/settingsRepo';

/** Read helpers for screens (keeps src/app free of direct DB access). */
export const listLibrary = (f: ListFilter) => createLibraryRepo(getDb()).list(f);

export async function searchExtras(query: string) {
  const db = getDb();
  return { tags: await createLibraryRepo(db).searchTags(query), reminders: await createRemindersRepo(db).search(query, 5) };
}

export async function itemTitle(id: string): Promise<string | null> {
  const r = await getDb().first<{ title: string }>('SELECT title FROM library_items WHERE id = ? AND deleted_at IS NULL', [id]);
  return r ? r.title || 'Без названия' : null;
}

export const getSetting = <K extends keyof SettingsShape>(k: K) => createSettingsRepo(getDb()).get(k);
export const setSetting = <K extends keyof SettingsShape>(k: K, v: SettingsShape[K]) => createSettingsRepo(getDb()).set(k, v);
