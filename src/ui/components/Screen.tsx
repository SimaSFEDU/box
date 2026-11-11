import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
}

/** Standard screen frame: safe area, large title, theme background, room for the tab bar. */
export function Screen({ title, subtitle, right, scroll = true, children }: ScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const header = title ? (
    <View style={[styles.header, { paddingHorizontal: spacing.lg, paddingTop: spacing.lg }]}>
      <View style={styles.flex}>
        <Text variant="display" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text tone="secondary" style={{ marginTop: spacing.xs }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  ) : null;
  const body = <View style={{ padding: spacing.lg, gap: spacing.xl }}>{children}</View>;
  return (
    <View style={[styles.flex, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {header}
          {body}
        </ScrollView>
      ) : (
        <>
          {header}
          <View style={styles.flex}>{body}</View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
});
