/** Private Media metadata (encrypted as a whole; only id, blob names and a coarse size bucket are stored in clear). */
export interface MediaMeta {
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sha256: string;
  favorite: boolean;
  note: string;
  addedAt: number;
  /** Mirrors the clear `collection_id` column so encrypted backups keep collection membership. */
  collectionId: string | null;
}

export interface MediaItem extends MediaMeta {
  id: string;
  blobName: string;
  thumbName: string | null;
}

export type MediaKind = 'image' | 'gif' | 'video' | 'file';

export const META_VERSION = 1;
export const metaAd = (id: string) => `media:${id}:${META_VERSION}`;
export const collectionAd = (id: string) => `pcol:${id}:1`;

export function kindOf(mime: string): MediaKind {
  if (mime === 'image/gif') return 'gif';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

/** Power-of-two KiB bucket: enough for rough sorting, does not reveal exact sizes. */
export function sizeBucket(bytes: number): number {
  return bytes <= 0 ? 0 : Math.ceil(Math.log2(Math.max(1, bytes / 1024)));
}

export function parseMeta(json: string): MediaMeta {
  const o = JSON.parse(json) as Partial<MediaMeta>;
  if (typeof o.mime !== 'string' || typeof o.size !== 'number') throw new Error('invalid media meta');
  return {
    originalName: String(o.originalName ?? 'file'),
    mime: o.mime,
    size: o.size,
    width: typeof o.width === 'number' ? o.width : null,
    height: typeof o.height === 'number' ? o.height : null,
    durationMs: typeof o.durationMs === 'number' ? o.durationMs : null,
    sha256: String(o.sha256 ?? ''),
    favorite: !!o.favorite,
    note: String(o.note ?? ''),
    addedAt: Number(o.addedAt ?? 0),
    collectionId: typeof o.collectionId === 'string' ? o.collectionId : null,
  };
}

export const serializeMeta = (m: MediaMeta) => JSON.stringify({ v: META_VERSION, ...m });

export type MediaSort = 'newest' | 'oldest' | 'name' | 'size';

export function sortMedia(items: MediaItem[], sort: MediaSort): MediaItem[] {
  const a = [...items];
  switch (sort) {
    case 'newest':
      return a.sort((x, y) => y.addedAt - x.addedAt);
    case 'oldest':
      return a.sort((x, y) => x.addedAt - y.addedAt);
    case 'name':
      return a.sort((x, y) => x.originalName.localeCompare(y.originalName, 'ru', { sensitivity: 'base', numeric: true }));
    case 'size':
      return a.sort((x, y) => y.size - x.size);
  }
}

export function filterMedia(items: MediaItem[], f: { query?: string; collectionId?: string | null; favorites?: boolean; kind?: MediaKind | 'all' }): MediaItem[] {
  const q = f.query?.trim().toLowerCase() ?? '';
  return items.filter(
    (i) =>
      (f.collectionId === undefined || i.collectionId === f.collectionId) &&
      (!f.favorites || i.favorite) &&
      (!f.kind || f.kind === 'all' || kindOf(i.mime) === f.kind) &&
      (!q || i.originalName.toLowerCase().includes(q) || i.note.toLowerCase().includes(q)),
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const SUPPORTED_PREVIEW = /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|video\/(mp4|webm|quicktime|3gpp|x-matroska))$/;
