import { router, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, PressableScale, Text, type IconName } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  library: { label: 'Library', icon: 'book' },
  reminders: { label: 'Reminders', icon: 'bell' },
  settings: { label: 'Settings', icon: 'settings' },
};

function TabBar({ state, navigateToTab }: TabBarProps) {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const items = state.routes.map((route, index) => {
    const meta = TABS[route.name];
    if (!meta) return null;
    const focused = state.index === index;
    return (
      <PressableScale
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={meta.label}
        onPress={() => {
          if (!focused) navigateToTab(route.key);
        }}
        style={styles.tab}
      >
        <Icon name={meta.icon} size={22} color={focused ? colors.primary : colors.secondary} />
        <Text variant="caption" style={{ color: focused ? colors.primary : colors.secondary }}>
          {meta.label}
        </Text>
      </PressableScale>
    );
  });
  const add = (
    <View key="add" style={styles.tab}>
      <PressableScale
        accessibilityLabel="Создать"
        onPress={() => router.push('/capture')}
        style={{ width: 52, height: 52, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="plus" size={26} color={colors.onPrimary} />
      </PressableScale>
    </View>
  );
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        paddingTop: spacing.sm,
        paddingBottom: Math.max(insets.bottom, spacing.sm),
      }}
    >
      {items.slice(0, 2)}
      {add}
      {items.slice(2)}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="reminders" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 48 },
});
