import { useIncomingShare, type SharePayload } from 'expo-sharing';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError, type AppError } from '../core/errors';
import { analyzeText, saveFile, saveLink, saveTextAsNote, type LinkDraft, type SaveOutcome } from '../features/clips/clipsService';
import { CollectionPicker } from '../features/collections/CollectionPicker';
import { openItem } from '../features/library/navigation';
import { useDataVersion } from '../stores/dataVersion';
import { Button, Card, Chip, EmptyState, Icon, PressableScale, Text } from '../ui/components';
import { useTheme } from '../ui/theme/ThemeProvider';

type Item =
  | { kind: 'link'; draft: LinkDraft }
  | { kind: 'text'; text: string }
  | { kind: 'file'; uri: string; name: string | null; mime: string; size: number | null };

function fileInfo(p: SharePayload): { name: string | null; size: number | null } {
  try {
    const f = new File(p.value);
    return { name: f.name || null, size: f.size ?? null };
  } catch {
    return { name: null, size: null };
  }
}

async function toItems(payloads: SharePayload[]): Promise<Item[]> {
  const out: Item[] = [];
  for (const p of payloads) {
    if (p.shareType === 'text' || p.shareType === 'url') {
      const draft = await analyzeText(p.value);
      out.push(draft ? { kind: 'link', draft } : { kind: 'text', text: p.value });
    } else if (p.value) {
      const { name, size } = fileInfo(p);
      out.push({ kind: 'file', uri: p.value, name, mime: p.mimeType ?? 'application/octet-stream', size });
    }
  }
  return out;
}

const fmtSize = (n: number | null) => (n === null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.ceil(n / 1024)} КБ`);

/**
 * Quick save screen for Android Share. One tap ("Сохранить") puts everything into Inbox;
 * comment and collections are optional. Network is never needed to save.
 */
export default function ShareScreen() {
  const { colors, spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { sharedPayloads, clearSharedPayloads } = useIncomingShare();
  const [items, setItems] = useState<Item[] | null>(null);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState<SaveOutcome[] | null>(null);
  const key = useMemo(() => JSON.stringify(sharedPayloads), [sharedPayloads]);

  useEffect(() => {
    let alive = true;
    toItems(sharedPayloads)
      .then((it) => alive && setItems(it))
      .catch((e) => alive && setError(toAppError(e, 'UNKNOWN', 'Не удалось прочитать данные')));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const single = items?.length === 1 ? items[0] : undefined;

  const save = async () => {
    if (!items?.length) return;
    setSaving(true);
    setError(null);
    const opts = { note, collectionIds: collections };
    const results: SaveOutcome[] = [];
    try {
      for (const it of items) {
        if (it.kind === 'link') results.push(await saveLink(it.draft, { ...opts, title: single ? title || undefined : undefined }));
        else if (it.kind === 'text') results.push(await saveTextAsNote(it.text, opts));
        else results.push(await saveFile(it.uri, it.name, it.mime, opts));
      }
      clearSharedPayloads();
      useDataVersion.getState().bump();
      setSaved(results);
    } catch (e) {
      setError(toAppError(e, 'UNKNOWN', 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    clearSharedPayloads();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const frame = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>{children}</View>
  );

  if (saved) {
    const first = saved[0];
    return frame(
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md }}>
        <EmptyState icon="check-circle" title="Сохранено в Inbox" message={saved.length > 1 ? `Элементов: ${saved.length}` : 'Метаданные подтянутся автоматически, когда будет сеть.'} />
        <Button label="Готово" onPress={() => BackHandler.exitApp()} />
        {first ? <Button label="Открыть" variant="secondary" onPress={() => { router.replace('/'); openItem({ id: first.id, kind: first.kind }); }} /> : null}
      </View>,
    );
  }

  return frame(
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}>
        <PressableScale accessibilityLabel="Отмена" onPress={close} style={{ padding: spacing.sm }}>
          <Icon name="x" size={22} />
        </PressableScale>
        <Text variant="title" style={{ flex: 1 }}>
          Сохранить в Clipbox
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {items === null ? null : items.length === 0 ? (
          <EmptyState icon="inbox" title="Нечего сохранять" message="Поделитесь ссылкой, текстом или файлом из другого приложения." />
        ) : (
          items.map((it, i) => (
            <Card key={i} style={{ gap: spacing.xs }}>
              {it.kind === 'link' ? (
                <>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Icon name="link" size={16} color={colors.primary} />
                    <Text variant="caption" tone="secondary" numberOfLines={2} style={{ flex: 1 }}>
                      {it.draft.url}
                    </Text>
                  </View>
                  {single ? (
                    <TextInput
                      value={title}
                      onChangeText={setTitle}
                      placeholder={it.draft.titleHint || 'Заголовок (подставится автоматически)'}
                      placeholderTextColor={colors.secondary}
                      accessibilityLabel="Заголовок"
                      style={[typography.heading, { color: colors.text, paddingVertical: spacing.xs }]}
                    />
                  ) : null}
                  {it.draft.duplicate ? (
                    <Text variant="caption" tone="danger">
                      Уже сохранено{it.draft.duplicate.title ? `: «${it.draft.duplicate.title}»` : ''}. Будет создана ещё одна копия.
                    </Text>
                  ) : null}
                </>
              ) : it.kind === 'text' ? (
                <>
                  <Text variant="label" tone="secondary">Текст → заметка</Text>
                  <Text numberOfLines={6}>{it.text}</Text>
                </>
              ) : (
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Icon name={it.mime.startsWith('image/') ? 'image' : 'file'} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1}>{it.name ?? 'Файл'}</Text>
                    <Text variant="caption" tone="secondary">
                      {it.mime} {fmtSize(it.size)}
                    </Text>
                  </View>
                </View>
              )}
            </Card>
          ))
        )}

        {items?.length ? (
          <>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Комментарий (необязательно)"
              placeholderTextColor={colors.secondary}
              multiline
              accessibilityLabel="Комментарий"
              style={[typography.body, { color: colors.text, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }]}
            />
            <View style={{ gap: spacing.sm }}>
              <Text variant="label" tone="secondary">Коллекции</Text>
              <CollectionPicker selected={collections} onChange={setCollections} />
            </View>
            <View style={{ gap: spacing.sm }}>
              <Text variant="label" tone="secondary">Куда</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Chip label="Библиотека (Inbox)" icon="inbox" selected onPress={() => undefined} />
                <View style={{ opacity: 0.45 }}>
                  <Chip label="Private Media — скоро" icon="lock" onPress={() => undefined} />
                </View>
              </View>
            </View>
          </>
        ) : null}
        {error ? <Text tone="danger">{error.userMessage}</Text> : null}
      </ScrollView>
      {items?.length ? (
        <View style={{ padding: spacing.lg }}>
          <Button label="Сохранить" icon="check" loading={saving} onPress={save} />
        </View>
      ) : null}
    </>,
  );
}
