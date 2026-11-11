import { randomBytes } from 'crypto';

import { setRandomSource } from '../src/core/ulid';
import { migrate } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import { createClipsRepo, MAX_META_ATTEMPTS } from '../src/data/repositories/clipsRepo';
import { createCollectionsRepo } from '../src/data/repositories/collectionsRepo';
import { createLibraryRepo } from '../src/data/repositories/libraryRepo';
import { openNodeDb } from './helpers/nodeDb';

setRandomSource((n) => new Uint8Array(randomBytes(n)));

async function setup() {
  const db = openNodeDb();
  await migrate(db, migrations);
  return { db, clips: createClipsRepo(db), cols: createCollectionsRepo(db), lib: createLibraryRepo(db) };
}

describe('clipsRepo', () => {
  it('saves links into Inbox and detects duplicates by canonical URL', async () => {
    const { clips, lib } = await setup();
    const id = await clips.createLink({ url: 'https://youtu.be/x?si=1', canonicalUrl: 'https://youtube.com/watch?v=x', contentType: 'youtube', note: 'watch later' });
    const c = await clips.get(id);
    expect(c).toMatchObject({ inbox: true, metaStatus: 'pending', title: '', note: 'watch later', contentType: 'youtube' });
    expect(await clips.findByCanonical('https://youtube.com/watch?v=x')).toMatchObject({ id });
    expect((await lib.list({ inbox: true })).map((i) => i.id)).toEqual([id]);
    await clips.softDelete(id);
    expect(await clips.findByCanonical('https://youtube.com/watch?v=x')).toBeNull();
  });

  it('metadata never overwrites a user title and makes the clip searchable', async () => {
    const { clips, lib } = await setup();
    const a = await clips.createLink({ url: 'https://a.com', canonicalUrl: 'https://a.com', contentType: 'link' });
    const b = await clips.createLink({ url: 'https://b.com', canonicalUrl: 'https://b.com', contentType: 'link', title: 'Mine' });
    await clips.applyMeta(a, { title: 'Fetched', description: 'about kotlin', siteName: 'A', previewPath: 'previews/p.png', contentType: 'article' });
    await clips.applyMeta(b, { title: 'Fetched', description: null, siteName: null, previewPath: null });
    expect(await clips.get(a)).toMatchObject({ title: 'Fetched', metaStatus: 'ok', contentType: 'article', previewPath: 'previews/p.png' });
    expect((await clips.get(b))!.title).toBe('Mine');
    expect((await lib.search('kotlin')).map((i) => i.id)).toEqual([a]);
  });

  it('gives up after max attempts and allows manual retry', async () => {
    const { clips } = await setup();
    const id = await clips.createLink({ url: 'https://x.com', canonicalUrl: 'https://x.com', contentType: 'link' });
    for (let i = 0; i < MAX_META_ATTEMPTS; i++) {
      expect((await clips.listPendingMeta()).map((p) => p.id)).toEqual([id]);
      await clips.markMetaAttemptFailed(id);
    }
    expect(await clips.listPendingMeta()).toEqual([]);
    expect((await clips.get(id))!.metaStatus).toBe('failed');
    await clips.retryMeta(id);
    expect((await clips.listPendingMeta()).map((p) => p.id)).toEqual([id]);
  });

  it('file clips own their attachment; purge queues files', async () => {
    const { db, clips } = await setup();
    const id = await clips.createFile({
      title: 'doc.pdf',
      contentType: 'pdf',
      attachment: { relPath: 'attachments/a.pdf', originalName: 'doc.pdf', mime: 'application/pdf', size: 3, sha256: 'h' },
    });
    expect(await clips.get(id)).toMatchObject({ attachmentPath: 'attachments/a.pdf', metaStatus: 'skipped', url: null });
    await db.run("UPDATE clips SET preview_path = 'previews/p.png' WHERE item_id = ?", [id]);
    expect((await clips.purge(id)).sort()).toEqual(['attachments/a.pdf', 'previews/p.png']);
  });
});

describe('collectionsRepo', () => {
  it('creates, assigns, counts and filters', async () => {
    const { clips, cols, lib } = await setup();
    const c1 = await cols.create('Read later');
    const c2 = await cols.create('Music');
    await expect(cols.create('  ')).rejects.toMatchObject({ code: 'VALIDATION' });
    const a = await clips.createLink({ url: 'https://a.com', canonicalUrl: 'https://a.com', contentType: 'link', collectionIds: [c1] });
    const b = await clips.createLink({ url: 'https://b.com', canonicalUrl: 'https://b.com', contentType: 'link' });
    await cols.setItemCollections(b, [c1, c2]);
    await cols.setItemCollections(a, [c2]);
    expect((await cols.list()).map((c) => [c.name, c.count])).toEqual([
      ['Music', 2],
      ['Read later', 1],
    ]);
    expect((await lib.list({ collectionId: c1 })).map((i) => i.id)).toEqual([b]);
    await clips.softDelete(b);
    expect((await cols.get(c1))!.count).toBe(0);
    await cols.remove(c2);
    expect(await clips.get(a)).not.toBeNull();
    expect(await cols.search('read')).toHaveLength(1);
  });
});

import { createNotesRepo } from '../src/data/repositories/notesRepo';
import { createRemindersRepo } from '../src/data/repositories/remindersRepo';

describe('global search extras (tags, reminders)', () => {
  it('finds tags with counts, filters by tag, finds reminders, escapes LIKE wildcards', async () => {
    const { db, lib } = await setup();
    const notes = createNotesRepo(db);
    const a = await notes.create({ title: 'A', tags: ['Travel', 'work'] });
    await notes.create({ title: 'B', tags: ['travel'] });
    const gone = await notes.create({ title: 'C', tags: ['travel_100%'] });
    await notes.softDelete(gone);
    expect(await lib.searchTags('trav')).toEqual([{ name: 'Travel', count: 2 }]);
    expect(await lib.searchTags('#WORK')).toEqual([{ name: 'work', count: 1 }]);
    expect(await lib.searchTags('%')).toEqual([]);
    expect((await lib.list({ tag: 'travel' })).length).toBe(2);
    expect((await lib.list({ tag: 'work' })).map((i) => i.id)).toEqual([a]);

    const rem = createRemindersRepo(db);
    await rem.create({ title: 'Позвонить маме', notes: 'про 50% скидку', dueLocal: '2030-01-01T10:00', tz: 'UTC' });
    expect((await rem.search('МАМЕ')).map((r) => r.title)).toEqual(['Позвонить маме']);
    expect((await lib.searchTags('TRAVEL')).length).toBe(1);
    expect((await rem.search('50%')).length).toBe(1);
    expect(await rem.search('_')).toEqual([]);
  });
});
