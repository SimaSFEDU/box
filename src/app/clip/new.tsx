import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../core/errors';
import { analyzeText, saveLink } from '../../features/clips/clipsService';
import { CollectionPicker } from '../../features/collections/CollectionPicker';
import { useDataVersion } from '../../stores/dataVersion';
import { Button, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export default function NewClipScreen() {
  const { colors, spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const withScheme = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      const draft = await analyzeText(withScheme);
      if (!draft) {
        setError('Это не похоже на ссылку');
        return;
      }
      const { id } = await saveLink(draft, { note, collectionIds: collections, inbox: false });
      useDataVersion.getState().bump();
      router.replace({ pathname: '/clip/[id]', params: { id } });
    } catch (e) {
      setError(toAppError(e, 'UNKNOWN', 'Не удалось сохранить').userMessage);
    } finally {
      setSaving(false);
    }
  };

  const input = [typography.body, { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 48 }];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="title">Новый клип</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <TextInput
          autoFocus
          value={url}
          onChangeText={setUrl}
          placeholder="https://"
          placeholderTextColor={colors.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Ссылка"
          style={input}
        />
        <TextInput value={note} onChangeText={setNote} placeholder="Комментарий" placeholderTextColor={colors.secondary} multiline accessibilityLabel="Комментарий" style={input} />
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" tone="secondary">Коллекции</Text>
          <CollectionPicker selected={collections} onChange={setCollections} />
        </View>
        {error ? <Text tone="danger">{error}</Text> : null}
      </ScrollView>
      <View style={{ padding: spacing.lg }}>
        <Button label="Сохранить" icon="check" loading={saving} disabled={!url.trim()} onPress={save} />
      </View>
    </View>
  );
}
