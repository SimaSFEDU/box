import { Redirect, router, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { toAppError } from '../../core/errors';
import type { ProtectedModuleController } from '../../secure/protectedModule';
import { Button, EmptyState, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { PasswordInput } from '../vault/PasswordInput';

/**
 * Renders children only while the module is unlocked. When it locks (background, idle timeout,
 * manual lock) children unmount, dropping any decrypted data held in component state.
 */
export function ModuleGate({ ctl, setupHref, title, accent, children }: { ctl: ProtectedModuleController; setupHref: Href; title: string; accent: string; children: ReactNode }) {
  const status = ctl.useState((s) => s.status);
  useEffect(() => {
    ctl.watch();
    void ctl.refresh();
  }, [ctl]);
  if (status === 'loading') return null;
  if (status === 'unavailable') return <EmptyState icon="alert-triangle" title={`${title} недоступен`} message="Эта сборка приложения не содержит защищённого модуля. Нужна сборка Clipbox для Android (не Expo Go)." />;
  if (status === 'not_setup') return <Redirect href={setupHref} />;
  if (status === 'locked') return <UnlockView ctl={ctl} title={title} accent={accent} />;
  return <>{children}</>;
}

function UnlockView({ ctl, title, accent }: { ctl: ProtectedModuleController; title: string; accent: string }) {
  const { spacing } = useTheme();
  const bioEnabled = ctl.useState((s) => s.biometricEnabled);
  const hasRecovery = ctl.useState((s) => s.hasRecovery);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const canBio = bioEnabled && ctl.biometricStatus() === 'available';

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
    ctl.unlockWithBiometric().catch((e) => {
      const err = toAppError(e);
      if (err.userMessage !== 'Отменено') setError(err.userMessage);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <View style={{ backgroundColor: accent + '22', padding: spacing.lg, borderRadius: 999 }}>
          <Icon name="lock" size={28} color={accent} />
        </View>
        <Text variant="title">{title} заблокирован</Text>
      </View>
      {mode === 'password' ? (
        <>
          <PasswordInput value={password} onChangeText={setPassword} placeholder="Мастер-пароль" onSubmitEditing={() => run(() => ctl.unlockWithPassword(password))} returnKeyType="go" accessibilityLabel="Мастер-пароль" />
          <Button label="Открыть" icon="unlock" loading={busy} disabled={!password} onPress={() => run(() => ctl.unlockWithPassword(password))} />
          {canBio ? <Button label="Биометрия" icon="smartphone" variant="secondary" disabled={busy} onPress={() => run(() => ctl.unlockWithBiometric())} /> : null}
          {hasRecovery ? (
            <PressableScale accessibilityLabel="Забыли пароль" onPress={() => setMode('recovery')} style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Text tone="primary">Забыли мастер-пароль?</Text>
            </PressableScale>
          ) : null}
        </>
      ) : (
        <>
          <Text tone="secondary">Введите ключ восстановления и задайте новый мастер-пароль. Данные останутся на месте.</Text>
          <PasswordInput value={recoveryKey} onChangeText={setRecoveryKey} placeholder="XXXX-XXXX-…" revealable={false} secureTextEntry={false} accessibilityLabel="Ключ восстановления" />
          <PasswordInput value={newPassword} onChangeText={setNewPassword} placeholder="Новый мастер-пароль" accessibilityLabel="Новый мастер-пароль" />
          <Button label="Восстановить доступ" loading={busy} disabled={!recoveryKey || !newPassword} onPress={() => run(() => ctl.unlockWithRecovery(recoveryKey, newPassword))} />
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
