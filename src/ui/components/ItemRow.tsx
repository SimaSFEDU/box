import { Image, View } from 'react-native';

import { fileUri } from '../../data/files/storage';
import type { LibraryItemSummary } from '../../data/repositories/libraryRepo';
import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

const clipIcons: Record<string, IconName> = {
  youtube: 'youtube',
  music: 'music',
  image: 'image',
  pdf: 'file-text',
  file: 'paperclip',
  game: 'play',
  ai_tool: 'cpu',
  reddit: 'message-circle',
  tiktok: 'video',
  article: 'book-open',
  link: 'link',
};

export function itemIcon(item: Pick<LibraryItemSummary, 'kind' | 'contentType'>): IconName {
  if (item.kind === 'note') return 'file-text';
  return clipIcons[item.contentType ?? 'link'] ?? 'link';
}

export function ItemRow({ item, onPress }: { item: LibraryItemSummary; onPress?: () => void }) {
  const { colors, spacing, radius } = useTheme();
  const title = item.title.trim() || (item.kind === 'note' ? 'Без названия' : 'Ссылка');
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: 56 }}
    >
      <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {item.previewPath ? (
          <Image source={{ uri: fileUri(item.previewPath) }} style={{ width: 40, height: 40 }} accessibilityIgnoresInvertColors />
        ) : (
          <Icon name={itemIcon(item)} size={18} color={colors.secondary} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="heading" numberOfLines={1}>
          {title}
        </Text>
        {item.inbox ? (
          <Text variant="caption" tone="primary">
            Inbox
          </Text>
        ) : null}
        {item.subtitle ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {item.subtitle.replace(/\s+/g, ' ')}
          </Text>
        ) : null}
      </View>
      {item.favorite ? <Icon name="star" size={14} color={colors.primary} /> : null}
    </PressableScale>
  );
}
