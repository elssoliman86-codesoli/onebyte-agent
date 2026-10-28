import React, { useState } from 'react';
import {
    Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { useAssistant, type DailyTask } from '@/src/assistant';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

const blankTask = { title: '', prompt: '', time: '18:00' };

export default function TasksScreen() {
  const colors = useColors();
  const { tasks, createTask, setTaskActive, deleteTask, setPendingPrompt } =
    useAssistant();
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState(blankTask);

  function parseTime(value: string): { hour: number; minute: number } | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    return { hour: Number(match[1]), minute: Number(match[2]) };
  }

  async function scheduleReminder(task: DailyTask): Promise<string> {
    if (Platform.OS === 'web') {
      throw new Error('التذكيرات المحلية تحتاج تثبيت التطبيق على Android أو iOS.');
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      throw new Error('لم يتم السماح بالتنبيهات. يمكنك تفعيلها من إعدادات الهاتف.');
    }
    const time = parseTime(task.time);
    if (!time) throw new Error('اكتبي الوقت بصيغة 24 ساعة مثل 18:00.');
    return Notifications.scheduleNotificationAsync({
      content: {
        title: 'حان وقت مهمتك',
        body: task.title,
        data: { taskId: task.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: time.hour,
        minute: time.minute,
        channelId: 'daily-tasks',
      },
    });
  }

  async function addTask() {
    if (!form.title.trim() || !form.prompt.trim()) {
      alertCompat('أكملي بيانات المهمة', 'اكتبي اسم المهمة والطلب الذي تريدي فتحه في الشات.');
      return;
    }
    if (!parseTime(form.time)) {
      alertCompat('الوقت غير صحيح', 'استخدمي صيغة 24 ساعة، مثل 09:30 أو 18:00.');
      return;
    }
    try {
      const taskId = await createTask(form);
      setVisible(false);
      setForm(blankTask);
      const task = tasks.find((item) => item.id === taskId) ?? {
        id: taskId,
        ...form,
        active: true,
        createdAt: new Date().toISOString(),
      };
      try {
        const notificationId = await scheduleReminder(task);
        await setTaskActive(taskId, true, notificationId);
      } catch (error) {
        await setTaskActive(taskId, false);
        alertCompat(
          'تم حفظ المهمة دون تذكير',
          error instanceof Error ? error.message : 'راجعي إعدادات التنبيهات.',
        );
      }
    } catch {
      alertCompat('لم يتم حفظ المهمة', 'حاولي مرة أخرى.');
    }
  }

  async function toggleTask(task: DailyTask, active: boolean) {
    try {
      if (!active) {
        if (task.notificationId) {
          await Notifications.cancelScheduledNotificationAsync(task.notificationId);
        }
        await setTaskActive(task.id, false);
        return;
      }
      const notificationId = await scheduleReminder(task);
      await setTaskActive(task.id, true, notificationId);
    } catch (error) {
      alertCompat(
        'لم يتم تفعيل التذكير',
        error instanceof Error ? error.message : 'راجعي إعدادات التنبيهات.',
      );
    }
  }

  function removeTask(task: DailyTask) {
    alertCompat(
      'حذف المهمة؟',
      'سيتم حذف التذكير المحلي، ولن تُرسل المهمة إلى أي خادم.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (task.notificationId) {
                await Notifications.cancelScheduledNotificationAsync(
                  task.notificationId,
                );
              }
              await deleteTask(task.id);
            })().catch(() => alertCompat('تعذّر حذف المهمة', 'حاولي مرة أخرى.'));
          },
        },
      ],
    );
  }

  function openTaskInChat(task: DailyTask) {
    setPendingPrompt(task.prompt);
    router.navigate('/(tabs)');
  }

  function renderTask(task: DailyTask) {
    return (
      <Surface key={task.id} style={styles.taskCard}>
        <View style={styles.taskTop}>
          <View style={[styles.taskIcon, { backgroundColor: colors.accent }]}>
            <Feather name="clock" size={16} color={colors.primary} />
          </View>
          <View style={styles.taskCopy}>
            <Text style={[styles.taskTitle, { color: colors.foreground }]}>
              {task.title}
            </Text>
            <Text style={[styles.taskTime, { color: colors.mutedForeground }]}>
              يوميًا · {task.time}
            </Text>
          </View>
          <Switch
            accessibilityLabel={task.active ? 'إيقاف التذكير' : 'تفعيل التذكير'}
            value={task.active}
            onValueChange={(active) => void toggleTask(task, active)}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.primaryForeground}
          />
        </View>
        <Text
          numberOfLines={3}
          style={[styles.taskPrompt, { color: colors.mutedForeground }]}
        >
          {task.prompt}
        </Text>
        <View style={styles.taskFooter}>
          <StatusPill
            label={task.active ? 'تذكير مفعّل' : 'التذكير متوقف'}
            tone={task.active ? 'success' : 'neutral'}
          />
          <View style={styles.footerActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => openTaskInChat(task)}
              style={styles.smallAction}
            >
              <Feather name="message-circle" size={14} color={colors.primary} />
              <Text style={[styles.actionText, { color: colors.primary }]}>
                افتحي في الشات
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="حذف المهمة"
              onPress={() => removeTask(task)}
              style={styles.deleteButton}
            >
              <Feather name="trash-2" size={15} color={colors.destructive} />
            </Pressable>
          </View>
        </View>
      </Surface>
    );
  }

  return (
    <>
      <AppScreen
        title="المهام اليومية"
        eyebrow="على جهازك فقط"
        subtitle="اعملي تذكيرًا يفتح طلبك في الشات. المساعد لا ينفذ المهمة تلقائيًا."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إضافة مهمة"
            onPress={() => setVisible(true)}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
          </Pressable>
        }
      >
        <ScreenTopBar active="tasks" />
        <Surface style={styles.localOnlyCard}>
          <View style={[styles.localIcon, { backgroundColor: colors.accent }]}>
            <Feather name="smartphone" size={17} color={colors.primary} />
          </View>
          <View style={styles.localCopy}>
            <Text style={[styles.localTitle, { color: colors.foreground }]}>
              تذكير محلي، مش تنفيذ بالخلفية
            </Text>
            <Text style={[styles.localText, { color: colors.mutedForeground }]}>
              لو التطبيق مقفول هيوصلك تنبيه فقط. افتحيه وراجعي الطلب قبل إرساله أو تنفيذه.
            </Text>
          </View>
        </Surface>

        <View style={styles.section}>
          <SectionTitle title={`كل المهام (${tasks.length})`} />
          {tasks.length ? (
            tasks.map(renderTask)
          ) : (
            <EmptyState
              icon="calendar"
              title="مفيش مهام مجدولة"
              message="أضيفي تذكيرًا يوميًا، مثل مراجعة العملاء أو تجهيز محتوى."
              action={
                <ActionButton
                  label="إضافة أول مهمة"
                  icon="plus"
                  onPress={() => setVisible(true)}
                />
              }
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
                مهمة يومية
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
                label="اسم المهمة"
                placeholder="مثال: مراجعة رسائل العملاء"
                value={form.title}
                onChangeText={(title) => setForm({ ...form, title })}
                style={styles.rtlInput}
                maxLength={100}
              />
              <FormField
                label="الوقت اليومي"
                placeholder="18:00"
                value={form.time}
                onChangeText={(time) => setForm({ ...form, time })}
                style={styles.rtlInput}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                hint="استخدمي صيغة 24 ساعة، مثل 09:30."
              />
              <FormField
                label="الطلب الذي سيفتح في الشات"
                placeholder="مثال: ساعديني أراجع رسائل العملاء وأجهز مسودات للرد."
                value={form.prompt}
                onChangeText={(prompt) => setForm({ ...form, prompt })}
                style={[styles.rtlInput, styles.multilineInput]}
                multiline
                maxLength={2000}
              />
              <ActionButton
                label="حفظ التذكير على الجهاز"
                icon="bell"
                onPress={() => void addTask()}
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
  localOnlyCard: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  localIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  localCopy: { flex: 1, alignItems: 'flex-end', gap: 4 },
  localTitle: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  localText: { fontSize: 11, lineHeight: 18, textAlign: 'right' },
  section: { gap: 11 },
  taskCard: { gap: 12 },
  taskTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  taskIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  taskCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  taskTitle: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  taskTime: { fontSize: 11 },
  taskPrompt: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  taskFooter: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.18)', paddingTop: 10 },
  footerActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 11 },
  smallAction: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingVertical: 3 },
  actionText: { fontSize: 11, fontWeight: '700' },
  deleteButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(4, 13, 10, 0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle: { fontSize: 19, fontWeight: '700' },
  form: { gap: 15, paddingBottom: 12 },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  multilineInput: { minHeight: 120 },
});
