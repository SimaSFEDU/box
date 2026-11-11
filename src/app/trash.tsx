import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../core/errors';
import type { LibraryItemSummary } from '../data/repositories/libraryRepo';
import { useLibraryQuery } from '../features/library/useLibraryQuery';
import { notesRepo, purgeAndCollect } from '../features/notes/notesService';
import { ActionSheet, EmptyState, ErrorView, Icon, ItemRow, PressableScale, Text } from '../ui/components';
import { useTheme } from '../ui/theme/ThemeProvider';

export default function TrashScreen() {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { items, error, loading, reload } = useLibraryQuery('all', '', 'trash');
  const [selected, setSelected] = useState<LibraryItemSummary | null>(null);
  const fail = (e: unknown) => Alert.alert('Clipbox', toAppError(e, 'DB_QUERY_FAILED', 'Операция не выполнена').userMessage);

  const emptyTrash = () =>
    Alert.alert('Очистить корзину?', 'Элементы будут удалены навсегда вместе с вложениями.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => purgeAndCollect(items.map((i) => i.id)).then(reload).catch(fail),
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="title" style={{ flex: 1 }}>
          Корзина
        </Text>
        {items.length > 0 ? (
          <PressableScale accessibilityLabel="Очистить корзину" onPress={emptyTrash} style={{ padding: spacing.sm }}>
            <Text variant="label" tone="danger">
              Очистить
            </Text>
          </PressableScale>
        ) : null}
      </View>
      <Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        Элементы удаляются навсегда через 30 дней.
      </Text>
      {error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
          renderItem={({ item }) => <ItemRow item={item} onPress={() => setSelected(item)} />}
          ListEmptyComponent={loading ? null : <EmptyState icon="trash-2" title="Корзина пуста" />}
        />
      )}
      <ActionSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title || undefined}
        actions={
          selected
            ? [
                { key: 'restore', label: 'Восстановить', icon: 'rotate-ccw', onPress: () => notesRepo().restore(selected.id).then(reload).catch(fail) },
                { key: 'purge', label: 'Удалить навсегда', icon: 'trash-2', destructive: true, onPress: () => purgeAndCollect([selected.id]).then(reload).catch(fail) },
              ]
            : []
        }
      />
    </View>
  );
}
