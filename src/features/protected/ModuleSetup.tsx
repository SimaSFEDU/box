import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../core/errors';
import { masterPasswordProblem } from '../../domain/vault/strength';
import { PasswordInput } from '../vault/PasswordInput';
import { StrengthMeter } from '../vault/StrengthMeter';
import type { ProtectedModuleController } from '../../secure/protectedModule';
import { Button, Card, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

type Step = 'intro' | 'password' | 'recovery' | 'biometric';

/** First-time setup wizard for a protected module: consequences → master password → recovery key → biometrics. */
export function ModuleSetup({ ctl, title, doneHref, intro, accent }: { ctl: ProtectedModuleController; title: string; doneHref: Href; intro: string; accent: string }) {
  const { colors, spacing, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('intro');
  const [understood, setUnderstood] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [withRecovery, setWithRecovery] = useState(true);
  const [declineAck, setDeclineAck] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [savedAck, setSavedAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = pw ? masterPasswordProblem(pw) : null;
  const mismatch = pw2.length > 0 && pw !== pw2;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = await ctl.setup(pw, withRecovery);
      setPw('');
      setPw2('');
      setRecoveryKey(key);
      setStep(key ? 'recovery' : 'biometric');
    } catch (e) {
      setError(toAppError(e).userMessage);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => router.replace(doneHref);
  const bio = ctl.biometricStatus();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}>
        {step === 'intro' || step === 'password' ? (
          <PressableScale accessibilityLabel="Назад" onPress={() => (step === 'password' ? setStep('intro') : router.back())} style={{ padding: spacing.sm }}>
            <Icon name="chevron-left" size={24} />
          </PressableScale>
        ) : null}
        <Text variant="title">Настройка: {title}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {step === 'intro' ? (
          <>
            <Text>{intro} Clipbox не хранит пароль и не может его восстановить.</Text>
            <Card style={{ gap: spacing.sm }}>
              {[
                ['key', 'Мастер-пароль открывает Vault. Его нельзя сбросить «по почте» — сервера нет.'],
                ['life-buoy', 'Ключ восстановления — единственный способ войти, если вы забудете пароль. Храните его на бумаге.'],
                ['smartphone', 'Биометрия — удобный вход на этом телефоне. При смене отпечатков потребуется пароль.'],
                ['trash-2', 'Удаление приложения или сброс телефона уничтожают ключи. Без зашифрованной резервной копии данные будут потеряны.'],
              ].map(([icon, text]) => (
                <View key={icon} style={{ flexDirection: 'row', gap: spacing.md }}>
                  <Icon name={icon as 'key'} size={18} color={accent} />
                  <Text style={{ flex: 1 }}>{text}</Text>
                </View>
              ))}
            </Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Switch value={understood} onValueChange={setUnderstood} trackColor={{ true: accent, false: colors.border }} accessibilityLabel="Я понимаю" />
              <Text style={{ flex: 1 }}>Я понимаю, что потерянный мастер-пароль без ключа восстановления означает потерю данных</Text>
            </View>
            <Button label="Продолжить" disabled={!understood} onPress={() => setStep('password')} />
          </>
        ) : null}

        {step === 'password' ? (
          <>
            <Text tone="secondary">Минимум 10 символов. Лучше всего — фраза из нескольких случайных слов.</Text>
            <PasswordInput value={pw} onChangeText={setPw} placeholder="Мастер-пароль" autoFocus accessibilityLabel="Мастер-пароль" />
            <StrengthMeter password={pw} />
            {problem ? <Text variant="caption" tone="danger">{problem}</Text> : null}
            <PasswordInput value={pw2} onChangeText={setPw2} placeholder="Повторите пароль" accessibilityLabel="Повтор пароля" />
            {mismatch ? <Text variant="caption" tone="danger">Пароли не совпадают</Text> : null}
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text>Создать ключ восстановления</Text>
                <Text variant="caption" tone="secondary">Рекомендуется</Text>
              </View>
              <Switch value={withRecovery} onValueChange={(v) => { setWithRecovery(v); setDeclineAck(false); }} trackColor={{ true: accent, false: colors.border }} accessibilityLabel="Ключ восстановления" />
            </Card>
            {!withRecovery ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Switch value={declineAck} onValueChange={setDeclineAck} trackColor={{ true: colors.danger, false: colors.border }} accessibilityLabel="Подтверждаю отказ" />
                <Text tone="danger" style={{ flex: 1 }}>
                  Если я забуду мастер-пароль и биометрия перестанет работать, данные будет невозможно восстановить.
                </Text>
              </View>
            ) : null}
            {error ? <Text tone="danger">{error}</Text> : null}
            <Button
              label={`Создать ${title}`}
              icon="lock"
              loading={busy}
              disabled={!!problem || !pw || pw !== pw2 || (!withRecovery && !declineAck)}
              onPress={create}
            />
            {busy ? <Text variant="caption" tone="secondary">Вычисление ключа (Argon2id) занимает около секунды…</Text> : null}
          </>
        ) : null}

        {step === 'recovery' && recoveryKey ? (
          <>
            <Text>Это ваш ключ восстановления. Он показывается один раз. Запишите его на бумаге и храните отдельно от телефона.</Text>
            <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
              <Text selectable={false} style={[typography.mono, { fontSize: 18, lineHeight: 28, letterSpacing: 1, textAlign: 'center', color: colors.text }]}>
                {recoveryKey.split('-').reduce<string[]>((rows, g, i) => {
                  if (i % 4 === 0) rows.push(g);
                  else rows[rows.length - 1] += '-' + g;
                  return rows;
                }, []).join('\n')}
              </Text>
            </Card>
            <Text variant="caption" tone="secondary">Не делайте скриншот — на этом экране он запрещён, а фото в галерее небезопасно.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Switch value={savedAck} onValueChange={setSavedAck} trackColor={{ true: accent, false: colors.border }} accessibilityLabel="Я записал ключ" />
              <Text style={{ flex: 1 }}>Я записал ключ восстановления</Text>
            </View>
            <Button label="Далее" disabled={!savedAck} onPress={() => { setRecoveryKey(null); setStep('biometric'); }} />
          </>
        ) : null}

        {step === 'biometric' ? (
          <>
            <Text>{bio === 'available' ? `Открывать ${title} отпечатком или лицом (если устройство поддерживает надёжную биометрию)?` : bio === 'none_enrolled' ? 'На телефоне не настроена биометрия. Её можно включить позже в настройках Vault.' : 'Надёжная биометрия на этом устройстве недоступна. Vault будет открываться мастер-паролем.'}</Text>
            {error ? <Text tone="danger">{error}</Text> : null}
            {bio === 'available' ? (
              <Button
                label="Включить биометрию"
                icon="smartphone"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await ctl.enableBiometric();
                    finish();
                  } catch (e) {
                    setError(toAppError(e).userMessage);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            ) : null}
            <Button label={bio === 'available' ? 'Не сейчас' : 'Готово'} variant={bio === 'available' ? 'ghost' : 'primary'} onPress={finish} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
