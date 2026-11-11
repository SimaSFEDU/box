import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../core/errors';
import { getDb } from '../../data/db/database';
import { createLibraryRepo } from '../../data/repositories/libraryRepo';
import { collectionsRepo } from '../../features/clips/clipsService';
import { useAsync } from '../../features/common/useAsync';
import { openItem } from '../../features/library/navigation';
import { useDataVersion } from '../../stores/dataVersion';
import { ActionSheet, EmptyState, Icon, ItemRow, PressableScale } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { data } = useAsync(
    async () => ({ collection: await collectionsRepo().get(id), items: await createLibraryRepo(getDb()).list({ collectionId: id, limit: 500 }) }),
    [id],
  );
  const collection = data?.collection ?? null;
  const items = data?.items ?? [];
  const [name, setName] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const fail = (e: unknown) => Alert.alert('Clipbox', toAppError(e, 'UNKNOWN', 'Операция не выполнена').userMessage);
  const rename = () => {
    if (name === null || name.trim() === collection?.name) return;
    collectionsRepo().rename(id, name).then(() => useDataVersion.getState().bump()).catch(fail);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <TextInput
          value={name ?? collection?.name ?? ''}
          onChangeText={setName}
          onEndEditing={rename}
          accessibilityLabel="Название коллекции"
          style={[typography.title, { flex: 1, color: colors.text, padding: 0 }]}
        />
        <PressableScale accessibilityLabel="Ещё" onPress={() => setMenu(true)} style={{ padding: spacing.sm }}>
          <Icon name="more-vertical" size={22} />
        </PressableScale>
      </View>
      <FlashList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 40 }}
        renderItem={({ item }) => <ItemRow item={item} onPress={() => openItem(item)} />}
        ListEmptyComponent={<EmptyState icon="folder" title="Коллекция пуста" message="Добавляйте элементы из карточки клипа или при сохранении через «Поделиться»." />}
      />
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { key: 'remind', label: 'Напомнить о коллекции', icon: 'bell', onPress: () => router.push({ pathname: '/reminder/[id]', params: { id: 'new', collectionId: id } }) },
          {
            key: 'delete',
            label: 'Удалить коллекцию',
            icon: 'trash-2',
            destructive: true,
            onPress: () =>
              Alert.alert('Удалить коллекцию?', 'Элементы останутся в библиотеке.', [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'Удалить',
                  style: 'destructive',
                  onPress: () =>
                    collectionsRepo()
                      .remove(id)
                      .then(() => {
                        useDataVersion.getState().bump();
                        router.back();
                      })
                      .catch(fail),
                },
              ]),
          },
        ]}
      />
    </View>
  );
}
