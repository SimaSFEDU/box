import { AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { Migration } from './migrations/types';
import type { SqlDb } from './types';

const log = createLogger('migrate');

export async function getSchemaVersion(db: SqlDb): Promise<number> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const row = await db.first<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  return row?.v ?? 0;
}

/**
 * Applies pending migrations, each in its own exclusive transaction.
 * A failed migration rolls back completely and stops the sequence.
 */
export async function migrate(db: SqlDb, list: readonly Migration[], now: () => number = Date.now): Promise<number> {
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.version <= list[i - 1]!.version) {
      throw new AppError('DB_MIGRATION_FAILED', 'Некорректный порядок миграций');
    }
  }
  const current = await getSchemaVersion(db);
  const latest = list.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new AppError('DB_MIGRATION_FAILED', 'База данных создана более новой версией Clipbox');
  }
  for (const m of list) {
    if (m.version <= current) continue;
    try {
      await db.transaction(async (tx) => {
        await m.up(tx);
        await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
          m.version,
          m.name,
          now(),
        ]);
      });
      log.info(`applied ${m.version}_${m.name}`);
    } catch (e) {
      throw new AppError('DB_MIGRATION_FAILED', 'Не удалось обновить базу данных', e);
    }
  }
  return getSchemaVersion(db);
}
