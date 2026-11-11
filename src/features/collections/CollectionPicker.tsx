import { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { toAppError } from '../../core/errors';
import { useDataVersion } from '../../stores/dataVersion';
import { Chip } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { collectionsRepo } from '../clips/clipsService';
import { useCollections } from './useCollections';

/** Multi-select of collections with inline creation. */
export function CollectionPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { colors, spacing, typography, radius } = useTheme();
  const { collections, reload } = useCollections();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const create = async () => {
    if (!name.trim()) {
      setCreating(false);
      return;
    }
    try {
      const id = await collectionsRepo().create(name);
      reload();
      useDataVersion.getState().bump();
      onChange([...selected, id]);
      setName('');
      setCreating(false);
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e, 'DB_QUERY_FAILED', 'Не удалось создать коллекцию').userMessage);
    }
  };

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {collections.map((c) => (
        <Chip key={c.id} label={c.name} icon="folder" selected={selected.includes(c.id)} onPress={() => toggle(c.id)} />
      ))}
      {creating ? (
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          onSubmitEditing={create}
          onBlur={create}
          placeholder="Название"
          placeholderTextColor={colors.secondary}
          accessibilityLabel="Название новой коллекции"
          style={[typography.label, { minWidth: 140, minHeight: 36, color: colors.text, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md }]}
        />
      ) : (
        <Chip label="Новая" icon="plus" onPress={() => setCreating(true)} />
      )}
    </View>
  );
}
