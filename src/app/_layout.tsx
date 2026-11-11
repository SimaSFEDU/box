import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { toAppError, type AppError } from '../core/errors';
import { createLogger } from '../core/logger';
import { bootstrap } from '../features/bootstrap/bootstrap';
import { ErrorView } from '../ui/components';
import { ThemeProvider, useTheme } from '../ui/theme/ThemeProvider';

const log = createLogger('root');
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Navigator() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="note/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="trash" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen
          name="capture"
          options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }}
        />
      </Stack>
    </>
  );
}

function StartupError({ error, onRetry }: { error: AppError; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
      <ErrorView error={error} onRetry={onRetry} />
    </View>
  );
}

export default function RootLayout() {
  const [state, setState] = useState<'loading' | 'ready' | AppError>('loading');

  const start = useCallback(() => {
    bootstrap()
      .then(() => setState('ready'))
      .catch((e) => {
        log.error('startup failed', e);
        setState(toAppError(e, 'UNKNOWN', 'Не удалось запустить Clipbox'));
      })
      .finally(() => SplashScreen.hideAsync().catch(() => undefined));
  }, []);

  useEffect(start, [start]);
  const retry = useCallback(() => {
    setState('loading');
    start();
  }, [start]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          {state === 'ready' ? <Navigator /> : state === 'loading' ? null : <StartupError error={state} onRetry={retry} />}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export { ErrorBoundary } from 'expo-router';
