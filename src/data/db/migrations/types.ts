import type { SqlExecutor } from '../types';

export interface Migration {
  version: number;
  name: string;
  up(tx: SqlExecutor): Promise<void>;
}
