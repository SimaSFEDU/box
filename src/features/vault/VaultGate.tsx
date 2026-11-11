import { Redirect, router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';

import { toAppError } from '../../core/errors';
import {
  biometricStatus,
  refreshVault,
  unlockDelayMs,
  unlockWithBiometric,
  unlockWithPassword,
  unlockWithRecovery,
  useVaultState,
  watchVaultLock,
} from '../../secure/vaultService';
import { Button, EmptyState, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { PasswordInput } from './PasswordInput';

/**
 * Renders children only while the Vault is unlocked. When it locks (background, idle timeout,
 * manual lock) children unmount, dropping any decrypted entries held in component state.
 */
export function VaultGate({ children }: { children: ReactNode }) {
  const status = useVaultState((s) => s.status);
  useEffect(() => {
    watchVaultLock();
    void refreshVault();
  }, []);
  if (status === 'loading') return null;
  if (status === 'unavailable') return <EmptyState icon="alert-triangle" title="Vault недоступен" message="Эта сборка приложения не содержит защищённого модуля. Нужна сборка Clipbox для Android (не Expo Go)." />;
  if (status === 'not_setup') return <Redirect href="/private/vault/setup" />;
  if (status === 'locked') return <UnlockView />;
  return <>{children}</>;
}

function UnlockView() {
  const { colors, spacing } = useTheme();
  const bioEnabled = useVaultState((s) => s.biometricEnabled);
  const hasRecovery = useVaultState((s) => s.hasRecovery);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const canBio = bioEnabled && biometricStatus() === 'available';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPassword('');
    } catch (e) {
      const err = toAppError(e);
      if (err.userMessage !== 'Отменено') setError(err.userMessage);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // Auto-prompt once when the gate appears.
    if (!canBio) return;
    unlockWithBiometric().catch((e) => {
      const err = toAppError(e);
      if (err.userMessage !== 'Отменено') setError(err.userMessage);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPassword = async () => {
    const wait = await unlockDelayMs();
    if (wait > 0) {
      setError(`Слишком много попыток. Подождите ${Math.ceil(wait / 1000)} с`);
      return;
    }
    await run(() => unlockWithPassword(password));
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <View style={{ backgroundColor: colors.vault + '22', padding: spacing.lg, borderRadius: 999 }}>
          <Icon name="lock" size={28} color={colors.vault} />
        </View>
        <Text variant="title">Vault заблокирован</Text>
      </View>
      {mode === 'password' ? (
        <>
          <PasswordInput value={password} onChangeText={setPassword} placeholder="Мастер-пароль" onSubmitEditing={submitPassword} returnKeyType="go" accessibilityLabel="Мастер-пароль" />
          <Button label="Открыть" icon="unlock" loading={busy} disabled={!password} onPress={submitPassword} />
          {canBio ? <Button label="Биометрия" icon="smartphone" variant="secondary" disabled={busy} onPress={() => run(unlockWithBiometric)} /> : null}
          {hasRecovery ? (
            <PressableScale accessibilityLabel="Забыли пароль" onPress={() => setMode('recovery')} style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Text tone="primary">Забыли мастер-пароль?</Text>
            </PressableScale>
          ) : null}
        </>
      ) : (
        <>
          <Text tone="secondary">Введите ключ восстановления и задайте новый мастер-пароль. Записи останутся на месте.</Text>
          <PasswordInput value={recoveryKey} onChangeText={setRecoveryKey} placeholder="XXXX-XXXX-…" revealable={false} secureTextEntry={false} accessibilityLabel="Ключ восстановления" />
          <PasswordInput value={newPassword} onChangeText={setNewPassword} placeholder="Новый мастер-пароль" accessibilityLabel="Новый мастер-пароль" />
          <Button label="Восстановить доступ" loading={busy} disabled={!recoveryKey || !newPassword} onPress={() => run(() => unlockWithRecovery(recoveryKey, newPassword))} />
          <Button label="Назад" variant="ghost" onPress={() => setMode('password')} />
        </>
      )}
      {error ? (
        <Text tone="danger" style={{ textAlign: 'center' }}>
          {error}
        </Text>
      ) : null}
      <Button label="Закрыть" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  );
}

export function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
