import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../../core/errors';
import { useAsync } from '../../../features/common/useAsync';
import { getSetting, setSetting } from '../../../features/library/libraryQueries';
import { PasswordInput } from '../../../features/vault/PasswordInput';
import { StrengthMeter } from '../../../features/vault/StrengthMeter';
import { confirmDestructive, VaultGate } from '../../../features/vault/VaultGate';
import {
  biometricStatus,
  changeMasterPassword,
  disableBiometric,
  enableBiometric,
  regenerateRecoveryKey,
  removeRecoveryKey,
  resetVault,
  setAutoLock,
  useVaultState,
} from '../../../secure/vaultService';
import { Button, Card, Chip, Icon, PressableScale, Section, Text } from '../../../ui/components';
import { useTheme } from '../../../ui/theme/ThemeProvider';

const AUTOLOCK = [30, 60, 300, 900];
const CLIPBOARD = [15, 30, 60, 120];

export default function VaultSettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <VaultGate>
        <VaultSettings />
      </VaultGate>
    </View>
  );
}

function VaultSettings() {
  const { colors, spacing, typography } = useTheme();
  const st = useVaultState();
  const clip = useAsync(() => getSetting('clipboardClearSec'), []);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);
  const fail = (e: unknown) => Alert.alert('Clipbox', toAppError(e).userMessage);
  const bio = biometricStatus();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const err = toAppError(e);
      if (err.userMessage !== 'Отменено') fail(err);
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
        <Text variant="title">Настройки Vault</Text>
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
            onValueChange={(v) => run(v ? enableBiometric : disableBiometric)}
            trackColor={{ true: colors.vault, false: colors.border }}
            accessibilityLabel="Биометрия"
          />
        </Card>
        <Text variant="label" tone="secondary">Блокировать при бездействии</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {AUTOLOCK.map((s) => (
            <Chip key={s} label={s < 60 ? `${s} с` : `${s / 60} мин`} selected={st.autoLockSec === s} onPress={() => run(() => setAutoLock(s))} />
          ))}
        </View>
        <Text variant="caption" tone="secondary">При сворачивании приложения Vault блокируется сразу.</Text>
        <Text variant="label" tone="secondary">Очищать буфер обмена через</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {CLIPBOARD.map((s) => (
            <Chip key={s} label={`${s} с`} selected={clip.data === s} onPress={() => run(async () => { await setSetting('clipboardClearSec', s); clip.reload(); })} />
          ))}
        </View>
      </Section>

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
              await changeMasterPassword(current, next);
              setCurrent('');
              setNext('');
              Alert.alert('Готово', 'Мастер-пароль изменён. Записи не перешифровывались — изменилась только обёртка ключа.');
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
        <Button
          label={st.hasRecovery ? 'Создать новый ключ' : 'Создать ключ'}
          variant="secondary"
          onPress={() => run(async () => setRecovery(await regenerateRecoveryKey()))}
        />
        {st.hasRecovery ? (
          <Button
            label="Отключить ключ восстановления"
            variant="ghost"
            onPress={() => confirmDestructive('Отключить ключ?', 'Если вы забудете мастер-пароль, восстановить доступ будет невозможно.', 'Отключить', () => void run(removeRecoveryKey))}
          />
        ) : null}
      </Section>

      <Section title="Опасная зона">
        <Button
          label="Удалить Vault и все записи"
          icon="trash-2"
          variant="danger"
          onPress={() =>
            confirmDestructive('Удалить Vault?', 'Ключи шифрования будут уничтожены, все записи станут недоступны навсегда. Это нельзя отменить.', 'Удалить навсегда', () =>
              void run(async () => {
                await resetVault();
                router.replace('/private');
              }),
            )
          }
        />
      </Section>
    </ScrollView>
  );
}
