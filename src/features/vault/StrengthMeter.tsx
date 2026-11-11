import { View } from 'react-native';

import { estimateStrength } from '../../domain/vault/strength';
import { Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export function StrengthMeter({ password }: { password: string }) {
  const { colors, spacing, radius } = useTheme();
  const s = estimateStrength(password);
  const color = [colors.danger, colors.danger, '#E0A33A', colors.success, colors.success][s.score];
  return (
    <View style={{ gap: spacing.xs }} accessibilityLabel={`Надёжность: ${s.label}`}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: password && i < Math.max(1, s.score) ? color : colors.elevated }} />
        ))}
      </View>
      {password ? (
        <Text variant="caption" tone="secondary">
          {s.label} · ~{s.bits} бит
        </Text>
      ) : null}
    </View>
  );
}
