import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';

import type { HomeBlockId } from '../../data/repositories/settingsRepo';
import { useNow } from '../../features/common/useNow';
import { openItem } from '../../features/library/navigation';
import { ReminderRow } from '../../features/reminders/ReminderRow';
import { reconcileReminders, remindersRepo } from '../../features/reminders/scheduler';
import { useDataVersion } from '../../stores/dataVersion';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Card, EmptyState, ErrorView, Icon, ItemRow, Screen, Section, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function HomeScreen() {
  const { colors, spacing } = useTheme();
  const { home, error, refreshHome } = useLibraryStore();
  const blocks = useSettingsStore((s) => s.settings.homeBlocks);

  const version = useDataVersion((s) => s.version);
  const now = useNow();
  useFocusEffect(
    useCallback(() => {
      refreshHome();
    }, [refreshHome]),
  );
  // Background changes (metadata fetched, share saved) while Home is visible.
  useEffect(() => {
    if (version > 0) void refreshHome();
  }, [version, refreshHome]);

  if (error) {
    return (
      <Screen title="Clipbox">
        <ErrorView error={error} onRetry={refreshHome} />
      </Screen>
    );
  }

  const total = home ? home.counts.notes + home.counts.clips : 0;
  const isEmpty = home !== null && total === 0;

  const render = (id: HomeBlockId) => {
    if (!home) return null;
    switch (id) {
      case 'inbox':
        return home.inbox.length > 0 ? (
          <Section key={id} title={`Inbox · ${home.counts.inbox}`}>
            <Card style={{ paddingVertical: spacing.sm }}>
              {home.inbox.map((i) => (
                <ItemRow key={i.id} item={i} onPress={() => openItem(i)} />
              ))}
            </Card>
          </Section>
        ) : null;
      case 'reminders':
        return home.reminders.length > 0 ? (
          <Section key={id} title="Напоминания" action={<Text variant="label" tone="primary" onPress={() => router.navigate('/reminders')}>Все</Text>}>
            <Card style={{ paddingVertical: spacing.xs }}>
              {home.reminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  r={r}
                  now={now}
                  onPress={() => router.push({ pathname: '/reminder/[id]', params: { id: r.id } })}
                  onToggle={() => void remindersRepo().complete(r.id, r.nextFireAt ?? now).then(reconcileReminders)}
                />
              ))}
            </Card>
          </Section>
        ) : null;
      case 'recent':
        return home.recent.length > 0 ? (
          <Section key={id} title="Недавние">
            <Card style={{ paddingVertical: spacing.sm }}>
              {home.recent.map((i) => (
                <ItemRow key={i.id} item={i} onPress={() => openItem(i)} />
              ))}
            </Card>
          </Section>
        ) : null;
      case 'favorites':
        return home.favorites.length > 0 ? (
          <Section key={id} title="Избранное">
            <Card style={{ paddingVertical: spacing.sm }}>
              {home.favorites.map((i) => (
                <ItemRow key={i.id} item={i} onPress={() => openItem(i)} />
              ))}
            </Card>
          </Section>
        ) : null;
      case 'private':
        return (
          <Card key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name="lock" color={colors.vault} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">Private space</Text>
              <Text variant="caption" tone="secondary">
                Vault и Private Media — в разработке
              </Text>
            </View>
          </Card>
        );
    }
  };

  return (
    <Screen title="Clipbox" subtitle={greeting()}>
      {isEmpty ? (
        <EmptyState
          icon="inbox"
          title="Здесь пока пусто"
          message="Сохраняйте заметки, ссылки и идеи — всё важное будет под рукой."
          actionLabel="Создать"
          onAction={() => router.push('/capture')}
        />
      ) : null}
      {blocks.filter((b) => b.visible).map((b) => render(b.id))}
    </Screen>
  );
}
