import type { ReactNode } from 'react';

import { mediaModule } from '../../secure/mediaService';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { ModuleGate } from '../protected/ModuleGate';

export function MediaGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ModuleGate ctl={mediaModule} setupHref="/private/media/setup" title="Private Media" accent={colors.media}>
      {children}
    </ModuleGate>
  );
}
