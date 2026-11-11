import { File } from 'expo-file-system';

import { AppError } from '../../core/errors';
import { ulid } from '../../core/ulid';
import type { ItemsRepo } from '../repositories/itemsRepo';
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

export interface StoredFile {
  relPath: string;
  size: number;
  sha256: string;
}

export const MAX_SHARED_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Copies a picked/shared file (file:// or content://) into app-private attachments storage —
 * never into public directories. Copy goes to a temp name and is renamed only when complete.
 */
export async function copyIntoAttachments(source: File, originalName: string | null, mime: string): Promise<StoredFile> {
  ensureStorage();
  const relPath = `attachments/${ulid()}.${safeExtension(originalName, mime)}`;
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
  const size = target.size ?? 0;
  if (size > MAX_SHARED_FILE_BYTES) {
    target.delete();
    throw new AppError('VALIDATION', 'Файл слишком большой (максимум 200 МБ)');
  }
  return { relPath, size, sha256: await target.digest('SHA-256') };
}

/** Copies a file into attachments and links it to an item. */
export async function importAttachment(
  repo: Pick<ItemsRepo, 'addAttachment'>,
  source: File,
  opts: { itemId: string | null; originalName: string | null; mime: string },
): Promise<{ id: string; relPath: string }> {
  const stored = await copyIntoAttachments(source, opts.originalName, opts.mime);
  const id = await repo.addAttachment({ itemId: opts.itemId, originalName: opts.originalName, mime: opts.mime, ...stored });
  return { id, relPath: stored.relPath };
}
