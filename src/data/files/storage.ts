import { Directory, File, Paths } from 'expo-file-system';

import { AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { SqlDb } from '../db/types';

const log = createLogger('files');

/** Standard-tier directories inside the app's private files dir. Protected media is handled natively. */
export const STANDARD_DIRS = ['attachments', 'previews'] as const;
export type StandardDir = (typeof STANDARD_DIRS)[number];

const REL_PATH = /^(attachments|previews)\/[0-9A-Za-z._-]+$/;

function assertRelPath(rel: string) {
  if (!REL_PATH.test(rel) || rel.includes('..')) {
    throw new AppError('VALIDATION', 'Недопустимый путь файла');
  }
}

export function fileFor(rel: string): File {
  assertRelPath(rel);
  return new File(Paths.document, rel);
}

/** Creates storage directories and a .nomedia marker in each (defence in depth vs media scanners). */
export function ensureStorage(): void {
  for (const d of STANDARD_DIRS) {
    const dir = new Directory(Paths.document, d);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const marker = new File(dir, '.nomedia');
    if (!marker.exists) marker.create();
  }
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export async function writeFileAtomic(rel: string, content: Uint8Array | string): Promise<File> {
  const target = fileFor(rel);
  const tmp = new File(target.parentDirectory, `.${target.name}.tmp`);
  try {
    if (tmp.exists) tmp.delete();
    tmp.create();
    await tmp.write(content);
    await tmp.move(target, { overwrite: true });
    return target;
  } catch (e) {
    try {
      if (tmp.exists) tmp.delete();
    } catch {
      /* best effort */
    }
    throw new AppError('FS_WRITE_FAILED', 'Не удалось сохранить файл', e);
  }
}

/** Queues a file for deletion; actual deletion happens after the DB transaction commits. */
export async function queueFileDeletion(db: Pick<SqlDb, 'run'>, rel: string, now = Date.now()): Promise<void> {
  assertRelPath(rel);
  await db.run('INSERT OR IGNORE INTO file_gc (rel_path, queued_at) VALUES (?, ?)', [rel, now]);
}

/** Deletes queued files that are no longer referenced. Safe to run at every startup. */
export async function runFileGc(db: SqlDb): Promise<number> {
  const rows = await db.all<{ rel_path: string }>(`
    SELECT g.rel_path FROM file_gc g
    WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.rel_path = g.rel_path)
      AND NOT EXISTS (SELECT 1 FROM clips c WHERE c.preview_path = g.rel_path)`);
  let removed = 0;
  for (const { rel_path } of rows) {
    try {
      const f = fileFor(rel_path);
      if (f.exists) f.delete();
      await db.run('DELETE FROM file_gc WHERE rel_path = ?', [rel_path]);
      removed++;
    } catch (e) {
      log.warn('gc failed', e);
    }
  }
  // Leftover temp files from interrupted writes.
  for (const d of STANDARD_DIRS) {
    const dir = new Directory(Paths.document, d);
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (entry instanceof File && entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
        entry.delete();
      }
    }
  }
  return removed;
}
