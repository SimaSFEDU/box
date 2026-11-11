import Database from 'better-sqlite3';

import type { SqlDb, SqlExecutor, SqlParams } from '../../src/data/db/types';

/** better-sqlite3 adapter implementing the same SqlDb contract as expo-sqlite. */
export function openNodeDb(path = ':memory:'): SqlDb & { raw: Database.Database } {
  const raw = new Database(path);
  raw.pragma('foreign_keys = ON');
  const conv = (p: SqlParams = []) => p.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : v));
  const exec: SqlExecutor = {
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, p) => ({ changes: raw.prepare(sql).run(...conv(p)).changes }),
    all: async <T,>(sql: string, p?: SqlParams) => raw.prepare(sql).all(...conv(p)) as T[],
    first: async <T,>(sql: string, p?: SqlParams) => (raw.prepare(sql).get(...conv(p)) as T | undefined) ?? null,
  };
  return {
    ...exec,
    raw,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(exec);
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close: async () => {
      raw.close();
    },
  };
}
