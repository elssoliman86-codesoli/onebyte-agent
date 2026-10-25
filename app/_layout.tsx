import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { WorkspaceProvider } from '@/src/workspace';
import { AssistantProvider, useAssistant } from '@/src/assistant';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="assessment/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * App-wide notification setup: the Android channel, the foreground-display handler,
 * and opening the task's prompt in the chat when its reminder is tapped — including
 * the cold-start case via getLastNotificationResponseAsync.
 */
function NotificationsBootstrap() {
  const { tasks, setPendingPrompt } = useAssistant();
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    // Notification APIs have no web implementation; guard so the web build stays clean.
    if (Platform.OS === 'web') return;

    void Notifications.setNotificationChannelAsync('daily-tasks', {
      name: 'تذكيرات المهام',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const openTask = (taskId: unknown) => {
      if (typeof taskId !== 'string') return;
      const task = tasksRef.current.find((item) => item.id === taskId);
      if (!task) return;
      setPendingPrompt(task.prompt);
      router.navigate('/(tabs)');
    };

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const taskId = response?.notification.request.content.data?.taskId;
      if (response) openTask(taskId);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        openTask(response.notification.request.content.data?.taskId);
      },
    );
    return () => subscription.remove();
  }, [setPendingPrompt]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <GestureHandlerRootView>
          <KeyboardProvider>
            <WorkspaceProvider>
              <AssistantProvider>
                <NotificationsBootstrap />
                <RootLayoutNav />
              </AssistantProvider>
            </WorkspaceProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
