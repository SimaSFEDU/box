import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../core/errors';
import { filterMedia, formatBytes, formatDuration, kindOf, sortMedia, SUPPORTED_PREVIEW, type MediaItem, type MediaSort } from '../../../domain/media/meta';
import { MediaGate } from '../../../features/media/MediaGate';
import { useMediaLibrary } from '../../../features/media/useMediaLibrary';
import { VideoPage } from '../../../features/media/VideoPage';
import { ZoomableImage } from '../../../features/media/ZoomableImage';
import { confirmDestructive } from '../../../features/vault/VaultGate';
import { deleteMedia, mediaModule, mediaUri, shareMedia, updateMeta } from '../../../secure/mediaService';
import { Button, Icon, PressableScale, Text } from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export default function MediaViewerScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <MediaGate>
        <Viewer />
      </MediaGate>
    </View>
  );
}

function Viewer() {
  const { id, scope = 'all', sort = 'newest' } = useLocalSearchParams<{ id: string; scope?: string; sort?: MediaSort }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, spacing, radius, typography } = useTheme();
  const { items, reload } = useMediaLibrary();
  const [index, setIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [info, setInfo] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<FlatList<MediaItem>>(null);

  const list = useMemo(() => {
    const f = filterMedia(items ?? [], { favorites: scope === 'fav', collectionId: scope !== 'all' && scope !== 'fav' ? scope : undefined });
    return sortMedia(f, sort);
  }, [items, scope, sort]);
  const initial = Math.max(0, list.findIndex((i) => i.id === id));
  const current = list[index ?? initial];

  const fail = (e: unknown) => Alert.alert('Clipbox', toAppError(e).userMessage);
  if (!items) return null;
  if (!current) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Button label="Назад" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        data={list}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={initial}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(i) => i.id}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
          setNote(null);
          mediaModule.touch();
        }}
        renderItem={({ item, index: i }) => {
          const k = kindOf(item.mime);
          const active = i === (index ?? initial);
          return (
            <View style={{ width, flex: 1 }}>
              {(k === 'image' || k === 'gif') && SUPPORTED_PREVIEW.test(item.mime) ? (
                <ZoomableImage uri={mediaUri(item)} onZoomChange={setZoomed} accessibilityLabel={item.originalName} />
              ) : k === 'video' && active ? (
                <VideoPage uri={mediaUri(item)} active={active} />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl }}>
                  <Icon name={k === 'video' ? 'film' : 'file'} size={48} color="#bbb" />
                  <Text style={{ color: '#fff', textAlign: 'center' }}>{item.originalName}</Text>
                  <Text variant="caption" style={{ color: '#aaa' }}>
                    {item.mime} · {formatBytes(item.size)}
                  </Text>
                  {k === 'file' ? <Text variant="caption" style={{ color: '#aaa', textAlign: 'center' }}>Просмотр этого формата не поддерживается — файл можно отправить в другое приложение.</Text> : null}
                </View>
              )}
            </View>
          );
        }}
      />

      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top, backgroundColor: 'rgba(0,0,0,0.45)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} color="#fff" />
        </PressableScale>
        <Text numberOfLines={1} style={{ flex: 1, color: '#fff' }}>
          {current.originalName}
        </Text>
        <Text variant="caption" style={{ color: '#ccc', paddingHorizontal: spacing.sm }}>
          {(index ?? initial) + 1}/{list.length}
        </Text>
      </View>

      {info ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '60%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="title" style={{ flex: 1 }}>Информация</Text>
              <PressableScale accessibilityLabel="Закрыть" onPress={() => setInfo(false)} style={{ padding: spacing.xs }}>
                <Icon name="x" size={22} />
              </PressableScale>
            </View>
            {[
              ['Имя', current.originalName],
              ['Тип', current.mime],
              ['Размер', formatBytes(current.size)],
              current.width ? ['Разрешение', `${current.width} × ${current.height}`] : null,
              current.durationMs ? ['Длительность', formatDuration(current.durationMs)] : null,
              ['Добавлено', new Date(current.addedAt).toLocaleString()],
              ['SHA-256', current.sha256.slice(0, 16) + '…'],
            ]
              .filter((x): x is string[] => !!x)
              .map(([k, v]) => (
                <View key={k} style={{ flexDirection: 'row', gap: spacing.md }}>
                  <Text tone="secondary" style={{ width: 110 }}>{k}</Text>
                  <Text style={{ flex: 1 }} selectable>{v}</Text>
                </View>
              ))}
            <TextInput
              value={note ?? current.note}
              onChangeText={setNote}
              onEndEditing={() => note !== null && updateMeta(current, { note }).then(reload).catch(fail)}
              placeholder="Заметка"
              placeholderTextColor={colors.secondary}
              multiline
              autoCorrect={false}
              importantForAutofill="no"
              accessibilityLabel="Заметка"
              style={[typography.body, { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 48 }]}
            />
          </ScrollView>
        </View>
      ) : (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + spacing.sm, paddingTop: spacing.sm, backgroundColor: 'rgba(0,0,0,0.45)', flexDirection: 'row', justifyContent: 'space-around' }}>
          <PressableScale accessibilityLabel={current.favorite ? 'Убрать из избранного' : 'В избранное'} onPress={() => updateMeta(current, { favorite: !current.favorite }).then(reload).catch(fail)} style={{ padding: spacing.md }}>
            <Icon name="star" size={22} color={current.favorite ? colors.media : '#fff'} />
          </PressableScale>
          <PressableScale accessibilityLabel="Отправить" onPress={() => shareMedia([current]).catch(fail)} style={{ padding: spacing.md }}>
            <Icon name="send" size={22} color="#fff" />
          </PressableScale>
          <PressableScale accessibilityLabel="Информация" onPress={() => setInfo(true)} style={{ padding: spacing.md }}>
            <Icon name="info" size={22} color="#fff" />
          </PressableScale>
          <PressableScale
            accessibilityLabel="Удалить"
            onPress={() =>
              confirmDestructive('Удалить файл?', 'Зашифрованный файл будет удалён без возможности восстановления.', 'Удалить', () =>
                deleteMedia([current])
                  .then(() => (list.length <= 1 ? router.back() : reload()))
                  .catch(fail),
              )
            }
            style={{ padding: spacing.md }}
          >
            <Icon name="trash-2" size={22} color="#fff" />
          </PressableScale>
        </View>
      )}
    </View>
  );
}
