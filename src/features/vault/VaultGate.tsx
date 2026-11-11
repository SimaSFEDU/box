import type { ReactNode } from 'react';
import { Alert } from 'react-native';

import { vaultModule } from '../../secure/vaultService';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { ModuleGate } from '../protected/ModuleGate';

export function VaultGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ModuleGate ctl={vaultModule} setupHref="/private/vault/setup" title="Vault" accent={colors.vault}>
      {children}
    </ModuleGate>
  );
}

export function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
