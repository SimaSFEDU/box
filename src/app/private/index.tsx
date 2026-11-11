import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lockVault, useVaultState } from '../../secure/vaultService';
import { Card, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

export default function PrivateHub() {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const vault = useVaultState((s) => s.status);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, padding: spacing.lg, gap: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <PressableScale accessibilityLabel="Назад" onPress={() => router.back()} style={{ padding: spacing.xs }}>
          <Icon name="chevron-left" size={24} />
        </PressableScale>
        <Text variant="display" style={{ flex: 1 }}>
          Private
        </Text>
        <PressableScale
          accessibilityLabel="Заблокировать всё и выйти"
          onPress={() => lockVault().finally(() => router.replace('/'))}
          style={{ padding: spacing.sm }}
        >
          <Icon name="log-out" size={22} color={colors.danger} />
        </PressableScale>
      </View>
      <Text tone="secondary">Отдельные ключи шифрования для каждого раздела. Скриншоты и превью в списке приложений здесь отключены.</Text>
      <PressableScale accessibilityLabel="Vault" onPress={() => router.push('/private/vault')}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon name="key" size={24} color={colors.vault} />
          <View style={{ flex: 1 }}>
            <Text variant="heading">Vault</Text>
            <Text variant="caption" tone="secondary">
              Пароли, ключи, карты, секретные заметки ·{' '}
              {vault === 'unlocked' ? 'открыт' : vault === 'not_setup' ? 'не настроен' : 'заблокирован'}
            </Text>
          </View>
          <Icon name={vault === 'unlocked' ? 'unlock' : 'lock'} size={18} color={colors.secondary} />
        </Card>
      </PressableScale>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, opacity: 0.5 }}>
        <Icon name="image" size={24} color={colors.media} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">Private Media</Text>
          <Text variant="caption" tone="secondary">
            Зашифрованные фото, видео и файлы · скоро
          </Text>
        </View>
      </Card>
    </View>
  );
}
