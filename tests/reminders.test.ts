import { randomBytes } from 'crypto';

import { setRandomSource } from '../src/core/ulid';
import { migrate } from '../src/data/db/migrate';
import { migrations } from '../src/data/db/migrations';
import { createNotesRepo } from '../src/data/repositories/notesRepo';
import { createRemindersRepo } from '../src/data/repositories/remindersRepo';
import { planSchedule, type PlannableReminder, type ScheduledEntry } from '../src/domain/reminders/plan';
import { openNodeDb } from './helpers/nodeDb';

setRandomSource((n) => new Uint8Array(randomBytes(n)));
const at = (s: string) => Date.parse(s);

const base = (o: Partial<PlannableReminder>): PlannableReminder => ({
  id: 'r',
  dueLocal: '2026-12-01T09:00',
  tz: 'UTC',
  tzMode: 'fixed',
  repeatRule: null,
  repeatUntil: null,
  status: 'active',
  snoozedUntil: null,
  completedAt: null,
  ...o,
});

/** Applies a plan to a fake OS schedule, like the real scheduler does. */
function apply(scheduled: ScheduledEntry[], plan: ReturnType<typeof planSchedule>): ScheduledEntry[] {
  const cancel = new Set(plan.toCancel.map((c) => c.osId));
  return [...scheduled.filter((s) => !cancel.has(s.osId)), ...plan.toSchedule.map((s, i) => ({ ...s, osId: `os-${s.reminderId}-${s.fireAt}-${i}` }))];
}

describe('planSchedule', () => {
  const now = at('2026-11-11T12:00Z');

  it('schedules a future one-off once and is idempotent', () => {
    const p1 = planSchedule([base({})], [], 'UTC', now);
    expect(p1.toSchedule).toEqual([{ reminderId: 'r', fireAt: at('2026-12-01T09:00Z') }]);
    const os = apply([], p1);
    const p2 = planSchedule([base({})], os, 'UTC', now);
    expect(p2.toSchedule).toEqual([]);
    expect(p2.toCancel).toEqual([]);
  });

  it('overdue one-off: nothing scheduled, next_fire null', () => {
    const p = planSchedule([base({ dueLocal: '2026-11-01T09:00' })], [], 'UTC', now);
    expect(p.toSchedule).toEqual([]);
    expect(p.nextFire.get('r')).toBeNull();
  });

  it('repeating keeps a lookahead of 2 and rolls forward', () => {
    const r = base({ dueLocal: '2026-11-01T09:00', repeatRule: JSON.stringify({ freq: 'daily', every: 1 }) });
    const p = planSchedule([r], [], 'UTC', now);
    expect(p.toSchedule.map((s) => new Date(s.fireAt).toISOString())).toEqual(['2026-11-12T09:00:00.000Z', '2026-11-13T09:00:00.000Z']);
    const os = apply([], p);
    const later = planSchedule([r], os, 'UTC', at('2026-11-12T10:00Z'));
    expect(later.toCancel.map((c) => new Date(c.fireAt).toISOString())).toEqual(['2026-11-12T09:00:00.000Z']);
    expect(later.toSchedule.map((s) => new Date(s.fireAt).toISOString())).toEqual(['2026-11-14T09:00:00.000Z']);
  });

  it('done / deleted reminders are cancelled', () => {
    const os: ScheduledEntry[] = [{ reminderId: 'r', fireAt: at('2026-12-01T09:00Z'), osId: 'x' }, { reminderId: 'gone', fireAt: at('2026-12-01T09:00Z'), osId: 'y' }];
    const p = planSchedule([base({ status: 'done' })], os, 'UTC', now);
    expect(p.toCancel.map((c) => c.osId).sort()).toEqual(['x', 'y']);
  });

  it('floating reminders follow the device time zone; fixed ones do not', () => {
    const f = planSchedule([base({ tzMode: 'floating', tz: 'Europe/Moscow' })], [], 'America/New_York', now);
    expect(new Date(f.toSchedule[0]!.fireAt).toISOString()).toBe('2026-12-01T14:00:00.000Z');
    const x = planSchedule([base({ tzMode: 'fixed', tz: 'Europe/Moscow' })], [], 'America/New_York', now);
    expect(new Date(x.toSchedule[0]!.fireAt).toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });

  it('snooze schedules the snooze time; elapsed snooze is lifted', () => {
    const s = planSchedule([base({ status: 'snoozed', snoozedUntil: at('2026-11-11T13:00Z'), dueLocal: '2026-11-11T11:00' })], [], 'UTC', now);
    expect(s.toSchedule.map((x) => x.fireAt)).toEqual([at('2026-11-11T13:00Z')]);
    const e = planSchedule([base({ status: 'snoozed', snoozedUntil: at('2026-11-11T11:30Z') })], [], 'UTC', now);
    expect(e.unsnooze).toEqual(['r']);
  });

  it('completed occurrence of a repeating reminder is skipped', () => {
    const r = base({ dueLocal: '2026-11-11T12:30', repeatRule: JSON.stringify({ freq: 'daily', every: 1 }), completedAt: at('2026-11-11T12:30Z') });
    const p = planSchedule([r], [], 'UTC', now);
    expect(new Date(p.toSchedule[0]!.fireAt).toISOString()).toBe('2026-11-12T12:30:00.000Z');
  });
});

describe('remindersRepo', () => {
  it('validates, links to items and completes one-off vs repeating', async () => {
    const db = openNodeDb();
    await migrate(db, migrations);
    const repo = createRemindersRepo(db);
    const notes = createNotesRepo(db);
    const nid = await notes.create({ title: 'Article' });
    await expect(repo.create({ title: ' ', dueLocal: '2026-12-01T09:00', tz: 'UTC' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(repo.create({ title: 'x', dueLocal: 'nope', tz: 'UTC' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(repo.create({ title: 'x', dueLocal: '2026-12-01T09:00', tz: 'UTC', rule: { freq: 'interval', every: 1, unit: 'minute' } })).rejects.toMatchObject({ code: 'VALIDATION' });

    const one = await repo.create({ title: 'Read', dueLocal: '2026-12-01T09:00', tz: 'UTC', itemId: nid });
    const rep = await repo.create({ title: 'Water', dueLocal: '2026-12-01T09:00', tz: 'UTC', rule: { freq: 'daily', every: 1 } });
    expect(await repo.get(one)).toMatchObject({ itemKind: 'note', itemTitle: 'Article' });
    expect((await repo.listForItem(nid)).map((r) => r.id)).toEqual([one]);

    await repo.complete(one, 1);
    await repo.complete(rep, 123);
    expect((await repo.get(one))!.status).toBe('done');
    expect(await repo.get(rep)).toMatchObject({ status: 'active', completedAt: 123 });

    // Item deleted → link silently dropped, reminder survives.
    await notes.softDelete(nid);
    expect(await repo.get(one)).toMatchObject({ itemId: null });
  });
});
