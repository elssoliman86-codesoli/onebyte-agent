import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useAssistant } from '@/src/assistant';
import { useWorkspace } from '@/src/workspace';
import { formatContext } from '@/src/model-catalog';
import { DesktopActivity as DesktopActivityPanel } from './DesktopActivity';
import { DesktopInspector as DesktopInspectorPanel } from './DesktopInspector';
import { CommandPalette as CommandPaletteLayer } from './CommandPalette';
import { useWideViewport } from './useDesktopViewport';
import { timeAgo } from './shared';
import {
  desktopColors,
  desktopLayout,
  desktopRadius,
  desktopSpacing,
  desktopTypography,
  withAlpha,
} from './DesktopTokens';

/* ─────────────────────────── navigation model ─────────────────────────── */

type NavKey =
  | 'index'
  | 'tasks'
  | 'skills'
  | 'memory'
  | 'github'
  | 'approvals'
  | 'assessments'
  | 'findings'
  | 'settings';

const NAV_ITEMS: {
  key: NavKey;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}[] = [
  { key: 'index', label: 'الرئيسية', icon: 'home' },
  { key: 'tasks', label: 'المهام', icon: 'calendar' },
  { key: 'skills', label: 'المهارات', icon: 'zap' },
  { key: 'memory', label: 'الذاكرة', icon: 'database' },
  { key: 'github', label: 'مشاريع GitHub', icon: 'github' },
  { key: 'approvals', label: 'الموافقات', icon: 'shield' },
  { key: 'assessments', label: 'التقييمات', icon: 'clipboard' },
  { key: 'findings', label: 'النتائج', icon: 'alert-triangle' },
  { key: 'settings', label: 'الإعدادات', icon: 'settings' },
];

/** Real routes only — every item navigates to an existing Expo Router screen. */
function navigate(key: NavKey): void {
  if (key === 'index') {
    router.push('/(tabs)');
    return;
  }
  router.push(`/(tabs)/${key}`);
}

function keyFromPath(pathname: string): NavKey {
  const clean = pathname.replace(/^\/\(tabs\)/, '').replace(/^\//, '');
  if (!clean) return 'index';
  return (NAV_ITEMS.find((n) => n.key === clean)?.key ?? 'index') as NavKey;
}

/* ─────────────────────────── tooltip ─────────────────────────── */

function IconTooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: string;
  children: React.ReactNode;
  side?: 'bottom' | 'right';
}) {
  const [hover, setHover] = useState(false);
  const webHoverProps =
    Platform.OS === 'web'
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onMouseEnter: (() => setHover(true)) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onMouseLeave: (() => setHover(false)) as any,
        }
      : {};
  return (
    <View style={styles.tooltipHost} {...webHoverProps}>
      {children}
      {hover ? (
        <View
          style={[
            styles.tooltip,
            side === 'right' ? styles.tooltipRight : styles.tooltipBottom,
          ]}
        >
          <Text style={styles.tooltipText}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ─────────────────────────── top bar ─────────────────────────── */

function DesktopTopBar({
  sidebarCollapsed,
  onToggleSidebar,
  onToggleInspector,
  inspectorVisible,
  onToggleActivity,
  activityVisible,
  onOpenPalette,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  inspectorVisible: boolean;
  onToggleActivity: () => void;
  activityVisible: boolean;
  onOpenPalette: () => void;
}) {
  const { activeSession, provider, apiKeyConfigured } = useAssistant();
  const { approvals } = useWorkspace();
  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === 'pending').length,
    [approvals],
  );
  const connected = Boolean(provider.keyless) || apiKeyConfigured;
  const hasModel = Boolean(provider.model.trim());
  const ctx = provider.contextLength ? ` · ${formatContext(provider.contextLength)}` : '';

  return (
    <View style={styles.topBar}>
      <View style={styles.topBarSide}>
        <IconTooltip label={sidebarCollapsed ? 'إظهار الشريط الجانبي' : 'إخفاء الشريط الجانبي'}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تبديل الشريط الجانبي"
            onPress={onToggleSidebar}
            style={styles.topBarBtn}
          >
            <Feather name="menu" size={17} color={desktopColors.textMuted} />
          </Pressable>
        </IconTooltip>
        <View style={styles.sessionChip}>
          <Text style={styles.sessionChipText} numberOfLines={1}>
            {activeSession?.title?.trim() || 'OneByte Agent'}
          </Text>
        </View>
      </View>

      <View style={styles.topBarCenter}>
        <View style={styles.modelChip}>
          <View style={styles.modelChipIcon}>
            <Feather name="zap" size={12} color={desktopColors.accentHover} />
          </View>
          <View style={styles.modelChipCopy}>
            <Text style={styles.modelChipName} numberOfLines={1}>
              {hasModel ? provider.model : 'لم يتم اختيار موديل'}
            </Text>
            <Text style={styles.modelChipSub} numberOfLines={1}>
              {`${provider.providerName || 'مزود'}${ctx}`}
            </Text>
          </View>
        </View>
        <View style={styles.connection}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? desktopColors.success : desktopColors.warning },
            ]}
          />
          <Text style={styles.connectionText}>{connected ? 'متصل' : 'غير مضبوط'}</Text>
        </View>
      </View>

      <View style={[styles.topBarSide, styles.topBarSideEnd]}>
        <IconTooltip label="بحث (Ctrl+K)">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="لوحة الأوامر"
            onPress={onOpenPalette}
            style={styles.topBarBtn}
          >
            <Feather name="search" size={16} color={desktopColors.textMuted} />
          </Pressable>
        </IconTooltip>
        <IconTooltip label={activityVisible ? 'إخفاء سجل التنفيذ' : 'سجل التنفيذ'}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تبديل سجل التنفيذ"
            onPress={onToggleActivity}
            style={[styles.topBarBtn, activityVisible && styles.topBarBtnActive]}
          >
            <Feather
              name="terminal"
              size={16}
              color={activityVisible ? desktopColors.accentHover : desktopColors.textMuted}
            />
          </Pressable>
        </IconTooltip>
        <IconTooltip label={pendingApprovals > 0 ? `${pendingApprovals} موافقات معلّقة` : 'الموافقات'}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="الموافقات"
            onPress={() => navigate('approvals')}
            style={styles.topBarBtn}
          >
            <Feather name="bell" size={16} color={desktopColors.textMuted} />
            {pendingApprovals > 0 ? <View style={styles.bellBadge} /> : null}
          </Pressable>
        </IconTooltip>
        <IconTooltip label="الإعدادات (Ctrl+,)">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="الإعدادات"
            onPress={() => navigate('settings')}
            style={styles.topBarBtn}
          >
            <Feather name="settings" size={16} color={desktopColors.textMuted} />
          </Pressable>
        </IconTooltip>
        <IconTooltip label={inspectorVisible ? 'إخفاء اللوحة الجانبية' : 'اللوحة الجانبية'}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تبديل لوحة التفاصيل"
            onPress={onToggleInspector}
            style={[styles.topBarBtn, inspectorVisible && styles.topBarBtnActive]}
          >
            <Feather
              name="sidebar"
              size={16}
              color={inspectorVisible ? desktopColors.accentHover : desktopColors.textMuted}
            />
          </Pressable>
        </IconTooltip>
      </View>
    </View>
  );
}

/* ─────────────────────────── sidebar ─────────────────────────── */

function DesktopSidebar({
  collapsed,
  onNewChat,
}: {
  collapsed: boolean;
  onNewChat: () => void;
}) {
  const pathname = usePathname();
  const activeKey = keyFromPath(pathname);
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    deleteSession,
    provider,
    apiKeyConfigured,
  } = useAssistant();

  const connected = Boolean(provider.keyless) || apiKeyConfigured;

  if (collapsed) {
    return (
      <View style={[styles.sidebar, styles.sidebarCollapsed]}>
        <View style={styles.brandMark}>
          <Feather name="cpu" size={15} color="#FFFFFF" />
        </View>
        <ScrollView contentContainerStyle={styles.navList} showsVerticalScrollIndicator={false}>
          {NAV_ITEMS.map((item) => (
            <IconTooltip key={item.key} label={item.label} side="right">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => navigate(item.key)}
                style={[
                  styles.navBtnCollapsed,
                  activeKey === item.key && styles.navBtnCollapsedActive,
                ]}
              >
                <Feather
                  name={item.icon}
                  size={17}
                  color={activeKey === item.key ? desktopColors.accentHover : desktopColors.textMuted}
                />
              </Pressable>
            </IconTooltip>
          ))}
        </ScrollView>
        <IconTooltip label="محادثة جديدة (Ctrl+N)" side="right">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="محادثة جديدة"
            onPress={onNewChat}
            style={styles.newChatCollapsed}
          >
            <Feather name="plus" size={17} color="#FFFFFF" />
          </Pressable>
        </IconTooltip>
      </View>
    );
  }

  return (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Feather name="cpu" size={15} color="#FFFFFF" />
        </View>
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>OneByte</Text>
          <Text style={styles.brandSub}>AI AGENT</Text>
        </View>
      </View>

      <ScrollView
        style={styles.sidebarScroll}
        contentContainerStyle={styles.navList}
        showsVerticalScrollIndicator={false}
      >
        {NAV_ITEMS.map((item) => {
          const active = activeKey === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => navigate(item.key)}
              style={(state) => {
                const s = state as { hovered?: boolean; focused?: boolean };
                return [
                  styles.navBtn,
                  (s.hovered || s.focused) && styles.navBtnHover,
                  active && styles.navBtnActive,
                ];
              }}
            >
              <View style={[styles.navIconBox, active && styles.navIconBoxActive]}>
                <Feather
                  name={item.icon}
                  size={15}
                  color={active ? desktopColors.accentHover : desktopColors.textMuted}
                />
              </View>
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}

        <View style={styles.sessionsHead}>
          <Text style={styles.sectionLabel}>المحادثات الأخيرة</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="عرض كل المحادثات"
            onPress={() => navigate('index')}
          >
            <Text style={styles.viewAll}>عرض الكل</Text>
          </Pressable>
        </View>

        {sessions.length === 0 ? (
          <Text style={styles.emptySessions}>لا محادثات بعد</Text>
        ) : (
          sessions.slice(0, 12).map((session) => {
            const active = session.id === activeSessionId;
            return (
              <View key={session.id} style={styles.sessionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`فتح ${session.title}`}
                  onPress={() => {
                    void setActiveSession(session.id);
                    router.push('/(tabs)');
                  }}
                  style={(state) => {
                    const s = state as { hovered?: boolean; focused?: boolean };
                    return [
                      styles.sessionBtn,
                      active && styles.sessionBtnActive,
                      (s.hovered || s.focused) && !active && styles.navBtnHover,
                    ];
                  }}
                >
                  <Text
                    style={[styles.sessionTitle, active && styles.sessionTitleActive]}
                    numberOfLines={1}
                  >
                    {session.title || 'محادثة'}
                  </Text>
                  <Text style={styles.sessionWhen}>{timeAgo(session.updatedAt)}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`حذف ${session.title}`}
                  onPress={() => void deleteSession(session.id)}
                  style={styles.sessionDelete}
                >
                  <Feather name="trash-2" size={13} color={desktopColors.error} />
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="حالة المزود — فتح الإعدادات"
        onPress={() => navigate('settings')}
        style={styles.statusCard}
      >
        <View style={styles.statusCardIcon}>
          <Feather name="monitor" size={14} color={desktopColors.accentHover} />
        </View>
        <View style={styles.statusCardCopy}>
          <Text style={styles.statusCardTitle} numberOfLines={1}>
            {provider.providerName || 'المزود'}
          </Text>
          <View style={styles.statusCardRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: connected ? desktopColors.success : desktopColors.warning },
              ]}
            />
            <Text style={styles.statusCardSub}>
              {connected ? 'متصل · مستقل عن الهاتف' : 'غير مضبوط — أكمل الإعدادات'}
            </Text>
          </View>
        </View>
        <Feather name="chevron-left" size={13} color={desktopColors.textMuted} />
      </Pressable>
    </View>
  );
}

/* ─────────────────────────── shell ─────────────────────────── */

export function DesktopShell({ children }: { children?: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activityVisible, setActivityVisible] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectorOverride, setInspectorOverride] = useState<boolean | null>(null);
  const wideEnough = useWideViewport();

  // Default: inspector open only when the viewport is wide enough.
  const inspectorShown = inspectorOverride === null ? wideEnough : inspectorOverride;

  const { createSession } = useAssistant();
  const handleNewChat = useCallback(() => {
    void (async () => {
      await createSession();
      router.push('/(tabs)');
    })();
  }, [createSession]);

  // Global keyboard shortcuts (web only). Ctrl-combos do not interfere with text editing.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (e.key === 'Escape' && paletteOpen) setPaletteOpen(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (k === 'n') {
        e.preventDefault();
        handleNewChat();
      } else if (k === ',') {
        e.preventDefault();
        navigate('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, handleNewChat]);

  return (
    <View style={styles.shell}>
      <DesktopSidebar collapsed={sidebarCollapsed} onNewChat={handleNewChat} />
      <View style={styles.centerColumn}>
        <DesktopTopBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          inspectorVisible={inspectorShown}
          onToggleInspector={() => setInspectorOverride(!inspectorShown)}
          activityVisible={activityVisible}
          onToggleActivity={() => setActivityVisible((v) => !v)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <View style={styles.workspace}>
          {/* ambient emerald glow behind the workspace (decorative only) */}
          <View style={styles.ambientTop} pointerEvents="none" />
          <View style={styles.ambientCorner} pointerEvents="none" />
          {children}
        </View>
        {activityVisible ? <DesktopActivityPanel /> : null}
      </View>
      {inspectorShown ? (
        <View style={styles.inspector}>
          <DesktopInspectorPanel />
        </View>
      ) : null}
      {paletteOpen ? <CommandPaletteLayer onClose={() => setPaletteOpen(false)} /> : null}
    </View>
  );
}

export default DesktopShell;

/* ─────────────────────────── styles ─────────────────────────── */

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row-reverse',
    backgroundColor: desktopColors.background,
  },
  centerColumn: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
  },
  inspector: {
    width: desktopLayout.inspectorWidth,
    flexShrink: 0,
    borderLeftWidth: 1,
    borderLeftColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
  },
  workspace: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  ambientTop: {
    position: 'absolute',
    top: -140,
    left: '20%',
    width: 420,
    height: 320,
    borderRadius: desktopRadius.full,
    backgroundColor: 'rgba(16, 185, 129, 0.07)',
  },
  ambientCorner: {
    position: 'absolute',
    top: -120,
    left: -160,
    width: 300,
    height: 300,
    borderRadius: desktopRadius.full,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },

  /* top bar */
  topBar: {
    height: 52,
    flexShrink: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: desktopSpacing.md,
    gap: desktopSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
  },
  topBarSide: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
  },
  topBarSideEnd: { flexDirection: 'row' },
  topBarBtn: {
    width: 32,
    height: 32,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBtnActive: { backgroundColor: desktopColors.accentSoft },
  bellBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: desktopColors.warning,
  },
  sessionChip: {
    maxWidth: 260,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: desktopRadius.sm,
    backgroundColor: desktopColors.surfaceSecondary,
    borderWidth: 1,
    borderColor: desktopColors.border,
  },
  sessionChipText: { ...desktopTypography.small, color: desktopColors.text },
  topBarCenter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.md,
    minWidth: 0,
  },
  modelChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    maxWidth: 300,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: desktopRadius.md,
    backgroundColor: desktopColors.surfaceSecondary,
    borderWidth: 1,
    borderColor: desktopColors.borderStrong,
  },
  modelChipIcon: {
    width: 24,
    height: 24,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accentSoft,
  },
  modelChipCopy: { flexShrink: 1 },
  modelChipName: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '700' },
  modelChipSub: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  connection: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  connectionText: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  /* sidebar */
  sidebar: {
    width: desktopLayout.sidebarWidth,
    flexShrink: 0,
    flexDirection: 'column',
    borderRightWidth: 1,
    borderRightColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
  },
  sidebarCollapsed: {
    width: desktopLayout.sidebarWidthCollapsed,
    alignItems: 'center',
    paddingVertical: desktopSpacing.sm,
  },
  brand: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    padding: desktopSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: desktopColors.border,
    alignSelf: 'stretch',
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: desktopRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accent,
  },
  brandCopy: { flexShrink: 1 },
  brandName: { ...desktopTypography.h3, color: desktopColors.text, fontWeight: '700' },
  brandSub: { ...desktopTypography.tiny, color: desktopColors.textMuted, letterSpacing: 1.2 },
  sidebarScroll: { flex: 1, minHeight: 0 },
  navList: { padding: desktopSpacing.sm, gap: 3 },
  navBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingHorizontal: desktopSpacing.sm,
    paddingVertical: 7,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navBtnHover: { backgroundColor: desktopColors.surfaceSecondary },
  navBtnActive: {
    backgroundColor: desktopColors.accentSoft,
    borderColor: desktopColors.borderStrong,
  },
  navIconBox: {
    width: 26,
    height: 26,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconBoxActive: { backgroundColor: withAlpha(desktopColors.accent, 0.16) },
  navLabel: { ...desktopTypography.body, color: desktopColors.textMuted, flexShrink: 1 },
  navLabelActive: { color: desktopColors.accentHover, fontWeight: '700' },
  navBtnCollapsed: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: desktopRadius.sm,
    marginVertical: 2,
  },
  navBtnCollapsedActive: { backgroundColor: desktopColors.accentSoft },
  sessionsHead: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: desktopSpacing.sm,
    marginTop: desktopSpacing.md,
    marginBottom: 4,
  },
  sectionLabel: {
    ...desktopTypography.tiny,
    color: desktopColors.textMuted,
    letterSpacing: 0.6,
  },
  viewAll: { ...desktopTypography.tiny, color: desktopColors.accentHover },
  emptySessions: {
    ...desktopTypography.small,
    color: desktopColors.textMuted,
    textAlign: 'center',
    paddingVertical: desktopSpacing.sm,
  },
  sessionRow: { flexDirection: 'row-reverse', alignItems: 'center' },
  sessionBtn: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: desktopSpacing.sm,
    paddingHorizontal: desktopSpacing.sm,
    paddingVertical: 8,
    borderRadius: desktopRadius.sm,
  },
  sessionBtnActive: { backgroundColor: desktopColors.accentSoft },
  sessionTitle: { ...desktopTypography.small, color: desktopColors.text, flexShrink: 1 },
  sessionTitleActive: { color: desktopColors.accentHover, fontWeight: '700' },
  sessionWhen: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  sessionDelete: { padding: 5 },

  /* sidebar bottom status card */
  statusCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    margin: desktopSpacing.sm,
    marginTop: 0,
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surfaceSecondary,
  },
  statusCardIcon: {
    width: 30,
    height: 30,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accentSoft,
  },
  statusCardCopy: { flexShrink: 1, gap: 1 },
  statusCardTitle: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '700' },
  statusCardRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  statusCardSub: { ...desktopTypography.tiny, color: desktopColors.textMuted, flexShrink: 1 },

  /* new chat (collapsed rail only) */
  newChatCollapsed: {
    width: 34,
    height: 34,
    borderRadius: desktopRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accent,
    margin: desktopSpacing.sm,
  },

  /* tooltip */
  tooltipHost: { position: 'relative' as never },
  tooltip: {
    position: 'absolute',
    backgroundColor: '#03100B',
    borderWidth: 1,
    borderColor: desktopColors.borderStrong,
    borderRadius: desktopRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 60,
  },
  tooltipBottom: { top: 34, right: -6 },
  tooltipRight: { right: 46, top: 7 },
  tooltipText: { ...desktopTypography.tiny, color: desktopColors.text },
});
