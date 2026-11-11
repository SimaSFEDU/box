import { migrate, getSchemaVersion } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import type { Migration } from '../src/data/db/migrations/types';
import { createLibraryRepo } from '../src/data/repositories/libraryRepo';
import { createSettingsRepo, DEFAULT_SETTINGS } from '../src/data/repositories/settingsRepo';
import { openNodeDb } from './helpers/nodeDb';

async function freshDb() {
  const db = openNodeDb();
  await migrate(db, migrations, () => 1);
  return db;
}

async function insertNote(db: Awaited<ReturnType<typeof freshDb>>, id: string, title: string, body: string, t = 1) {
  await db.run('INSERT INTO library_items (id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, 'note', title, t, t]);
  await db.run('INSERT INTO notes (item_id, format, body) VALUES (?, ?, ?)', [id, 'markdown', body]);
}

describe('migrations', () => {
  it('applies all migrations and is idempotent', async () => {
    const db = openNodeDb();
    const latest = migrations.at(-1)!.version;
    expect(await migrate(db, migrations)).toBe(latest);
    expect(await migrate(db, migrations)).toBe(latest);
    const rows = await db.all<{ version: number }>('SELECT version FROM schema_migrations');
    expect(rows).toHaveLength(migrations.length);
  });

  it('rolls back a failing migration completely', async () => {
    const db = openNodeDb();
    const bad: Migration = {
      version: 2,
      name: 'bad',
      async up(tx) {
        await tx.exec('CREATE TABLE half_done (x INTEGER)');
        await tx.exec('THIS IS NOT SQL');
      },
    };
    await expect(migrate(db, [...migrations, bad])).rejects.toMatchObject({ code: 'DB_MIGRATION_FAILED' });
    expect(await getSchemaVersion(db)).toBe(1);
    const t = await db.first("SELECT name FROM sqlite_master WHERE name = 'half_done'");
    expect(t).toBeNull();
  });

  it('refuses to open a database from a newer app version', async () => {
    const db = await freshDb();
    await db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'future', 0)");
    await expect(migrate(db, migrations)).rejects.toMatchObject({ code: 'DB_MIGRATION_FAILED' });
  });

  it('enforces foreign keys and cascades', async () => {
    const db = await freshDb();
    await insertNote(db, 'n1', 'Hello', 'body');
    await db.run("INSERT INTO tags (id, name, created_at) VALUES ('t1', 'work', 1)");
    await db.run("INSERT INTO item_tags (item_id, tag_id) VALUES ('n1', 't1')");
    await expect(db.run("INSERT INTO notes (item_id, format) VALUES ('missing', 'text')")).rejects.toThrow();
    await db.run("DELETE FROM library_items WHERE id = 'n1'");
    expect(await db.first("SELECT * FROM notes WHERE item_id = 'n1'")).toBeNull();
    expect(await db.first("SELECT * FROM item_tags WHERE item_id = 'n1'")).toBeNull();
  });

  it('keeps protected tables free of foreign keys into the standard tier', async () => {
    const db = await freshDb();
    for (const t of ['vault_entries', 'private_media', 'private_collections', 'encryption_metadata']) {
      const fks = await db.all<{ table: string }>(`PRAGMA foreign_key_list(${t})`);
      expect(fks.every((fk) => ['private_collections'].includes(fk.table))).toBe(true);
    }
  });
});

describe('full-text search (triggers)', () => {
  it('indexes notes, follows updates, tags and soft deletes', async () => {
    const db = await freshDb();
    const repo = createLibraryRepo(db);
    await insertNote(db, 'n1', 'Рецепт борща', 'Свёкла, капуста, картофель');
    await insertNote(db, 'n2', 'Kotlin notes', 'coroutines and flows');

    expect((await repo.search('борщ')).map((r) => r.id)).toEqual(['n1']);
    expect((await repo.search('капус')).map((r) => r.id)).toEqual(['n1']);
    expect((await repo.search('svekla')).map((r) => r.id)).toEqual([]);
    expect((await repo.search('coroutine')).map((r) => r.id)).toEqual(['n2']);

    await db.run("UPDATE notes SET body = 'channels' WHERE item_id = 'n2'");
    expect(await repo.search('coroutine')).toHaveLength(0);
    expect((await repo.search('channels')).map((r) => r.id)).toEqual(['n2']);

    await db.run("INSERT INTO tags (id, name, created_at) VALUES ('t1', 'android', 1)");
    await db.run("INSERT INTO item_tags (item_id, tag_id) VALUES ('n2', 't1')");
    expect((await repo.search('android')).map((r) => r.id)).toEqual(['n2']);
    await db.run("UPDATE tags SET name = 'mobile' WHERE id = 't1'");
    expect(await repo.search('android')).toHaveLength(0);
    expect((await repo.search('mobile')).map((r) => r.id)).toEqual(['n2']);

    await db.run("UPDATE library_items SET deleted_at = 5 WHERE id = 'n1'");
    expect(await repo.search('борщ')).toHaveLength(0);
  });

  it('indexes clips by url and site name', async () => {
    const db = await freshDb();
    await db.run("INSERT INTO library_items (id, kind, title, inbox, created_at, updated_at) VALUES ('c1', 'clip', 'Talk', 1, 1, 1)");
    await db.run(
      "INSERT INTO clips (item_id, url, content_type, site_name) VALUES ('c1', 'https://youtube.com/watch?v=x', 'youtube', 'YouTube')",
    );
    const repo = createLibraryRepo(db);
    expect((await repo.search('youtube')).map((r) => r.id)).toEqual(['c1']);
    expect(await repo.counts()).toEqual({ notes: 0, clips: 1, inbox: 1, favorites: 0 });
  });

  it('treats user input as literal text, not FTS syntax', async () => {
    const db = await freshDb();
    await insertNote(db, 'n1', 'a', 'b');
    const repo = createLibraryRepo(db);
    await expect(repo.search('"AND OR NEAR( *')).resolves.toEqual([]);
    await expect(repo.search('   ')).resolves.toEqual([]);
  });
});

describe('library list & settings', () => {
  it('lists newest first with filters', async () => {
    const db = await freshDb();
    await insertNote(db, 'a', 'A', 'x', 1);
    await insertNote(db, 'b', 'B', 'y', 2);
    await db.run("UPDATE library_items SET favorite = 1 WHERE id = 'a'");
    const repo = createLibraryRepo(db);
    expect((await repo.list()).map((r) => r.id)).toEqual(['b', 'a']);
    expect((await repo.list({ favorite: true })).map((r) => r.id)).toEqual(['a']);
  });

  it('round-trips settings and falls back to defaults', async () => {
    const db = await freshDb();
    const s = createSettingsRepo(db);
    expect(await s.get('themeMode')).toBe('system');
    await s.set('themeMode', 'dark');
    expect(await s.get('themeMode')).toBe('dark');
    await db.run("UPDATE settings SET value = '{broken' WHERE key = 'themeMode'");
    expect(await s.get('themeMode')).toBe(DEFAULT_SETTINGS.themeMode);
  });
});
