import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAssistant } from '@/src/assistant';
import { desktopColors, desktopRadius, desktopSpacing, desktopTypography, withAlpha } from './DesktopTokens';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  run: () => void;
}

/**
 * Command palette (Ctrl+K). Every command maps to a real route or a real
 * assistant action — no placeholder entries.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    createSession,
  } = useAssistant();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      {
        id: 'new-chat',
        label: 'محادثة جديدة',
        hint: 'Ctrl+N',
        icon: 'plus-circle',
        run: () => {
          void (async () => {
            await createSession();
            router.push('/(tabs)');
          })();
        },
      },
      { id: 'open-chat', label: 'الشات', icon: 'message-circle', run: () => router.push('/(tabs)') },
      { id: 'open-tasks', label: 'المهام', icon: 'calendar', run: () => router.push('/(tabs)/tasks') },
      { id: 'open-skills', label: 'المهارات', icon: 'zap', run: () => router.push('/(tabs)/skills') },
      { id: 'open-memory', label: 'الذاكرة', icon: 'database', run: () => router.push('/(tabs)/memory') },
      { id: 'open-approvals', label: 'الموافقات', icon: 'shield', run: () => router.push('/(tabs)/approvals') },
      { id: 'open-assessments', label: 'التقييمات', icon: 'clipboard', run: () => router.push('/(tabs)/assessments') },
      { id: 'open-findings', label: 'النتائج', icon: 'alert-triangle', run: () => router.push('/(tabs)/findings') },
      { id: 'open-settings', label: 'الإعدادات', hint: 'Ctrl+,', icon: 'settings', run: () => router.push('/(tabs)/settings') },
    ];
    const switchers: Command[] = sessions
      .filter((s) => s.id !== activeSessionId)
      .slice(0, 12)
      .map((s) => ({
        id: `switch-${s.id}`,
        label: s.title || 'محادثة',
        hint: 'تبديل المحادثة',
        icon: 'corner-up-left',
        run: () => {
          void (async () => {
            await setActiveSession(s.id);
            router.push('/(tabs)');
          })();
        },
      }));
    return [...nav, ...switchers];
  }, [sessions, activeSessionId, setActiveSession, createSession]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const visible = filtered.slice(0, 14);
  const current = visible[Math.min(cursor, visible.length - 1)];

  function onInputKey(e: {
    nativeEvent: { key: string };
    preventDefault?: () => void;
  }) {
    const key = e.nativeEvent.key;
    if (key === 'ArrowDown') {
      e.preventDefault?.();
      setCursor((c) => Math.min(c + 1, visible.length - 1));
    } else if (key === 'ArrowUp') {
      e.preventDefault?.();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (key === 'Enter') {
      e.preventDefault?.();
      if (current) {
        current.run();
        onClose();
      }
    } else if (key === 'Escape') {
      onClose();
    }
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="إغلاق لوحة الأوامر">
        <Pressable style={styles.panel} onPress={() => undefined}>
          <View style={styles.searchRow}>
            <Feather name="search" size={15} color={desktopColors.textMuted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              onKeyPress={onInputKey}
              placeholder="ابحث عن أمر أو محادثة…"
              placeholderTextColor={desktopColors.textMuted}
              style={styles.input}
              accessibilityLabel="البحث في لوحة الأوامر"
            />
            <Text style={styles.escHint}>Esc</Text>
          </View>
          <View style={styles.listWrap}>
            {visible.length === 0 ? (
              <Text style={styles.empty}>لا نتائج</Text>
            ) : (
              visible.map((cmd, i) => (
                <Pressable
                  key={cmd.id}
                  accessibilityRole="button"
                  accessibilityLabel={cmd.label}
                  onPress={() => {
                    cmd.run();
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    i === cursor && styles.rowActive,
                    pressed && i !== cursor && styles.rowHover,
                  ]}
                >
                  <Feather name={cmd.icon} size={15} color={i === cursor ? desktopColors.accentHover : desktopColors.textMuted} />
                  <Text style={styles.rowLabel} numberOfLines={1}>{cmd.label}</Text>
                  {cmd.hint ? <Text style={styles.rowHint}>{cmd.hint}</Text> : null}
                </Pressable>
              ))
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,8,0.62)',
    alignItems: 'center',
    paddingTop: 110,
  },
  panel: {
    width: 560,
    maxWidth: '92%',
    maxHeight: 480,
    borderRadius: desktopRadius.xl,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
    overflow: 'hidden',
  },
  searchRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingHorizontal: desktopSpacing.lg,
    paddingVertical: desktopSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: desktopColors.border,
  },
  input: {
    flex: 1,
    ...desktopTypography.body,
    color: desktopColors.text,
    textAlign: 'right',
    padding: 0,
  },
  escHint: {
    ...desktopTypography.tiny,
    color: desktopColors.textMuted,
    borderWidth: 1,
    borderColor: desktopColors.border,
    borderRadius: desktopRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  listWrap: { paddingVertical: desktopSpacing.sm, gap: 1 },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.md,
    marginHorizontal: desktopSpacing.sm,
    paddingHorizontal: desktopSpacing.md,
    paddingVertical: 9,
    borderRadius: desktopRadius.md,
  },
  rowHover: { backgroundColor: desktopColors.surfaceSecondary },
  rowActive: {
    backgroundColor: withAlpha(desktopColors.accent, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.accent, 0.45),
    marginHorizontal: desktopSpacing.sm - 1,
  },
  rowLabel: { ...desktopTypography.body, color: desktopColors.text, flexShrink: 1 },
  rowHint: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  empty: {
    ...desktopTypography.small,
    color: desktopColors.textMuted,
    textAlign: 'center',
    paddingVertical: desktopSpacing.xl,
  },
});
