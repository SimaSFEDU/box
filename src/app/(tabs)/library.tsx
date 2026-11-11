import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { collectionsRepo } from '../../features/clips/clipsService';
import { useAsync } from '../../features/common/useAsync';
import { openItem } from '../../features/library/navigation';
import { useLibraryQuery, type LibraryFilter, type LibraryScope } from '../../features/library/useLibraryQuery';
import { Chip, EmptyState, ErrorView, Icon, ItemRow, PressableScale, SegmentedControl, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

const SEGMENTS: { value: LibraryScope; label: string }[] = [
  { value: 'all', label: 'Всё' },
  { value: 'note', label: 'Заметки' },
  { value: 'clip', label: 'Клипы' },
];

export default function LibraryScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [scope, setScope] = useState<LibraryScope>('all');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('none');
  const { items, error, loading, reload } = useLibraryQuery(scope, query, filter);
  const matchingCollections = useAsync(() => collectionsRepo().search(query), [query]).data ?? [];
  const toggle = (f: LibraryFilter) => setFilter((cur) => (cur === f ? 'none' : f));

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="display" accessibilityRole="header">
            Library
          </Text>
          <PressableScale accessibilityLabel="Корзина" onPress={() => router.push('/trash')} style={{ padding: spacing.sm }}>
            <Icon name="trash-2" size={20} color={colors.secondary} />
          </PressableScale>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          }}
        >
          <Icon name="search" size={18} color={colors.secondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по заметкам и клипам"
            placeholderTextColor={colors.secondary}
            accessibilityLabel="Поиск"
            returnKeyType="search"
            style={[typography.body, { flex: 1, color: colors.text, minHeight: 44 }]}
          />
        </View>
        <SegmentedControl segments={SEGMENTS} value={scope} onChange={setScope} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label="Избранное" icon="star" selected={filter === 'favorites'} onPress={() => toggle('favorites')} />
          <Chip label="Inbox" icon="inbox" selected={filter === 'inbox'} onPress={() => toggle('inbox')} />
          <Chip label="Архив" icon="archive" selected={filter === 'archive'} onPress={() => toggle('archive')} />
          <Chip label="Коллекции" icon="folder" onPress={() => router.push('/collections')} />
        </View>
        {query.trim() && matchingCollections.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {matchingCollections.map((c) => (
              <Chip key={c.id} label={`${c.name} · ${c.count}`} icon="folder" selected onPress={() => router.push({ pathname: '/collection/[id]', params: { id: c.id } })} />
            ))}
          </View>
        ) : null}
      </View>
      {error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
          renderItem={({ item }) => <ItemRow item={item} onPress={() => openItem(item)} />}
          ListEmptyComponent={
            loading ? null : query && filter === 'none' ? (
              <EmptyState icon="search" title="Ничего не найдено" message="Попробуйте другой запрос." />
            ) : (
              <EmptyState
                icon={filter === 'archive' ? 'archive' : filter === 'favorites' ? 'star' : filter === 'inbox' ? 'inbox' : 'book'}
                title={filter === 'archive' ? 'Архив пуст' : filter === 'favorites' ? 'Нет избранного' : filter === 'inbox' ? 'Inbox разобран' : 'Библиотека пуста'}
                message={filter === 'none' ? 'Заметки и сохранённые материалы появятся здесь.' : undefined}
              />
            )
          }
        />
      )}
    </View>
  );
}
