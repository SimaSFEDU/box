import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import type { HomeBlockId } from '../../data/repositories/settingsRepo';
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

  useFocusEffect(
    useCallback(() => {
      refreshHome();
    }, [refreshHome]),
  );

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
                <ItemRow key={i.id} item={i} />
              ))}
            </Card>
          </Section>
        ) : null;
      case 'reminders':
        return null; // Populated in stage 5 (Reminders); hidden instead of showing placeholder data.
      case 'recent':
        return home.recent.length > 0 ? (
          <Section key={id} title="Недавние">
            <Card style={{ paddingVertical: spacing.sm }}>
              {home.recent.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </Card>
          </Section>
        ) : null;
      case 'favorites':
        return home.favorites.length > 0 ? (
          <Section key={id} title="Избранное">
            <Card style={{ paddingVertical: spacing.sm }}>
              {home.favorites.map((i) => (
                <ItemRow key={i.id} item={i} />
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
