import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../core/errors';
import type { NoteFormat } from '../data/repositories/notesRepo';
import { createNote } from '../features/notes/notesService';
import { Icon, PressableScale, Text, type IconName } from '../ui/components';
import { useTheme } from '../ui/theme/ThemeProvider';

interface CaptureOption {
  key: string;
  label: string;
  icon: IconName;
  /** What to create; `null` = module not built yet (shown disabled, never faked). */
  note: NoteFormat | null;
  accent?: 'vault' | 'media';
}

const OPTIONS: CaptureOption[] = [
  { key: 'note', label: 'Заметка', icon: 'edit-3', note: 'text' },
  { key: 'markdown', label: 'Markdown', icon: 'hash', note: 'markdown' },
  { key: 'checklist', label: 'Чек-лист', icon: 'check-square', note: 'checklist' },
  { key: 'clip', label: 'Клип', icon: 'link', note: null },
  { key: 'reminder', label: 'Напоминание', icon: 'bell', note: null },
  { key: 'media', label: 'Private Media', icon: 'image', note: null, accent: 'media' },
  { key: 'vault', label: 'Vault', icon: 'lock', note: null, accent: 'vault' },
];

export default function CaptureSheet() {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const create = async (format: NoteFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await createNote(format);
      router.replace({ pathname: '/note/[id]', params: { id } });
    } catch (e) {
      setBusy(false);
      Alert.alert('Clipbox', toAppError(e, 'DB_QUERY_FAILED', 'Не удалось создать заметку').userMessage);
    }
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}>
        <Pressable accessibilityLabel="Закрыть" style={StyleSheet.absoluteFill} onPress={() => router.back()} />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.duration(220)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          padding: spacing.lg,
          paddingBottom: Math.max(insets.bottom, spacing.lg),
          gap: spacing.md,
        }}
      >
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        <Text variant="title">Создать</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {OPTIONS.map((o) => {
            const accent = o.accent ? colors[o.accent] : colors.primary;
            const enabled = o.note !== null;
            return (
              <PressableScale
                key={o.key}
                disabled={!enabled}
                accessibilityLabel={o.label}
                accessibilityState={{ disabled: !enabled }}
                onPress={() => o.note && create(o.note)}
                style={{
                  width: '31.5%',
                  aspectRatio: 1.1,
                  borderRadius: radius.lg,
                  backgroundColor: colors.elevated,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: spacing.sm,
                  opacity: enabled ? 1 : 0.45,
                }}
              >
                <Icon name={o.icon} size={24} color={accent} />
                <Text variant="label">{o.label}</Text>
              </PressableScale>
            );
          })}
        </View>
        <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          Остальные разделы появятся в следующих обновлениях
        </Text>
      </Animated.View>
    </View>
  );
}
