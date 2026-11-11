import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { toAppError } from '../../core/errors';
import type { Reminder } from '../../data/repositories/remindersRepo';
import { bucketOf, type ReminderBucket } from '../../domain/reminders/format';
import { useAsync } from '../../features/common/useAsync';
import { useNow } from '../../features/common/useNow';
import { ReminderRow } from '../../features/reminders/ReminderRow';
import { reconcileReminders, remindersRepo } from '../../features/reminders/scheduler';
import { Card, EmptyState, ErrorView, Icon, PressableScale, Screen, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

const TITLES: Record<ReminderBucket, string> = { overdue: 'Просрочено', today: 'Сегодня', upcoming: 'Предстоящие', done: 'Выполнено' };

export default function RemindersScreen() {
  const { colors, spacing } = useTheme();
  const { data, error, reload } = useAsync(() => remindersRepo().list(), []);
  const [showDone, setShowDone] = useState(false);
  const now = useNow();

  const toggle = (r: Reminder) =>
    (r.status === 'done' ? remindersRepo().reopen(r.id) : remindersRepo().complete(r.id, r.nextFireAt ?? now))
      .then(reconcileReminders)
      .catch((e) => Alert.alert('Clipbox', toAppError(e, 'DB_QUERY_FAILED', 'Не удалось изменить').userMessage));

  const add = (
    <PressableScale accessibilityLabel="Новое напоминание" onPress={() => router.push({ pathname: '/reminder/[id]', params: { id: 'new' } })} style={{ padding: spacing.sm }}>
      <Icon name="plus" size={26} color={colors.primary} />
    </PressableScale>
  );

  if (error) {
    return (
      <Screen title="Reminders">
        <ErrorView error={error} onRetry={reload} />
      </Screen>
    );
  }
  const list = data ?? [];
  const groups: Record<ReminderBucket, Reminder[]> = { overdue: [], today: [], upcoming: [], done: [] };
  for (const r of list) groups[bucketOf(r, now)].push(r);

  return (
    <Screen title="Reminders" right={add}>
      {list.length === 0 && data ? (
        <EmptyState icon="bell" title="Напоминаний нет" message="Работают офлайн, с повторами. Можно привязать к заметке, клипу или коллекции." actionLabel="Создать" onAction={() => router.push({ pathname: '/reminder/[id]', params: { id: 'new' } })} />
      ) : null}
      {(['overdue', 'today', 'upcoming'] as const).map((b) =>
        groups[b].length ? (
          <Section key={b} title={TITLES[b]}>
            <Card style={{ paddingVertical: spacing.xs }}>
              {groups[b].map((r) => (
                <ReminderRow key={r.id} r={r} now={now} onToggle={() => toggle(r)} onPress={() => router.push({ pathname: '/reminder/[id]', params: { id: r.id } })} />
              ))}
            </Card>
          </Section>
        ) : null,
      )}
      {groups.done.length ? (
        <Section
          title={`${TITLES.done} · ${groups.done.length}`}
          action={
            <PressableScale accessibilityLabel={showDone ? 'Скрыть' : 'Показать'} onPress={() => setShowDone((v) => !v)}>
              <Icon name={showDone ? 'chevron-up' : 'chevron-down'} color={colors.secondary} />
            </PressableScale>
          }
        >
          {showDone ? (
            <Card style={{ paddingVertical: spacing.xs }}>
              {groups.done.map((r) => (
                <ReminderRow key={r.id} r={r} now={now} onToggle={() => toggle(r)} onPress={() => router.push({ pathname: '/reminder/[id]', params: { id: r.id } })} />
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}
