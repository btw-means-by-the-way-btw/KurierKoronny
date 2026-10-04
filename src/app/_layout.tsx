import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { NavBar } from '../components/ui/NavBar';
import { useMeshLifecycle } from '../hooks/useMeshLifecycle';
import RecoveryScreen from '../screens/RecoveryScreen';
import { useAppearanceStore } from '../store/appearanceStore';
import { useIdentityStore } from '../store/identityStore';
import { useMeshStore } from '../store/meshStore';
import { usePermissionStore } from '../store/permissionStore';
import { darkTheme, lightTheme } from '../theme';

void SplashScreen.preventAutoHideAsync();

/**
 * Navigation guards (first launch flow):
 *   keys / database unreadable → recovery screen (nothing else is reachable)
 *   permissions not granted    → /permissions   (system dialogs; cannot continue without them)
 *   no nick yet                → /onboarding
 *   otherwise                  → tabs (chats / network / settings) + chat and security screens
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  const [ready, setReady] = useState(false);
  const granted = usePermissionStore((s) => s.granted);
  const nick = useIdentityStore((s) => s.nick);
  const identityLost = useIdentityStore((s) => s.status === 'lost');
  const storageError = useMeshStore((s) => s.storageError);

  useEffect(() => {
    useAppearanceStore.getState().load();
    useIdentityStore.getState().load();
    usePermissionStore
      .getState()
      .check()
      .finally(() => {
        setReady(true);
        void SplashScreen.hideAsync();
      });
  }, []);

  useMeshLifecycle();

  if (!ready) return null;

  return (
    <PaperProvider theme={theme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {identityLost || storageError ? (
        <RecoveryScreen kind={identityLost ? 'identity' : 'database'} />
      ) : (
        <Stack
          screenOptions={{
            // One header for every pushed screen. A screen can still inject a custom middle and a
            // right-hand action through `headerTitle` / `headerRight` (the chat does).
            header: ({ options, back, navigation }) => (
              <NavBar
                title={typeof options.headerTitle === 'string' ? options.headerTitle : options.title}
                onBack={back ? navigation.goBack : undefined}
                center={
                  typeof options.headerTitle === 'function'
                    ? options.headerTitle({ children: options.title ?? '' })
                    : undefined
                }
                right={options.headerRight?.({ canGoBack: !!back })}
              />
            ),
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        >
          <Stack.Protected guard={!granted}>
            <Stack.Screen name="permissions" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={granted && !nick}>
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={granted && !!nick}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[id]" options={{ title: 'Czat' }} />
            <Stack.Screen name="alerts" options={{ title: 'Komunikaty urzędowe' }} />
            <Stack.Screen
              name="compose-alert"
              options={{ title: 'Nowy alert', presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="security" options={{ title: 'Bezpieczeństwo' }} />
            <Stack.Screen name="my-key" options={{ title: 'Mój klucz' }} />
            <Stack.Screen name="verify/[id]" options={{ title: 'Weryfikacja klucza' }} />
            <Stack.Screen name="install-cert" options={{ title: 'Certyfikat urzędowy' }} />
          </Stack.Protected>
        </Stack>
      )}
    </PaperProvider>
  );
}
