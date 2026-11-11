import { useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function Chip({ label, selected, onPress, onLongPress, icon }: { label: string; selected?: boolean; onPress: () => void; onLongPress?: () => void; icon?: IconName }) {
  const { colors, radius, spacing } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: spacing.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary + '22' : 'transparent',
      }}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? colors.primary : colors.secondary} /> : null}
      <Text variant="label" style={{ color: selected ? colors.primary : colors.secondary }}>
        {label}
      </Text>
    </PressableScale>
  );
}
