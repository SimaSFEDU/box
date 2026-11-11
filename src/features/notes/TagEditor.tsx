import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { colors, spacing, radius, typography } = useTheme();
  const [draft, setDraft] = useState('');
  const commit = () => {
    const parts = draft.split(/[,\s]+/).filter(Boolean);
    if (parts.length) onChange([...tags, ...parts]);
    setDraft('');
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
      {tags.map((t) => (
        <PressableScale
          key={t}
          accessibilityLabel={`Удалить тег ${t}`}
          onPress={() => onChange(tags.filter((x) => x !== t))}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.elevated, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
        >
          <Text variant="caption">#{t}</Text>
          <Icon name="x" size={12} color={colors.secondary} />
        </PressableScale>
      ))}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={commit}
        onBlur={commit}
        placeholder={tags.length ? '+ тег' : '+ добавить тег'}
        placeholderTextColor={colors.secondary}
        autoCapitalize="none"
        accessibilityLabel="Новый тег"
        style={[typography.caption, { color: colors.text, minWidth: 90, paddingVertical: 4 }]}
      />
    </View>
  );
}
