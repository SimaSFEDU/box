/**
 * Private Media gateway. Files are encrypted natively straight from their source stream;
 * JS only handles ids, encrypted metadata and content:// URIs served by SecureMediaProvider
 * (valid only while the module is unlocked; token rotates on every lock/unlock).
 */
import { AppError } from '../core/errors';
import { createLogger } from '../core/logger';
import { ulid } from '../core/ulid';
import { getDb } from '../data/db/database';
import { createMediaRepo } from '../data/repositories/mediaRepo';
import { collectionAd, metaAd, parseMeta, serializeMeta, sizeBucket, type MediaItem, type MediaMeta } from '../domain/media/meta';
import { call, createProtectedModule, native } from './protectedModule';

const log = createLogger('media');

/** Media stays unlocked 60 s in background so the system file picker / share sheet keep working. */
export const mediaModule = createProtectedModule('media', { title: 'Private Media', backgroundLockSec: 60 });
export const useMediaState = mediaModule.useState;

const repo = () => createMediaRepo(getDb());

export interface PrivateCollection {
  id: string;
  name: string;
}

export function mediaUri(item: Pick<MediaItem, 'id' | 'blobName'>): string {
  const n = native();
  return `content://${n.mediaAuthority()}/m/${item.id}/${item.blobName}?t=${n.mediaToken()}`;
}

export function thumbUri(item: Pick<MediaItem, 'id' | 'thumbName'>): string | null {
  if (!item.thumbName) return null;
  const n = native();
  return `content://${n.mediaAuthority()}/t/${item.id}/${item.thumbName}?t=${n.mediaToken()}`;
}

export async function listMedia(): Promise<{ items: MediaItem[]; corrupted: number }> {
  const rows = await repo().list();
  if (rows.length === 0) return { items: [], corrupted: 0 };
  const plain = await call(() => native().openMany('media', rows.map((r) => [r.meta, metaAd(r.id)] as [string, string])));
  const items: MediaItem[] = [];
  let corrupted = 0;
  rows.forEach((r, i) => {
    try {
      const p = plain[i];
      if (p == null) throw new Error('corrupted');
      items.push({ ...parseMeta(p), id: r.id, collectionId: r.collectionId, blobName: r.blobName, thumbName: r.thumbName });
    } catch {
      corrupted++;
    }
  });
  return { items, corrupted };
}

async function sealMeta(id: string, meta: MediaMeta) {
  return call(() => native().seal('media', serializeMeta(meta), metaAd(id)));
}

export interface ImportSource {
  uri: string;
  name: string | null;
  mime: string | null;
}

/** Imports files one by one; a failing file does not abort the rest. */
export async function importMedia(sources: ImportSource[], collectionId: string | null, onProgress?: (done: number) => void): Promise<{ imported: number; failed: number }> {
  let imported = 0;
  let failed = 0;
  for (const s of sources) {
    const id = ulid();
    let blob: string | null = null;
    let thumb: string | null = null;
    try {
      const r = await call(() => native().mediaImport(id, s.uri, s.mime));
      blob = r.blobName;
      thumb = r.thumbName;
      const meta: MediaMeta = {
        originalName: s.name?.trim() || `${r.mime.split('/')[0]}-${new Date().toISOString().slice(0, 10)}`,
        mime: r.mime,
        size: r.size,
        width: r.width,
        height: r.height,
        durationMs: r.durationMs,
        sha256: r.sha256,
        favorite: false,
        note: '',
        addedAt: Date.now(),
        collectionId,
      };
      await repo().insert({ id, collectionId, blobName: r.blobName, thumbName: r.thumbName, meta: await sealMeta(id, meta), sizeBucket: sizeBucket(r.size) });
      imported++;
    } catch (e) {
      log.warn('import failed', e);
      if (blob) native().mediaDelete(blob, thumb);
      failed++;
    }
    onProgress?.(imported + failed);
  }
  return { imported, failed };
}

export async function updateMeta(item: MediaItem, patch: Partial<Pick<MediaMeta, 'favorite' | 'note' | 'originalName' | 'collectionId'>>): Promise<void> {
  const { id, blobName: _b, thumbName: _t, ...meta } = item;
  await repo().updateMeta(id, await sealMeta(id, { ...meta, ...patch }));
}

export async function moveMedia(items: MediaItem[], collectionId: string | null): Promise<void> {
  await repo().setCollection(items.map((i) => i.id), collectionId);
  for (const i of items) await updateMeta(i, { collectionId });
}

/** Deletes rows first (so a crash never leaves rows pointing at missing files), then files. */
export async function deleteMedia(items: Pick<MediaItem, 'id' | 'blobName' | 'thumbName'>[]): Promise<void> {
  await repo().remove(items.map((i) => i.id));
  for (const i of items) native().mediaDelete(i.blobName, i.thumbName);
}

export async function shareMedia(items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;
  if (items.length > 20) throw new AppError('VALIDATION', 'Можно отправить не больше 20 файлов за раз');
  await call(() => native().mediaShare(items.map((i) => ({ id: i.id, blob: i.blobName, name: i.originalName, mime: i.mime })), 'Отправить'));
}

export async function listCollections(): Promise<PrivateCollection[]> {
  const rows = await repo().listCollections();
  if (rows.length === 0) return [];
  const plain = await call(() => native().openMany('media', rows.map((r) => [r.payload, collectionAd(r.id)] as [string, string])));
  return rows.flatMap((r, i) => {
    try {
      return [{ id: r.id, name: String((JSON.parse(plain[i] ?? 'null') as { name: string }).name) }];
    } catch {
      return [];
    }
  });
}

export async function saveCollection(name: string, id: string = ulid()): Promise<string> {
  const n = name.trim().slice(0, 100);
  if (!n) throw new AppError('VALIDATION', 'Введите название');
  await repo().putCollection(id, await call(() => native().seal('media', JSON.stringify({ name: n }), collectionAd(id))));
  return id;
}

export async function deleteCollection(id: string): Promise<void> {
  await repo().removeCollection(id);
}

/** Irreversibly destroys Private Media: keys, metadata and all encrypted files. */
export async function resetMedia(): Promise<void> {
  await mediaModule.destroyKeys();
  const files = await repo().wipe();
  for (const [b, t] of files) native().mediaDelete(b ?? null, t || null);
  await mediaModule.refresh();
}
