import { randomBytes } from 'crypto';

import { migrate } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import { createMediaRepo } from '../src/data/repositories/mediaRepo';
import { filterMedia, formatBytes, formatDuration, kindOf, parseMeta, serializeMeta, sizeBucket, sortMedia, type MediaItem } from '../src/domain/media/meta';
import { openNodeDb } from './helpers/nodeDb';

const item = (o: Partial<MediaItem>): MediaItem => ({
  id: 'x',
  collectionId: null,
  blobName: 'b',
  thumbName: null,
  originalName: 'a.jpg',
  mime: 'image/jpeg',
  size: 100,
  width: 10,
  height: 10,
  durationMs: null,
  sha256: '',
  favorite: false,
  note: '',
  addedAt: 1,
  ...o,
});

describe('media meta', () => {
  it('round-trips and validates', () => {
    const m = item({ collectionId: 'c1', note: 'hi' });
    const { id: _i, blobName: _b, thumbName: _t, ...meta } = m;
    expect(parseMeta(serializeMeta(meta))).toEqual(meta);
    expect(() => parseMeta('{}')).toThrow();
  });
  it('classifies kinds and formats values', () => {
    expect(kindOf('image/gif')).toBe('gif');
    expect(kindOf('image/webp')).toBe('image');
    expect(kindOf('video/mp4')).toBe('video');
    expect(kindOf('application/pdf')).toBe('file');
    expect(formatBytes(1536)).toBe('2 КБ');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 МБ');
    expect(formatDuration(65_000)).toBe('1:05');
  });
  it('size bucket hides exact sizes', () => {
    expect(sizeBucket(1_000_000)).toBe(sizeBucket(1_040_000));
    expect(sizeBucket(1_000_000)).toBeLessThan(sizeBucket(3_000_000));
  });
  it('filters and sorts', () => {
    const list = [
      item({ id: 'a', originalName: 'b.png', addedAt: 1, size: 5, favorite: true }),
      item({ id: 'b', originalName: 'A.mp4', mime: 'video/mp4', addedAt: 3, size: 50, collectionId: 'c', note: 'beach' }),
      item({ id: 'c', originalName: 'c.gif', mime: 'image/gif', addedAt: 2, size: 1 }),
    ];
    expect(sortMedia(list, 'newest').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortMedia(list, 'name').map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(sortMedia(list, 'size').map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(filterMedia(list, { favorites: true }).map((i) => i.id)).toEqual(['a']);
    expect(filterMedia(list, { collectionId: 'c' }).map((i) => i.id)).toEqual(['b']);
    expect(filterMedia(list, { query: 'BEACH' }).map((i) => i.id)).toEqual(['b']);
    expect(filterMedia(list, { kind: 'gif' }).map((i) => i.id)).toEqual(['c']);
  });
});

describe('mediaRepo', () => {
  it('stores ciphertext only, keeps media when a collection is deleted, wipes everything', async () => {
    const db = openNodeDb();
    await migrate(db, migrations);
    const repo = createMediaRepo(db);
    const b = (n: number) => Buffer.from(randomBytes(n)).toString('base64');
    await repo.putCollection('c1', b(40));
    await repo.insert({ id: 'm1', collectionId: 'c1', blobName: 'x.bin', thumbName: 't.bin', meta: b(200), sizeBucket: 10 });
    await repo.insert({ id: 'm2', collectionId: null, blobName: 'y.bin', thumbName: null, meta: b(200), sizeBucket: 3 });
    expect((await db.first<{ t: string }>('SELECT typeof(meta) AS t FROM private_media'))!.t).toBe('blob');
    expect((await repo.list()).map((r) => r.id).sort()).toEqual(['m1', 'm2']);
    await repo.removeCollection('c1');
    expect((await repo.list()).find((r) => r.id === 'm1')!.collectionId).toBeNull();
    await repo.setCollection(['m2'], null);
    expect((await repo.ids()).sort()).toEqual(['m1', 'm2']);
    expect(await db.first('SELECT * FROM search_items')).toBeNull();
    const files = await repo.wipe();
    expect(files.map((f) => f[0]).sort()).toEqual(['x.bin', 'y.bin']);
    expect(await repo.list()).toEqual([]);
  });
});
