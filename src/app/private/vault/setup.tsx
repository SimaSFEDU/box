import { ModuleSetup } from '../../../features/protected/ModuleSetup';
import { vaultModule } from '../../../secure/vaultService';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export default function VaultSetup() {
  const { colors } = useTheme();
  return (
    <ModuleSetup
      ctl={vaultModule}
      title="Vault"
      doneHref="/private/vault"
      accent={colors.vault}
      intro="Vault шифрует пароли и секреты на устройстве ключом, который защищён вашим мастер-паролем."
    />
  );
}
