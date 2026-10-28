import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { AppScreen, Surface } from '@/components/Ui';
import { alertCompat } from '@/src/web-alert';
import { useAssistant } from '@/src/assistant';
import { PLATFORM_URLS, type PlatformKey } from '@/src/marketing';

type SocialPlatform = {
  key: PlatformKey;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  color: string;
};

const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { key: 'youtube', title: 'YouTube Studio', subtitle: 'قناة يوتيوب ورفع الفيديوهات', icon: 'youtube', color: '#FF4D4F' },
  { key: 'tiktok', title: 'TikTok', subtitle: 'الحساب وصفحة رفع المقاطع', icon: 'music', color: '#E85D9E' },
  { key: 'facebook', title: 'Facebook', subtitle: 'الصفحة والحسابات المسجلة', icon: 'facebook', color: '#4D8DFF' },
  { key: 'instagram', title: 'Instagram', subtitle: 'الحساب وإدارة المحتوى', icon: 'instagram', color: '#DB70A5' },
  { key: 'whatsapp', title: 'WhatsApp Web / Desktop', subtitle: 'افتح جلسة واتساب الموجودة عندك', icon: 'message-circle', color: '#36C987' },
  { key: 'telegram', title: 'Telegram Web', subtitle: 'المحادثات والقنوات المسجلة', icon: 'send', color: '#46A8E8' },
];

export default function MarketingScreen() {
  const colors = useColors();
  const { createSession, patchSession } = useAssistant();
  const [opening, setOpening] = useState<PlatformKey | 'chat' | null>(null);

  async function openPlatform(platform: SocialPlatform) {
    setOpening(platform.key);
    try {
      await Linking.openURL(PLATFORM_URLS[platform.key]);
    } catch {
      alertCompat(
        'تعذّر فتح المنصة',
        'افتح الرابط يدويًا أو تأكد من اتصال الإنترنت. لو أنت مش مسجل الدخول، سجل في موقع المنصة الرسمي أولًا.',
      );
    } finally {
      setOpening(null);
    }
  }

  async function openMarketingChat() {
    if (opening) return;
    setOpening('chat');
    try {
      const id = await createSession();
      await patchSession(id, { mode: 'marketing' });
      router.replace('/(tabs)');
    } catch {
      alertCompat('تعذّر فتح مساعد التسويق', 'حاول مرة أخرى.');
      setOpening(null);
    }
  }

  return (
    <AppScreen
      title="Marketing Studio"
      eyebrow="إدارة حساباتك ومحتواك"
      subtitle="افتح حساباتك الرسمية من هنا، ثم استخدم مساعد التسويق للتخطيط وكتابة المحتوى."
      topBar={<ScreenTopBar active="marketing" />}
    >
      <Surface style={styles.notice}>
        <Feather name="shield" size={18} color={colors.primary} />
        <Text style={[styles.noticeText, { color: colors.foreground }]}>
          المنصات تفتح من روابطها الرسمية. لو أنت مسجل الدخول في المتصفح أو التطبيق، قد تفتح جلستك الحالية؛ وإلا سجّل الدخول بنفسك. OneByte لا يطلب كلمة السر ولا يتجاوز تسجيل الدخول أو صلاحيات المنصة.
        </Text>
      </Surface>

      <View style={styles.grid}>
        {SOCIAL_PLATFORMS.map((platform) => (
          <Pressable
            key={platform.key}
            accessibilityRole="button"
            accessibilityLabel={`فتح ${platform.title}`}
            onPress={() => void openPlatform(platform)}
            disabled={opening !== null}
            style={({ pressed }) => [
              styles.platformButton,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: opening && opening !== platform.key ? 0.65 : 1 },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.platformIcon, { backgroundColor: platform.color + '20' }]}>
              {opening === platform.key ? (
                <ActivityIndicator size="small" color={platform.color} />
              ) : (
                <Feather name={platform.icon} size={21} color={platform.color} />
              )}
            </View>
            <View style={styles.platformCopy}>
              <Text style={[styles.platformTitle, { color: colors.foreground }]}>{platform.title}</Text>
              <Text style={[styles.platformSubtitle, { color: colors.mutedForeground }]}>{platform.subtitle}</Text>
            </View>
            <Feather name="external-link" size={15} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void openMarketingChat()}
        disabled={opening !== null}
        style={({ pressed }) => [
          styles.chatButton,
          { backgroundColor: colors.primary, opacity: opening === 'chat' ? 0.75 : 1 },
          pressed && styles.pressed,
        ]}
      >
        {opening === 'chat' ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Feather name="message-circle" size={19} color={colors.primaryForeground} />
        )}
        <Text style={[styles.chatButtonText, { color: colors.primaryForeground }]}>افتح مساعد التسويق</Text>
      </Pressable>

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        تجهيز المحتوى لا يعني نشره تلقائيًا. النشر الآلي متاح فقط حيث تتيح المنصة واجهة رسمية وصلاحيات صحيحة.
      </Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10, padding: 13 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 20, textAlign: 'right' },
  grid: { gap: 9 },
  platformButton: { minHeight: 70, flexDirection: 'row-reverse', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 15, padding: 12 },
  platformIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  platformCopy: { flex: 1, gap: 4 },
  platformTitle: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  platformSubtitle: { fontSize: 11, lineHeight: 16, textAlign: 'right' },
  chatButton: { minHeight: 48, borderRadius: 14, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16, marginTop: 5 },
  chatButtonText: { fontSize: 14, fontWeight: '800' },
  footer: { fontSize: 11, lineHeight: 18, textAlign: 'right', marginBottom: 12 },
  pressed: { transform: [{ scale: 0.985 }] },
});
