import React, { useMemo, useState } from 'react';
import {
    Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';
import { useAssistant, type AssistantMemory } from '@/src/assistant';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import type { KnowledgeEntry } from '@/src/knowledge';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

const emptyMemory = { title: '', content: '' };

export default function MemoryScreen() {
  const colors = useColors();
  const {
    memories,
    knowledge,
    clearKnowledge,
    createMemory,
    updateMemory,
    setMemoryActive,
  } = useAssistant();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<AssistantMemory | null>(null);
  const [form, setForm] = useState(emptyMemory);
  const activeMemories = useMemo(
    () => memories.filter((memory) => memory.active),
    [memories],
  );
  const archivedMemories = useMemo(
    () => memories.filter((memory) => !memory.active),
    [memories],
  );

  function openNew() {
    setSelected(null);
    setForm(emptyMemory);
    setVisible(true);
  }

  function openEdit(memory: AssistantMemory) {
    setSelected(memory);
    setForm({ title: memory.title, content: memory.content });
    setVisible(true);
  }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) {
      alertCompat('أكملي البيانات', 'اكتبي عنوان المعلومة وتفاصيلها.');
      return;
    }
    try {
      if (selected) await updateMemory(selected.id, form);
      else await createMemory(form);
      setVisible(false);
    } catch {
      alertCompat('لم يتم حفظ المعلومة', 'حاولي مرة أخرى.');
    }
  }

  function renderMemory(memory: AssistantMemory) {
    return (
      <Surface key={memory.id} style={styles.memoryCard}>
        <View style={styles.memoryHeader}>
          <View style={[styles.memoryIcon, { backgroundColor: colors.accentSubtle }]}>
            <Feather name="bookmark" size={16} color={colors.primary} />
          </View>
          <Text style={[styles.memoryTitle, { color: colors.foreground }]}>
            {memory.title}
          </Text>
          <StatusPill
            label={memory.active ? 'تُستخدم في الشات' : 'مؤرشفة'}
            tone={memory.active ? 'success' : 'neutral'}
          />
        </View>
        <Text style={[styles.memoryContent, { color: colors.mutedForeground }]}>
          {memory.content}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => openEdit(memory)}
            style={styles.smallAction}
          >
            <Feather name="edit-2" size={14} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>تعديل</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void setMemoryActive(memory.id, !memory.active).catch(() =>
                alertCompat('تعذّر حفظ التغيير', 'حاولي مرة أخرى.'),
              )
            }
            style={styles.smallAction}
          >
            <Feather
              name={memory.active ? 'archive' : 'rotate-ccw'}
              size={14}
              color={colors.mutedForeground}
            />
            <Text style={[styles.actionText, { color: colors.mutedForeground }]}>
              {memory.active ? 'أرشفة' : 'استعادة'}
            </Text>
          </Pressable>
        </View>
      </Surface>
    );
  }

  return (
    <>
      <AppScreen
        title="ذاكرة المساعد"
        eyebrow="معلومات تفضل تفضل معاك"
        subtitle="احفظي تفاصيل عن شغلك أو تفضيلاتك عشان تدخل في سياق المحادثة."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إضافة إلى الذاكرة"
            onPress={openNew}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
          </Pressable>
        }
        topBar={<ScreenTopBar active="memory" />}
      >
        <Surface style={styles.infoCard}>
          <Feather name="shield" size={18} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.foreground }]}>
            الذاكرة منفصلة عن المهارات. أرشفة أو تعديل مهارة لا يمسح المعلومات المحفوظة هنا.
          </Text>
        </Surface>
        <View style={styles.section}>
          <SectionTitle title={`نشطة (${activeMemories.length})`} />
          {activeMemories.length ? (
            activeMemories.map(renderMemory)
          ) : (
            <EmptyState
              icon="bookmark"
              title="الذاكرة فاضية"
              message="أضيفي تفضيلاتك أو معلومات عن مشروعك عشان المساعد يراعيها في الردود."
              action={
                <ActionButton
                  label="إضافة معلومة"
                  icon="plus"
                  onPress={openNew}
                />
              }
            />
          )}
        </View>
        {archivedMemories.length ? (
          <View style={styles.section}>
            <SectionTitle title={`أرشيف الذاكرة (${archivedMemories.length})`} />
            {archivedMemories.map(renderMemory)}
          </View>
        ) : null}

        {/* Automatic knowledge base — built in the background from your
            discussions; listed here for full privacy and control. */}
        <View style={styles.section}>
          <SectionTitle title={`مستودع المعلومات التلقائي (${knowledge.length})`} />
          <Surface style={styles.infoCard}>
            <Feather name="database" size={18} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              يُبنى تلقائيًا من محادثاتك (جهازك، تفضيلاتك، مشاريعك) في الخلفية، ويُسترجَع ضمن الردود المناسبة فقط — لا يظهر في الشات.
            </Text>
          </Surface>
          {knowledge.length ? (
            <>
              {knowledge.slice(0, 40).map((entry: KnowledgeEntry) => (
                <Surface key={entry.id} style={styles.memoryCard}>
                  <View style={styles.memoryHeader}>
                    <View style={[styles.memoryIcon, { backgroundColor: colors.accentSubtle }]}>
                      <Feather name="database" size={14} color={colors.primary} />
                    </View>
                    <Text style={[styles.memoryTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {entry.text}
                    </Text>
                    <StatusPill
                      label={
                        entry.kind === 'device'
                          ? 'جهاز'
                          : entry.kind === 'preference'
                            ? 'تفضيل'
                            : entry.kind === 'identity'
                              ? 'عن المستخدم'
                              : entry.kind === 'project'
                                ? 'مشروع'
                                : 'سياق'
                      }
                      tone="neutral"
                    />
                  </View>
                </Surface>
              ))}
              <ActionButton
                label="مسح مستودع المعلومات"
                icon="trash-2"
                variant="secondary"
                onPress={() =>
                  alertCompat(
                    'مسح مستودع المعلومات؟',
                    'سيتم حذف كل المعلومات المستخرجة تلقائيًا من محادثاتك. لا يمكن استعادتها.',
                    [
                      { text: 'إلغاء', style: 'cancel' },
                      { text: 'مسح', style: 'destructive', onPress: () => void clearKnowledge() },
                    ],
                  )
                }
              />
            </>
          ) : (
            <EmptyState
              icon="database"
              title="المستودع فاضي"
              message="مع استمرار المحادثة، سيُسجّل تلقائيًا معلومات قابلة لإعادة الاستخدام عن جهازك وتفضيلاتك."
            />
          )}
        </View>
      </AppScreen>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {selected ? 'تعديل المعلومة' : 'إضافة للذاكرة'}
              </Text>
              <Pressable onPress={() => setVisible(false)} accessibilityLabel="إغلاق">
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.form}
            >
              <FormField
                label="عنوان"
                placeholder="مثال: أسلوب الكتابة المفضل"
                value={form.title}
                onChangeText={(title) => setForm({ ...form, title })}
                style={styles.rtlInput}
                maxLength={100}
              />
              <FormField
                label="المعلومة"
                placeholder="اكتبي المعلومة اللي تحبي تفضل مع المساعد."
                value={form.content}
                onChangeText={(content) => setForm({ ...form, content })}
                style={[styles.rtlInput, styles.multilineInput]}
                multiline
                maxLength={4000}
              />
              <ActionButton
                label="حفظ على الجهاز"
                icon="check"
                onPress={() => void save()}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  addButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  infoCard: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 19, textAlign: 'right' },
  section: { gap: 11 },
  memoryCard: { gap: 12 },
  memoryHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  memoryIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  memoryTitle: { flex: 1, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  memoryContent: { fontSize: 12, lineHeight: 19, textAlign: 'right' },
  actions: { flexDirection: 'row-reverse', gap: 16, borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.18)', paddingTop: 9 },
  smallAction: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  actionText: { fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(4, 13, 10, 0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '84%', borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle: { fontSize: 19, fontWeight: '700' },
  form: { gap: 15, paddingBottom: 12 },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  multilineInput: { minHeight: 130 },
});
