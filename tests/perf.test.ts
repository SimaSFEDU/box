import { migrate } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import { createLibraryRepo } from '../src/data/repositories/libraryRepo';
import { openNodeDb } from './helpers/nodeDb';

/** Sanity budget for the NFR "10 000 items": queries must stay well under a frame budget on desktop. */
describe('performance with 10k items', () => {
  it('lists, filters and full-text searches quickly', async () => {
    const db = openNodeDb();
    await migrate(db, migrations);
    const words = ['kotlin', 'react', 'рецепт', 'путешествие', 'markdown', 'музыка', 'idea', 'vault', 'android', 'заметка'];
    db.raw.exec('BEGIN');
    const li = db.raw.prepare('INSERT INTO library_items (id, kind, title, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const n = db.raw.prepare('INSERT INTO notes (item_id, format, body) VALUES (?, ?, ?)');
    for (let i = 0; i < 10_000; i++) {
      const id = `id${String(i).padStart(5, '0')}`;
      li.run(id, 'note', `Note ${i} ${words[i % 10]}`, i % 50 === 0 ? 1 : 0, i, i);
      n.run(id, 'markdown', `${words[(i * 7) % 10]} body text ${i} lorem ipsum dolor sit amet `.repeat(5));
    }
    db.raw.exec('COMMIT');
    const repo = createLibraryRepo(db);
    const time = async (fn: () => Promise<unknown>) => {
      const t = performance.now();
      await fn();
      return performance.now() - t;
    };
    expect((await repo.list({ limit: 100 })).length).toBe(100);
    expect(await time(() => repo.list({ limit: 100, offset: 5000 }))).toBeLessThan(50);
    expect(await time(() => repo.list({ favorite: true, limit: 100 }))).toBeLessThan(50);
    expect(await time(() => repo.search('путешеств'))).toBeLessThan(50);
    expect((await repo.search('путешеств', 2000)).length).toBe(2000);
    expect(await time(() => repo.counts())).toBeLessThan(50);
  });
});
