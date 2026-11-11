import { m0001_init } from './0001_init';
import type { Migration } from './types';

/** Ordered, append-only. Never edit a migration that has shipped. */
export const migrations: readonly Migration[] = [m0001_init];
