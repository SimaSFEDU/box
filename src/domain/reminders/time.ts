/**
 * Wall-clock ↔ instant conversion for IANA time zones using only Intl (no tz database bundled).
 * A "naive" timestamp is wall-clock time encoded as if it were UTC (Date.UTC fields).
 */
export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Wall-clock fields of `instant` in `tz`. If the JS engine's Intl lacks time-zone data for `tz`
 * (defensive: Hermes builds without full ICU), falls back to the device's local zone.
 */
export function toLocal(instant: number, tz: string): LocalDateTime {
  try {
    const parts: Record<string, number> = {};
    for (const p of formatter(tz).formatToParts(new Date(instant))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
    if (Number.isFinite(parts.year) && Number.isFinite(parts.minute)) {
      return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute! };
    }
  } catch {
    /* fall through */
  }
  const d = new Date(instant);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}

export const naive = (l: LocalDateTime) => Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);

export function fromNaive(ms: number): LocalDateTime {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** UTC offset (ms) of tz at instant. */
function offsetAt(instant: number, tz: string): number {
  const l = toLocal(instant, tz);
  const s = new Date(instant).getUTCSeconds();
  return naive(l) + s * 1000 - (instant - (instant % 1000 + 1000) % 1000);
}

/**
 * Instant for a wall-clock time in tz.
 * Non-existent times (DST gap) are moved forward by the gap; ambiguous times (DST overlap) resolve
 * to the first (earlier) occurrence.
 */
export function toInstant(l: LocalDateTime, tz: string): number {
  const target = naive(l);
  // Two candidate offsets around the target cover both sides of any transition.
  const o1 = offsetAt(target - 36e5 * 12, tz);
  const o2 = offsetAt(target + 36e5 * 12, tz);
  const candidates = [target - o1, target - o2].filter((c, i, a) => a.indexOf(c) === i).sort((a, b) => a - b);
  for (const c of candidates) if (naive(toLocal(c, tz)) === target) return c;
  // Gap: wall time does not exist — use the pre-transition offset, which lands after the jump.
  return target - Math.min(o1, o2);
}

export function parseLocal(s: string): LocalDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const l = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]! };
  const back = fromNaive(naive(l));
  return back.year === l.year && back.month === l.month && back.day === l.day && l.hour < 24 && l.minute < 60 ? l : null;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export const formatLocal = (l: LocalDateTime) => `${l.year}-${p2(l.month)}-${p2(l.day)}T${p2(l.hour)}:${p2(l.minute)}`;

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
