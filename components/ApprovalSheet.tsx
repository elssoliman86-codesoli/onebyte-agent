import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { describeCall, type ToolSpec } from '@/src/tools';
import type { ApprovalDecision } from '@/src/agent';

export interface PendingApproval {
  spec: ToolSpec;
  args: Record<string, unknown>;
  resolve: (decision: ApprovalDecision) => void;
}

export function ApprovalSheet({ pending }: { pending: PendingApproval | null }) {
  const colors = useColors();
  if (!pending) return null;
  const { spec, args, resolve } = pending;
  const icon =
    spec.group === 'device_read'
      ? 'eye'
      : spec.group === 'memory'
        ? 'bookmark'
        : spec.group === 'net'
          ? 'globe'
          : 'smartphone';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => resolve('deny')}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.foreground }]}>المساعد يطلب إذنك</Text>
            <View style={[styles.icon, { backgroundColor: colors.accent }]}>
              <Feather name={icon} size={18} color={colors.primary} />
            </View>
          </View>
          <Text style={[styles.action, { color: colors.foreground }]}>{spec.label}</Text>
          <View style={[styles.args, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.argsText, { color: colors.foreground }]}>{describeCall(spec.name, args)}</Text>
          </View>
          {spec.group === 'device_read' ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              سيُرسل ما يظهر على الشاشة (بدون كلمات المرور) إلى مزود الموديل. تأكد أن الشاشة لا تعرض بيانات لا تريد مشاركتها.
            </Text>
          ) : null}
          <Pressable
            onPress={() => resolve('once')}
            style={[styles.btn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.btnText, { color: colors.primaryForeground }]}>موافق (هذه المرة فقط)</Text>
          </Pressable>
          <Pressable
            onPress={() => resolve('turn')}
            style={[styles.btn, { backgroundColor: colors.secondary }]}
          >
            <Text style={[styles.btnText, { color: colors.secondaryForeground }]}>
              موافق على هذه الأداة حتى تنتهي المهمة
            </Text>
          </Pressable>
          <Pressable onPress={() => resolve('deny')} style={styles.btn}>
            <Text style={[styles.btnText, { color: colors.destructive }]}>رفض</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(4,13,10,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, gap: 12 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  action: { fontSize: 15, fontWeight: '700', textAlign: 'right' },
  args: { borderWidth: 1, borderRadius: 12, padding: 12 },
  argsText: { fontSize: 12, lineHeight: 19, textAlign: 'left', writingDirection: 'ltr' },
  note: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
  btn: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
