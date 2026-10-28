import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAssistant, type ToolStep } from '@/src/assistant';
import { useWorkspace } from '@/src/workspace';
import {
  desktopColors,
  desktopRadius,
  desktopSpacing,
  desktopTypography,
  withAlpha,
} from './DesktopTokens';
import { STEP_META_ROW } from './shared';

/**
 * Bottom panel: real execution events only.
 * - Tool timeline: steps persisted on the active session's messages.
 * - Pending workspace approvals.
 * - Active tasks (as created by the model or the user).
 * No fabricated counters, no fake terminal — labelled "سجل التنفيذ".
 */
export function DesktopActivity() {
  const { activeSession, tasks, storageError } = useAssistant();
  const { approvals } = useWorkspace();

  const timeline = useMemo(() => {
    const events: { step: ToolStep; at: string }[] = [];
    for (const message of activeSession?.messages ?? []) {
      if (message.role === 'assistant' && message.steps) {
        for (const step of message.steps) {
          events.push({ step, at: message.createdAt });
        }
      }
    }
    return events.reverse().slice(0, 40);
  }, [activeSession?.messages]);

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === 'pending'),
    [approvals],
  );
  const activeTasks = useMemo(() => tasks.filter((t) => t.active), [tasks]);

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Feather name="activity" size={13} color={desktopColors.accentHover} />
        <Text style={styles.headText}>سجل التنفيذ</Text>
        <Text style={styles.headMeta}>
          {timeline.length} حدث · {pendingApprovals.length} موافقة معلّقة
        </Text>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {storageError ? (
          <Text style={styles.storageError}>⚠️ {storageError}</Text>
        ) : null}

        {pendingApprovals.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>موافقات مسجّلة معلّقة</Text>
            {pendingApprovals.map((approval) => (
              <View key={approval.id} style={styles.approvalRow}>
                <Feather name="clock" size={12} color={desktopColors.warning} />
                <Text style={styles.approvalAction} numberOfLines={1}>{approval.action}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {timeline.length === 0 && activeTasks.length === 0 ? (
          <Text style={styles.empty}>لا أحداث بعد — ابدأ مهمة من الشات.</Text>
        ) : null}

        {timeline.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>أدوات نفّذها الوكيل</Text>
            {timeline.map(({ step, at }) => {
              const meta = STEP_META_ROW[step.status];
              return (
                <View key={`${step.id}-${at}`} style={styles.stepRow}>
                  <Feather name={meta.icon} size={11} color={meta.color} />
                  <Text style={styles.stepTool} numberOfLines={1}>{step.tool}</Text>
                  <Text style={styles.stepAt} numberOfLines={1}>{at.slice(11, 16)}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {activeTasks.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>مهام نشطة</Text>
            {activeTasks.slice(0, 10).map((task) => (
              <View key={task.id} style={styles.stepRow}>
                <Feather name="calendar" size={11} color={desktopColors.textMuted} />
                <Text style={styles.stepTool} numberOfLines={1}>{task.title}</Text>
                <Text style={styles.stepAt}>{task.time}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
    maxHeight: 240,
  },
  head: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingHorizontal: desktopSpacing.lg,
    paddingVertical: desktopSpacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(desktopColors.border, 0.6),
  },
  headText: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '700' },
  headMeta: { ...desktopTypography.tiny, color: desktopColors.textMuted, flexShrink: 1 },
  body: { minHeight: 90 },
  bodyContent: { padding: desktopSpacing.md, gap: desktopSpacing.md },
  storageError: { ...desktopTypography.small, color: desktopColors.warning, textAlign: 'right' },
  section: { gap: 4 },
  sectionLabel: {
    ...desktopTypography.tiny,
    color: desktopColors.textMuted,
    textAlign: 'right',
    letterSpacing: 0.5,
  },
  approvalRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingVertical: 2,
  },
  approvalAction: { ...desktopTypography.small, color: desktopColors.warning, flexShrink: 1 },
  stepRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingVertical: 2,
  },
  stepTool: { ...desktopTypography.small, color: desktopColors.text, flexShrink: 1 },
  stepAt: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  empty: {
    ...desktopTypography.small,
    color: desktopColors.textMuted,
    textAlign: 'center',
    paddingVertical: desktopSpacing.lg,
  },
});
