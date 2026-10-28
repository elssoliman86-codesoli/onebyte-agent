import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';
import { useAssistant } from '@/src/assistant';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import {
  PLATFORMS,
  PLATFORM_URLS,
  buildWeeklyPlan,
  loadConnections,
  loadMarketingPosts,
  saveConnections,
  saveMarketingPosts,
  sendTelegramMessage,
  verifyGithubToken,
  type MarketingConnections,
  type MarketingPost,
  type PlatformKey,
} from '@/src/marketing';
import {
  ActionButton,
  AppScreen,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

/**
 * Marketing Studio — content planning + real publishing where a free
 * official API allows it (Telegram Bot, GitHub) and browser-assisted
 * posting elsewhere. Sessions opened from here are tagged with the
 * marketing mode so the model talks like a marketing agent.
 */
export default function MarketingScreen() {
  const colors = useColors();
  const { setPendingPrompt, createSession, patchSession } = useAssistant();
  const [connections, setConnections] = useState<MarketingConnections>({});
  const [posts, setPosts] = useState<MarketingPost[]>([]);
  const [business, setBusiness] = useState('');
  const [time, setTime] = useState('10:00');
  const [pickedPlatforms, setPickedPlatforms] = useState<PlatformKey[]>(['facebook', 'instagram']);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChat, setTelegramChat] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [busy, setBusy] = useState('');
  const [detailModal, setDetailModal] = useState<MarketingPost | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, p] = await Promise.all([loadConnections(), loadMarketingPosts()]);
      setConnections(c);
      setPosts(p);
      if (c.telegram) {
        setTelegramToken(c.telegram.botToken);
        setTelegramChat(c.telegram.chatId);
      }
      if (c.githubToken) setGithubToken(c.githubToken);
    })();
  }, []);

  function togglePlatform(key: PlatformKey) {
    setPickedPlatforms((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  }

  async function saveTelegram() {
    setBusy('tg');
    const next = { ...connections, telegram: { botToken: telegramToken.trim(), chatId: telegramChat.trim() } };
    await saveConnections(next);
    setConnections(next);
    setBusy('');
    alertCompat('تم الحفظ', 'تيليجرام جاهز — جرّب إرسال رسالة تجريبية.');
  }

  async function testTelegram() {
    setBusy('tg-test');
    const result = await sendTelegramMessage(
      { botToken: telegramToken, chatId: telegramChat },
      'رسالة تجريبية من OneByte Agent ✅',
    );
    setBusy('');
    alertCompat(result.ok ? 'نجاح' : 'فشل', result.detail);
  }

  async function saveGithub() {
    setBusy('gh');
    const check = await verifyGithubToken(githubToken);
    if (!check.ok) {
      setBusy('');
      alertCompat('التوكن مرفوض', check.detail);
      return;
    }
    const next = { ...connections, githubToken: githubToken.trim() };
    await saveConnections(next);
    setConnections(next);
    setBusy('');
    alertCompat('تم الحفظ', check.detail);
  }

  async function generatePlan() {
    if (!business.trim()) {
      alertCompat('اكتب نشاطك', 'وصف واحد يكفي — بنبني منه خطة أسبوع.');
      return;
    }
    setBusy('plan');
    const plan = buildWeeklyPlan({ business: business.trim(), platforms: pickedPlatforms, time: time.trim() || '10:00' });
    const next = [...plan, ...posts];
    await saveMarketingPosts(next);
    setPosts(next);
    setBusy('');
  }

  async function postNow(post: MarketingPost) {
    if (post.platform === 'telegram') {
      setBusy(post.id);
      const result = await sendTelegramMessage(
        {
          botToken: connections.telegram?.botToken ?? '',
          chatId: connections.telegram?.chatId ?? '',
        },
        post.caption,
      );
      setBusy('');
      if (result.ok) {
        const updated = posts.map((p) => (p.id === post.id ? { ...p, status: 'posted' as const, updatedAt: new Date().toISOString() } : p));
        setPosts(updated);
        await saveMarketingPosts(updated);
      }
      alertCompat(result.ok ? 'اتنشر ✅' : 'فشل النشر', result.detail);
      return;
    }
    alertCompat(
      'النشر اليدوي المساعد',
      'هذه المنصة محتاجة تطبيق معتمد عند مزودها للنشر البرمجي. هيتم نسخ الكابشن وفتح المنصة — الصق وانشر في خطوتين.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'نسخ وفتح',
          onPress: () => {
            void Clipboard.setStringAsync(post.caption);
            openPlatformUrl(PLATFORM_URLS[post.platform]);
          },
        },
      ],
    );
  }

  async function toggleStatus(post: MarketingPost) {
    const status = post.status === 'posted' ? 'planned' : 'posted';
    const updated = posts.map((p) =>
      p.id === post.id ? { ...p, status: status as MarketingPost['status'], updatedAt: new Date().toISOString() } : p,
    );
    setPosts(updated);
    await saveMarketingPosts(updated);
  }

  async function askAgent(prompt: string) {
    const sessionId = await createSession();
    await patchSession(sessionId, { mode: 'marketing' });
    setPendingPrompt(prompt);
    router.push('/(tabs)');
  }

  /** Open the platform: real browser tab on web, the in-app browser on native. */
  function openPlatformUrl(url: string) {
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      router.push({ pathname: '/browser', params: { url } });
    }
  }

  return (
    <>
      <AppScreen
        title="استوديو التسويق"
        eyebrow="وكيل تسويق رقمي"
        subtitle="خطة محتوى أسبوعية، ونشر حقيقي حيث تسمح الواجهات الرسمية المجانية — والباقي بمساعدة المتصفح المدمج."
      >
        <ScreenTopBar active="marketing" />

        {/* Honest capability matrix */}
        <Surface style={styles.card}>
          <SectionTitle title="ما اللي يقدر يعمله النشر تلقائيًا؟" />
          <View style={{ gap: 7, marginTop: 6 }}>
            {PLATFORMS.map((p) => (
              <View key={p.key} style={styles.capRow}>
                <StatusPill label={p.label} tone={p.level === 'api' ? 'success' : 'neutral'} />
                <Text style={[styles.capNote, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {p.note}
                </Text>
              </View>
            ))}
          </View>
        </Surface>

        {/* Connections */}
        <View style={styles.section}>
          <SectionTitle title="الاتصالات" />
          <Surface style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>تيليجرام (Bot API — يعمل فعلًا)</Text>
            <FormField
              label="توكن البوت (من @BotFather)"
              value={telegramToken}
              onChangeText={setTelegramToken}
              placeholder="123456:ABC-DEF..."
              secureTextEntry
            />
            <FormField
              label="Chat / Channel ID"
              value={telegramChat}
              onChangeText={setTelegramChat}
              placeholder="@mychannel أو -1001234567890"
            />
            <View style={styles.rowBtns}>
              <ActionButton
                label="حفظ"
                icon="save"
                variant="secondary"
                onPress={() => void saveTelegram()}
                disabled={busy === 'tg'}
              />
              <ActionButton
                label="رسالة تجريبية"
                icon="send"
                onPress={() => void testTelegram()}
                disabled={busy === 'tg-test'}
              />
            </View>
          </Surface>
          <Surface style={styles.card}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>GitHub (توكن شخصي مجاني)</Text>
            <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
              اتصال حقيقي بقراءة وكتابة على مستودعاتك — التوكن يبقى على جهازك فقط.
            </Text>
            <FormField
              label="Personal Access Token"
              value={githubToken}
              onChangeText={setGithubToken}
              placeholder="ghp_..."
              secureTextEntry
            />
            <ActionButton
              label="تحقق واحفظ"
              icon="github"
              variant="secondary"
              onPress={() => void saveGithub()}
              disabled={busy === 'gh'}
            />
          </Surface>
        </View>

        {/* Weekly plan */}
        <View style={styles.section}>
          <SectionTitle title="خطة أسبوع" />
          <Surface style={styles.card}>
            <FormField
              label="وصف نشاطك (الموديل والمولّد يبنوا عليه)"
              value={business}
              onChangeText={setBusiness}
              placeholder="مثال: مطعم بيتزا منزلي في القاهرة"
              multiline
            />
            <FormField label="وقت النشر اليومي" value={time} onChangeText={setTime} placeholder="10:00" />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>المنصات</Text>
            <View style={styles.chipWrap}>
              {PLATFORMS.filter((p) => p.key !== 'github').map((p) => {
                const active = pickedPlatforms.includes(p.key);
                return (
                  <Pressable
                    key={p.key}
                    accessibilityRole="button"
                    onPress={() => togglePlatform(p.key)}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary + '22' : 'transparent',
                      },
                    ]}
                  >
                    <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <ActionButton
              label="جهّز خطة 7 أيام"
              icon="calendar"
              onPress={() => void generatePlan()}
              disabled={busy === 'plan'}
            />
            <ActionButton
              label="اسأل الوكيل لتحسين الخطة (شات تسويقي)"
              icon="message-circle"
              variant="secondary"
              onPress={() =>
                void askAgent(
                  `نشاطي: ${business || '…'}\nجهّزلي خطة محتوى أسبوع كامل للمنصات: ${pickedPlatforms.join(' و') || 'فيسبوك وإنستجرام'}، النشر يوميًا الساعة ${time}. خد في اعتبارك اللي تعرفه عني من المستودع، واكتب كابشن واقعي جاهز لكل يوم.`,
                )
              }
            />
          </Surface>

          {/* Calendar */}
          {posts.length ? (
            posts.map((post) => (
              <Surface key={post.id} style={styles.card}>
                <View style={styles.postHead}>
                  <View style={[styles.postIcon, { backgroundColor: colors.accent }]}>
                    <Feather name="calendar" size={15} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.postTitle, { color: colors.foreground }]}>
                      {post.day} · {post.time} · {PLATFORMS.find((p) => p.key === post.platform)?.label}
                    </Text>
                    <Text style={[styles.postIdea, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {post.idea}
                    </Text>
                  </View>
                  <StatusPill
                    label={post.status === 'posted' ? 'اتنشر' : post.status === 'skipped' ? 'متخطى' : 'مجدول'}
                    tone={post.status === 'posted' ? 'success' : 'neutral'}
                  />
                </View>
                <View style={styles.rowBtns}>
                  <ActionButton label="نشر الآن" icon="upload" onPress={() => void postNow(post)} disabled={busy === post.id} />
                  <ActionButton label="تعديل الحالة" icon="check-circle" variant="secondary" onPress={() => void toggleStatus(post)} />
                  <ActionButton label="تفاصيل" icon="eye" variant="quiet" onPress={() => setDetailModal(post)} />
                </View>
              </Surface>
            ))
          ) : null}
        </View>

        <Surface style={styles.card}>
          <Feather name="lock" size={17} color={colors.primary} />
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
            التوكنات والسيشن محفوظة على جهازك فقط. النشر الآلي غير المراقب مش مضمون على منصات بلا API رسمي متاح — بنجهّز ونفتح بدل ما ندّعي.
          </Text>
        </Surface>
      </AppScreen>

      {/* Post detail */}
      <Modal visible={detailModal !== null} transparent animationType="slide" onRequestClose={() => setDetailModal(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHead}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>تفاصيل المنشور</Text>
              <Pressable onPress={() => setDetailModal(null)} accessibilityLabel="إغلاق">
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            {detailModal ? (
              <ScrollView showsVerticalScrollIndicator>
                <Text style={[styles.bodyText, { color: colors.foreground }]} selectable>
                  {detailModal.caption}
                </Text>
                <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                  الوسيط: {detailModal.media}
                </Text>
                <View style={styles.rowBtns}>
                  <ActionButton
                    label="نسخ الكابشن"
                    icon="copy"
                    variant="secondary"
                    onPress={() => void Clipboard.setStringAsync(detailModal.caption)}
                  />
                  <ActionButton
                    label="افتح المنصة"
                    icon="external-link"
                    onPress={() => openPlatformUrl(PLATFORM_URLS[detailModal.platform])}
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: 16 },
  section: { marginTop: 18, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  bodyText: { fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  capRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  capNote: { flex: 1, fontSize: 11.5, lineHeight: 17, textAlign: 'right' },
  rowBtns: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chipWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  postHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  postIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  postTitle: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  postIdea: { fontSize: 11.5, marginTop: 2, textAlign: 'right' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12 },
  sheetHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
});
