import { describeRule, nextOccurrence, upcoming, validateRule, type RepeatRule } from '../src/domain/reminders/recurrence';
import { formatLocal, parseLocal, toInstant, toLocal } from '../src/domain/reminders/time';

const BER = 'Europe/Berlin';
const MSK = 'Europe/Moscow';
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const local = (t: number, tz = BER) => formatLocal(toLocal(t, tz));
const at = (s: string) => Date.parse(s);

describe('time zone conversion', () => {
  it('round-trips normal times', () => {
    expect(iso(toInstant(parseLocal('2026-07-01T09:00')!, BER))).toBe('2026-07-01T07:00:00.000Z');
    expect(iso(toInstant(parseLocal('2026-01-01T09:00')!, BER))).toBe('2026-01-01T08:00:00.000Z');
    expect(iso(toInstant(parseLocal('2026-01-01T09:00')!, MSK))).toBe('2026-01-01T06:00:00.000Z');
  });
  it('moves non-existent DST-gap times forward', () => {
    // 2026-03-29 02:30 does not exist in Berlin (clocks jump 02:00 → 03:00).
    expect(local(toInstant(parseLocal('2026-03-29T02:30')!, BER))).toBe('2026-03-29T03:30');
  });
  it('resolves ambiguous DST-overlap times to the first occurrence', () => {
    // 2026-10-25 02:30 happens twice in Berlin; first is CEST (+02:00).
    expect(iso(toInstant(parseLocal('2026-10-25T02:30')!, BER))).toBe('2026-10-25T00:30:00.000Z');
  });
  it('validates local strings', () => {
    expect(parseLocal('2026-02-30T10:00')).toBeNull();
    expect(parseLocal('2026-02-28T24:00')).toBeNull();
    expect(parseLocal('garbage')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('one-off: returns due if in future, else null', () => {
    expect(iso(nextOccurrence('2026-05-01T10:00', 'UTC', null, at('2026-04-01T00:00Z')))).toBe('2026-05-01T10:00:00.000Z');
    expect(nextOccurrence('2026-05-01T10:00', 'UTC', null, at('2026-06-01T00:00Z'))).toBeNull();
  });

  it('daily keeps 09:00 wall time across DST', () => {
    const rule: RepeatRule = { freq: 'daily', every: 1 };
    const occ = upcoming('2026-03-27T09:00', BER, rule, at('2026-03-26T00:00Z'), 4).map((t) => local(t));
    expect(occ).toEqual(['2026-03-27T09:00', '2026-03-28T09:00', '2026-03-29T09:00', '2026-03-30T09:00']);
  });

  it('daily far in the future stays fast and correct', () => {
    const t = nextOccurrence('2020-01-01T08:15', BER, { freq: 'daily', every: 3 }, at('2026-07-15T12:00Z'));
    expect(local(t!)).toMatch(/T08:15$/);
    expect(t! > at('2026-07-15T12:00Z')).toBe(true);
    expect(t! - at('2026-07-15T12:00Z')).toBeLessThanOrEqual(3 * 86_400_000);
  });

  it('weekly on several weekdays', () => {
    // 2026-11-11 is a Wednesday.
    const rule: RepeatRule = { freq: 'weekly', every: 1, byWeekday: [1, 3, 5] };
    const occ = upcoming('2026-11-11T07:30', 'UTC', rule, at('2026-11-10T00:00Z'), 5).map((t) => iso(t)!.slice(0, 16));
    expect(occ).toEqual(['2026-11-11T07:30', '2026-11-13T07:30', '2026-11-16T07:30', '2026-11-18T07:30', '2026-11-20T07:30']);
  });

  it('every 2 weeks on the base weekday', () => {
    const occ = upcoming('2026-11-11T07:30', 'UTC', { freq: 'weekly', every: 2 }, at('2026-11-12T00:00Z'), 2).map((t) => iso(t)!.slice(0, 10));
    expect(occ).toEqual(['2026-11-25', '2026-12-09']);
  });

  it('monthly on the 31st falls back to the last day', () => {
    const occ = upcoming('2026-01-31T10:00', 'UTC', { freq: 'monthly', every: 1 }, at('2026-01-01T00:00Z'), 4).map((t) => iso(t)!.slice(0, 10));
    expect(occ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('yearly on Feb 29', () => {
    const occ = upcoming('2028-02-29T10:00', 'UTC', { freq: 'yearly', every: 1 }, at('2028-01-01T00:00Z'), 3).map((t) => iso(t)!.slice(0, 10));
    expect(occ).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
  });

  it('hour intervals are absolute (not wall clock) across DST', () => {
    const occ = upcoming('2026-03-29T00:00', BER, { freq: 'interval', every: 2, unit: 'hour' }, at('2026-03-28T00:00Z'), 3).map((t) => local(t));
    expect(occ).toEqual(['2026-03-29T00:00', '2026-03-29T03:00', '2026-03-29T05:00']);
  });

  it('respects until', () => {
    const rule: RepeatRule = { freq: 'daily', every: 1 };
    expect(upcoming('2026-01-01T10:00', 'UTC', rule, at('2025-12-31T00:00Z'), 10, at('2026-01-03T10:00Z'))).toHaveLength(3);
  });

  it('validates and describes rules', () => {
    expect(validateRule({ freq: 'interval', every: 5, unit: 'minute' })).toMatch('15');
    expect(validateRule({ freq: 'daily', every: 0 })).not.toBeNull();
    expect(validateRule({ freq: 'weekly', every: 1, byWeekday: [] })).not.toBeNull();
    expect(describeRule({ freq: 'weekly', every: 1, byWeekday: [5, 1] })).toBe('Каждую неделю (пн, пт)');
    expect(describeRule({ freq: 'interval', every: 3, unit: 'hour' })).toBe('Каждые 3 ч');
  });
});
