import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAssistant } from '@/src/assistant';
import { useWorkspace } from '@/src/workspace';
import { spacing, radius } from '@/src/design-tokens';
import { alertCompat } from '@/src/web-alert';
import type { StudioMode } from '@/src/modes';

/**
 * Phone side drawer + its hamburger handle.
 *
 * The drawer holds the full navigation (chat, tasks, skills, memory,
 * approvals, settings), the recent-chats list, and quick theme switches —
 * real data only. Screens embed <ScreenTopBar /> once and get both the
 * hamburger button and the drawer in a single line.
 */

const NAV: { key: string; label: string; icon: string; route: string }[] = [
  { key: 'index', label: 'الشات', icon: 'message-circle', route: '/(tabs)' },
  { key: 'tasks', label: 'المهام', icon: 'calendar', route: '/(tabs)/tasks' },
  { key: 'skills', label: 'المهارات', icon: 'zap', route: '/(tabs)/skills' },
  { key: 'memory', label: 'الذاكرة', icon: 'database', route: '/(tabs)/memory' },
  { key: 'github', label: 'مشاريع GitHub', icon: 'github', route: '/(tabs)/github' },
  { key: 'lab', label: 'Cybersecurity Lab', icon: 'shield', route: '/(tabs)/lab' },
  { key: 'approvals', label: 'الموافقات', icon: 'shield', route: '/(tabs)/approvals' },
  { key: 'settings', label: 'الإعدادات', icon: 'settings', route: '/(tabs)/settings' },
];

/** Studio entries start a normal chat with an internal mode prompt. */
const STUDIO_NAV: { key: StudioMode; label: string; icon: string }[] = [
  { key: 'marketing', label: 'استوديو التسويق', icon: 'trending-up' },
  { key: 'developer', label: 'مختبر المطوّر', icon: 'code' },
  { key: 'hunter', label: 'الأمن السيبراني', icon: 'shield' },
];

export function ScreenTopBar({
  active,
  center,
  actions,
  onOpenHistory,
  onNewChat,
}: {
  active: string;
  /** Optional content rendered beside the hamburger in the same row (chat title etc.). */
  center?: React.ReactNode;
  /** Optional action buttons rendered at the row's far edge. */
  actions?: React.ReactNode;
  /** Opens the full history sheet (chat screen wires it; undefined elsewhere). */
  onOpenHistory?: () => void;
  /** Starts a new chat from the drawer's bottom button (undefined elsewhere). */
  onNewChat?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const colors = useColors();
  return (
    <>
      <View style={styles.topBarRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="القائمة الجانبية"
          onPress={() => setOpen(true)}
          style={[styles.hamburger, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="menu" size={19} color={colors.foreground} />
        </Pressable>
        {center ? <View style={styles.topBarCenter}>{center}</View> : null}
        {actions ? <View style={styles.topBarActions}>{actions}</View> : null}
      </View>
      <PhoneDrawer
        active={active}
        visible={open}
        onClose={() => setOpen(false)}
        onOpenHistory={onOpenHistory}
        onNewChat={onNewChat}
      />
    </>
  );
}

export function PhoneDrawer({
  active,
  visible,
  onClose,
  onOpenHistory,
  onNewChat,
}: {
  active: string;
  visible: boolean;
  onClose: () => void;
  /** Opens the chat history sheet on the chat screen (undefined elsewhere). */
  onOpenHistory?: () => void;
  /** Starts a new chat (undefined elsewhere — the bottom button hides). */
  onNewChat?: () => void;
}) {
  const colors = useColors();
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    createSession,
    patchSession,
    provider,
    appearance,
    saveAppearanceSettings,
  } = useAssistant();
  const { approvals } = useWorkspace();
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;
  const recent = sessions.slice(0, 6);

  function go(route: string) {
    onClose();
    router.push(route as never);
  }

  function openSession(id: string) {
    onClose();
    void setActiveSession(id).then(() => router.push('/(tabs)'));
  }

  async function openStudio(mode: StudioMode) {
    onClose();
    try {
      const id = await createSession();
      await patchSession(id, { mode });
      router.replace('/(tabs)');
    } catch {
      alertCompat('تعذّر فتح الاستوديو', 'حاولي مرة أخرى.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="إغلاق القائمة"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.panel, { backgroundColor: colors.background, borderRightColor: colors.border }]}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Identity + honest plan status */}
            <View style={styles.head}>
              <View style={[styles.avatar, { backgroundColor: colors.accentSubtle }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>O</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.appName, { color: colors.foreground }]}>OneByte Agent</Text>
                <Text style={[styles.planLine, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {provider.model
                    ? `${provider.free ? 'الخطة المجانية' : 'خطة مدفوعة'} · ${provider.providerName}`
                    : 'لم يتم اختيار موديل بعد'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق القائمة"
                onPress={onClose}
                style={styles.closeBtn}
              >
                <Feather name="x" size={19} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Navigation */}
            <View style={styles.section}>
              {NAV.map((item) => {
                const isActive = item.key === active;
                const badge = item.key === 'approvals' && pendingApprovals > 0 ? pendingApprovals : null;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    onPress={() => go(item.route)}
                    style={[
                      styles.navItem,
                      isActive && { backgroundColor: colors.accentSubtle, borderColor: colors.borderHighlighted },
                    ]}
                  >
                    <Feather
                      name={item.icon as React.ComponentProps<typeof Feather>['name']}
                      size={18}
                      color={isActive ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.navLabel,
                        { color: isActive ? colors.primary : colors.foreground },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {badge ? (
                      <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
                        <Text style={styles.badgeText}>{badge}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>

            {/* Studios — one specialised button per mode */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                الاستوديوهات
              </Text>
              {STUDIO_NAV.map((item) => {
                const isActive = item.key === active;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    onPress={() => void openStudio(item.key)}
                    style={[
                      styles.navItem,
                      isActive && { backgroundColor: colors.accentSubtle, borderColor: colors.borderHighlighted },
                    ]}
                  >
                    <Feather
                      name={item.icon as React.ComponentProps<typeof Feather>['name']}
                      size={18}
                      color={isActive ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.navLabel,
                        { color: isActive ? colors.primary : colors.foreground },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Recent chats — real sessions, tap to switch; clock entry opens the full history */}
            {(recent.length || onOpenHistory) ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                  المحادثات الأخيرة
                </Text>
                {recent.map((session) => (
                  <Pressable
                    key={session.id}
                    accessibilityRole="button"
                    onPress={() => openSession(session.id)}
                    style={styles.sessionRow}
                  >
                    <Feather
                      name={session.id === activeSessionId ? 'message-square' : 'clock'}
                      size={14}
                      color={session.id === activeSessionId ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.sessionTitle,
                        {
                          color: session.id === activeSessionId ? colors.primary : colors.foreground,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {session.title || 'محادثة'}
                    </Text>
                  </Pressable>
                ))}
                {onOpenHistory ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="كل المحادثات السابقة"
                    onPress={() => {
                      onClose();
                      onOpenHistory();
                    }}
                    style={[styles.sessionRow, styles.allChatsRow]}
                  >
                    <Feather name="clock" size={14} color={colors.primary} />
                    <Text style={[styles.sessionTitle, { color: colors.primary }]}>
                      كل المحادثات السابقة
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Theme quick switch — the same preference stored in settings */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>المظهر</Text>
              <View style={styles.themeRow}>
                {(
                  [
                    { key: 'dark', label: 'داكن' },
                    { key: 'light', label: 'فاتح' },
                    { key: 'system', label: 'تلقائي' },
                  ] as const
                ).map((opt) => {
                  const isActive = appearance.theme === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      accessibilityRole="button"
                      onPress={() => void saveAppearanceSettings({ theme: opt.key })}
                      style={[
                        styles.themeChip,
                        { borderColor: isActive ? colors.primary : colors.border },
                        isActive && { backgroundColor: colors.accentSubtle },
                      ]}
                    >
                      <Text
                        style={{
                          color: isActive ? colors.primary : colors.mutedForeground,
                          fontSize: 12,
                          fontWeight: '700',
                        }}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Text style={[styles.foot, { color: colors.mutedForeground }]}>
              اللغة وألوان الثيم من الإعدادات
            </Text>

            {/* Bottom action — "new chat", like the reference chat apps */}
            {onNewChat ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="محادثة جديدة"
                onPress={() => {
                  onClose();
                  onNewChat();
                }}
                style={[styles.newChatBtn, { backgroundColor: colors.primary }]}
              >
                <Feather name="edit-3" size={16} color={colors.primaryForeground ?? '#FFFFFF'} />
                <Text style={[styles.newChatBtnText, { color: colors.primaryForeground ?? '#FFFFFF' }]}>
                  محادثة جديدة
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBarRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs + 2,
    paddingBottom: spacing.xs,
  },
  hamburger: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarCenter: { flex: 1, minWidth: 0, marginHorizontal: spacing.xs, alignItems: 'flex-end' },
  topBarActions: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(2,6,4,0.62)', flexDirection: 'row-reverse' },
  panel: {
    width: 300,
    maxWidth: '84%',
    borderLeftWidth: 1,
    height: '100%',
  },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl + 40 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '800' },
  appName: { fontSize: 15.5, fontWeight: '800' },
  planLine: { fontSize: 11.5, marginTop: 2 },
  closeBtn: { padding: 4 },
  section: { marginTop: spacing.sm + 2, marginBottom: spacing.sm + 4 },
  sectionTitle: { fontSize: 11.5, fontWeight: '700', marginBottom: spacing.xs + 1 },
  navItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm - 2,
    paddingVertical: 10.5,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 2,
  },
  navLabel: { flex: 1, fontSize: 14, fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  sessionRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm - 2,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm,
  },
  sessionTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  allChatsRow: {
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.28)',
  },
  newChatBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm - 2,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  newChatBtnText: { fontSize: 14, fontWeight: '800' },
  themeRow: { flexDirection: 'row-reverse', gap: spacing.xs + 2 },
  themeChip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 2,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  foot: { fontSize: 11, marginTop: spacing.md, textAlign: 'center' },
});
