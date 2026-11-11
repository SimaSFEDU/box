import { View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.elevated, borderRadius: radius.md, padding: spacing.xxs }}>
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <PressableScale
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(s.value)}
            style={{
              flex: 1,
              minHeight: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: active ? colors.surface : 'transparent',
            }}
          >
            <Text variant="label" tone={active ? 'default' : 'secondary'}>
              {s.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
