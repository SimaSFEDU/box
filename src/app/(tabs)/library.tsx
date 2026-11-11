import { FlashList } from '@shopify/flash-list';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLibraryQuery, type LibraryScope } from '../../features/library/useLibraryQuery';
import { EmptyState, ErrorView, Icon, ItemRow, SegmentedControl, Text } from '../../ui/components';
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
  const { items, error, loading, reload } = useLibraryQuery(scope, query);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Text variant="display" accessibilityRole="header">
          Library
        </Text>
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
      </View>
      {error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
          renderItem={({ item }) => <ItemRow item={item} />}
          ListEmptyComponent={
            loading ? null : query ? (
              <EmptyState icon="search" title="Ничего не найдено" message="Попробуйте другой запрос." />
            ) : (
              <EmptyState icon="book" title="Библиотека пуста" message="Заметки и сохранённые материалы появятся здесь." />
            )
          }
        />
      )}
    </View>
  );
}
