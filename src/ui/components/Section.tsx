import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="label" tone="secondary" accessibilityRole="header" style={{ textTransform: 'uppercase' }}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}
