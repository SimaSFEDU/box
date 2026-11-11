import { File } from 'expo-file-system';

import { AppError } from '../../core/errors';
import { ulid } from '../../core/ulid';
import type { NotesRepo } from '../repositories/notesRepo';
import { ensureStorage, fileFor } from './storage';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'text/plain': 'txt',
};

export function safeExtension(name: string | null, mime: string): string {
  const fromName = name ? /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() : undefined;
  return fromName ?? EXT_BY_MIME[mime] ?? 'bin';
}

/**
 * Copies a picked/shared file into app-private attachments storage (never public dirs) and records it.
 * Copy goes to a temp name first and is renamed only when complete.
 */
export async function importAttachment(
  repo: NotesRepo,
  source: File,
  opts: { itemId: string | null; originalName: string | null; mime: string },
): Promise<{ id: string; relPath: string }> {
  ensureStorage();
  const relPath = `attachments/${ulid()}.${safeExtension(opts.originalName, opts.mime)}`;
  const target = fileFor(relPath);
  const tmp = new File(target.parentDirectory, `.${target.name}.tmp`);
  try {
    if (tmp.exists) tmp.delete();
    await source.copy(tmp);
    await tmp.move(target);
  } catch (e) {
    if (tmp.exists) tmp.delete();
    throw new AppError('FS_WRITE_FAILED', 'Не удалось сохранить вложение', e);
  }
  const sha256 = await target.digest('SHA-256');
  const id = await repo.addAttachment({
    itemId: opts.itemId,
    relPath,
    originalName: opts.originalName,
    mime: opts.mime,
    size: target.size ?? 0,
    sha256,
  });
  return { id, relPath };
}
