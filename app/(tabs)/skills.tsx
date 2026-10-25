import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAssistant, type AssistantSkill } from '@/src/assistant';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

const emptySkill = { name: '', description: '', instructions: '' };

export default function SkillsScreen() {
  const colors = useColors();
  const { skills, createSkill, updateSkill, setSkillActive } = useAssistant();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<AssistantSkill | null>(null);
  const [form, setForm] = useState(emptySkill);
  const activeSkills = useMemo(() => skills.filter((skill) => skill.active), [skills]);
  const archivedSkills = useMemo(
    () => skills.filter((skill) => !skill.active),
    [skills],
  );

  function openNew() {
    setSelected(null);
    setForm(emptySkill);
    setVisible(true);
  }

  function openEdit(skill: AssistantSkill) {
    setSelected(skill);
    setForm({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
    });
    setVisible(true);
  }

  async function save() {
    if (!form.name.trim() || !form.instructions.trim()) {
      Alert.alert('أكملي البيانات', 'اكتبي اسم المهارة وطريقة تنفيذها.');
      return;
    }
    try {
      if (selected) {
        await updateSkill(selected.id, form);
      } else {
        await createSkill(form);
      }
      setVisible(false);
    } catch (error) {
      Alert.alert(
        'لم يتم حفظ المهارة',
        error instanceof Error ? error.message : 'حاولي مرة أخرى.',
      );
    }
  }

  function renderSkill(skill: AssistantSkill) {
    return (
      <Surface key={skill.id} style={styles.skillCard}>
        <View style={styles.skillHeading}>
          <View style={[styles.skillIcon, { backgroundColor: colors.accent }]}>
            <Feather name="zap" size={17} color={colors.primary} />
          </View>
          <View style={styles.skillNameBlock}>
            <Text style={[styles.skillName, { color: colors.foreground }]}>
              {skill.name}
            </Text>
            <Text style={[styles.skillDescription, { color: colors.mutedForeground }]}>
              {skill.description || 'من غير وصف إضافي'}
            </Text>
          </View>
          <StatusPill
            label={skill.active ? 'نشطة' : 'مؤرشفة'}
            tone={skill.active ? 'success' : 'neutral'}
          />
        </View>
        <Text
          numberOfLines={3}
          style={[styles.instructions, { color: colors.mutedForeground }]}
        >
          {skill.instructions}
        </Text>
        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          <Text style={[styles.versionText, { color: colors.mutedForeground }]}>
            {skill.versions.length} {skill.versions.length === 1 ? 'نسخة محفوظة' : 'نسخ محفوظة'}
          </Text>
          <View style={styles.cardActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => openEdit(skill)}
              style={styles.smallAction}
            >
              <Feather name="edit-2" size={14} color={colors.primary} />
              <Text style={[styles.smallActionText, { color: colors.primary }]}>تعديل</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void setSkillActive(skill.id, !skill.active).catch(() =>
                  Alert.alert('تعذّر حفظ التغيير', 'حاولي مرة أخرى.'),
                )
              }
              style={styles.smallAction}
            >
              <Feather
                name={skill.active ? 'archive' : 'rotate-ccw'}
                size={14}
                color={colors.mutedForeground}
              />
              <Text style={[styles.smallActionText, { color: colors.mutedForeground }]}>
                {skill.active ? 'أرشفة' : 'استعادة'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Surface>
    );
  }

  return (
    <>
      <AppScreen
        title="مهاراتي"
        eyebrow="تعليمات قابلة للتطوير"
        subtitle="أضيفي أسلوب شغلك وتعليماتك. المهارات النشطة تدخل في سياق الشات."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إضافة مهارة"
            onPress={openNew}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
          </Pressable>
        }
      >
        <Surface style={styles.infoCard}>
          <Feather name="layers" size={18} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.foreground }]}>
            أرشفة المهارة توقف استخدامها في الشات لكنها تحتفظ بنسخها. تقدري ترجعيها أو تطوريها في أي وقت.
          </Text>
        </Surface>

        <View style={styles.section}>
          <SectionTitle title={`نشطة (${activeSkills.length})`} />
          {activeSkills.length ? (
            activeSkills.map(renderSkill)
          ) : (
            <EmptyState
              icon="zap"
              title="مفيش مهارات لسه"
              message="أضيفي خطوات عملك أو الطريقة اللي تحبي المساعد يكتب بيها."
              action={
                <ActionButton
                  label="إضافة أول مهارة"
                  icon="plus"
                  onPress={openNew}
                />
              }
            />
          )}
        </View>

        {archivedSkills.length ? (
          <View style={styles.section}>
            <SectionTitle title={`أرشيف المهارات (${archivedSkills.length})`} />
            {archivedSkills.map(renderSkill)}
          </View>
        ) : null}
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
                {selected ? 'تعديل المهارة' : 'مهارة جديدة'}
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
                label="اسم المهارة"
                placeholder="مثال: كتابة وصف المنتجات"
                value={form.name}
                onChangeText={(name) => setForm({ ...form, name })}
                style={styles.rtlInput}
                maxLength={80}
              />
              <FormField
                label="وصف مختصر"
                placeholder="إمتى يستخدمها المساعد؟"
                value={form.description}
                onChangeText={(description) => setForm({ ...form, description })}
                style={styles.rtlInput}
                maxLength={180}
              />
              <FormField
                label="التعليمات"
                hint="اكتبي خطوات واضحة وأمثلة إن أمكن. هذه تعليمات للموديل وليست كودًا يعمل تلقائيًا."
                placeholder="1. افهمي الجمهور…&#10;2. اكتبي النتيجة…"
                value={form.instructions}
                onChangeText={(instructions) => setForm({ ...form, instructions })}
                multiline
                style={[styles.rtlInput, styles.multilineInput]}
                maxLength={8000}
              />
              {selected?.versions.length ? (
                <View style={styles.versionHistory}>
                  <Text style={[styles.historyHeading, { color: colors.foreground }]}>
                    النسخ السابقة المحفوظة
                  </Text>
                  {[...selected.versions].reverse().map((version) => (
                    <Pressable
                      key={version.version}
                      accessibilityRole="button"
                      onPress={() =>
                        setForm({
                          name: version.name,
                          description: version.description,
                          instructions: version.instructions,
                        })
                      }
                      style={[
                        styles.versionRow,
                        { borderColor: colors.border, backgroundColor: colors.card },
                      ]}
                    >
                      <View style={styles.versionCopy}>
                        <Text style={[styles.versionTitle, { color: colors.foreground }]}>
                          نسخة {version.version} ·{' '}
                          {new Date(version.savedAt).toLocaleDateString('ar-EG')}
                        </Text>
                        <Text
                          numberOfLines={2}
                          style={[styles.versionDescription, { color: colors.mutedForeground }]}
                        >
                          {version.name} — {version.instructions}
                        </Text>
                      </View>
                      <Feather name="rotate-ccw" size={15} color={colors.primary} />
                    </Pressable>
                  ))}
                  <Text style={[styles.versionHint, { color: colors.mutedForeground }]}>
                    اختاري نسخة لملء النموذج بها، ثم احفظيها كنسخة جديدة.
                  </Text>
                </View>
              ) : null}
              <ActionButton
                label={selected ? 'حفظ نسخة جديدة' : 'حفظ المهارة'}
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
  skillCard: { gap: 12 },
  skillHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  skillIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  skillNameBlock: { flex: 1, alignItems: 'flex-end', gap: 3 },
  skillName: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  skillDescription: { fontSize: 11, textAlign: 'right' },
  instructions: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  cardFooter: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10 },
  versionText: { fontSize: 10 },
  cardActions: { flexDirection: 'row-reverse', gap: 14 },
  smallAction: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingVertical: 4 },
  smallActionText: { fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(4, 13, 10, 0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle: { fontSize: 19, fontWeight: '700' },
  form: { gap: 15, paddingBottom: 12 },
  versionHistory: { gap: 8, paddingTop: 4 },
  historyHeading: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  versionRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  versionCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  versionTitle: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  versionDescription: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  versionHint: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  multilineInput: { minHeight: 140 },
});
