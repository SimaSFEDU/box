export type ErrorCode =
  | 'DB_OPEN_FAILED'
  | 'DB_MIGRATION_FAILED'
  | 'DB_QUERY_FAILED'
  | 'DB_CONSTRAINT'
  | 'FS_WRITE_FAILED'
  | 'FS_READ_FAILED'
  | 'FS_NOT_FOUND'
  | 'NET_UNAVAILABLE'
  | 'NET_TIMEOUT'
  | 'CRYPTO_AUTH_FAILED'
  | 'CRYPTO_CORRUPTED'
  | 'AUTH_REQUIRED'
  | 'VALIDATION'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Safe, localized message for the UI. Must never contain user content or secrets. */
  readonly userMessage: string;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, userMessage: string, cause?: unknown) {
    super(`${code}: ${userMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

export function toAppError(e: unknown, fallback: ErrorCode = 'UNKNOWN', userMessage = 'Что-то пошло не так'): AppError {
  if (e instanceof AppError) return e;
  return new AppError(fallback, userMessage, e);
}
