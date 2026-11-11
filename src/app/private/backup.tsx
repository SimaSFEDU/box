import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toAppError } from '../../core/errors';
import { useAsync } from '../../features/common/useAsync';
import { PasswordInput } from '../../features/vault/PasswordInput';
import { StrengthMeter } from '../../features/vault/StrengthMeter';
import { backupScope, exportPrivateBackup, restorePrivateBackup } from '../../secure/backupService';
import { Button, Card, Icon, PressableScale, Section, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

const LABEL = { included: 'будет включён', locked: 'заблокирован — откройте, чтобы включить', not_setup: 'не настроен' } as const;

export default function BackupScreen() {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const scope = useAsync(() => backupScope(), []);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [restorePw, setRestorePw] = useState('');
  const [busy, setBusy] = useState<null | 'export' | 'restore'>(null);

  const run = async (kind: 'export' | 'restore', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Clipbox', toAppError(e).userMessage);
    } finally {
      setBusy(null);
      scope.reload();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.xs }}>
            <Icon name="chevron-left" size={24} />
          </PressableScale>
          <Text variant="title">Зашифрованная копия</Text>
        </View>
        <Text tone="secondary">
          Файл .cbvault с Vault и Private Media, зашифрованный отдельным паролем. Нужен для переноса на новый телефон: ключи устройства не переносятся, без этой копии данные после удаления приложения не восстановить.
        </Text>

        <Section title="Создать копию">
          <Card style={{ gap: spacing.xs }}>
            <Text>Vault: {scope.data ? LABEL[scope.data.vault] : '…'}</Text>
            <Text>Private Media: {scope.data ? LABEL[scope.data.media] : '…'}</Text>
          </Card>
          <PasswordInput value={pw} onChangeText={setPw} placeholder="Пароль копии (не мастер-пароль)" accessibilityLabel="Пароль копии" />
          <StrengthMeter password={pw} />
          <PasswordInput value={pw2} onChangeText={setPw2} placeholder="Повторите пароль" accessibilityLabel="Повтор пароля копии" />
          {pw2 && pw !== pw2 ? <Text variant="caption" tone="danger">Пароли не совпадают</Text> : null}
          <Button
            label="Создать и сохранить"
            icon="download"
            loading={busy === 'export'}
            disabled={!pw || pw !== pw2 || busy !== null}
            onPress={() =>
              run('export', async () => {
                await exportPrivateBackup(pw);
                setPw('');
                setPw2('');
              })
            }
          />
          <Text variant="caption" tone="secondary">Храните пароль копии отдельно: без него файл расшифровать нельзя.</Text>
        </Section>

        <Section title="Восстановить из копии">
          <Text tone="secondary">Откройте Vault и Private Media на этом телефоне (настройте, если нужно), затем выберите файл. Копия сначала полностью проверяется; существующие записи не перезаписываются.</Text>
          <PasswordInput value={restorePw} onChangeText={setRestorePw} placeholder="Пароль копии" accessibilityLabel="Пароль копии для восстановления" />
          <Button
            label="Выбрать файл .cbvault"
            icon="upload"
            variant="secondary"
            loading={busy === 'restore'}
            disabled={!restorePw || busy !== null}
            onPress={() =>
              run('restore', async () => {
                const r = await restorePrivateBackup(restorePw);
                if (r) {
                  setRestorePw('');
                  Alert.alert('Восстановлено', `Vault: ${r.vault}\nФайлы: ${r.media}\nКоллекции: ${r.collections}`);
                }
              })
            }
          />
        </Section>
      </ScrollView>
    </View>
  );
}
