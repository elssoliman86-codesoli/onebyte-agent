import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type ColorValue,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Slot, Tabs, usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { DesktopShell } from '@/components/desktop/DesktopShell';
import { DesktopChat } from '@/components/desktop/DesktopChat';
import { useIsDesktopViewport } from '@/components/desktop/useDesktopViewport';

// IMPORTANT: iOS 26 uses NativeTabs for native tabs with liquid glass support.
// NativeTabs intentionally does NOT use custom design tokens — liquid glass
// is a system-level appearance provided by iOS and cannot be overridden.
// Custom brand colors are applied only on the ClassicTabLayout path (older iOS / Android / web).
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }}
        />
        <NativeTabs.Trigger.Label>الشات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} />
        <NativeTabs.Trigger.Label>المهام</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="skills">
        <NativeTabs.Trigger.Icon sf={{ default: 'sparkles', selected: 'sparkles' }} />
        <NativeTabs.Trigger.Label>المهارات</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="memory">
        <NativeTabs.Trigger.Icon sf={{ default: 'brain.head.profile', selected: 'brain.head.profile' }} />
        <NativeTabs.Trigger.Label>الذاكرة</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const tabIcon = (name: string, color: ColorValue) => {
    const icons: Record<string, React.ComponentProps<typeof Feather>['name']> = {
      index: 'message-circle',
      tasks: 'calendar',
      skills: 'zap',
      memory: 'database',
      settings: 'settings',
    };
    return <Feather name={icons[name] ?? 'circle'} size={20} color={color} />;
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        // Navigation moved into the phone side drawer (PhoneDrawer) — the
        // classic bottom tab bar is hidden everywhere it would render.
        // The screens stay registered (routes keep working) but no tab bar.
        tabBarStyle: { display: 'none' },
        tabBarButton: () => null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'الشات',
          tabBarIcon: ({ color }) => tabIcon('index', color),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'المهام',
          tabBarIcon: ({ color }) => tabIcon('tasks', color),
        }}
      />
      <Tabs.Screen
        name="skills"
        options={{
          title: 'المهارات',
          tabBarIcon: ({ color }) => tabIcon('skills', color),
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: 'الذاكرة',
          tabBarIcon: ({ color }) => tabIcon('memory', color),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => tabIcon('settings', color),
        }}
      />
      <Tabs.Screen name="assessments" options={{ href: null }} />
      <Tabs.Screen name="approvals" options={{ href: null }} />
      <Tabs.Screen name="findings" options={{ href: null }} />
      <Tabs.Screen name="github" options={{ href: null }} />
      {/* Studio modes — drawer-only access, no tab bar entries. */}
      <Tabs.Screen name="marketing" options={{ href: null }} />
      <Tabs.Screen name="lab" options={{ href: null }} />\n      <Tabs.Screen name="developer" options={{ href: null }} />
      <Tabs.Screen name="hunter" options={{ href: null }} />
      <Tabs.Screen name="hunter-tools" options={{ href: null }} />
    </Tabs>
  );
}

/**
 * Desktop center workspace. The chat route gets the dedicated desktop chat
 * presentation (DesktopChat); every other screen renders its existing route
 * element untouched inside the shell.
 *
 * Router constraint: <Slot /> (the navigator) must stay MOUNTED on every
 * desktop route. Unmounting it for the chat route made expo-router's state
 * churn infinitely ("Maximum update depth exceeded") when navigating back.
 * So the Slot layer always renders — hidden (display none, no pointer events)
 * while the home route shows DesktopChat on top of it.
 */
function DesktopCenter() {
  const pathname = usePathname();
  const clean = pathname.replace(/^\/\(tabs\)/, '');
  const isHome = clean === '' || clean === '/';
  return (
    <View style={desktopCenterStyles.centerStack}>
      <View
        style={[desktopCenterStyles.centerLayer, isHome && desktopCenterStyles.centerLayerHidden]}
        pointerEvents={isHome ? 'none' : 'auto'}
      >
        <Slot />
      </View>
      {isHome ? (
        <View style={desktopCenterStyles.centerLayer}>
          <DesktopChat />
        </View>
      ) : null}
    </View>
  );
}

const desktopCenterStyles = StyleSheet.create({
  centerStack: { flex: 1, minHeight: 0, minWidth: 0 },
  centerLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  centerLayerHidden: { display: 'none' },
});

export default function TabLayout() {
  const isDesktop = useIsDesktopViewport();
  // Desktop viewport (web only): custom command-center shell instead of the
  // tab bar. The mobile tab bar is not rendered simultaneously.
  if (isDesktop) {
    return (
      <DesktopShell>
        <DesktopCenter />
      </DesktopShell>
    );
  }
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
