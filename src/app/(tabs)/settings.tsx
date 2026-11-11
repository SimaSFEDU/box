import Constants from 'expo-constants';

import type { SettingsShape } from '../../data/repositories/settingsRepo';
import { useSettingsStore } from '../../stores/settingsStore';
import { Card, Screen, Section, SegmentedControl, Text } from '../../ui/components';

const THEMES: { value: SettingsShape['themeMode']; label: string }[] = [
  { value: 'system', label: 'Система' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

export default function SettingsScreen() {
  const themeMode = useSettingsStore((s) => s.settings.themeMode);
  const update = useSettingsStore((s) => s.update);
  return (
    <Screen title="Settings">
      <Section title="Оформление">
        <SegmentedControl segments={THEMES} value={themeMode} onChange={(v) => update('themeMode', v)} />
      </Section>
      <Section title="О приложении">
        <Card>
          <Text variant="heading">Clipbox {Constants.expoConfig?.version ?? ''}</Text>
          <Text tone="secondary">Your mind, organized. Все данные хранятся только на этом устройстве.</Text>
        </Card>
      </Section>
    </Screen>
  );
}
