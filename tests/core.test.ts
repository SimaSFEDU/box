import { randomBytes } from 'crypto';

import { AppError, toAppError } from '../src/core/errors';
import { Redacted, sanitize } from '../src/core/logger';
import { ulid, setRandomSource } from '../src/core/ulid';

setRandomSource((n) => new Uint8Array(randomBytes(n)));

describe('ulid', () => {
  it('is 26 chars, crockford base32, time-sortable', () => {
    const a = ulid(1000);
    const b = ulid(2000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(ulid(1000)).not.toEqual(a);
  });
});

describe('logger sanitize', () => {
  it('never prints redacted values or raw error payloads', () => {
    expect(sanitize(new Redacted('hunter2'))).toBe('[redacted]');
    expect(JSON.stringify({ p: new Redacted('hunter2') })).not.toContain('hunter2');
    const e = new AppError('DB_QUERY_FAILED', 'fail', { secret: 'x' });
    expect(sanitize(e)).toEqual({ name: 'AppError', code: 'DB_QUERY_FAILED', message: 'DB_QUERY_FAILED: fail' });
  });

  it('toAppError wraps unknowns', () => {
    expect(toAppError('x').code).toBe('UNKNOWN');
  });
});
