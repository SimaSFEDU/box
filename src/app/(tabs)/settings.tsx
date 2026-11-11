import Constants from 'expo-constants';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { toAppError } from '../../core/errors';
import type { SettingsShape } from '../../data/repositories/settingsRepo';
import { useAsync } from '../../features/common/useAsync';
import { exactAlarmsAllowed, ensureNotificationPermission, notificationPermission, reconcileReminders, requestExactAlarms } from '../../features/reminders/scheduler';
import { exportNotesArchive, importFromFiles, importFromFolder, type ImportResult } from '../../features/notes/archiveService';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button, Card, Screen, Section, SegmentedControl, Text } from '../../ui/components';

const THEMES: { value: SettingsShape['themeMode']; label: string }[] = [
  { value: 'system', label: 'Система' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

export default function SettingsScreen() {
  const themeMode = useSettingsStore((s) => s.settings.themeMode);
  const update = useSettingsStore((s) => s.update);
  const [busy, setBusy] = useState<null | 'export' | 'files' | 'folder'>(null);
  const notif = useAsync(async () => ({ permission: await notificationPermission(), exact: await exactAlarmsAllowed() }), []);
  const fixNotifications = async () => {
    const p = await ensureNotificationPermission();
    if (p === 'denied') await Linking.openSettings();
    await reconcileReminders();
    notif.reload();
  };
  const fixExact = async () => {
    await requestExactAlarms();
    await reconcileReminders();
    notif.reload();
  };

  const report = (r: ImportResult | null) => {
    if (!r) return;
    const lines = [`Импортировано: ${r.imported}`, r.skipped ? `Пропущено (уже есть): ${r.skipped}` : '', ...r.warnings.slice(0, 5)];
    Alert.alert('Импорт завершён', lines.filter(Boolean).join('\n'));
  };
  const run = async <T,>(kind: 'export' | 'files' | 'folder', fn: () => Promise<T>, done: (r: T) => void) => {
    setBusy(kind);
    try {
      done(await fn());
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e, 'UNKNOWN', 'Операция не выполнена').userMessage);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Settings">
      <Section title="Оформление">
        <SegmentedControl segments={THEMES} value={themeMode} onChange={(v) => update('themeMode', v)} />
      </Section>
      <Section title="Напоминания">
        <Card style={{ gap: 12 }}>
          <Text>
            Уведомления: {notif.data?.permission === 'granted' ? 'разрешены' : notif.data?.permission === 'denied' ? 'запрещены' : 'не настроены'}
          </Text>
          {notif.data && notif.data.permission !== 'granted' ? <Button label="Разрешить уведомления" icon="bell" variant="secondary" onPress={fixNotifications} /> : null}
          <Text tone="secondary">
            {notif.data?.exact
              ? 'Точное время включено: напоминания приходят минута в минуту.'
              : 'Без разрешения «Будильники и напоминания» Android может присылать уведомления с задержкой в несколько минут.'}
          </Text>
          {notif.data && !notif.data.exact ? <Button label="Включить точное время" icon="clock" variant="secondary" onPress={fixExact} /> : null}
        </Card>
      </Section>
      <Section title="Данные">
        <Card style={{ gap: 12 }}>
          <Text tone="secondary">
            Заметки экспортируются в ZIP: Markdown-файлы, вложения и манифест с контрольными суммами. Его можно открыть в Obsidian
            или восстановить в Clipbox.
          </Text>
          <Button label="Экспорт заметок" icon="upload" loading={busy === 'export'} disabled={busy !== null} onPress={() => run('export', exportNotesArchive, () => undefined)} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="Файлы .md / .zip" icon="file-plus" variant="secondary" loading={busy === 'files'} disabled={busy !== null} onPress={() => run('files', importFromFiles, report)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Папка Obsidian" icon="folder-plus" variant="secondary" loading={busy === 'folder'} disabled={busy !== null} onPress={() => run('folder', importFromFolder, report)} />
            </View>
          </View>
        </Card>
      </Section>
      <Section title="О приложении">
        <Card>
          <Text variant="heading">Clipbox {Constants.expoConfig?.version ?? ''}</Text>
          <Text tone="secondary">Your mind, organized. Все данные хранятся только на этом устройстве.</Text>
        </Card>
      </Section>
    </Screen>
  );
}
