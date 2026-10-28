import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAssistant } from '@/src/assistant';
import { useWorkspace } from '@/src/workspace';
import { requestPrefill, setRunStateSink, timeAgo, type FeatherIcon } from './shared';
import {
  desktopColors,
  desktopRadius,
  desktopSpacing,
  desktopTypography,
  withAlpha,
} from './DesktopTokens';

/**
 * Right rail — mirrors the approved mockup (Quick Tools / الحالة الآن /
 * حالة النظام) but is fed exclusively by real assistant & workspace state:
 * quick tools drive the composer or navigate; status rows reflect actual
 * provider configuration and runtime availability. No fabricated counters,
 * no fake storage bars, no Android-only capabilities advertised as working.
 */

function Section({
  icon,
  title,
  children,
  defaultOpen = true,
}: {
  icon: FeatherIcon;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`تبديل قسم ${title}`}
        onPress={() => setOpen((v) => !v)}
        style={styles.cardHead}
      >
        <Feather name={icon} size={13} color={desktopColors.accentHover} />
        <Text style={styles.cardTitle}>{title}</Text>
        <Feather
          name={open ? 'chevron-up' : 'chevron-down'}
          size={13}
          color={desktopColors.textMuted}
        />
      </Pressable>
      {open ? <View style={styles.cardBody}>{children}</View> : null}
    </View>
  );
}

function ToolRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: FeatherIcon;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={(state) => {
        const s = state as { hovered?: boolean; focused?: boolean };
        return [styles.toolRow, (s.hovered || s.focused) && styles.toolRowHover];
      }}
    >
      <View style={styles.toolRowIcon}>
        <Feather name={icon} size={13} color={desktopColors.accentHover} />
      </View>
      <View style={styles.toolRowCopy}>
        <Text style={styles.toolRowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.toolRowSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Feather name="chevron-left" size={12} color={desktopColors.textMuted} />
    </Pressable>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'muted';
}) {
  const color =
    tone === 'ok' ? desktopColors.success : tone === 'warn' ? desktopColors.warning : desktopColors.textMuted;
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusRowLabel}>{label}</Text>
      <View style={styles.statusRowValue}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.statusRowText, { color }]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

export function DesktopInspector() {
  const {
    activeSession,
    provider,
    skills,
    memories,
    tasks,
    agent,
    apiKeyConfigured,
    storageError,
  } = useAssistant();
  const { approvals } = useWorkspace();
  const [agentRunning, setAgentRunning] = useState(false);

  // Live run state comes from the real agent runner (DesktopChat publishes
  // start/stop through the shared desktop event channel).
  useEffect(() => {
    setRunStateSink(setAgentRunning);
    return () => setRunStateSink(null);
  }, []);

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === 'pending'),
    [approvals],
  );
  const activeSkills = useMemo(() => skills.filter((s) => s.active), [skills]);
  const activeMemories = useMemo(() => memories.filter((m) => m.active), [memories]);
  const activeTasks = useMemo(() => tasks.filter((t) => t.active), [tasks]);

  const connected = Boolean(provider.keyless) || apiKeyConfigured;

  const lastEventAt = useMemo(() => {
    const msgs = activeSession?.messages ?? [];
    return msgs.length ? msgs[msgs.length - 1].createdAt : null;
  }, [activeSession?.messages]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Section icon="zap" title="أدوات سريعة">
        <ToolRow
          icon="search"
          title="بحث في الويب"
          subtitle="ابحث واجمع النتائج لمهمتك"
          onPress={() => {
            router.push('/(tabs)');
            requestPrefill({ text: 'ابحث في الويب عن: ', focus: true });
          }}
        />
        <ToolRow
          icon="link"
          title="قراءة رابط"
          subtitle="لخّص صفحة ويب كاملة"
          onPress={() => {
            router.push('/(tabs)');
            requestPrefill({ text: 'اقرأ هذه الصفحة ولخّصها: ', focus: true });
          }}
        />
        <ToolRow
          icon="database"
          title="حفظ ذكرى"
          subtitle="ذاكرة دائمة يعيد الوكيل استخدامها"
          onPress={() => router.push('/(tabs)/memory')}
        />
        <ToolRow
          icon="file-text"
          title="إدارة المهارات"
          subtitle={`${activeSkills.length} مهارة نشطة`}
          onPress={() => router.push('/(tabs)/skills')}
        />
        <ToolRow
          icon="sliders"
          title="الموديل والإعدادات"
          subtitle={connected ? `${provider.providerName} · ${provider.model}` : 'أكمل الإعداد أولًا'}
          onPress={() => router.push('/(tabs)/settings')}
        />
      </Section>

      <Section icon="activity" title="الحالة الآن">
        <StatusRow
          label="الوكيل"
          value={agentRunning ? 'جارٍ التنفيذ…' : 'خامل — جاهز'}
          tone={agentRunning ? 'ok' : 'muted'}
        />
        <StatusRow
          label="المزود"
          value={connected ? 'متصل' : 'غير مضبوط'}
          tone={connected ? 'ok' : 'warn'}
        />
        <StatusRow
          label="موافقات معلّقة"
          value={String(pendingApprovals.length)}
          tone={pendingApprovals.length ? 'warn' : 'muted'}
        />
        <StatusRow label="مهام نشطة" value={String(activeTasks.length)} tone="muted" />
        <StatusRow
          label="آخر نشاط"
          value={lastEventAt ? timeAgo(lastEventAt) : '—'}
          tone="muted"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="فتح شاشة الموافقات"
          onPress={() => router.push('/(tabs)/approvals')}
          style={styles.linkRow}
        >
          <Text style={styles.linkText}>فتح شاشة الموافقات</Text>
          <Feather name="chevron-left" size={12} color={desktopColors.accentHover} />
        </Pressable>
      </Section>

      <Section icon="monitor" title="حالة النظام">
        <StatusRow
          label="المفاتيح"
          value={connected ? 'محفوظة على هذا الجهاز' : 'غير محفوظة بعد'}
          tone={connected ? 'ok' : 'warn'}
        />
        <StatusRow label="أدوات الويب والذاكرة" value="متاحة" tone="ok" />
        {/* Honest platform rows — Android features are NOT advertised as working here. */}
        <StatusRow label="تحكم الجهاز" value="يتطلب تطبيق الهاتف" tone="muted" />
        <StatusRow label="خادم الهاتف" value="غير مستخدم في وضع سطح المكتب" tone="muted" />
        <Text style={styles.systemNote}>
          وضع سطح المكتب يعمل بمحرك التطبيق نفسه على المتصفح — بلا اعتماد على الهاتف.
        </Text>
      </Section>

      <View style={styles.agentCard}>
        <View style={styles.cardHead}>
          <Feather name="settings" size={13} color={desktopColors.textMuted} />
          <Text style={styles.cardTitle}>حدود الوكيل</Text>
        </View>
        <Text style={styles.meta}>أقصى خطوات: {agent.maxSteps}</Text>
        <Text style={styles.meta}>
          ميزانية العمل: {agent.maxWorkingTokens.toLocaleString('en')} توكن
        </Text>
        <Text style={styles.meta}>
          أدوات معتمدة دائمًا: {agent.autoApprovedTools.length}
        </Text>
      </View>

      {storageError ? (
        <View style={styles.errorCard}>
          <Feather name="alert-triangle" size={13} color={desktopColors.error} />
          <Text style={styles.errorText}>{storageError}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { padding: desktopSpacing.md, gap: desktopSpacing.md },
  card: {
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surfaceSecondary,
    padding: desktopSpacing.md,
  },
  cardHead: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
  },
  cardTitle: {
    ...desktopTypography.small,
    color: desktopColors.text,
    fontWeight: '700',
    flexShrink: 1,
  },
  cardBody: { marginTop: desktopSpacing.sm, gap: 4 },
  toolRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    padding: 7,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: withAlpha(desktopColors.background, 0.5),
  },
  toolRowHover: { borderColor: desktopColors.borderStrong, backgroundColor: desktopColors.surfaceRaised },
  toolRowIcon: {
    width: 28,
    height: 28,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accentSoft,
  },
  toolRowCopy: { flexShrink: 1, gap: 1 },
  toolRowTitle: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '600' },
  toolRowSub: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  statusRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  statusRowLabel: { ...desktopTypography.small, color: desktopColors.textMuted },
  statusRowValue: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  statusRowText: { ...desktopTypography.small, flexShrink: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  linkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
  },
  linkText: { ...desktopTypography.small, color: desktopColors.accentHover, fontWeight: '600' },
  systemNote: {
    ...desktopTypography.tiny,
    color: desktopColors.textMuted,
    textAlign: 'right',
    marginTop: 4,
    lineHeight: 15,
  },
  agentCard: {
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surfaceSecondary,
    padding: desktopSpacing.md,
    gap: 2,
  },
  meta: { ...desktopTypography.small, color: desktopColors.textMuted },
  errorCard: {
    flexDirection: 'row-reverse',
    gap: desktopSpacing.sm,
    alignItems: 'flex-start',
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.error, 0.55),
    backgroundColor: withAlpha(desktopColors.error, 0.08),
  },
  errorText: { ...desktopTypography.small, color: desktopColors.text, flexShrink: 1 },
});

export default DesktopInspector;
