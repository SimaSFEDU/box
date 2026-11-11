import { Image } from 'expo-image';
import { View } from 'react-native';

import { formatDuration, kindOf, type MediaItem } from '../../domain/media/meta';
import { thumbUri } from '../../secure/mediaService';
import { Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function MediaTile({ item, size, selected, selecting, onPress, onLongPress }: { item: MediaItem; size: number; selected: boolean; selecting: boolean; onPress: () => void; onLongPress: () => void }) {
  const { colors, radius } = useTheme();
  const kind = kindOf(item.mime);
  const thumb = thumbUri(item);
  return (
    <PressableScale
      accessibilityLabel={item.originalName}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={{ width: size, height: size, padding: 1 }}
    >
      <View style={{ flex: 1, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' }}>
        {thumb ? (
          <Image source={{ uri: thumb }} cachePolicy="none" contentFit="cover" recyclingKey={item.id} style={{ width: '100%', height: '100%' }} />
        ) : (
          <View style={{ alignItems: 'center', gap: 4, padding: 6 }}>
            <Icon name={kind === 'video' ? 'film' : kind === 'file' ? 'file' : 'image'} size={22} color={colors.secondary} />
            <Text variant="caption" tone="secondary" numberOfLines={2} style={{ textAlign: 'center' }}>
              {item.originalName}
            </Text>
          </View>
        )}
        {kind === 'video' || kind === 'gif' ? (
          <View style={{ position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name={kind === 'video' ? 'play' : 'zap'} size={10} color="#fff" />
            <Text variant="caption" style={{ color: '#fff', fontSize: 10 }}>
              {kind === 'video' ? formatDuration(item.durationMs) : 'GIF'}
            </Text>
          </View>
        ) : null}
        {item.favorite ? (
          <View style={{ position: 'absolute', right: 4, bottom: 4 }}>
            <Icon name="star" size={12} color="#fff" />
          </View>
        ) : null}
        {selecting ? (
          <View style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: selected ? colors.media : 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
            {selected ? <Icon name="check" size={12} color="#fff" /> : null}
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}
