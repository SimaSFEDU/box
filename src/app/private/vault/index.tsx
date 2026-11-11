import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../core/errors';
import { entrySubtitle, matchesQuery, sortEntries, TYPE_META, type VaultEntryType } from '../../../domain/vault/entries';
import { VaultGate } from '../../../features/vault/VaultGate';
import { listEntries, lockVault, touchVault, type LoadedEntry } from '../../../secure/vaultService';
import { ActionSheet, EmptyState, Icon, PressableScale, Text, type IconName } from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export default function VaultScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <VaultGate>
        <VaultList />
      </VaultGate>
    </View>
  );
}

function VaultList() {
  const { colors, spacing, radius, typography } = useTheme();
  const [items, setItems] = useState<LoadedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      touchVault();
      listEntries().then(
        (r) => alive && setItems(r),
        (e) => alive && setError(toAppError(e).userMessage),
      );
      return () => {
        alive = false;
      };
    }, []),
  );

  const visible = useMemo(() => {
    const ok = (items ?? []).filter((i): i is Extract<LoadedEntry, { ok: true }> => i.ok);
    const broken = (items ?? []).filter((i) => !i.ok);
    return { list: sortEntries(ok.map((i) => i.entry).filter((e) => matchesQuery(e, query))), broken: broken.length };
  }, [items, query]);

  const open = (id: string, type?: VaultEntryType) => router.push({ pathname: '/private/vault/[id]', params: type ? { id, type } : { id } });

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="title" style={{ flex: 1 }}>
          Vault
        </Text>
        <PressableScale accessibilityLabel="Настройки Vault" onPress={() => router.push('/private/vault/settings')} style={{ padding: spacing.sm }}>
          <Icon name="settings" size={20} color={colors.secondary} />
        </PressableScale>
        <PressableScale accessibilityLabel="Заблокировать" onPress={() => void lockVault()} style={{ padding: spacing.sm }}>
          <Icon name="lock" size={20} color={colors.vault} />
        </PressableScale>
        <PressableScale accessibilityLabel="Добавить запись" onPress={() => setAdding(true)} style={{ padding: spacing.sm }}>
          <Icon name="plus" size={24} color={colors.primary} />
        </PressableScale>
      </View>
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md }}>
          <Icon name="search" size={18} color={colors.secondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по названию и логину"
            placeholderTextColor={colors.secondary}
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            accessibilityLabel="Поиск в Vault"
            style={[typography.body, { flex: 1, color: colors.text, minHeight: 44 }]}
          />
        </View>
        {visible.broken > 0 ? (
          <Text variant="caption" tone="danger" style={{ marginTop: spacing.xs }}>
            Повреждённых записей: {visible.broken}. Их можно восстановить только из резервной копии.
          </Text>
        ) : null}
        {error ? <Text tone="danger">{error}</Text> : null}
      </View>
      <FlashList
        data={visible.list}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <PressableScale accessibilityLabel={item.title} onPress={() => open(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: 56 }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.vault + '1f', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={TYPE_META[item.type].icon as IconName} size={18} color={colors.vault} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {item.title}
              </Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {entrySubtitle(item)}
              </Text>
            </View>
            {item.favorite ? <Icon name="star" size={14} color={colors.vault} /> : null}
          </PressableScale>
        )}
        ListEmptyComponent={
          items === null ? null : query ? (
            <EmptyState icon="search" title="Ничего не найдено" message="Поиск не смотрит в пароли и другие секретные поля." />
          ) : (
            <EmptyState icon="key" title="Vault пуст" message="Добавьте первый пароль, ключ или секретную заметку." actionLabel="Добавить" onAction={() => setAdding(true)} />
          )
        }
      />
      <ActionSheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Новая запись"
        actions={(Object.keys(TYPE_META) as VaultEntryType[]).map((t) => ({ key: t, label: TYPE_META[t].label, icon: TYPE_META[t].icon as IconName, onPress: () => open('new', t) }))}
      />
    </View>
  );
}
