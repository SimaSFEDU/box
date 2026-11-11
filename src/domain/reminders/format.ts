import { deviceTimeZone, formatLocal, toLocal, type LocalDateTime } from './time';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const p2 = (n: number) => String(n).padStart(2, '0');

const dayKey = (l: LocalDateTime) => l.year * 10000 + l.month * 100 + l.day;

/** "Сегодня, 18:00" / "Завтра, 09:00" / "Вчера, …" / "12 дек, 09:00" / "12 дек 2027, 09:00". */
export function formatWhen(instant: number, now: number, tz = deviceTimeZone()): string {
  const l = toLocal(instant, tz);
  const n = toLocal(now, tz);
  const time = `${p2(l.hour)}:${p2(l.minute)}`;
  const today = dayKey(n);
  const tomorrow = dayKey(toLocal(now + 86_400_000, tz));
  const yesterday = dayKey(toLocal(now - 86_400_000, tz));
  const k = dayKey(l);
  if (k === today) return `Сегодня, ${time}`;
  if (k === tomorrow) return `Завтра, ${time}`;
  if (k === yesterday) return `Вчера, ${time}`;
  return `${l.day} ${MONTHS[l.month - 1]}${l.year !== n.year ? ` ${l.year}` : ''}, ${time}`;
}

export type ReminderBucket = 'overdue' | 'today' | 'upcoming' | 'done';

export function bucketOf(r: { status: string; nextFireAt: number | null; rule: unknown }, now: number, tz = deviceTimeZone()): ReminderBucket {
  if (r.status === 'done') return 'done';
  if (r.nextFireAt === null) return r.rule ? 'done' : 'overdue';
  return dayKey(toLocal(r.nextFireAt, tz)) === dayKey(toLocal(now, tz)) ? 'today' : 'upcoming';
}

/** Quick presets for the editor, as local wall-clock strings. */
export function presets(now: number, tz = deviceTimeZone()): { label: string; local: string }[] {
  const n = toLocal(now, tz);
  const at = (dayOffset: number, hour: number) => {
    const l = toLocal(now + dayOffset * 86_400_000, tz);
    return formatLocal({ ...l, hour, minute: 0 });
  };
  const out: { label: string; local: string }[] = [];
  if (n.hour < 18) out.push({ label: 'Сегодня вечером', local: at(0, 19) });
  out.push({ label: 'Завтра утром', local: at(1, 9) });
  out.push({ label: 'Через неделю', local: at(7, 9) });
  const inHour = toLocal(now + 3_600_000, tz);
  out.unshift({ label: 'Через час', local: formatLocal({ ...inHour, minute: inHour.minute }) });
  return out;
}
