import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';

import { toAppError } from '../../core/errors';
import type { ProtectedModuleController } from '../../secure/protectedModule';
import { Button, Card, Chip, Icon, PressableScale, Section, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { PasswordInput } from '../vault/PasswordInput';
import { StrengthMeter } from '../vault/StrengthMeter';
import { confirmDestructive } from '../vault/VaultGate';

const AUTOLOCK = [30, 60, 300, 900];

/** Shared settings for a protected module: biometrics, idle lock, master password, recovery key, destroy. */
export function ModuleSettings({ ctl, title, accent, onReset, extra }: { ctl: ProtectedModuleController; title: string; accent: string; onReset: () => Promise<void>; extra?: ReactNode }) {
  const { colors, spacing, typography } = useTheme();
  const st = ctl.useState();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const bio = ctl.biometricStatus();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const err = toAppError(e);
      if (err.userMessage !== 'Отменено') Alert.alert('Clipbox', err.userMessage);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.xs }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="title">Настройки: {title}</Text>
      </View>

      <Section title="Вход">
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text>Биометрия</Text>
            <Text variant="caption" tone="secondary">
              {bio === 'available' ? 'Отпечаток или лицо (только надёжная биометрия Class 3)' : bio === 'none_enrolled' ? 'Сначала добавьте отпечаток в настройках Android' : 'Недоступна на этом устройстве'}
            </Text>
          </View>
          <Switch
            value={st.biometricEnabled}
            disabled={busy || (bio !== 'available' && !st.biometricEnabled)}
            onValueChange={(v) => run(v ? ctl.enableBiometric : ctl.disableBiometric)}
            trackColor={{ true: accent, false: colors.border }}
            accessibilityLabel="Биометрия"
          />
        </Card>
        <Text variant="label" tone="secondary">Блокировать при бездействии</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {AUTOLOCK.map((s) => (
            <Chip key={s} label={s < 60 ? `${s} с` : `${s / 60} мин`} selected={st.autoLockSec === s} onPress={() => run(() => ctl.setAutoLock(s))} />
          ))}
        </View>
        <Text variant="caption" tone="secondary">
          {st.backgroundLockSec === 0 ? 'При сворачивании приложения раздел блокируется сразу.' : `При сворачивании раздел блокируется через ${st.backgroundLockSec} с (чтобы работали выбор файлов и «Отправить»).`}
        </Text>
      </Section>

      {extra}

      <Section title="Мастер-пароль">
        <PasswordInput value={current} onChangeText={setCurrent} placeholder="Текущий пароль" accessibilityLabel="Текущий пароль" />
        <PasswordInput value={next} onChangeText={setNext} placeholder="Новый пароль" accessibilityLabel="Новый пароль" />
        <StrengthMeter password={next} />
        <Button
          label="Сменить пароль"
          variant="secondary"
          loading={busy}
          disabled={!current || !next}
          onPress={() =>
            run(async () => {
              await ctl.changePassword(current, next);
              setCurrent('');
              setNext('');
              Alert.alert('Готово', 'Мастер-пароль изменён. Данные не перешифровывались — изменилась только обёртка ключа.');
            })
          }
        />
      </Section>

      <Section title="Ключ восстановления">
        <Text tone="secondary">{st.hasRecovery ? 'Ключ восстановления настроен.' : 'Ключа нет: забытый пароль без биометрии = потеря данных.'}</Text>
        {recovery ? (
          <Card>
            <Text style={[typography.mono, { textAlign: 'center', color: colors.text }]}>{recovery}</Text>
            <Text variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>Запишите его. Старый ключ больше не действует.</Text>
          </Card>
        ) : null}
        <Button label={st.hasRecovery ? 'Создать новый ключ' : 'Создать ключ'} variant="secondary" onPress={() => run(async () => setRecovery(await ctl.regenerateRecoveryKey()))} />
        {st.hasRecovery ? (
          <Button label="Отключить ключ восстановления" variant="ghost" onPress={() => confirmDestructive('Отключить ключ?', 'Если вы забудете мастер-пароль, восстановить доступ будет невозможно.', 'Отключить', () => void run(ctl.removeRecoveryKey))} />
        ) : null}
      </Section>

      <Section title="Опасная зона">
        <Button
          label={`Удалить ${title} и все данные`}
          icon="trash-2"
          variant="danger"
          onPress={() =>
            confirmDestructive(`Удалить ${title}?`, 'Ключи шифрования будут уничтожены, все данные раздела станут недоступны навсегда. Это нельзя отменить.', 'Удалить навсегда', () =>
              void run(async () => {
                await onReset();
                router.replace('/private');
              }),
            )
          }
        />
      </Section>
    </ScrollView>
  );
}
