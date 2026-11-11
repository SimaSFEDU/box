import { getDb } from '../../data/db/database';
import { runFileGc } from '../../data/files/storage';
import { createNotesRepo, type NoteFormat } from '../../data/repositories/notesRepo';

export const notesRepo = () => createNotesRepo(getDb());

const TEMPLATES: Record<NoteFormat, string> = {
  text: '',
  markdown: '',
  checklist: '- [ ] ',
};

export async function createNote(format: NoteFormat): Promise<string> {
  return notesRepo().create({ format, body: TEMPLATES[format] });
}

/** A note the user opened and left without typing anything is removed instead of cluttering the library. */
export async function discardIfEmpty(id: string): Promise<boolean> {
  const n = await notesRepo().get(id);
  if (!n) return false;
  const untouched = n.title.trim() === '' && (n.body.trim() === '' || n.body === TEMPLATES[n.format]) && n.tags.length === 0;
  if (!untouched) return false;
  await notesRepo().purge(id);
  await runFileGc(getDb());
  return true;
}

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Permanently deletes items and removes their files right after the DB commit. */
export async function purgeAndCollect(ids: string[]): Promise<void> {
  const repo = notesRepo();
  for (const id of ids) await repo.purge(id);
  await runFileGc(getDb());
}

/** Startup housekeeping: drop trash older than the retention window. */
export async function purgeExpiredTrash(): Promise<number> {
  const n = await notesRepo().purgeTrash(TRASH_RETENTION_MS);
  if (n > 0) await runFileGc(getDb());
  return n;
}
