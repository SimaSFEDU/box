import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../core/errors';
import { TYPE_META, type VaultEntry, type VaultEntryType, type VaultField } from '../../../domain/vault/entries';
import { GeneratorPanel } from '../../../features/vault/GeneratorPanel';
import { PasswordInput } from '../../../features/vault/PasswordInput';
import { StrengthMeter } from '../../../features/vault/StrengthMeter';
import { confirmDestructive, VaultGate } from '../../../features/vault/VaultGate';
import { copySecret, deleteEntry, draftEntry, getEntry, saveEntry, touchVault } from '../../../secure/vaultService';
import { Button, Card, Icon, PressableScale, Text } from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export default function VaultEntryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <VaultGate>
        <EntryEditor />
      </VaultGate>
    </View>
  );
}

function EntryEditor() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: VaultEntryType }>();
  const isNew = id === 'new';
  const { colors, spacing, typography, radius } = useTheme();
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [editing, setEditing] = useState(isNew);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [generatorFor, setGeneratorFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (isNew ? Promise.resolve(draftEntry(type ?? 'login')) : getEntry(id)).then(
      (e) => {
        if (!alive) return;
        if (!e) router.back();
        else setEntry(e);
      },
      (e) => Alert.alert('Clipbox', toAppError(e).userMessage, [{ text: 'OK', onPress: () => router.back() }]),
    );
    return () => {
      alive = false;
    };
  }, [id, isNew, type]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!entry) return null;
  const setField = (fid: string, value: string) => {
    touchVault();
    setEntry({ ...entry, fields: entry.fields.map((f) => (f.id === fid ? { ...f, value } : f)) });
  };

  const copy = async (f: VaultField) => {
    try {
      const sec = await copySecret(f.value);
      setToast(f.secret ? `Скопировано. Буфер очистится через ${sec} с` : 'Скопировано');
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e).userMessage);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveEntry(entry);
      if (isNew) router.replace({ pathname: '/private/vault/[id]', params: { id: entry.id } });
      else setEditing(false);
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e).userMessage);
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirmDestructive('Удалить запись?', 'Запись будет удалена без возможности восстановления.', 'Удалить', () =>
      deleteEntry(entry.id).then(() => router.back()).catch((e) => Alert.alert('Clipbox', toAppError(e).userMessage)),
    );

  const input = [typography.body, { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 48, backgroundColor: colors.surface }];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="label" tone="secondary" style={{ flex: 1 }}>
          {TYPE_META[entry.type].label}
        </Text>
        {!editing ? (
          <>
            <PressableScale accessibilityLabel={entry.favorite ? 'Убрать из избранного' : 'В избранное'} onPress={() => { const next = { ...entry, favorite: !entry.favorite }; setEntry(next); void saveEntry(next); }} style={{ padding: spacing.sm }}>
              <Icon name="star" size={20} color={entry.favorite ? colors.vault : colors.secondary} />
            </PressableScale>
            <PressableScale accessibilityLabel="Изменить" onPress={() => setEditing(true)} style={{ padding: spacing.sm }}>
              <Icon name="edit-2" size={20} />
            </PressableScale>
          </>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        {editing ? (
          <TextInput value={entry.title} onChangeText={(t) => setEntry({ ...entry, title: t })} placeholder="Название (например, GitHub)" placeholderTextColor={colors.secondary} autoFocus={isNew} accessibilityLabel="Название" style={[input, typography.heading]} />
        ) : (
          <Text variant="title">{entry.title}</Text>
        )}

        {entry.fields.map((f) =>
          editing ? (
            <View key={f.id} style={{ gap: spacing.xs }}>
              <Text variant="label" tone="secondary">{f.label}</Text>
              {f.secret ? (
                <>
                  <PasswordInput value={f.value} onChangeText={(v) => setField(f.id, v)} multiline={f.kind === 'multiline'} accessibilityLabel={f.label} />
                  {f.kind === 'password' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <StrengthMeter password={f.value} />
                      </View>
                      <Button label="Сгенерировать" icon="zap" variant="secondary" onPress={() => setGeneratorFor(f.id)} />
                    </View>
                  ) : null}
                </>
              ) : (
                <TextInput
                  value={f.value}
                  onChangeText={(v) => setField(f.id, v)}
                  multiline={f.kind === 'multiline'}
                  keyboardType={f.kind === 'url' ? 'url' : f.kind === 'number' ? 'number-pad' : 'default'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  importantForAutofill="no"
                  accessibilityLabel={f.label}
                  style={input}
                />
              )}
            </View>
          ) : f.value ? (
            <Card key={f.id} style={{ gap: spacing.xs }}>
              <Text variant="caption" tone="secondary">{f.label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text style={[f.secret ? typography.mono : typography.body, { flex: 1, color: colors.text }]} selectable={!f.secret || revealed[f.id]}>
                  {f.secret && !revealed[f.id] ? '•'.repeat(Math.min(12, Math.max(8, f.value.length))) : f.value}
                </Text>
                {f.secret ? (
                  <PressableScale accessibilityLabel={revealed[f.id] ? 'Скрыть' : 'Показать'} onPress={() => { touchVault(); setRevealed({ ...revealed, [f.id]: !revealed[f.id] }); }} style={{ padding: spacing.xs }}>
                    <Icon name={revealed[f.id] ? 'eye-off' : 'eye'} size={18} color={colors.secondary} />
                  </PressableScale>
                ) : null}
                <PressableScale accessibilityLabel={`Копировать ${f.label}`} onPress={() => copy(f)} style={{ padding: spacing.xs }}>
                  <Icon name="copy" size={18} color={colors.primary} />
                </PressableScale>
              </View>
            </Card>
          ) : null,
        )}

        {editing ? (
          <View style={{ gap: spacing.xs }}>
            <Text variant="label" tone="secondary">Заметки</Text>
            <TextInput value={entry.notes} onChangeText={(t) => setEntry({ ...entry, notes: t })} multiline autoCorrect={false} importantForAutofill="no" accessibilityLabel="Заметки" style={[input, { minHeight: 80, textAlignVertical: 'top' }]} />
          </View>
        ) : entry.notes ? (
          <Card style={{ gap: spacing.xs }}>
            <Text variant="caption" tone="secondary">Заметки</Text>
            <Text>{entry.notes}</Text>
          </Card>
        ) : null}

        {!editing ? (
          <Text variant="caption" tone="secondary">
            Создано {new Date(entry.createdAt).toLocaleString()} · Изменено {new Date(entry.updatedAt).toLocaleString()}
          </Text>
        ) : null}

        {editing ? (
          <View style={{ gap: spacing.sm }}>
            <Button label="Сохранить" icon="check" loading={busy} disabled={!entry.title.trim()} onPress={save} />
            {!isNew ? <Button label="Удалить" icon="trash-2" variant="danger" onPress={remove} /> : null}
          </View>
        ) : null}
      </ScrollView>

      {toast ? (
        <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl, backgroundColor: colors.elevated, borderRadius: radius.md, padding: spacing.md }}>
          <Text>{toast}</Text>
        </View>
      ) : null}

      {/* In-window overlay (not RN Modal): a separate Dialog window might not inherit FLAG_SECURE. */}
      {generatorFor !== null ? (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', backgroundColor: colors.overlay }]}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="title" style={{ flex: 1 }}>Генератор</Text>
              <PressableScale accessibilityLabel="Закрыть" onPress={() => setGeneratorFor(null)} style={{ padding: spacing.sm }}>
                <Icon name="x" size={22} />
              </PressableScale>
            </View>
            <GeneratorPanel
              onUse={(pw) => {
                if (generatorFor) setField(generatorFor, pw);
                setGeneratorFor(null);
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
