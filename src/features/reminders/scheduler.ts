import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { router } from 'expo-router';

import { createLogger } from '../../core/logger';
import { getDb } from '../../data/db/database';
import { createRemindersRepo } from '../../data/repositories/remindersRepo';
import { planSchedule } from '../../domain/reminders/plan';
import { deviceTimeZone } from '../../domain/reminders/time';
import { useDataVersion } from '../../stores/dataVersion';

const log = createLogger('reminders');
export const remindersRepo = () => createRemindersRepo(getDb());

const CHANNEL = 'reminders';
const CATEGORY = 'reminder';
const ACTION_DONE = 'done';
const ACTION_SNOOZE = 'snooze';
export const SNOOZE_MS = 60 * 60 * 1000;

let configured = false;
let responseSub: { remove(): void } | null = null;

/**
 * One-time setup: foreground presentation, Android channel, action buttons, tap/actions handling.
 * Actions open the app (opensAppToForeground) so they are handled reliably even if the process was
 * killed; background handling would need a headless task (see docs/ARCHITECTURE.md §7).
 */
export async function setupNotifications(): Promise<void> {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Напоминания',
    importance: AndroidImportance.HIGH,
    // Notification text never contains Vault / Private Media data (they cannot have reminders).
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
    enableVibrate: true,
  });
  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: ACTION_DONE, buttonTitle: 'Готово', options: { opensAppToForeground: true } },
    { identifier: ACTION_SNOOZE, buttonTitle: 'Через 1 час', options: { opensAppToForeground: true } },
  ]);
  responseSub = Notifications.addNotificationResponseReceivedListener((r) => void handleResponse(r));
  const last = await Notifications.getLastNotificationResponseAsync();
  if (last) {
    await handleResponse(last);
    await Notifications.clearLastNotificationResponseAsync();
  }
}

export function teardownNotifications() {
  responseSub?.remove();
  responseSub = null;
  configured = false;
}

const handled = new Set<string>();

async function handleResponse(r: Notifications.NotificationResponse): Promise<void> {
  const key = `${r.notification.request.identifier}:${r.actionIdentifier}:${r.notification.date}`;
  if (handled.has(key)) return;
  handled.add(key);
  const data = r.notification.request.content.data as { reminderId?: string; fireAt?: number } | undefined;
  const id = data?.reminderId;
  if (!id) return;
  const fireAt = typeof data.fireAt === 'number' ? data.fireAt : Date.now();
  try {
    if (r.actionIdentifier === ACTION_DONE) {
      await remindersRepo().complete(id, fireAt);
    } else if (r.actionIdentifier === ACTION_SNOOZE) {
      await remindersRepo().snooze(id, Date.now() + SNOOZE_MS, fireAt);
    } else {
      const rem = await remindersRepo().get(id);
      if (rem?.itemId && rem.itemKind) {
        router.push({ pathname: rem.itemKind === 'note' ? '/note/[id]' : '/clip/[id]', params: { id: rem.itemId } });
      } else {
        router.push({ pathname: '/reminder/[id]', params: { id } });
      }
    }
    await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
    await reconcileReminders();
  } catch (e) {
    log.error('notification response failed', e);
  }
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function notificationPermission(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asked in context (when the user creates a reminder), never at startup. */
export async function ensureNotificationPermission(): Promise<PermissionState> {
  const cur = await notificationPermission();
  if (cur !== 'undetermined') return cur;
  const r = await Notifications.requestPermissionsAsync();
  return r.granted ? 'granted' : 'denied';
}

export async function exactAlarmsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function requestExactAlarms(): Promise<boolean> {
  try {
    return (await Notifications.requestExactAlarmPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

let running: Promise<void> | null = null;
let rerun = false;

/**
 * Brings OS-scheduled notifications in line with the reminders table (docs/ARCHITECTURE.md §7).
 * Idempotent and single-flight; call after any reminder change, on startup and on foreground.
 */
export function reconcileReminders(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await reconcileOnce();
    } while (rerun);
  })()
    .catch((e) => log.error('reconcile failed', e))
    .finally(() => {
      running = null;
      useDataVersion.getState().bump();
    });
  return running;
}

async function reconcileOnce(): Promise<void> {
  const repo = remindersRepo();
  const now = Date.now();
  const reminders = await repo.listOpen();
  const scheduled = await repo.scheduled();
  const plan = planSchedule(reminders, scheduled, deviceTimeZone(), now);

  for (const id of plan.unsnooze) await repo.unsnooze(id);
  for (const [id, t] of plan.nextFire) await repo.setNextFire(id, t);
  // Entries of done/deleted reminders are not desired by the plan, so they are in toCancel too.
  for (const c of plan.toCancel) {
    await Notifications.cancelScheduledNotificationAsync(c.osId).catch(() => undefined);
    await repo.forgetScheduled(c.reminderId, c.fireAt);
  }

  if ((await notificationPermission()) !== 'granted') return;
  const delivery = (await exactAlarmsAllowed()) ? 'alarmClock' : 'bestEffort';
  const byId = new Map(reminders.map((r) => [r.id, r]));
  for (const s of plan.toSchedule) {
    const r = byId.get(s.reminderId);
    if (!r) continue;
    const osId = await Notifications.scheduleNotificationAsync({
      content: {
        title: r.title,
        body: r.itemTitle ? `↳ ${r.itemTitle}` : r.collectionName ? `↳ ${r.collectionName}` : (r.notes?.slice(0, 120) ?? ''),
        categoryIdentifier: CATEGORY,
        data: { reminderId: r.id, fireAt: s.fireAt },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: s.fireAt, channelId: CHANNEL, delivery },
    });
    await repo.recordScheduled(r.id, s.fireAt, osId);
  }

  // Orphans: OS notifications we scheduled but no longer track (e.g. crash between schedule and record).
  const tracked = new Set((await repo.scheduled()).map((s) => s.osId));
  for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
    const data = n.content.data as { reminderId?: string } | undefined;
    if (data?.reminderId && !tracked.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined);
  }
}
