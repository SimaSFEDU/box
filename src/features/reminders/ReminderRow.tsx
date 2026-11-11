import { View } from 'react-native';

import type { Reminder } from '../../data/repositories/remindersRepo';
import { formatWhen } from '../../domain/reminders/format';
import { describeRule } from '../../domain/reminders/recurrence';
import { Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function ReminderRow({ r, now, onPress, onToggle }: { r: Reminder; now: number; onPress: () => void; onToggle: () => void }) {
  const { colors, spacing } = useTheme();
  const done = r.status === 'done';
  const overdue = !done && r.nextFireAt === null && !r.rule;
  const when = r.nextFireAt !== null ? formatWhen(r.nextFireAt, now) : overdue ? 'Просрочено' : done && r.completedAt ? `Выполнено ${formatWhen(r.completedAt, now)}` : '—';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 }}>
      <PressableScale accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={done ? 'Вернуть' : 'Выполнено'} onPress={onToggle} style={{ padding: spacing.xs }}>
        <Icon name={done ? 'check-circle' : 'circle'} size={22} color={done ? colors.success : colors.secondary} />
      </PressableScale>
      <PressableScale accessibilityLabel={r.title} onPress={onPress} style={{ flex: 1, paddingVertical: spacing.sm }}>
        <Text variant="heading" numberOfLines={1} style={done ? { color: colors.secondary, textDecorationLine: 'line-through' } : undefined}>
          {r.title}
        </Text>
        <Text variant="caption" tone={overdue ? 'danger' : 'secondary'} numberOfLines={1}>
          {when}
          {r.status === 'snoozed' ? ' · отложено' : ''}
          {r.rule ? ` · ${describeRule(r.rule)}` : ''}
          {r.itemTitle ? ` · ${r.itemTitle}` : r.collectionName ? ` · ${r.collectionName}` : ''}
        </Text>
      </PressableScale>
    </View>
  );
}
