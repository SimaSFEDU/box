import { AppError } from '../../core/errors';
import { ulid } from '../../core/ulid';
import { parseRule, validateRule, type RepeatRule } from '../../domain/reminders/recurrence';
import type { PlannableReminder, ScheduledEntry } from '../../domain/reminders/plan';
import { parseLocal } from '../../domain/reminders/time';
import type { SqlDb } from '../db/types';

export interface Reminder extends PlannableReminder {
  title: string;
  notes: string | null;
  itemId: string | null;
  itemKind: 'note' | 'clip' | null;
  itemTitle: string | null;
  collectionId: string | null;
  collectionName: string | null;
  rule: RepeatRule | null;
  nextFireAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  title: string;
  notes: string | null;
  item_id: string | null;
  item_kind: 'note' | 'clip' | null;
  item_title: string | null;
  collection_id: string | null;
  collection_name: string | null;
  due_local: string;
  tz: string;
  tz_mode: 'floating' | 'fixed';
  repeat_rule: string | null;
  repeat_until: number | null;
  status: 'active' | 'done' | 'snoozed';
  next_fire_at: number | null;
  snoozed_until: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

const SELECT = `
SELECT r.*, li.kind AS item_kind, li.title AS item_title, c.name AS collection_name
FROM reminders r
LEFT JOIN library_items li ON li.id = r.item_id AND li.deleted_at IS NULL
LEFT JOIN collections c ON c.id = r.collection_id`;

const map = (r: Row): Reminder => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  itemId: r.item_kind ? r.item_id : null,
  itemKind: r.item_kind,
  itemTitle: r.item_title,
  collectionId: r.collection_id,
  collectionName: r.collection_name,
  dueLocal: r.due_local,
  tz: r.tz,
  tzMode: r.tz_mode,
  repeatRule: r.repeat_rule,
  rule: parseRule(r.repeat_rule),
  repeatUntil: r.repeat_until,
  status: r.status,
  nextFireAt: r.next_fire_at,
  snoozedUntil: r.snoozed_until,
  completedAt: r.completed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface ReminderInput {
  title: string;
  notes?: string | null;
  itemId?: string | null;
  collectionId?: string | null;
  dueLocal: string;
  tz: string;
  tzMode?: 'floating' | 'fixed';
  rule?: RepeatRule | null;
  repeatUntil?: number | null;
}

function validate(i: ReminderInput) {
  if (!i.title.trim()) throw new AppError('VALIDATION', 'Введите название напоминания');
  if (!parseLocal(i.dueLocal)) throw new AppError('VALIDATION', 'Некорректная дата');
  if (i.rule) {
    const e = validateRule(i.rule);
    if (e) throw new AppError('VALIDATION', e);
  }
}

export function createRemindersRepo(db: SqlDb, now: () => number = Date.now) {
  return {
    async create(i: ReminderInput): Promise<string> {
      validate(i);
      const t = now();
      const id = ulid(t);
      await db.run(
        `INSERT INTO reminders (id, title, notes, item_id, collection_id, due_local, tz, tz_mode, repeat_rule, repeat_until, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [id, i.title.trim(), i.notes?.trim() || null, i.itemId ?? null, i.collectionId ?? null, i.dueLocal, i.tz, i.tzMode ?? 'floating', i.rule ? JSON.stringify(i.rule) : null, i.repeatUntil ?? null, t, t],
      );
      return id;
    },

    /** Editing schedule fields re-activates the reminder and clears completion/snooze state. */
    async update(id: string, i: ReminderInput): Promise<void> {
      validate(i);
      await db.run(
        `UPDATE reminders SET title = ?, notes = ?, item_id = ?, collection_id = ?, due_local = ?, tz = ?, tz_mode = ?, repeat_rule = ?, repeat_until = ?,
           status = 'active', snoozed_until = NULL, completed_at = NULL, updated_at = ? WHERE id = ?`,
        [i.title.trim(), i.notes?.trim() || null, i.itemId ?? null, i.collectionId ?? null, i.dueLocal, i.tz, i.tzMode ?? 'floating', i.rule ? JSON.stringify(i.rule) : null, i.repeatUntil ?? null, now(), id],
      );
    },

    async get(id: string): Promise<Reminder | null> {
      const r = await db.first<Row>(`${SELECT} WHERE r.id = ?`, [id]);
      return r ? map(r) : null;
    },

    async list(): Promise<Reminder[]> {
      return (await db.all<Row>(`${SELECT} ORDER BY r.status = 'done', COALESCE(r.next_fire_at, r.completed_at, r.created_at)`)).map(map);
    },

    async listForItem(itemId: string): Promise<Reminder[]> {
      return (await db.all<Row>(`${SELECT} WHERE r.item_id = ? AND r.status != 'done' ORDER BY r.next_fire_at`, [itemId])).map(map);
    },

    async upcoming(limit: number): Promise<Reminder[]> {
      return (await db.all<Row>(`${SELECT} WHERE r.status != 'done' AND r.next_fire_at IS NOT NULL ORDER BY r.next_fire_at LIMIT ?`, [limit])).map(map);
    },

    async listOpen(): Promise<Reminder[]> {
      return (await db.all<Row>(`${SELECT} WHERE r.status != 'done'`)).map(map);
    },

    /**
     * "Done": a one-off becomes done; a repeating reminder only completes the current occurrence
     * (everything up to `occurrenceAt`) and stays active for the next one.
     */
    async complete(id: string, occurrenceAt: number): Promise<void> {
      const r = await this.get(id);
      if (!r) return;
      const t = now();
      if (r.rule) {
        await db.run("UPDATE reminders SET status = 'active', snoozed_until = NULL, completed_at = ?, updated_at = ? WHERE id = ?", [occurrenceAt, t, id]);
      } else {
        await db.run("UPDATE reminders SET status = 'done', snoozed_until = NULL, completed_at = ?, next_fire_at = NULL, updated_at = ? WHERE id = ?", [t, t, id]);
      }
    },

    async reopen(id: string): Promise<void> {
      await db.run("UPDATE reminders SET status = 'active', completed_at = NULL, updated_at = ? WHERE id = ?", [now(), id]);
    },

    /** Snooze until `until`; for repeating reminders the snoozed occurrence counts as handled. */
    async snooze(id: string, until: number, occurrenceAt: number | null): Promise<void> {
      const r = await this.get(id);
      if (!r) return;
      await db.run("UPDATE reminders SET status = 'snoozed', snoozed_until = ?, completed_at = COALESCE(?, completed_at), updated_at = ? WHERE id = ?", [
        until,
        r.rule ? occurrenceAt : null,
        now(),
        id,
      ]);
    },

    async remove(id: string): Promise<void> {
      await db.run('DELETE FROM reminders WHERE id = ?', [id]);
    },

    // ---- OS schedule bookkeeping (reminder_schedule)
    async scheduled(): Promise<ScheduledEntry[]> {
      return (await db.all<{ reminder_id: string; fire_at: number; os_notification_id: string }>('SELECT * FROM reminder_schedule')).map((r) => ({
        reminderId: r.reminder_id,
        fireAt: r.fire_at,
        osId: r.os_notification_id,
      }));
    },
    async recordScheduled(reminderId: string, fireAt: number, osId: string): Promise<void> {
      await db.run('INSERT OR REPLACE INTO reminder_schedule (reminder_id, fire_at, os_notification_id) VALUES (?, ?, ?)', [reminderId, fireAt, osId]);
    },
    async forgetScheduled(reminderId: string, fireAt: number): Promise<void> {
      await db.run('DELETE FROM reminder_schedule WHERE reminder_id = ? AND fire_at = ?', [reminderId, fireAt]);
    },
    async setNextFire(id: string, t: number | null): Promise<void> {
      await db.run('UPDATE reminders SET next_fire_at = ? WHERE id = ? AND (next_fire_at IS NOT ? )', [t, id, t]);
    },
    async unsnooze(id: string): Promise<void> {
      await db.run("UPDATE reminders SET status = 'active', snoozed_until = NULL WHERE id = ? AND status = 'snoozed'", [id]);
    },
  };
}

export type RemindersRepo = ReturnType<typeof createRemindersRepo>;
