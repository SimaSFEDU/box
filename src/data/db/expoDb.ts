import * as SQLite from 'expo-sqlite';

import type { SqlDb, SqlExecutor, SqlParams } from './types';

type ExpoExecutor = Pick<SQLite.SQLiteDatabase, 'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync'>;

function wrap(db: ExpoExecutor): SqlExecutor {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlParams = []) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: <T,>(sql: string, params: SqlParams = []) => db.getAllAsync<T>(sql, params),
    first: <T,>(sql: string, params: SqlParams = []) => db.getFirstAsync<T>(sql, params),
  };
}

export async function openExpoDb(name: string): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;',
  );
  const base = wrap(db);
  return {
    ...base,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      let out: T | undefined;
      await db.withExclusiveTransactionAsync(async (txn) => {
        out = await fn(wrap(txn));
      });
      return out as T;
    },
    close: () => db.closeAsync(),
  };
}
