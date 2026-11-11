import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../core/errors';
import { collectionsRepo } from '../features/clips/clipsService';
import { useCollections } from '../features/collections/useCollections';
import { useDataVersion } from '../stores/dataVersion';
import { Button, Card, EmptyState, Icon, PressableScale, Text } from '../ui/components';
import { useTheme } from '../ui/theme/ThemeProvider';

export default function CollectionsScreen() {
  const { colors, spacing, typography, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { collections, reload } = useCollections();
  const [name, setName] = useState('');

  const create = async () => {
    try {
      await collectionsRepo().create(name);
      setName('');
      reload();
      useDataVersion.getState().bump();
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e, 'DB_QUERY_FAILED', 'Не удалось создать').userMessage);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="title">Коллекции</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={create}
            placeholder="Новая коллекция"
            placeholderTextColor={colors.secondary}
            accessibilityLabel="Название новой коллекции"
            style={[typography.body, { flex: 1, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48 }]}
          />
          <Button label="Создать" onPress={create} disabled={!name.trim()} />
        </View>
        {collections.length === 0 ? (
          <EmptyState icon="folder" title="Коллекций пока нет" message="Группируйте заметки и клипы по темам: «Прочитать», «Музыка», «Идеи»." />
        ) : (
          collections.map((c) => (
            <PressableScale key={c.id} accessibilityLabel={c.name} onPress={() => router.push({ pathname: '/collection/[id]', params: { id: c.id } })}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Icon name="folder" color={colors.primary} />
                <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text tone="secondary">{c.count}</Text>
              </Card>
            </PressableScale>
          ))
        )}
      </ScrollView>
    </View>
  );
}
