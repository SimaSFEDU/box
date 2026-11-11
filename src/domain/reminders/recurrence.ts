import { daysInMonth, fromNaive, naive, parseLocal, toInstant, type LocalDateTime } from './time';

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'interval';
export type IntervalUnit = 'minute' | 'hour' | 'day' | 'week';

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every N periods (≥ 1). */
  every: number;
  /** For `interval` only. */
  unit?: IntervalUnit;
  /** For `weekly`: ISO weekdays 1 (Mon) … 7 (Sun). Defaults to the weekday of the first occurrence. */
  byWeekday?: number[];
}

const DAY = 86_400_000;
const MAX_ITER = 5000;

export function validateRule(r: RepeatRule): string | null {
  if (!Number.isInteger(r.every) || r.every < 1 || r.every > 1000) return 'Интервал должен быть от 1 до 1000';
  if (r.freq === 'interval' && !r.unit) return 'Не указана единица интервала';
  if (r.freq === 'interval' && r.unit === 'minute' && r.every < 15) return 'Минимальный интервал — 15 минут';
  if (r.byWeekday && (r.byWeekday.length === 0 || r.byWeekday.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) return 'Выберите дни недели';
  return null;
}

export function parseRule(json: string | null): RepeatRule | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json) as RepeatRule;
    return validateRule(r) === null ? r : null;
  } catch {
    return null;
  }
}

const isoWeekday = (naiveMs: number) => ((new Date(naiveMs).getUTCDay() + 6) % 7) + 1;

/**
 * Generates the k-th wall-clock occurrence (naive ms) — calendar arithmetic, so "every day at 09:00"
 * stays at 09:00 across DST changes, the 31st becomes the last day of shorter months and
 * Feb 29 becomes Feb 28 in non-leap years.
 */
function* wallOccurrences(base: LocalDateTime, rule: RepeatRule): Generator<number> {
  const baseNaive = naive(base);
  const n = rule.every;
  if (rule.freq === 'daily' || (rule.freq === 'interval' && rule.unit === 'day')) {
    for (let k = 0; ; k++) yield baseNaive + k * n * DAY;
  }
  if (rule.freq === 'weekly' || (rule.freq === 'interval' && rule.unit === 'week')) {
    const days = [...new Set(rule.freq === 'weekly' && rule.byWeekday?.length ? rule.byWeekday : [isoWeekday(baseNaive)])].sort();
    const monday = baseNaive - (isoWeekday(baseNaive) - 1) * DAY;
    for (let w = 0; ; w += n) {
      for (const d of days) {
        const t = monday + (w * 7 + d - 1) * DAY;
        if (t >= baseNaive) yield t;
      }
    }
  }
  if (rule.freq === 'monthly') {
    for (let k = 0; ; k++) {
      const total = base.month - 1 + k * n;
      const year = base.year + Math.floor(total / 12);
      const month = (total % 12) + 1;
      yield naive({ ...base, year, month, day: Math.min(base.day, daysInMonth(year, month)) });
    }
  }
  if (rule.freq === 'yearly') {
    for (let k = 0; ; k++) {
      const year = base.year + k * n;
      yield naive({ ...base, year, day: Math.min(base.day, daysInMonth(year, base.month)) });
    }
  }
}

/**
 * First occurrence strictly after `after` (UTC ms), or null if none (one-off in the past, or past `until`).
 * Minute/hour intervals run in absolute time; everything else follows the wall clock of `tz`.
 */
export function nextOccurrence(dueLocal: string, tz: string, rule: RepeatRule | null, after: number, until: number | null = null): number | null {
  const base = parseLocal(dueLocal);
  if (!base) return null;
  const first = toInstant(base, tz);
  const within = (t: number) => (until === null || t <= until ? t : null);
  if (!rule) return first > after ? within(first) : null;

  if (rule.freq === 'interval' && (rule.unit === 'minute' || rule.unit === 'hour')) {
    const step = rule.every * (rule.unit === 'minute' ? 60_000 : 3_600_000);
    if (first > after) return within(first);
    const k = Math.floor((after - first) / step) + 1;
    return within(first + k * step);
  }

  // Fast-forward close to `after` for simple day-based rules to keep iteration bounded.
  let i = 0;
  for (const wall of wallOccurrences(base, rule)) {
    if (++i > MAX_ITER) return null;
    const t = toInstant(fromNaive(wall), tz);
    if (until !== null && t > until) return null;
    if (t > after) return t;
    if (i === 1 && (rule.freq === 'daily' || rule.unit === 'day') && after - t > 2 * DAY) {
      // Jump: restart from an occurrence just before `after`.
      const skip = Math.floor((after - t) / (rule.every * DAY)) - 1;
      if (skip > 0) {
        const jumped = naive(base) + skip * rule.every * DAY;
        return nextOccurrence(formatNaive(jumped), tz, rule, after, until);
      }
    }
  }
  return null;
}

function formatNaive(ms: number): string {
  const l = fromNaive(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${l.year}-${p(l.month)}-${p(l.day)}T${p(l.hour)}:${p(l.minute)}`;
}

/** Up to `count` upcoming occurrences after `after`. */
export function upcoming(dueLocal: string, tz: string, rule: RepeatRule | null, after: number, count: number, until: number | null = null): number[] {
  const out: number[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    const t = nextOccurrence(dueLocal, tz, rule, cursor, until);
    if (t === null) break;
    out.push(t);
    cursor = t;
  }
  return out;
}

const WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export function describeRule(r: RepeatRule | null): string {
  if (!r) return 'Без повтора';
  const every = (one: string, many: string) => (r.every === 1 ? one : `Каждые ${r.every} ${many}`);
  switch (r.freq) {
    case 'daily':
      return every('Каждый день', 'дн.');
    case 'weekly': {
      const days = r.byWeekday?.length ? ` (${[...r.byWeekday].sort().map((d) => WD[d]).join(', ')})` : '';
      return every('Каждую неделю', 'нед.') + days;
    }
    case 'monthly':
      return every('Каждый месяц', 'мес.');
    case 'yearly':
      return every('Каждый год', 'г.');
    case 'interval':
      return `Каждые ${r.every} ${({ minute: 'мин', hour: 'ч', day: 'дн.', week: 'нед.' } as const)[r.unit ?? 'day']}`;
  }
}
