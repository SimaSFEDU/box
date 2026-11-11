import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SheetAction {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
}

export function ActionSheet({ visible, onClose, actions, title }: { visible: boolean; onClose: () => void; actions: SheetAction[]; title?: string }) {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessibilityLabel="Закрыть" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          padding: spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.md),
        }}
      >
        {title ? (
          <Text variant="label" tone="secondary" style={{ padding: spacing.md }}>
            {title}
          </Text>
        ) : null}
        {actions.map((a) => (
          <PressableScale
            key={a.key}
            accessibilityLabel={a.label}
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 48 }}
          >
            <Icon name={a.icon} color={a.destructive ? colors.danger : colors.text} />
            <Text tone={a.destructive ? 'danger' : 'default'}>{a.label}</Text>
          </PressableScale>
        ))}
      </View>
    </Modal>
  );
}
