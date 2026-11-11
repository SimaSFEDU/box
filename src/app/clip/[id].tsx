import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Image, ScrollView, Share, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppError, toAppError } from '../../core/errors';
import { fileUri } from '../../data/files/storage';
import { clipsRepo, collectionsRepo, processMetadataQueue } from '../../features/clips/clipsService';
import { CollectionPicker } from '../../features/collections/CollectionPicker';
import { useAsync } from '../../features/common/useAsync';
import { TagEditor } from '../../features/notes/TagEditor';
import { useDataVersion } from '../../stores/dataVersion';
import { ActionSheet, Button, Card, ErrorView, Icon, itemIcon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

const TYPE_LABEL: Record<string, string> = {
  link: 'Ссылка', article: 'Статья', youtube: 'YouTube', tiktok: 'TikTok', reddit: 'Reddit', music: 'Музыка',
  game: 'Игра', ai_tool: 'AI-инструмент', image: 'Изображение', pdf: 'PDF', file: 'Файл',
};

export default function ClipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, error, reload } = useAsync(
    async () => {
      const c = await clipsRepo().get(id);
      if (!c) throw new AppError('DB_QUERY_FAILED', 'Клип не найден');
      return { clip: c, collections: await collectionsRepo().collectionsOf(id) };
    },
    [id],
    'Не удалось открыть клип',
  );
  const clip = data?.clip ?? null;
  const [title, setTitle] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [localCollections, setCollections] = useState<string[] | null>(null);
  const collections = localCollections ?? data?.collections ?? [];
  const [menu, setMenu] = useState(false);
  const load = async () => reload();

  const fail = (e: unknown) => Alert.alert('Clipbox', toAppError(e, 'UNKNOWN', 'Операция не выполнена').userMessage);
  const act = (p: Promise<unknown>) => p.then(load).then(() => useDataVersion.getState().bump()).catch(fail);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ErrorView error={error} onRetry={() => router.back()} />
      </View>
    );
  }
  if (!clip) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const shownTitle = title ?? clip.title;
  const shownNote = note ?? clip.note ?? '';
  const isImageFile = clip.attachmentPath && clip.attachmentMime?.startsWith('image/');
  const preview = isImageFile ? clip.attachmentPath : clip.previewPath;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <View style={{ flex: 1 }} />
        <PressableScale accessibilityLabel={clip.favorite ? 'Убрать из избранного' : 'В избранное'} onPress={() => act(clipsRepo().setFlag(id, 'favorite', !clip.favorite))} style={{ padding: spacing.sm }}>
          <Icon name="star" size={22} color={clip.favorite ? colors.primary : colors.secondary} />
        </PressableScale>
        <PressableScale accessibilityLabel="Ещё" onPress={() => setMenu(true)} style={{ padding: spacing.sm }}>
          <Icon name="more-vertical" size={22} />
        </PressableScale>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {preview ? (
          <Image source={{ uri: fileUri(preview) }} resizeMode="cover" style={{ width: '100%', aspectRatio: 1.91, borderRadius: radius.lg, backgroundColor: colors.elevated }} />
        ) : null}
        <View style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Icon name={itemIcon({ kind: 'clip', contentType: clip.contentType })} size={14} color={colors.secondary} />
            <Text variant="caption" tone="secondary">
              {TYPE_LABEL[clip.contentType]}
              {clip.siteName ? ` · ${clip.siteName}` : ''}
              {clip.metaStatus === 'pending' ? ' · загрузка данных…' : clip.metaStatus === 'failed' ? ' · данные не загрузились' : ''}
            </Text>
          </View>
          <TextInput
            value={shownTitle}
            onChangeText={setTitle}
            onEndEditing={() => title !== null && title !== clip.title && act(clipsRepo().setTitle(id, title.trim()))}
            placeholder={clip.url ?? 'Без названия'}
            placeholderTextColor={colors.secondary}
            multiline
            accessibilityLabel="Заголовок"
            style={[typography.title, { color: colors.text, padding: 0 }]}
          />
          {clip.description ? <Text tone="secondary">{clip.description}</Text> : null}
        </View>

        {clip.url ? (
          <Card style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="secondary" numberOfLines={3} selectable>
              {clip.url}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Открыть" icon="external-link" onPress={() => Linking.openURL(clip.url!).catch(fail)} />
              </View>
              {clip.metaStatus === 'failed' ? (
                <Button label="Повторить" icon="refresh-cw" variant="secondary" onPress={() => act(clipsRepo().retryMeta(id).then(() => processMetadataQueue()))} />
              ) : null}
            </View>
          </Card>
        ) : clip.attachmentPath ? (
          <Card style={{ gap: spacing.sm }}>
            <Text numberOfLines={1}>{clip.attachmentName ?? 'Файл'}</Text>
            <Button
              label="Открыть / отправить"
              icon="share"
              onPress={() => Sharing.shareAsync(fileUri(clip.attachmentPath!), { mimeType: clip.attachmentMime ?? undefined }).catch(fail)}
            />
          </Card>
        ) : null}

        {clip.inbox ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Icon name="inbox" color={colors.primary} />
            <Text style={{ flex: 1 }}>В Inbox — ещё не разобрано</Text>
            <Button label="Разобрано" variant="secondary" onPress={() => act(clipsRepo().setFlag(id, 'inbox', false))} />
          </Card>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Text variant="label" tone="secondary">Комментарий</Text>
          <TextInput
            value={shownNote}
            onChangeText={setNote}
            onEndEditing={() => note !== null && act(clipsRepo().setNote(id, note))}
            placeholder="Почему это важно?"
            placeholderTextColor={colors.secondary}
            multiline
            accessibilityLabel="Комментарий"
            style={[typography.body, { color: colors.text, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }]}
          />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" tone="secondary">Теги</Text>
          <TagEditor tags={clip.tags} onChange={(t) => act(clipsRepo().setTags(id, t))} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" tone="secondary">Коллекции</Text>
          <CollectionPicker
            selected={collections}
            onChange={(ids) => {
              setCollections(ids);
              act(collectionsRepo().setItemCollections(id, ids));
            }}
          />
        </View>
      </ScrollView>
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          { key: 'remind', label: 'Напомнить', icon: 'bell', onPress: () => router.push({ pathname: '/reminder/[id]', params: { id: 'new', itemId: id } }) },
          { key: 'archive', label: clip.archived ? 'Вернуть из архива' : 'В архив', icon: 'archive', onPress: () => act(clipsRepo().setFlag(id, 'archived', !clip.archived)) },
          ...(clip.url ? [{ key: 'share', label: 'Поделиться ссылкой', icon: 'share-2' as const, onPress: () => Share.share({ message: clip.url! }).catch(fail) }] : []),
          {
            key: 'delete',
            label: 'Удалить в корзину',
            icon: 'trash-2',
            destructive: true,
            onPress: () => clipsRepo().softDelete(id).then(() => { useDataVersion.getState().bump(); router.back(); }).catch(fail),
          },
        ]}
      />
    </View>
  );
}
