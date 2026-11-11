import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../core/errors';
import { applySmartNewline, insertImage, type EditorState, type Selection } from '../../domain/markdown/editing';
import { taskStats, toggleTaskAtLine } from '../../domain/markdown/tasks';
import { MarkdownPreview } from '../../features/markdown/preview/MarkdownPreview';
import { EditorToolbar } from '../../features/notes/EditorToolbar';
import { pickImageAttachment, shareNoteAsMarkdown } from '../../features/notes/noteActions';
import { discardIfEmpty, notesRepo } from '../../features/notes/notesService';
import { TagEditor } from '../../features/notes/TagEditor';
import { useNoteEditor, type SaveStatus } from '../../features/notes/useNoteEditor';
import { ActionSheet, ErrorView, Icon, PressableScale, SegmentedControl, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

type Mode = 'source' | 'preview';

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  dirty: 'Изменено',
  saving: 'Сохранение…',
  saved: 'Сохранено',
  error: 'Ошибка сохранения',
};

export default function NoteScreen() {
  const { id, mode: initialMode } = useLocalSearchParams<{ id: string; mode?: Mode }>();
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const ed = useNoteEditor(id);
  const [mode, setMode] = useState<Mode>(initialMode === 'preview' ? 'preview' : 'source');
  const [menu, setMenu] = useState(false);
  const [localTags, setTags] = useState<string[] | null>(null);
  const tags = localTags ?? ed.note?.tags ?? [];
  const [forcedSelection, setForcedSelection] = useState<Selection | undefined>(undefined);
  const bodyRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Leaving an untouched new note removes it.
  useEffect(() => {
    return () => {
      void ed.flush().then(() => discardIfEmpty(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const apply = useCallback(
    (s: EditorState) => {
      ed.setBody(s.text, s.selection);
      setForcedSelection(s.selection);
      bodyRef.current?.focus();
    },
    [ed],
  );

  const onChangeBody = (text: string) => {
    const smart = applySmartNewline({ text: ed.body, selection: ed.selection }, text);
    if (smart) {
      ed.setBody(smart.text, smart.selection);
      setForcedSelection(smart.selection);
    } else {
      ed.setBody(text);
    }
  };

  const fail = (e: unknown, msg: string) => Alert.alert('Clipbox', toAppError(e, 'UNKNOWN', msg).userMessage);

  const onInsertImage = async () => {
    try {
      const img = await pickImageAttachment(id);
      if (img) apply(insertImage({ text: ed.body, selection: ed.selection }, img.relPath, img.name));
    } catch (e) {
      fail(e, 'Не удалось добавить изображение');
    }
  };

  const updateTags = async (next: string[]) => {
    setTags(next);
    try {
      await notesRepo().setTags(id, next);
      await ed.reload();
    } catch (e) {
      fail(e, 'Не удалось сохранить теги');
    }
  };

  if (ed.loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, justifyContent: 'center' }}>
        <ErrorView error={ed.loadError} onRetry={() => router.back()} />
      </View>
    );
  }

  const note = ed.note;
  const stats = taskStats(ed.body);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.xs, minHeight: 52 }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <SegmentedControl
            segments={[
              { value: 'source', label: 'Markdown' },
              { value: 'preview', label: 'Просмотр' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </View>
        <PressableScale accessibilityLabel="Ещё" onPress={() => setMenu(true)} style={{ padding: spacing.sm }}>
          <Icon name="more-vertical" size={22} />
        </PressableScale>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.xs }}>
        <TextInput
          value={ed.title}
          onChangeText={ed.setTitle}
          placeholder="Заголовок"
          placeholderTextColor={colors.secondary}
          accessibilityLabel="Заголовок заметки"
          returnKeyType="next"
          onSubmitEditing={() => bodyRef.current?.focus()}
          style={[typography.title, { color: colors.text, paddingVertical: spacing.sm }]}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TagEditor tags={tags} onChange={updateTags} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <Text variant="caption" tone={ed.status === 'error' ? 'danger' : 'secondary'}>
            {STATUS_LABEL[ed.status]}
          </Text>
          {stats.total > 0 ? (
            <Text variant="caption" tone="secondary">
              ✓ {stats.done}/{stats.total}
            </Text>
          ) : null}
          {note?.favorite ? <Icon name="star" size={12} color={colors.primary} /> : null}
          {note?.archived ? <Text variant="caption" tone="secondary">В архиве</Text> : null}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {mode === 'source' ? (
          <TextInput
            ref={bodyRef}
            value={ed.body}
            onChangeText={onChangeBody}
            selection={forcedSelection}
            onSelectionChange={(e) => {
              ed.setSelection(e.nativeEvent.selection);
              if (forcedSelection) setForcedSelection(undefined);
            }}
            multiline
            scrollEnabled
            textAlignVertical="top"
            autoCorrect
            placeholder="Начните писать… Поддерживается Markdown."
            placeholderTextColor={colors.secondary}
            accessibilityLabel="Текст заметки"
            style={[typography.body, { flex: 1, color: colors.text, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl }]}
          />
        ) : (
          <MarkdownPreview markdown={ed.body} onToggleTask={(line) => ed.setBody(toggleTaskAtLine(ed.body, line))} />
        )}
      </View>

      {mode === 'source' ? (
        <View style={{ paddingBottom: insets.bottom }}>
          <EditorToolbar state={{ text: ed.body, selection: ed.selection }} onChange={apply} onInsertImage={onInsertImage} />
        </View>
      ) : null}

      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        actions={[
          {
            key: 'fav',
            label: note?.favorite ? 'Убрать из избранного' : 'В избранное',
            icon: 'star',
            onPress: () => notesRepo().setFlag(id, 'favorite', !note?.favorite).then(ed.reload).catch((e) => fail(e, 'Не удалось изменить')),
          },
          {
            key: 'archive',
            label: note?.archived ? 'Вернуть из архива' : 'В архив',
            icon: 'archive',
            onPress: () => notesRepo().setFlag(id, 'archived', !note?.archived).then(ed.reload).catch((e) => fail(e, 'Не удалось изменить')),
          },
          {
            key: 'share',
            label: 'Экспорт .md',
            icon: 'share',
            onPress: () => ed.flush().then(() => shareNoteAsMarkdown({ title: ed.title, body: ed.body })).catch((e) => fail(e, 'Не удалось экспортировать')),
          },
          {
            key: 'delete',
            label: 'Удалить в корзину',
            icon: 'trash-2',
            destructive: true,
            onPress: () =>
              ed
                .flush()
                .then(() => notesRepo().softDelete(id))
                .then(() => router.back())
                .catch((e) => fail(e, 'Не удалось удалить')),
          },
        ]}
      />
    </KeyboardAvoidingView>
  );
}
