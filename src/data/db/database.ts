import { AppError } from '../../core/errors';
import { openExpoDb } from './expoDb';
import { migrate } from './migrate';
import { migrations } from './migrations';
import type { SqlDb } from './types';

export const DB_NAME = 'clipbox.db';

let instance: SqlDb | null = null;

/** Opens the app database and brings its schema up to date. Idempotent. */
export async function initDatabase(): Promise<SqlDb> {
  if (instance) return instance;
  let db: SqlDb;
  try {
    db = await openExpoDb(DB_NAME);
  } catch (e) {
    throw new AppError('DB_OPEN_FAILED', 'Не удалось открыть базу данных', e);
  }
  await migrate(db, migrations);
  const check = await db.first<{ quick_check: string }>('PRAGMA quick_check');
  if (check && check.quick_check !== 'ok') {
    throw new AppError('DB_OPEN_FAILED', 'База данных повреждена');
  }
  instance = db;
  return db;
}

export function getDb(): SqlDb {
  if (!instance) throw new AppError('DB_OPEN_FAILED', 'База данных ещё не открыта');
  return instance;
}
