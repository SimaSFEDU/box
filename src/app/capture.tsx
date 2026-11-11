import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, PressableScale, Text, type IconName } from '../ui/components';
import { useTheme } from '../ui/theme/ThemeProvider';

interface CaptureOption {
  key: string;
  label: string;
  icon: IconName;
  /** Route to open; `null` = module not built yet (shown disabled, never faked). */
  href: null;
  accent?: 'vault' | 'media';
}

const OPTIONS: CaptureOption[] = [
  { key: 'note', label: 'Заметка', icon: 'edit-3', href: null },
  { key: 'markdown', label: 'Markdown', icon: 'hash', href: null },
  { key: 'clip', label: 'Клип', icon: 'link', href: null },
  { key: 'reminder', label: 'Напоминание', icon: 'bell', href: null },
  { key: 'media', label: 'Private Media', icon: 'image', href: null, accent: 'media' },
  { key: 'vault', label: 'Vault', icon: 'lock', href: null, accent: 'vault' },
];

export default function CaptureSheet() {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
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
            const enabled = o.href !== null;
            return (
              <PressableScale
                key={o.key}
                disabled={!enabled}
                accessibilityLabel={o.label}
                accessibilityState={{ disabled: !enabled }}
                onPress={() => enabled && router.replace(o.href!)}
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
          Создание элементов появится по мере готовности модулей
        </Text>
      </Animated.View>
    </View>
  );
}
