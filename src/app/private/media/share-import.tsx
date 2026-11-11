import { router } from 'expo-router';
import { clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import { useState } from 'react';
import { BackHandler, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../core/errors';
import { MediaGate } from '../../../features/media/MediaGate';
import { importMedia, listCollections, type PrivateCollection } from '../../../secure/mediaService';
import { useAsync } from '../../../features/common/useAsync';
import { Button, Chip, EmptyState, Text } from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

/**
 * Share → Clipbox → Private Media. Runs inside the secure section (FLAG_SECURE) and behind the media
 * lock; files are encrypted straight from the sender's content:// stream (no plaintext copy).
 */
export default function ShareImportScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <MediaGate>
        <ShareImport />
      </MediaGate>
    </View>
  );
}

function ShareImport() {
  const { spacing } = useTheme();
  const files = getSharedPayloads().filter((p) => p.shareType !== 'text' && p.shareType !== 'url' && p.value);
  const { data: collections } = useAsync<PrivateCollection[]>(() => listCollections(), []);
  const [collection, setCollection] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | { imported: number; failed: number }>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setState('busy');
    try {
      const r = await importMedia(files.map((f) => ({ uri: f.value, name: f.value.split('/').pop() ?? null, mime: f.mimeType ?? null })), collection);
      clearSharedPayloads();
      setState(r);
    } catch (e) {
      setError(toAppError(e).userMessage);
      setState('idle');
    }
  };

  if (typeof state === 'object') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}>
        <EmptyState icon="check-circle" title={`Зашифровано: ${state.imported}`} message={(state.failed ? `Не удалось: ${state.failed}. ` : '') + 'Оригинал в исходном приложении остался — Clipbox не может удалить его сам.'} />
        <Button label="Готово" onPress={() => BackHandler.exitApp()} />
        <Button label="Открыть Private Media" variant="secondary" onPress={() => router.replace('/private/media')} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <Text variant="title">В Private Media</Text>
      {files.length === 0 ? (
        <EmptyState icon="image" title="Нет файлов" message="Поделитесь изображением, видео или файлом из другого приложения." />
      ) : (
        <>
          <Text tone="secondary">Файлов: {files.length}. Они будут зашифрованы и не появятся в галерее.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            <Chip label="Без коллекции" selected={collection === null} onPress={() => setCollection(null)} />
            {(collections ?? []).map((c) => (
              <Chip key={c.id} label={c.name} icon="folder" selected={collection === c.id} onPress={() => setCollection(c.id)} />
            ))}
          </View>
          {error ? <Text tone="danger">{error}</Text> : null}
          <Button label="Зашифровать и сохранить" icon="lock" loading={state === 'busy'} onPress={run} />
        </>
      )}
      <Button label="Отмена" variant="ghost" onPress={() => { clearSharedPayloads(); router.replace('/'); }} />
    </ScrollView>
  );
}
