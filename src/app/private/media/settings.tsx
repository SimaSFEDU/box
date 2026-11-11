import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaGate } from '../../../features/media/MediaGate';
import { ModuleSettings } from '../../../features/protected/ModuleSettings';
import { mediaModule, resetMedia } from '../../../secure/mediaService';
import { useTheme } from '../../../ui/theme/ThemeProvider';

export default function MediaSettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <MediaGate>
        <ModuleSettings ctl={mediaModule} title="Private Media" accent={colors.media} onReset={resetMedia} />
      </MediaGate>
    </View>
  );
}
