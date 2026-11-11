import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../core/errors';
import { filterMedia, sortMedia, type MediaSort } from '../../../domain/media/meta';
import { MediaGate } from '../../../features/media/MediaGate';
import { MediaTile } from '../../../features/media/MediaTile';
import { pickMediaFiles } from '../../../features/media/pickMedia';
import { useMediaLibrary } from '../../../features/media/useMediaLibrary';
import { confirmDestructive } from '../../../features/vault/VaultGate';
import { deleteCollection, deleteMedia, importMedia, mediaModule, moveMedia, saveCollection, shareMedia, updateMeta } from '../../../secure/mediaService';
import { ActionSheet, Button, Chip, EmptyState, Icon, PressableScale, Text } from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

const SORTS: { value: MediaSort; label: string }[] = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
  { value: 'name', label: 'По имени' },
  { value: 'size', label: 'По размеру' },
];

export default function MediaScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <MediaGate>
        <Gallery />
      </MediaGate>
    </View>
  );
}

let originalsHintShown = false;

type Scope = { kind: 'all' } | { kind: 'fav' } | { kind: 'collection'; id: string };

function Gallery() {
  const { colors, spacing, radius, typography } = useTheme();
  const { width } = useWindowDimensions();
  const { items, collections, corrupted, error, reload } = useMediaLibrary();
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [sort, setSort] = useState<MediaSort>('newest');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<null | 'sort' | 'move' | { collection: string }>(null);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const visible = useMemo(() => {
    const f = filterMedia(items ?? [], {
      query,
      favorites: scope.kind === 'fav',
      collectionId: scope.kind === 'collection' ? scope.id : undefined,
    });
    return sortMedia(f, sort);
  }, [items, scope, sort, query]);

  const selecting = selected.size > 0;
  const selectedItems = () => visible.filter((i) => selected.has(i.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const fail = (e: unknown) => Alert.alert('Clipbox', toAppError(e).userMessage);
  const done = () => { setSelected(new Set()); reload(); };

  const add = async () => {
    try {
      const files = await pickMediaFiles();
      if (!files.length) return;
      setProgress({ done: 0, total: files.length });
      const r = await importMedia(files, scope.kind === 'collection' ? scope.id : null, (d) => setProgress({ done: d, total: files.length }));
      setProgress(null);
      reload();
      if (r.failed) Alert.alert('Импорт', `Добавлено: ${r.imported}. Не удалось: ${r.failed} (файл недоступен или слишком большой).`);
      if (!originalsHintShown) {
        originalsHintShown = true;
        Alert.alert('Оригиналы остались', 'Clipbox сохранил зашифрованные копии. Исходные файлы в галерее или папке нужно удалить вручную, если они больше не нужны.');
      }
    } catch (e) {
      setProgress(null);
      fail(e);
    }
  };

  const size = Math.floor((width - spacing.lg * 2) / 3);
  const scopeLabel = scope.kind === 'all' ? 'Все' : scope.kind === 'fav' ? 'Избранное' : collections.find((c) => c.id === scope.id)?.name ?? '';

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs }}>
        {selecting ? (
          <>
            <PressableScale accessibilityLabel="Отменить выбор" onPress={() => setSelected(new Set())} style={{ padding: spacing.sm }}>
              <Icon name="x" size={22} />
            </PressableScale>
            <Text variant="title" style={{ flex: 1 }}>
              Выбрано: {selected.size}
            </Text>
            <PressableScale accessibilityLabel="Выбрать все" onPress={() => setSelected(new Set(visible.map((i) => i.id)))} style={{ padding: spacing.sm }}>
              <Icon name="check-square" size={20} color={colors.secondary} />
            </PressableScale>
          </>
        ) : (
          <>
            <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
              <Icon name="chevron-left" size={24} />
            </PressableScale>
            <Text variant="title" style={{ flex: 1 }}>
              Private Media
            </Text>
            <PressableScale accessibilityLabel="Сортировка" onPress={() => setSheet('sort')} style={{ padding: spacing.sm }}>
              <Icon name="bar-chart-2" size={20} color={colors.secondary} />
            </PressableScale>
            <PressableScale accessibilityLabel="Настройки Private Media" onPress={() => router.push('/private/media/settings')} style={{ padding: spacing.sm }}>
              <Icon name="settings" size={20} color={colors.secondary} />
            </PressableScale>
            <PressableScale accessibilityLabel="Заблокировать" onPress={() => void mediaModule.lock()} style={{ padding: spacing.sm }}>
              <Icon name="lock" size={20} color={colors.media} />
            </PressableScale>
            <PressableScale accessibilityLabel="Добавить файлы" onPress={add} style={{ padding: spacing.sm }}>
              <Icon name="plus" size={24} color={colors.primary} />
            </PressableScale>
          </>
        )}
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md }}>
          <Icon name="search" size={18} color={colors.secondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Имя файла или заметка" placeholderTextColor={colors.secondary} autoCorrect={false} importantForAutofill="no" accessibilityLabel="Поиск" style={[typography.body, { flex: 1, color: colors.text, minHeight: 44 }]} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          <Chip label="Все" selected={scope.kind === 'all'} onPress={() => setScope({ kind: 'all' })} />
          <Chip label="Избранное" icon="star" selected={scope.kind === 'fav'} onPress={() => setScope({ kind: 'fav' })} />
          {collections.map((c) => (
            <Chip key={c.id} label={c.name} icon="folder" selected={scope.kind === 'collection' && scope.id === c.id} onPress={() => setScope({ kind: 'collection', id: c.id })} onLongPress={() => setSheet({ collection: c.id })} />
          ))}
          {newCollection !== null ? (
            <TextInput
              autoFocus
              value={newCollection}
              onChangeText={setNewCollection}
              onSubmitEditing={() => saveCollection(newCollection).then(() => { setNewCollection(null); reload(); }).catch(fail)}
              onBlur={() => setNewCollection(null)}
              placeholder="Название"
              placeholderTextColor={colors.secondary}
              accessibilityLabel="Новая коллекция"
              style={[typography.label, { minWidth: 120, minHeight: 36, color: colors.text, borderWidth: 1, borderColor: colors.media, borderRadius: radius.pill, paddingHorizontal: spacing.md }]}
            />
          ) : (
            <Chip label="Коллекция" icon="plus" onPress={() => setNewCollection('')} />
          )}
        </ScrollView>
        {corrupted ? <Text variant="caption" tone="danger">Повреждённых файлов: {corrupted}. Их можно вернуть только из резервной копии.</Text> : null}
        {error ? <Text tone="danger">{error}</Text> : null}
        {progress ? <Text tone="secondary">Шифрование… {progress.done}/{progress.total}</Text> : null}
      </View>

      <FlashList
        data={visible}
        numColumns={3}
        keyExtractor={(i) => i.id}
        extraData={selected}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 100 }}
        renderItem={({ item }) => (
          <MediaTile
            item={item}
            size={size}
            selecting={selecting}
            selected={selected.has(item.id)}
            onLongPress={() => toggle(item.id)}
            onPress={() =>
              selecting
                ? toggle(item.id)
                : router.push({ pathname: '/private/media/[id]', params: { id: item.id, scope: scope.kind === 'collection' ? scope.id : scope.kind, sort } })
            }
          />
        )}
        ListEmptyComponent={
          items === null ? null : (
            <EmptyState
              icon="image"
              title={query ? 'Ничего не найдено' : `${scopeLabel}: пусто`}
              message="Добавьте файлы кнопкой «+» или через «Поделиться» → Clipbox → Private Media. Файлы шифруются и не появляются в галерее."
              actionLabel={query ? undefined : 'Добавить'}
              onAction={query ? undefined : add}
            />
          )
        }
      />

      {selecting ? (
        <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.elevated, borderRadius: radius.lg, padding: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Отправить" icon="send" onPress={() => shareMedia(selectedItems()).catch(fail)} />
          </View>
          <Button label="" icon="folder" variant="secondary" onPress={() => setSheet('move')} />
          <Button label="" icon="star" variant="secondary" onPress={() => { const s = selectedItems(); const fav = !s.every((i) => i.favorite); Promise.all(s.map((i) => updateMeta(i, { favorite: fav }))).then(done).catch(fail); }} />
          <Button
            label=""
            icon="trash-2"
            variant="danger"
            onPress={() => confirmDestructive(`Удалить ${selected.size}?`, 'Зашифрованные файлы будут удалены без возможности восстановления.', 'Удалить', () => deleteMedia(selectedItems()).then(done).catch(fail))}
          />
        </View>
      ) : null}

      <ActionSheet
        visible={sheet === 'sort'}
        onClose={() => setSheet(null)}
        title="Сортировка"
        actions={SORTS.map((s) => ({ key: s.value, label: (sort === s.value ? '✓ ' : '') + s.label, icon: 'bar-chart-2', onPress: () => setSort(s.value) }))}
      />
      <ActionSheet
        visible={sheet === 'move'}
        onClose={() => setSheet(null)}
        title="Переместить в коллекцию"
        actions={[
          { key: 'none', label: 'Без коллекции', icon: 'inbox', onPress: () => moveMedia(selectedItems(), null).then(done).catch(fail) },
          ...collections.map((c) => ({ key: c.id, label: c.name, icon: 'folder' as const, onPress: () => moveMedia(selectedItems(), c.id).then(done).catch(fail) })),
        ]}
      />
      <ActionSheet
        visible={typeof sheet === 'object' && sheet !== null}
        onClose={() => setSheet(null)}
        title="Коллекция"
        actions={
          typeof sheet === 'object' && sheet !== null
            ? [
                {
                  key: 'delete',
                  label: 'Удалить коллекцию (файлы останутся)',
                  icon: 'trash-2',
                  destructive: true,
                  onPress: () => deleteCollection(sheet.collection).then(() => { setScope({ kind: 'all' }); reload(); }).catch(fail),
                },
              ]
            : []
        }
      />
    </View>
  );
}

