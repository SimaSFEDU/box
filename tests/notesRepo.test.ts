import { randomBytes } from 'crypto';

import { setRandomSource } from '../src/core/ulid';
import { migrate } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import { createLibraryRepo } from '../src/data/repositories/libraryRepo';
import { createNotesRepo, normalizeTags } from '../src/data/repositories/notesRepo';
import { openNodeDb } from './helpers/nodeDb';

setRandomSource((n) => new Uint8Array(randomBytes(n)));

async function setup() {
  const db = openNodeDb();
  await migrate(db, migrations);
  let t = 1000;
  const clock = () => t;
  return { db, notes: createNotesRepo(db, clock), lib: createLibraryRepo(db), tick: (d = 1) => (t += d) };
}

describe('notesRepo', () => {
  it('creates, reads and saves only on change', async () => {
    const { notes, tick } = await setup();
    const id = await notes.create({ title: 'T', body: '# hi', tags: ['#work', 'Work', ' ideas '] });
    const n = await notes.get(id);
    expect(n).toMatchObject({ title: 'T', body: '# hi', format: 'markdown', tags: ['ideas', 'work'], updatedAt: 1000 });
    tick();
    expect(await notes.save(id, { body: '# hi' })).toBe(false);
    expect((await notes.get(id))!.updatedAt).toBe(1000);
    expect(await notes.save(id, { body: '# hello' })).toBe(true);
    expect((await notes.get(id))!).toMatchObject({ body: '# hello', updatedAt: 1001 });
  });

  it('keeps search index in sync through save, tags and trash', async () => {
    const { notes, lib } = await setup();
    const id = await notes.create({ title: 'Groceries', body: 'milk' });
    expect((await lib.search('milk')).map((r) => r.id)).toEqual([id]);
    await notes.save(id, { body: 'bread' });
    expect(await lib.search('milk')).toEqual([]);
    await notes.setTags(id, ['shopping']);
    expect((await lib.search('shopping')).map((r) => r.id)).toEqual([id]);
    await notes.softDelete(id);
    expect(await lib.search('bread')).toEqual([]);
    expect((await lib.list({ trash: true })).map((r) => r.id)).toEqual([id]);
    await notes.restore(id);
    expect((await lib.search('bread')).map((r) => r.id)).toEqual([id]);
  });

  it('purge removes rows and queues attachment files for GC', async () => {
    const { db, notes } = await setup();
    const id = await notes.create({ body: 'x' });
    await notes.addAttachment({ itemId: id, relPath: 'attachments/a.png', originalName: 'a.png', mime: 'image/png', size: 1, sha256: 'h' });
    expect(await notes.purge(id)).toEqual(['attachments/a.png']);
    expect(await notes.get(id)).toBeNull();
    expect(await db.first('SELECT * FROM attachments')).toBeNull();
    expect(await db.all('SELECT rel_path FROM file_gc')).toEqual([{ rel_path: 'attachments/a.png' }]);
  });

  it('purges old trash only', async () => {
    const { notes, tick } = await setup();
    const a = await notes.create({ body: 'a' });
    await notes.softDelete(a);
    tick(10_000);
    const b = await notes.create({ body: 'b' });
    await notes.softDelete(b);
    expect(await notes.purgeTrash(5_000)).toBe(1);
    expect(await notes.get(a)).toBeNull();
    expect(await notes.get(b)).not.toBeNull();
  });

  it('normalizes tags', () => {
    expect(normalizeTags(['#a b', 'A-B', '', '##x'])).toEqual(['a-b', 'x']);
  });
});
