import { View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ icon, title, message, actionLabel, onAction, compact }: EmptyStateProps) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? spacing.lg : spacing.xxxl, gap: spacing.sm }}>
      <View style={{ backgroundColor: colors.elevated, borderRadius: radius.pill, padding: spacing.md }}>
        <Icon name={icon} size={compact ? 18 : 24} color={colors.secondary} />
      </View>
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}
