import { ModuleSetup } from '../../../features/protected/ModuleSetup';
import { mediaModule } from '../../../secure/mediaService';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export default function MediaSetup() {
  const { colors } = useTheme();
  return (
    <ModuleSetup
      ctl={mediaModule}
      title="Private Media"
      doneHref="/private/media"
      accent={colors.media}
      intro="Private Media шифрует фото, видео и файлы отдельным ключом (не тем, что у Vault). Можно использовать тот же мастер-пароль или другой."
    />
  );
}
