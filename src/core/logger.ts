/**
 * Minimal leveled logger.
 * - In release builds only warn/error are emitted.
 * - Values wrapped in `Redacted` are never printed (used by src/secure).
 * - Errors are reduced to name/code/message — never full objects that may hold user data.
 */
export class Redacted<T> {
  readonly #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  reveal(): T {
    return this.#value;
  }
  toString(): string {
    return '[redacted]';
  }
  toJSON(): string {
    return '[redacted]';
  }
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: Level = typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'warn';

export function sanitize(arg: unknown): unknown {
  if (arg instanceof Redacted) return '[redacted]';
  if (arg instanceof Error) {
    const code = (arg as { code?: unknown }).code;
    return { name: arg.name, code: typeof code === 'string' ? code : undefined, message: arg.message };
  }
  return arg;
}

function emit(level: Level, scope: string, args: unknown[]) {
  if (order[level] < order[minLevel]) return;
  const out = args.map(sanitize);
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${scope}]`, ...out);
}

export function createLogger(scope: string) {
  return {
    debug: (...a: unknown[]) => emit('debug', scope, a),
    info: (...a: unknown[]) => emit('info', scope, a),
    warn: (...a: unknown[]) => emit('warn', scope, a),
    error: (...a: unknown[]) => emit('error', scope, a),
  };
}
