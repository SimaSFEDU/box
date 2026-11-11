import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Required for icon-only buttons (empty label). */
  accessibilityLabel?: string;
}

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, accessibilityLabel }: ButtonProps) {
  const { colors, radius, spacing } = useTheme();
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.elevated
        : variant === 'danger'
          ? colors.danger
          : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? colors.onPrimary : colors.text;
  const inactive = disabled || loading;
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[styles.base, { backgroundColor: bg, borderRadius: radius.md, paddingHorizontal: spacing.lg, opacity: inactive ? 0.5 : 1 }]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
        {label ? (
          <Text variant="label" style={{ color: fg }}>
            {label}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
