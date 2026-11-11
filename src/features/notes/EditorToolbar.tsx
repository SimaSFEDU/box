import { ScrollView, StyleSheet, View } from 'react-native';

import {
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  insertTable,
  toggleInline,
  toggleLinePrefix,
  type EditorState,
} from '../../domain/markdown/editing';
import { Icon, PressableScale, Text, type IconName } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

type Action = { key: string; label: string; icon?: IconName; text?: string; run: (s: EditorState) => EditorState };

const ACTIONS: Action[] = [
  { key: 'h1', label: 'Заголовок 1', text: 'H1', run: (s) => toggleLinePrefix(s, 'h1') },
  { key: 'h2', label: 'Заголовок 2', text: 'H2', run: (s) => toggleLinePrefix(s, 'h2') },
  { key: 'h3', label: 'Заголовок 3', text: 'H3', run: (s) => toggleLinePrefix(s, 'h3') },
  { key: 'bold', label: 'Жирный', icon: 'bold', run: (s) => toggleInline(s, '**') },
  { key: 'italic', label: 'Курсив', icon: 'italic', run: (s) => toggleInline(s, '_') },
  { key: 'strike', label: 'Зачёркнутый', text: 'S̶', run: (s) => toggleInline(s, '~~') },
  { key: 'task', label: 'Задача', icon: 'check-square', run: (s) => toggleLinePrefix(s, 'task') },
  { key: 'bullet', label: 'Список', icon: 'list', run: (s) => toggleLinePrefix(s, 'bullet') },
  { key: 'numbered', label: 'Нумерованный список', text: '1.', run: (s) => toggleLinePrefix(s, 'numbered') },
  { key: 'quote', label: 'Цитата', text: '❝', run: (s) => toggleLinePrefix(s, 'quote') },
  { key: 'code', label: 'Код', icon: 'code', run: (s) => toggleInline(s, '`', 'code') },
  { key: 'codeblock', label: 'Блок кода', icon: 'terminal', run: (s) => insertCodeBlock(s) },
  { key: 'link', label: 'Ссылка', icon: 'link-2', run: (s) => insertLink(s) },
  { key: 'table', label: 'Таблица', icon: 'grid', run: (s) => insertTable(s) },
  { key: 'hr', label: 'Разделитель', icon: 'minus', run: (s) => insertHorizontalRule(s) },
];

export function EditorToolbar({
  state,
  onChange,
  onInsertImage,
}: {
  state: EditorState;
  onChange: (s: EditorState) => void;
  onInsertImage: () => void;
}) {
  const { colors, spacing, radius } = useTheme();
  const btn = { minWidth: 44, height: 40, paddingHorizontal: spacing.sm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface }}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: spacing.xs, gap: 2 }}>
        {ACTIONS.map((a) => (
          <PressableScale key={a.key} accessibilityLabel={a.label} onPress={() => onChange(a.run(state))} style={btn}>
            {a.icon ? <Icon name={a.icon} size={18} color={colors.secondary} /> : <Text variant="label" tone="secondary">{a.text}</Text>}
          </PressableScale>
        ))}
        <PressableScale accessibilityLabel="Изображение" onPress={onInsertImage} style={btn}>
          <Icon name="image" size={18} color={colors.secondary} />
        </PressableScale>
      </ScrollView>
    </View>
  );
}
