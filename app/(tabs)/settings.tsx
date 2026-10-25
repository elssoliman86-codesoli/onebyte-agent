import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import {
  getStoredModelApiKey,
  useAssistant,
  type ProviderSettings,
} from '@/src/assistant';
import { streamModelChat } from '@/src/model-provider';
import { formatContext, formatPrice, type ModelInfo } from '@/src/model-catalog';
import * as Device from '@/src/device';
import { ModelPicker } from '@/components/ModelPicker';
import {
  ActionButton,
  AppScreen,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

export default function SettingsScreen() {
  const colors = useColors();
  const {
    provider,
    apiKeyConfigured,
    sessions,
    skills,
    memories,
    tasks,
    agent,
    saveAgentSettings,
    saveProvider,
    removeApiKey,
    exportLocalData,
  } = useAssistant();
  const [providerName, setProviderName] = useState(provider.providerName);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [model, setModel] = useState(provider.model);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testReply, setTestReply] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [picked, setPicked] = useState<ModelInfo | null>(null);
  const [serviceOn, setServiceOn] = useState(Device.isServiceEnabled());
  // Local text buffers so the 1.5s service-status re-render never wipes what the
  // user is typing; values are committed only when a field is finished.
  const [workingTokensText, setWorkingTokensText] = useState(
    String(agent.maxWorkingTokens),
  );
  const [maxStepsText, setMaxStepsText] = useState(String(agent.maxSteps));

  // The accessibility switch lives in system settings, so re-check when the user comes back.
  useEffect(() => {
    const id = setInterval(() => setServiceOn(Device.isServiceEnabled()), 1500);
    return () => clearInterval(id);
  }, []);

  async function openPicker() {
    if (!baseUrl.trim()) {
      Alert.alert('أضف الرابط أولًا', 'اكتب Base URL ثم افتح قائمة الموديلات.');
      return;
    }
    if (!apiKey.trim() && !apiKeyConfigured) {
      Alert.alert('أضف المفتاح أولًا', 'الصق مفتاح API ثم افتح قائمة الموديلات.');
      return;
    }
    setPickerVisible(true);
  }

  function onPickModel(m: ModelInfo) {
    setModel(m.id);
    setPicked(m);
    setPickerVisible(false);
  }

  async function toggleDevice(next: boolean) {
    try {
      await saveAgentSettings({ deviceControlEnabled: next });
    } catch {
      Alert.alert('تعذّر الحفظ', 'حاول مرة أخرى.');
    }
  }

  useEffect(() => {
    setProviderName(provider.providerName);
    setBaseUrl(provider.baseUrl);
    setModel(provider.model);
  }, [provider.providerName, provider.baseUrl, provider.model]);

  useEffect(() => {
    setWorkingTokensText(String(agent.maxWorkingTokens));
    setMaxStepsText(String(agent.maxSteps));
  }, [agent.maxWorkingTokens, agent.maxSteps]);

  function commitWorkingTokens() {
    const n = Number(workingTokensText.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(n) || n < 4000) {
      setWorkingTokensText(String(agent.maxWorkingTokens));
      return;
    }
    const clamped = Math.min(n, 2_000_000);
    setWorkingTokensText(String(clamped));
    if (clamped !== agent.maxWorkingTokens) {
      void saveAgentSettings({ maxWorkingTokens: clamped }).catch(() =>
        Alert.alert('تعذّر الحفظ', 'حاولي مرة أخرى.'),
      );
    }
  }

  function commitMaxSteps() {
    const n = Number(maxStepsText.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(n) || n < 1) {
      setMaxStepsText(String(agent.maxSteps));
      return;
    }
    const clamped = Math.min(n, 60);
    setMaxStepsText(String(clamped));
    if (clamped !== agent.maxSteps) {
      void saveAgentSettings({ maxSteps: clamped }).catch(() =>
        Alert.alert('تعذّر الحفظ', 'حاولي مرة أخرى.'),
      );
    }
  }

  async function saveSettings() {
    if (!baseUrl.trim() || !model.trim()) {
      Alert.alert('أكملي إعدادات الموديل', 'أضيفي Base URL واسم الموديل.');
      return;
    }
    if (!apiKey.trim() && !apiKeyConfigured) {
      Alert.alert('مفتاح API مطلوب', 'أضيفي مفتاح الموديل في الحقل الآمن.');
      return;
    }
    setSaving(true);
    try {
      await saveProvider(
        {
          providerName: providerName.trim() || 'Custom provider',
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          contextLength:
            picked && picked.id === model.trim() ? picked.contextLength : provider.model === model.trim() ? provider.contextLength : null,
          promptPrice:
            picked && picked.id === model.trim() ? picked.promptPrice : provider.model === model.trim() ? provider.promptPrice : null,
          completionPrice:
            picked && picked.id === model.trim() ? picked.completionPrice : provider.model === model.trim() ? provider.completionPrice : null,
          free: picked && picked.id === model.trim() ? picked.free : provider.model === model.trim() ? provider.free : false,
        },
        apiKey,
      );
      setApiKey('');
      Alert.alert('تم الحفظ', 'الإعدادات محفوظة على هذا الجهاز فقط.');
    } catch (error) {
      Alert.alert(
        'تعذّر الحفظ',
        error instanceof Error ? error.message : 'حاولي مرة أخرى.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!baseUrl.trim() || !model.trim()) {
      Alert.alert('أكملي إعدادات الموديل', 'أضيفي Base URL واسم الموديل أولًا.');
      return;
    }
    setTesting(true);
    setTestReply('');
    let reply = '';
    try {
      const key = apiKey.trim() || (await getStoredModelApiKey());
      const settings: ProviderSettings = {
        providerName: providerName.trim() || 'Custom provider',
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      };
      await streamModelChat({
        settings,
        apiKey: key,
        messages: [{ role: 'user', content: 'Reply with a short greeting.' }],
        onChunk: (chunk) => {
          reply += chunk;
          setTestReply(reply);
        },
      });
      if (!reply.trim()) throw new Error('وصل الاتصال لكن الرد كان فارغًا.');
      Alert.alert('الاتصال ناجح', 'استقبلنا ردًا من الموديل.');
    } catch (error) {
      Alert.alert(
        'تعذّر الاتصال',
        error instanceof Error
          ? error.message
          : 'راجعي Base URL واسم الموديل والمفتاح.',
      );
    } finally {
      setTesting(false);
    }
  }

  function confirmRemoveKey() {
    Alert.alert(
      'حذف مفتاح الموديل؟',
      'سيتم حذفه من خزنة هذا الجهاز. سيظل اسم الموديل ورابط الخدمة محفوظين.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف المفتاح',
          style: 'destructive',
          onPress: () => {
            void removeApiKey().catch(() =>
              Alert.alert('تعذّر حذف المفتاح', 'حاولي مرة أخرى.'),
            );
          },
        },
      ],
    );
  }

  function confirmExport() {
    Alert.alert(
      'تصدير نسخة محلية؟',
      'النسخة تحتوي على محادثاتك ومهاراتك وذاكرتك ومهامك، لكنها لا تحتوي على مفتاح API.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'متابعة',
          onPress: () => {
            void Share.share({
              title: 'نسخة بيانات OneByte Agent',
              message: exportLocalData(),
            }).catch(() => Alert.alert('تعذّر التصدير', 'حاولي من قائمة المشاركة.'));
          },
        },
      ],
    );
  }

  return (
    <AppScreen
      title="الإعدادات"
      eyebrow="تحكم كامل من جهازك"
      subtitle="اختاري مزود النموذج واحفظي مفتاحه محليًا."
    >
      <Surface style={styles.localCard}>
        <View style={styles.localHeading}>
          <View style={[styles.localIcon, { backgroundColor: colors.accent }]}>
            <Feather name="lock" size={18} color={colors.primary} />
          </View>
          <View style={styles.localCopy}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              تخزين محلي فقط
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              لا يوجد حساب تطبيق أو مزامنة سحابية. الرسائل تذهب مباشرةً للمزود الذي تختارينه عند إرسالها.
            </Text>
          </View>
        </View>
        <View style={styles.stats}>
          <Count label="المحادثات" value={sessions.length} />
          <Count label="المهارات" value={skills.length} />
          <Count label="الذكريات" value={memories.length} />
          <Count label="المهام" value={tasks.length} />
        </View>
      </Surface>

      <View style={styles.section}>
        <SectionTitle title="مزود الذكاء الاصطناعي" />
        <Surface style={styles.formCard}>
          <FormField
            label="اسم المزود"
            placeholder="مثال: OpenAI أو مزودك الخاص"
            value={providerName}
            onChangeText={setProviderName}
            style={styles.rtlInput}
            maxLength={60}
          />
          <FormField
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChangeText={setBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.rtlInput, styles.urlInput]}
            hint="يُستخدم مسار OpenAI-compatible /chat/completions."
          />
          <FormField
            label="اسم الموديل"
            placeholder="مثال: gpt-4o-mini"
            value={model}
            onChangeText={(v) => {
              setModel(v);
              setPicked(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.rtlInput}
            maxLength={120}
          />
          <ActionButton
            label="اختيار من قائمة الموديلات (مع الأسعار والمجاني)"
            icon="list"
            variant="secondary"
            onPress={() => void openPicker()}
          />
          {(picked ?? (provider.model === model.trim() && provider.model ? provider : null)) ? (
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {formatPrice({
                free: (picked ?? provider).free ?? false,
                promptPrice: (picked ?? provider).promptPrice ?? null,
                completionPrice: (picked ?? provider).completionPrice ?? null,
              })}{' '}
              · {formatContext((picked ?? provider).contextLength)}
            </Text>
          ) : null}
          <FormField
            label="مفتاح API"
            placeholder={apiKeyConfigured ? 'مفتاح محفوظ — اكتبي مفتاحًا جديدًا للتغيير' : 'الصقي مفتاح الموديل هنا'}
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.secretInput}
            hint={
              Platform.OS === 'web'
                ? 'حفظ المفاتيح يحتاج تثبيت التطبيق على الهاتف.'
                : 'المفتاح لا يظهر في الشاشة ولا يُحفظ على خادم التطبيق.'
            }
          />
          <View style={styles.keyStatus}>
            <StatusPill
              label={apiKeyConfigured ? 'مفتاح محفوظ على الجهاز' : 'لا يوجد مفتاح محفوظ'}
              tone={apiKeyConfigured ? 'success' : 'warning'}
            />
            {apiKeyConfigured ? (
              <Pressable
                accessibilityRole="button"
                onPress={confirmRemoveKey}
                style={styles.removeKey}
              >
                <Feather name="trash-2" size={14} color={colors.destructive} />
                <Text style={[styles.removeKeyText, { color: colors.destructive }]}>
                  حذف المفتاح
                </Text>
              </Pressable>
            ) : null}
          </View>
          <ActionButton
            label={saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
            icon="save"
            onPress={() => void saveSettings()}
            disabled={saving}
          />
          <ActionButton
            label={testing ? 'جارٍ اختبار الاتصال…' : 'اختبار الاتصال'}
            icon="wifi"
            variant="secondary"
            onPress={() => void testConnection()}
            disabled={testing}
          />
          {testReply ? (
            <View style={[styles.testResult, { backgroundColor: colors.accent }]}>
              <Text style={[styles.testLabel, { color: colors.primary }]}>
                رد الاختبار
              </Text>
              <Text style={[styles.testText, { color: colors.foreground }]}>
                {testReply}
              </Text>
            </View>
          ) : null}
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="التحكم في الهاتف" />
        <Surface style={styles.formCard}>
          <View style={styles.switchRow}>
            <Switch
              value={agent.deviceControlEnabled}
              onValueChange={(v) => void toggleDevice(v)}
            />
            <View style={styles.connectionCopy}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                السماح للمساعد باستخدام أدوات الجهاز
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                فتح Chrome والروابط والتطبيقات، قراءة الشاشة، الضغط والكتابة. كل إجراء يظهر لك لتوافق عليه أو ترفضه، وزر الإيقاف في الشات يقطع المهمة فورًا.
              </Text>
            </View>
          </View>
          {!Device.isAvailable() ? (
            <Text style={[styles.body, { color: colors.warning }]}>
              {Platform.OS === 'android'
                ? 'وحدة التحكم غير موجودة في هذه النسخة (Expo Go لا يدعمها). ثبّت نسخة APK مبنية من المشروع.'
                : 'التحكم الكامل في التطبيقات متاح على Android فقط. على iPhone يعمل فتح الروابط فقط.'}
            </Text>
          ) : (
            <>
              <StatusPill
                label={serviceOn ? 'خدمة إمكانية الوصول: مفعّلة' : 'خدمة إمكانية الوصول: غير مفعّلة'}
                tone={serviceOn ? 'success' : 'warning'}
              />
              {!serviceOn ? (
                <ActionButton
                  label="تفعيلها من إعدادات النظام"
                  icon="shield"
                  onPress={() =>
                    Alert.alert(
                      'تفعيل إمكانية الوصول',
                      'سيفتح النظام شاشة إمكانية الوصول. اختر "OneByte Agent" ثم فعّله ووافق على تنبيه النظام. تقدر توقفه من نفس المكان في أي وقت.',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'فتح الإعدادات', onPress: () => Device.openAccessibilitySettings() },
                      ],
                    )
                  }
                />
              ) : null}
            </>
          )}
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="السياق والذاكرة الطويلة" />
        <Surface style={styles.formCard}>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            لا يوجد موديل بسياق 200 مليون توكن، لذلك المحادثة هنا لا تنتهي بطريقة أخرى: عند اقتراب النافذة من حدها يُضغط الجزء القديم تلقائيًا في ملخص، وتبقى كل الرسائل الأصلية على جهازك ويستطيع المساعد البحث فيها بأداة search_history.
          </Text>
          <FormField
            label="الحد الأقصى للتوكنز في كل طلب"
            value={workingTokensText}
            onChangeText={setWorkingTokensText}
            onEndEditing={commitWorkingTokens}
            keyboardType="number-pad"
            style={styles.urlInput}
            hint="كلما زاد الرقم زادت التكلفة. يُستخدم الأقل بين هذا الرقم و60% من سياق الموديل."
          />
          <FormField
            label="أقصى عدد خطوات للمهمة الواحدة"
            value={maxStepsText}
            onChangeText={setMaxStepsText}
            onEndEditing={commitMaxSteps}
            keyboardType="number-pad"
            style={styles.urlInput}
          />
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="حساباتك الخارجية" />
        <Surface style={styles.connectionCard}>
          <View style={[styles.connectionIcon, { backgroundColor: colors.accent }]}>
            <Feather name="share-2" size={17} color={colors.primary} />
          </View>
          <View style={styles.connectionCopy}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Facebook وWhatsApp غير مربوطين
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              النسخة المحلية تقدر تجهز مسودات للمشاركة يدويًا، لكنها لا تقرأ رسائل WhatsApp ولا تنشر تلقائيًا. الربط الرسمي يحتاج إعداد تطبيق Meta وحساب WhatsApp Business، كما أن استقبال الرسائل يتطلب خادمًا.
            </Text>
          </View>
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="أدوات متقدمة" />
        <Surface style={styles.formCard}>
          <ActionButton
            label="مساحة عمل تقييم الأمان (سجل محلي)"
            icon="shield"
            variant="secondary"
            onPress={() => router.push('/(tabs)/assessments')}
          />
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="نسخة احتياطية" />
        <Surface>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            احفظي نسخة من المحادثات والمهارات والذاكرة والمهام قبل تغيير الهاتف. ملف النسخة لا يتضمن مفاتيح API.
          </Text>
          <ActionButton
            label="تصدير نسخة بيانات"
            icon="share"
            variant="secondary"
            onPress={confirmExport}
          />
        </Surface>
      </View>

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        OneByte Agent · النسخة المحلية
      </Text>

      <ModelPicker
        visible={pickerVisible}
        baseUrl={baseUrl}
        getApiKey={async () => apiKey.trim() || (await getStoredModelApiKey())}
        onClose={() => setPickerVisible(false)}
        onPick={onPickModel}
      />
    </AppScreen>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  localCard: { gap: 14 },
  localHeading: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  localIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  localCopy: { flex: 1, alignItems: 'flex-end', gap: 5 },
  cardTitle: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  body: { fontSize: 12, lineHeight: 19, textAlign: 'right' },
  stats: { flexDirection: 'row-reverse', borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.18)', paddingTop: 12, gap: 8 },
  count: { flex: 1, alignItems: 'center', gap: 3 },
  countValue: { fontSize: 19, fontWeight: '700' },
  countLabel: { fontSize: 10 },
  section: { gap: 10 },
  formCard: { gap: 14 },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  urlInput: { textAlign: 'left', writingDirection: 'ltr' },
  secretInput: { textAlign: 'left', writingDirection: 'ltr' },
  keyStatus: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  removeKey: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, padding: 6 },
  removeKeyText: { fontSize: 11, fontWeight: '700' },
  testResult: { padding: 12, borderRadius: 14, gap: 5 },
  testLabel: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  testText: { fontSize: 12, lineHeight: 19, textAlign: 'right' },
  switchRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  connectionCard: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  connectionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  connectionCopy: { flex: 1, alignItems: 'flex-end', gap: 6 },
  footer: { fontSize: 10, textAlign: 'center', paddingVertical: 4 },
});
