import { nextOccurrence, parseRule, upcoming } from './recurrence';

/** Minimal reminder shape the planner needs (mirrors the `reminders` table). */
export interface PlannableReminder {
  id: string;
  dueLocal: string;
  tz: string;
  tzMode: 'floating' | 'fixed';
  repeatRule: string | null;
  repeatUntil: number | null;
  status: 'active' | 'done' | 'snoozed';
  snoozedUntil: number | null;
  /** Occurrences at or before this instant were completed by the user (repeating reminders). */
  completedAt: number | null;
}

export interface ScheduledEntry {
  reminderId: string;
  fireAt: number;
  osId: string;
}

export interface SchedulePlan {
  /** New value for reminders.next_fire_at (null = nothing upcoming, e.g. overdue one-off). */
  nextFire: Map<string, number | null>;
  /** Reminders whose snooze has elapsed and should return to `active`. */
  unsnooze: string[];
  toSchedule: { reminderId: string; fireAt: number }[];
  toCancel: ScheduledEntry[];
}

/** How many future occurrences of a repeating reminder are kept scheduled in the OS. */
export const LOOKAHEAD = 2;

/**
 * Pure reconciliation: given reminders, what is already scheduled in the OS, the device time zone
 * and "now", decide what to schedule/cancel. Idempotent: running it twice yields no changes.
 */
export function planSchedule(reminders: PlannableReminder[], scheduled: ScheduledEntry[], deviceTz: string, now: number): SchedulePlan {
  const desired = new Map<string, number[]>();
  const nextFire = new Map<string, number | null>();
  const unsnooze: string[] = [];

  for (const r of reminders) {
    if (r.status === 'done') {
      nextFire.set(r.id, null);
      continue;
    }
    const tz = r.tzMode === 'floating' ? deviceTz : r.tz;
    const rule = parseRule(r.repeatRule);
    const times: number[] = [];
    if (r.status === 'snoozed' && r.snoozedUntil !== null && r.snoozedUntil > now) {
      times.push(r.snoozedUntil);
    } else if (r.status === 'snoozed') {
      unsnooze.push(r.id);
    }
    // Occurrences already handled (completed or superseded by a snooze) are skipped.
    const from = Math.max(now, r.completedAt ?? -Infinity);
    if (rule) {
      times.push(...upcoming(r.dueLocal, tz, rule, from, LOOKAHEAD, r.repeatUntil));
    } else if (times.length === 0) {
      const t = nextOccurrence(r.dueLocal, tz, null, from, null);
      if (t !== null) times.push(t);
    }
    times.sort((a, b) => a - b);
    const uniq = times.filter((t, i) => t !== times[i - 1]).slice(0, LOOKAHEAD);
    desired.set(r.id, uniq);
    nextFire.set(r.id, uniq[0] ?? null);
  }

  const toCancel: ScheduledEntry[] = [];
  const have = new Set<string>();
  for (const s of scheduled) {
    const want = desired.get(s.reminderId);
    if (want?.includes(s.fireAt) && s.fireAt > now) have.add(`${s.reminderId}@${s.fireAt}`);
    else toCancel.push(s);
  }
  const toSchedule: { reminderId: string; fireAt: number }[] = [];
  for (const [id, times] of desired) {
    for (const t of times) if (!have.has(`${id}@${t}`)) toSchedule.push({ reminderId: id, fireAt: t });
  }
  return { nextFire, unsnooze, toSchedule, toCancel };
}
