import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export interface TaskReminderResult {
  scheduled: boolean;
  notificationId?: string;
  message: string;
}

export async function scheduleTaskReminder(task: {
  id: string;
  title: string;
  time: string;
}): Promise<TaskReminderResult> {
  if (Platform.OS === 'web') {
    return {
      scheduled: false,
      message: 'حُفظت المهمة، لكن التذكير المحلي يحتاج نسخة Android أو iOS المثبتة.',
    };
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(task.time.trim());
  if (!match) {
    return {
      scheduled: false,
      message: 'حُفظت المهمة دون تذكير؛ الوقت يحتاج صيغة 24 ساعة مثل 18:00.',
    };
  }

  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      return {
        scheduled: false,
        message: 'حُفظت المهمة دون تذكير؛ اسمح بالإشعارات من إعدادات الهاتف.',
      };
    }
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'حان وقت مهمتك',
        body: task.title,
        data: { taskId: task.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Number(match[1]),
        minute: Number(match[2]),
        channelId: 'daily-tasks',
      },
    });
    return { scheduled: true, notificationId, message: 'تم جدولة التذكير اليومي.' };
  } catch {
    return {
      scheduled: false,
      message: 'حُفظت المهمة دون تذكير؛ تعذّر إنشاء الإشعار على هذا الجهاز.',
    };
  }
}
