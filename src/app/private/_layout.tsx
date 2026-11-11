import { setSecureWindow } from 'clipbox-native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useTheme } from '../../ui/theme/ThemeProvider';

/**
 * Private space: FLAG_SECURE (no screenshots/recording, blank Recents thumbnail) for every screen
 * inside, switched off only when leaving the section.
 */
export default function PrivateLayout() {
  const { colors } = useTheme();
  useEffect(() => {
    void setSecureWindow(true);
    return () => {
      void setSecureWindow(false);
    };
  }, []);
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'slide_from_right' }} />;
}
