/**
 * Driver-agnostic SQL interface. The app uses expo-sqlite (expoDb.ts);
 * tests use better-sqlite3 with identical SQL, so migrations and repositories
 * are verified against a real SQLite engine.
 */
export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = SqlValue[];

export interface RunResult {
  changes: number;
}

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<RunResult>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  first<T>(sql: string, params?: SqlParams): Promise<T | null>;
}

export interface SqlDb extends SqlExecutor {
  /** Runs `fn` in an exclusive transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
