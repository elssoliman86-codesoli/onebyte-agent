import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { useAssistant } from '@/src/assistant';
import { alertCompat } from '@/src/web-alert';
import type { StudioMode } from '@/src/modes';
import { modeBySessionTag } from '@/src/modes';

export function StudioChatEntry({ mode }: { mode: StudioMode }) {
  const colors = useColors();
  const { createSession, patchSession } = useAssistant();
  const [opening, setOpening] = useState(false);
  const def = modeBySessionTag(mode);

  async function startChat() {
    if (opening) return;
    setOpening(true);
    try {
      const id = await createSession();
      await patchSession(id, { mode });
      router.replace('/(tabs)');
    } catch {
      setOpening(false);
      alertCompat('تعذّر فتح المحادثة', 'حاولي مرة أخرى.');
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenTopBar active={mode} />
      <View style={styles.content}>
        <View style={[styles.icon, { backgroundColor: colors.accent }]}>
          <Feather
            name={(def?.icon ?? 'message-circle') as React.ComponentProps<typeof Feather>['name']}
            size={24}
            color={colors.primary}
          />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>{def?.label ?? 'المساعد'}</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {def?.tagline ?? 'ابدأ محادثة متخصصة.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ابدأ محادثة متخصصة"
          onPress={() => void startChat()}
          disabled={opening}
          style={[styles.button, { backgroundColor: colors.primary, opacity: opening ? 0.7 : 1 }]}
        >
          {opening ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="message-circle" size={17} color={colors.primaryForeground} />
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>ابدأ المحادثة</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  icon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  subtitle: { maxWidth: 280, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  button: {
    minHeight: 46,
    borderRadius: 15,
    paddingHorizontal: 18,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontSize: 14, fontWeight: '700' },
});
