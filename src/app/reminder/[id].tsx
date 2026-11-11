import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppError, toAppError } from '../../core/errors';
import type { ReminderInput } from '../../data/repositories/remindersRepo';
import { formatWhen, presets } from '../../domain/reminders/format';
import { describeRule, nextOccurrence, type IntervalUnit, type RepeatFreq, type RepeatRule } from '../../domain/reminders/recurrence';
import { deviceTimeZone, formatLocal, parseLocal, toInstant, toLocal } from '../../domain/reminders/time';
import { collectionsRepo } from '../../features/clips/clipsService';
import { useAsync } from '../../features/common/useAsync';
import { useNow } from '../../features/common/useNow';
import { itemTitle } from '../../features/library/libraryQueries';
import { ensureNotificationPermission, reconcileReminders, remindersRepo } from '../../features/reminders/scheduler';
import { Button, Card, Chip, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

type RepeatChoice = 'none' | RepeatFreq;
const REPEATS: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Нет' },
  { value: 'daily', label: 'Каждый день' },
  { value: 'weekly', label: 'Каждую неделю' },
  { value: 'monthly', label: 'Каждый месяц' },
  { value: 'yearly', label: 'Каждый год' },
  { value: 'interval', label: 'Свой интервал' },
];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'hour', label: 'часы' },
  { value: 'day', label: 'дни' },
  { value: 'week', label: 'недели' },
];

interface Form {
  title: string;
  notes: string;
  dueLocal: string;
  repeat: RepeatChoice;
  every: string;
  unit: IntervalUnit;
  weekdays: number[];
  fixedTz: boolean;
  tz: string;
  itemId: string | null;
  collectionId: string | null;
}

function defaultDue(): string {
  const tz = deviceTimeZone();
  const l = toLocal(Date.now() + 3_600_000, tz);
  return formatLocal({ ...l, minute: 0 });
}

export default function ReminderEditor() {
  const params = useLocalSearchParams<{ id: string; itemId?: string; collectionId?: string; title?: string }>();
  const isNew = params.id === 'new';
  const { colors, spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const now = useNow();

  const { data: initial, error } = useAsync(async (): Promise<Form & { linked: string | null }> => {
    if (isNew) {
      let linked: string | null = null;
      if (params.itemId) linked = await itemTitle(params.itemId);
      if (params.collectionId) linked = (await collectionsRepo().get(params.collectionId))?.name ?? null;
      return {
        title: params.title ?? (linked ? `Вернуться к «${linked}»` : ''),
        notes: '',
        dueLocal: defaultDue(),
        repeat: 'none',
        every: '2',
        unit: 'day',
        weekdays: [],
        fixedTz: false,
        tz: deviceTimeZone(),
        itemId: params.itemId ?? null,
        collectionId: params.collectionId ?? null,
        linked,
      };
    }
    const r = await remindersRepo().get(params.id);
    if (!r) throw new AppError('DB_QUERY_FAILED', 'Напоминание не найдено');
    return {
      title: r.title,
      notes: r.notes ?? '',
      dueLocal: r.dueLocal,
      repeat: r.rule?.freq ?? 'none',
      every: String(r.rule?.every ?? 2),
      unit: r.rule?.unit ?? 'day',
      weekdays: r.rule?.byWeekday ?? [],
      fixedTz: r.tzMode === 'fixed',
      tz: r.tz,
      itemId: r.itemId,
      collectionId: r.collectionId,
      linked: r.itemTitle ?? r.collectionName,
    };
  }, [params.id]);

  const f = form ?? initial;
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: spacing.xl }}>
        <Text tone="danger">{error.userMessage}</Text>
      </View>
    );
  }
  if (!f) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch });

  const rule: RepeatRule | null =
    f.repeat === 'none'
      ? null
      : f.repeat === 'interval'
        ? { freq: 'interval', every: Math.max(1, parseInt(f.every, 10) || 1), unit: f.unit }
        : f.repeat === 'weekly' && f.weekdays.length
          ? { freq: 'weekly', every: 1, byWeekday: f.weekdays }
          : { freq: f.repeat, every: 1 };
  const tz = f.fixedTz ? f.tz : deviceTimeZone();
  const next = nextOccurrence(f.dueLocal, tz, rule, now - 60_000);
  const local = parseLocal(f.dueLocal)!;
  const dueDate = new Date(toInstant(local, tz));

  const pick = (mode: 'date' | 'time') =>
    DateTimePickerAndroid.open({
      value: dueDate,
      mode,
      is24Hour: true,
      onChange: (e, d) => {
        if (e.type !== 'set' || !d) return;
        // Picker returns a Date in the device zone; take its wall-clock fields.
        const picked = toLocal(d.getTime(), deviceTimeZone());
        set({ dueLocal: formatLocal(mode === 'date' ? { ...local, year: picked.year, month: picked.month, day: picked.day } : { ...local, hour: picked.hour, minute: picked.minute }) });
      },
    });

  const save = async () => {
    setSaving(true);
    try {
      const input: ReminderInput = {
        title: f.title,
        notes: f.notes,
        itemId: f.itemId,
        collectionId: f.collectionId,
        dueLocal: f.dueLocal,
        tz,
        tzMode: f.fixedTz ? 'fixed' : 'floating',
        rule,
      };
      if (!rule && next === null) throw new AppError('VALIDATION', 'Время уже прошло — выберите время в будущем');
      if (isNew) await remindersRepo().create(input);
      else await remindersRepo().update(params.id, input);
      const perm = await ensureNotificationPermission();
      await reconcileReminders();
      if (perm !== 'granted') {
        Alert.alert('Уведомления выключены', 'Напоминание сохранено, но Android не покажет уведомление. Разрешите уведомления для Clipbox в настройках системы.');
      }
      router.back();
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e, 'DB_QUERY_FAILED', 'Не удалось сохранить').userMessage);
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert('Удалить напоминание?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          remindersRepo()
            .remove(params.id)
            .then(reconcileReminders)
            .then(() => router.back())
            .catch((e) => Alert.alert('Clipbox', toAppError(e).userMessage)),
      },
    ]);

  const input = [typography.body, { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 48 }];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="title" style={{ flex: 1 }}>
          {isNew ? 'Новое напоминание' : 'Напоминание'}
        </Text>
        {!isNew ? (
          <PressableScale accessibilityLabel="Удалить" onPress={remove} style={{ padding: spacing.sm }}>
            <Icon name="trash-2" size={20} color={colors.danger} />
          </PressableScale>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <TextInput value={f.title} onChangeText={(t) => set({ title: t })} placeholder="Что напомнить?" placeholderTextColor={colors.secondary} autoFocus={isNew && !f.title} accessibilityLabel="Название" style={input} />
        {initial?.linked ? (
          <Card style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="link-2" size={16} color={colors.primary} />
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {initial.linked}
            </Text>
          </Card>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Text variant="label" tone="secondary">Когда</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {presets(now).map((p) => (
              <Chip key={p.label} label={p.label} selected={p.local === f.dueLocal} onPress={() => set({ dueLocal: p.local })} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label={`${local.day}.${String(local.month).padStart(2, '0')}.${local.year}`} icon="calendar" variant="secondary" onPress={() => pick('date')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={`${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`} icon="clock" variant="secondary" onPress={() => pick('time')} />
            </View>
          </View>
          <Text variant="caption" tone={next === null && !rule ? 'danger' : 'secondary'}>
            {next !== null ? `Сработает: ${formatWhen(next, now)}` : rule ? 'Повторов больше нет' : 'Это время уже прошло'}
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label" tone="secondary">Повтор · {describeRule(rule)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {REPEATS.map((r) => (
              <Chip key={r.value} label={r.label} selected={f.repeat === r.value} onPress={() => set({ repeat: r.value })} />
            ))}
          </View>
          {f.repeat === 'weekly' ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {WEEKDAYS.map((w, i) => (
                <Chip key={w} label={w} selected={f.weekdays.includes(i + 1)} onPress={() => set({ weekdays: f.weekdays.includes(i + 1) ? f.weekdays.filter((d) => d !== i + 1) : [...f.weekdays, i + 1] })} />
              ))}
            </View>
          ) : null}
          {f.repeat === 'interval' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Text>Каждые</Text>
              <TextInput value={f.every} onChangeText={(t) => set({ every: t.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" accessibilityLabel="Интервал" style={[input, { minWidth: 64, textAlign: 'center' }]} />
              {UNITS.map((u) => (
                <Chip key={u.value} label={u.label} selected={f.unit === u.value} onPress={() => set({ unit: u.value })} />
              ))}
            </View>
          ) : null}
        </View>

        <TextInput value={f.notes} onChangeText={(t) => set({ notes: t })} placeholder="Заметка (необязательно)" placeholderTextColor={colors.secondary} multiline accessibilityLabel="Заметка" style={input} />

        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text>Фиксированный часовой пояс</Text>
            <Text variant="caption" tone="secondary">
              {f.fixedTz ? `Сработает по времени ${f.tz}, даже если вы в другом поясе.` : 'Время следует за поясом телефона (09:00 останется 09:00 в поездке).'}
            </Text>
          </View>
          <Switch value={f.fixedTz} onValueChange={(v) => set({ fixedTz: v, tz: v ? f.tz || deviceTimeZone() : deviceTimeZone() })} trackColor={{ true: colors.primary, false: colors.border }} accessibilityLabel="Фиксированный часовой пояс" />
        </Card>
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
        <Button label="Сохранить" icon="check" loading={saving} disabled={!f.title.trim()} onPress={save} />
      </View>
    </View>
  );
}
