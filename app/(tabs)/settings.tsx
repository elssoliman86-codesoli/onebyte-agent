import React, { useEffect, useRef, useState } from 'react';
import {
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
import { alertCompat } from '@/src/web-alert';
import {
  getStoredModelApiKey,
  useAssistant,
  type ProviderSettings,
  type ThemePreference,
} from '@/src/assistant';
import { probeModel, streamModelChat, type ProbeResult } from '@/src/model-provider';
import { PROVIDER_PRESETS } from '@/src/provider-presets';
import type { ApprovalDecision } from '@/src/agent';
import type { ToolSpec } from '@/src/tools';
import { formatContext, formatPrice, type ModelInfo } from '@/src/model-catalog';
import * as Device from '@/src/device';
import { ACCENTS, type AccentKey } from '@/constants/colors';
import { LANGUAGES } from '@/src/i18n';

const FONT_COLORS: string[] = ['#F3F7F4', '#FFFFFF', '#A1ADA5', '#737F77', '#00D977', '#FF5F56'];
import { RESPONSE_STYLE_LABELS, type ResponseStyle } from '@/src/response-style';
import {
  configurePcServer,
  setPcApprovalHandler,
  startPcControl,
  stopPcControl,
  isPcControlRunning,
  getPcAccess,
} from '@/src/pc-server';
import { ModelPicker } from '@/components/ModelPicker';
import { ScreenTopBar } from '@/components/PhoneDrawer';
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
    appearance,
    knowledge,
    activeSession,
    appendMessage,
    createSession,
    setActiveSession,
    createMemory,
    createTask,
    setTaskActive,
    saveAgentSettings,
    saveAppearanceSettings,
    saveProvider,
    removeApiKey,
    exportLocalData,
  } = useAssistant();
  const [providerName, setProviderName] = useState(provider.providerName);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [model, setModel] = useState(provider.model);
  const [keyless, setKeyless] = useState(provider.keyless ?? false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testReply, setTestReply] = useState('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [picked, setPicked] = useState<ModelInfo | null>(null);
  const [serviceOn, setServiceOn] = useState(Device.isServiceEnabled());
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const probeAbortRef = useRef<AbortController | null>(null);
  const [pendingLanguage, setPendingLanguage] = useState(appearance.language);
  const [showResponseStyle, setShowResponseStyle] = useState(false);
  // PC companion server state
  const [pcRunning, setPcRunning] = useState(isPcControlRunning());
  const [pcAccess, setPcAccess] = useState<{ url: string; pin: string }>({ url: '', pin: '' });
  const [pcBusy, setPcBusy] = useState(false);
  const [pendingPcApproval, setPendingPcApproval] = useState<{
    spec: ToolSpec;
    args: Record<string, unknown>;
    resolve: (d: ApprovalDecision) => void;
  } | null>(null);
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

  // Keep the PC server wired to the freshest data + callbacks, and route its
  // approval requests into a sheet on this screen (decided on the phone).
  useEffect(() => {
    configurePcServer({
      getData: () => ({
        sessions,
        activeSessionId: activeSession?.id ?? null,
        provider,
        skills,
        memories,
        tasks,
        agent,
        appearance,
        knowledge,
      }),
      appendMessage,
      createSession,
      setActiveSession,
      createMemory,
      createTask,
      setTaskActive,
    });
    setPcApprovalHandler((spec, args) =>
      new Promise<ApprovalDecision>((resolve) => {
        setPendingPcApproval({ spec, args, resolve });
      }),
    );
    return () => setPcApprovalHandler(null);
  }, [
    sessions,
    activeSession?.id,
    provider,
    skills,
    memories,
    tasks,
    agent,
    appearance,
    appendMessage,
    createSession,
    setActiveSession,
    createMemory,
    createTask,
    setTaskActive,
  ]);

  async function togglePcServer(next: boolean) {
    setPcBusy(true);
    try {
      if (next) {
        const access = await startPcControl();
        setPcAccess(access);
        setPcRunning(true);
      } else {
        await stopPcControl();
        setPcRunning(false);
        setPcAccess({ url: '', pin: '' });
      }
    } catch (error) {
      alertCompat(
        'خادم الكمبيوتر',
        error instanceof Error ? error.message : 'حاولي مرة أخرى.',
      );
    } finally {
      setPcBusy(false);
    }
  }

  async function openPicker() {
    if (!baseUrl.trim()) {
      alertCompat('أضف الرابط أولًا', 'اكتب Base URL ثم افتح قائمة الموديلات.');
      return;
    }
    if (!apiKey.trim() && !apiKeyConfigured) {
      alertCompat('أضف المفتاح أولًا', 'الصق مفتاح API ثم افتح قائمة الموديلات.');
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
      alertCompat('تعذّر الحفظ', 'حاول مرة أخرى.');
    }
  }

  useEffect(() => {
    setProviderName(provider.providerName);
    setBaseUrl(provider.baseUrl);
    setModel(provider.model);
    setKeyless(provider.keyless ?? false);
  }, [provider.providerName, provider.baseUrl, provider.model, provider.keyless]);

  useEffect(() => {
    setWorkingTokensText(String(agent.maxWorkingTokens));
    setMaxStepsText(String(agent.maxSteps));
  }, [agent.maxWorkingTokens, agent.maxSteps]);

  // Auto-test: once a base URL + model + key exist, probe the provider (debounced)
  // and surface the actual HTTP status next to the price so the user can see
  // which model actually works without manual trial and error.
  useEffect(() => {
    const cleanBaseUrl = baseUrl.trim();
    const modelId = model.trim();
    const key = apiKey.trim();
    const hasStoredKey = apiKeyConfigured && Platform.OS !== 'web';
    if (!cleanBaseUrl || !modelId || (!key && !hasStoredKey)) {
      probeAbortRef.current?.abort();
      setProbing(false);
      setProbe(null);
      return;
    }
    const controller = new AbortController();
    probeAbortRef.current?.abort();
    probeAbortRef.current = controller;
    setProbing(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const resolvedKey = key || (await getStoredModelApiKey());
          const result = await probeModel({
            settings: { providerName: providerName.trim() || 'Custom', baseUrl: cleanBaseUrl, model: modelId },
            apiKey: resolvedKey,
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            setProbe(result);
            setProbing(false);
          }
        } catch {
          if (!controller.signal.aborted) {
            setProbe({ status: null, ok: false, message: 'تعذّر جلب المفتاح المحفوظ.' });
            setProbing(false);
          }
        }
      })();
    }, 900);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [baseUrl, model, apiKey, apiKeyConfigured, providerName]);

  function applyPreset(name: string, presetBaseUrl: string, presetKeyless = false) {
    setProviderName(name);
    setBaseUrl(presetBaseUrl);
    setKeyless(presetKeyless);
    setModel('');
    setPicked(null);
    // The key is the only thing left to fill: if it is already saved, jump
    // straight to the model list; otherwise guide the user to the key field.
    if ((apiKeyConfigured || presetKeyless) && Platform.OS !== 'web') {
      setPickerVisible(true);
    }
  }

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
        alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'),
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
        alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'),
      );
    }
  }

  async function saveSettings() {
    if (!baseUrl.trim() || !model.trim()) {
      alertCompat('أكملي إعدادات الموديل', 'أضيفي Base URL واسم الموديل.');
      return;
    }
    if (!apiKey.trim() && !apiKeyConfigured && !keyless) {
      alertCompat('مفتاح API مطلوب', 'أضيفي مفتاح الموديل في الحقل الآمن، أو اختر مزودًا يعمل بدون مفتاح.');
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
          keyless,
        },
        apiKey,
      );
      setApiKey('');
      alertCompat('تم الحفظ', 'الإعدادات محفوظة على هذا الجهاز فقط.');
    } catch (error) {
      alertCompat(
        'تعذّر الحفظ',
        error instanceof Error ? error.message : 'حاولي مرة أخرى.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!baseUrl.trim() || !model.trim()) {
      alertCompat('أكملي إعدادات الموديل', 'أضيفي Base URL واسم الموديل أولًا.');
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
      alertCompat('الاتصال ناجح', 'استقبلنا ردًا من الموديل.');
    } catch (error) {
      alertCompat(
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
    alertCompat(
      'حذف مفتاح الموديل؟',
      'سيتم حذفه من خزنة هذا الجهاز. سيظل اسم الموديل ورابط الخدمة محفوظين.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف المفتاح',
          style: 'destructive',
          onPress: () => {
            void removeApiKey().catch(() =>
              alertCompat('تعذّر حذف المفتاح', 'حاولي مرة أخرى.'),
            );
          },
        },
      ],
    );
  }

  function confirmExport() {
    alertCompat(
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
            }).catch(() => alertCompat('تعذّر التصدير', 'حاولي من قائمة المشاركة.'));
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
      <ScreenTopBar active="settings" />
      {/* Plan card — honest summary of the real provider state; no fake commerce.
          The only real "upgrade" is choosing a paid model from your provider. */}
      <Surface style={styles.proCard}>
        <View style={styles.proHead}>
          <View style={[styles.proIcon, { backgroundColor: colors.accent }]}>
            <Feather name="award" size={19} color={colors.warning} />
          </View>
          <View style={styles.proCopy}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              تريد ميزات أكثر؟
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              كل ميزات التطبيق تعمل بالكامل على الخطة المجانية. الفرق الوحيد هو الموديل نفسه: الموديلات المدفوعة من مزودك تعطي جودة أعلى وسياقًا أكبر — تختارها من قائمة الموديلات عند إضافة مفتاح مزودك.
            </Text>
          </View>
        </View>
        <View style={[styles.planStatus, { backgroundColor: colors.accent }]}>
          <Feather
            name={provider.free ? 'zap' : 'trending-up'}
            size={13}
            color={colors.primary}
          />
          <Text style={[styles.planStatusText, { color: colors.primary }]} numberOfLines={1}>
            خطتك الحالية:{' '}
            {provider.model
              ? `${provider.free ? 'مجانية' : 'مدفوعة'} · ${provider.providerName} · ${provider.model}`
              : 'لم يتم اختيار موديل بعد'}
          </Text>
        </View>
        <ActionButton
          label="اختيار موديل من القائمة (مجاني أو مدفوع)"
          icon="list"
          variant="secondary"
          onPress={() => void openPicker()}
        />
      </Surface>

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
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            اختاري مزودًا جاهزًا بكبسة، أو اكتبي أي رابط OpenAI-compatible يدويًا:
          </Text>
          <View style={styles.presetWrap}>
            {PROVIDER_PRESETS.map((preset) => {
              const active = baseUrl.trim().replace(/\/+$/, '') === preset.baseUrl;
              return (
                <Pressable
                  key={preset.baseUrl}
                  accessibilityRole="button"
                  accessibilityLabel={`اختيار مزود ${preset.name}`}
                  onPress={() => applyPreset(preset.name, preset.baseUrl, Boolean(preset.keyless))}
                  style={[
                    styles.presetChip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + '22' : colors.background,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {preset.name}
                  </Text>
                  {preset.note ? (
                    <Text
                      style={[
                        styles.presetChipNote,
                        { color: active ? colors.primary : colors.mutedForeground },
                      ]}
                    >
                      {preset.note}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl.trim().replace(/\/+$/, ''))?.note ? (
            <Text style={[styles.body, { color: colors.primary }]}>
              {PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl.trim().replace(/\/+$/, ''))?.note}
              {apiKeyConfigured || apiKey.trim()
                ? ' — افتحي قائمة الموديلات واختاري، والفحص التلقائي هيوضحلك الكود جنب السعر.'
                : ' — الصقي مفتاح المزود في الحقل الآمن تحت، ثم افتحي قائمة الموديلات.'}
            </Text>
          ) : null}
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
          {probing || probe ? (
            <View style={styles.probeRow}>
              {probing ? (
                <Text style={[styles.probeText, { color: colors.mutedForeground }]}>
                  جارٍ الفحص التلقائي للموديل…
                </Text>
              ) : probe ? (
                <Text
                  style={[
                    styles.probeText,
                    { color: probe.ok ? colors.success : colors.destructive },
                  ]}
                >
                  {probe.status !== null ? `HTTP ${probe.status}` : 'HTTP ✗'}
                  {probe.ok
                    ? ' ✓ الموديل شغال — احفظي الإعدادات وابدأي الشات'
                    : probe.message
                      ? ` ✗ ${probe.message}`
                      : ' ✗'}
                </Text>
              ) : null}
            </View>
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
                  label="فتح صفحة التطبيق في إعدادات النظام (المسار الأسرع)"
                  icon="shield"
                  onPress={() =>
                    alertCompat(
                      'تفعيل إمكانية الوصول — 3 خطوات',
                      '1) من صفحة التطبيق اللي هتفتح: اضغطي "إمكانية الوصول" (أو من إعدادات النظام ← إمكانية الوصول) ← دوّري على "OneByte Agent" وشغّلي مفتاحه.\n\n' +
                        '2) لو المفتاح رمادي ومش بيتحرك (أندرويد 13+): من نفس صفحة التطبيقات ← اضغطي ⋮ (تلات نقط فوق) ← "السماح بالإعدادات المقيدة" ← فعّليها، ثم ارجعي للمفتاح.\n\n' +
                        '3) وافقي على تنبيه النظام. تقدري توقفيه في أي وقت من نفس المكان.',
                      [
                        { text: 'إلغاء', style: 'cancel' },
                        { text: 'فتح صفحة التطبيق', onPress: () => Device.openAppDetailsSettings() },
                        { text: 'صفحة إمكانية الوصول', onPress: () => Device.openAccessibilitySettings() },
                      ],
                    )
                  }
                />
              ) : null}
              {agent.autoApprovedTools.length ? (
                <View style={{ gap: 6 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    موافقات محفوظة "دائمًا" (اضغطي للتراجع):
                  </Text>
                  <View style={styles.presetWrap}>
                    {agent.autoApprovedTools.map((key) => (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityLabel={`إزالة الموافقة الدائمة على ${key}`}
                        onPress={() =>
                          void saveAgentSettings({
                            autoApprovedTools: agent.autoApprovedTools.filter((k) => k !== key),
                          }).catch(() => alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'))
                        }
                        style={[styles.presetChip, { borderColor: colors.success, minWidth: '45%' }]}
                      >
                        <Text style={[styles.presetChipText, { color: colors.success }]}>{key}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
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
            onBlur={commitWorkingTokens}
            keyboardType="number-pad"
            style={styles.urlInput}
            hint="كلما زاد الرقم زادت التكلفة. يُستخدم الأقل بين هذا الرقم و60% من سياق الموديل."
          />
          <FormField
            label="أقصى عدد خطوات للمهمة الواحدة"
            value={maxStepsText}
            onChangeText={setMaxStepsText}
            onEndEditing={commitMaxSteps}
            onBlur={commitMaxSteps}
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
        <SectionTitle title="المظهر" />
        <Surface style={styles.formCard}>
          <View style={styles.presetWrap}>
            {(
              [
                ['system', 'تلقائي (النظام)'],
                ['light', 'فاتح'],
                ['dark', 'داكن'],
              ] as [ThemePreference, string][]
            ).map(([value, label]) => {
              const active = appearance.theme === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`ثيم ${label}`}
                  onPress={() =>
                    void saveAppearanceSettings({ theme: value }).catch(() =>
                      alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'),
                    )
                  }
                  style={[
                    styles.presetChip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active
                        ? colors.primary + '22'
                        : colors.background,
                      minWidth: '30%',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Accent colors — every screen follows the pick; text on the
              accent stays contrast-safe in light and dark themes. */}
          <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 14 }]}>
            لون الثيم
          </Text>
          <View style={styles.presetWrap}>
            {(Object.keys(ACCENTS) as AccentKey[]).map((key) => {
              const swatch = ACCENTS[key];
              const active = appearance.accent === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`لون ${key}`}
                  onPress={() =>
                    void saveAppearanceSettings({ accent: key }).catch(() =>
                      alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'),
                    )
                  }
                  style={[
                    styles.accentSwatch,
                    { borderColor: active ? colors.foreground : 'transparent' },
                  ]}
                >
                  <View
                    style={[styles.accentDot, { backgroundColor: swatch.primary }]}
                  >
                    {active ? (
                      <Feather name="check" size={14} color={swatch.primaryForeground} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="لون الخط" />
        <Surface style={styles.formCard}>
          <View style={styles.presetWrap}>
            {FONT_COLORS.map((color) => {
              const active = appearance.fontColor === color;
              return (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={`لون الخط ${color}`}
                  onPress={() =>
                    void saveAppearanceSettings({ fontColor: color }).catch(() =>
                      alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'),
                    )
                  }
                  style={[
                    styles.accentSwatch,
                    { borderColor: active ? colors.foreground : 'transparent' },
                  ]}
                >
                  <View style={[styles.accentDot, { backgroundColor: color }]} />
                </Pressable>
              );
            })}
          </View>
        </Surface>
      </View>

      <View style={styles.section}>
        <SectionTitle title="اللغة" />
        <Surface style={styles.formCard}>
          <View style={styles.presetWrap}>
            {LANGUAGES.map((lang) => {
              const active = pendingLanguage === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  accessibilityRole="button"
                  accessibilityLabel={`اختيار اللغة ${lang.native}`}
                  onPress={() => setPendingLanguage(lang.code)}
                  style={[
                    styles.presetChip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active
                        ? colors.primary + '22'
                        : colors.background,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      { color: active ? colors.primary : colors.foreground },
                    ]}
                  >
                    {lang.native}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <ActionButton
            label="حفظ اللغة"
            icon="save"
            variant="secondary"
            onPress={() =>
              void saveAppearanceSettings({ language: pendingLanguage }).catch(() =>
                alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'),
              )
            }
          />
          <Text style={[styles.body, { color: colors.mutedForeground, marginTop: 8 }]}>
            تغيّر لغة ردود الموديل فورًا، وباقي الشاشات تترجم تدريجيًا (الشات مترجم بالكامل).
          </Text>
        </Surface>
      </View>

      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowResponseStyle((v) => !v)}
          style={styles.sectionHead}
        >
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            أسلوب الرد (باك إند)
          </Text>
          <Feather
            name={showResponseStyle ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.primary}
          />
        </Pressable>
        {showResponseStyle ? (
          <Surface style={styles.formCard}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              ضوابط تعمل في الخلفية: كل رد يمرّ عليها قبل وصوله إليك — بلا خطوة إضافية ولا تأخير.
            </Text>
            {(Object.keys(RESPONSE_STYLE_LABELS) as (keyof ResponseStyle)[]).map((field) => {
              const options = RESPONSE_STYLE_LABELS[field];
              const current = agent.responseStyle?.[field];
              return (
                <View key={field} style={{ marginTop: 12 }}>
                  <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                    {field === 'title'
                      ? 'العنوان'
                      : field === 'links'
                        ? 'الروابط'
                        : field === 'diagram'
                          ? 'الدياجرام (flowchart)'
                          : field === 'markdown'
                            ? 'الماركداون'
                            : field === 'length'
                              ? 'الطول'
                              : 'النبرة'}
                  </Text>
                  <View style={styles.presetWrap}>
                    {(Object.keys(options) as string[]).map((opt) => {
                      const active = current === opt;
                      return (
                        <Pressable
                          key={opt}
                          accessibilityRole="button"
                          accessibilityLabel={`${field}: ${options[opt]}`}
                          onPress={() =>
                            void saveAgentSettings({
                              responseStyle: {
                                ...(agent.responseStyle ?? {}),
                                [field]: opt,
                              } as ResponseStyle,
                            }).catch(() => alertCompat('تعذّر الحفظ', 'حاولي مرة أخرى.'))
                          }
                          style={[
                            styles.presetChip,
                            {
                              borderColor: active ? colors.primary : colors.border,
                              backgroundColor: active
                                ? colors.primary + '22'
                                : colors.background,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              { color: active ? colors.primary : colors.foreground },
                            ]}
                          >
                            {options[opt]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </Surface>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionTitle title="التحكم من الكمبيوتر" />
        <Surface style={styles.formCard}>
          <View style={styles.switchRow}>
            <Switch
              value={pcRunning}
              onValueChange={(v) => void togglePcServer(v)}
              disabled={pcBusy}
            />
            <View style={styles.connectionCopy}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                تشغيل خادم ويب للكمبيوتر
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                افتحي المتصفح على الكمبيوتر (نفس الواي فاي) وادخلي الرابط ورمز التفويض. نفس تصميم التطبيق ونفس المهام، وطلبات الموافقة تظهر هنا على الهاتف.
              </Text>
            </View>
          </View>
          {pcRunning ? (
            <>
              <StatusPill label={`الرمز: ${getPcAccess().pin || pcAccess.pin || '—'}`} tone="success" />
              <Text style={[styles.body, { color: colors.primary, textAlign: 'left', writingDirection: 'ltr' }]}>
                {getPcAccess().url || pcAccess.url || '—'}
              </Text>
              {pendingPcApproval ? (
                <View style={[styles.pcApproval, { borderColor: colors.warning }]}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                    طلب من الكمبيوتر: {pendingPcApproval.spec.label}
                  </Text>
                  <Text style={[styles.body, { color: colors.mutedForeground, textAlign: 'left', writingDirection: 'ltr' }]}>
                    {JSON.stringify(pendingPcApproval.args).slice(0, 300)}
                  </Text>
                  <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                    <ActionButton
                      label="موافق (هذه المرة)"
                      icon="check"
                      onPress={() => {
                        pendingPcApproval.resolve('once');
                        setPendingPcApproval(null);
                      }}
                    />
                    <ActionButton
                      label="رفض"
                      icon="x"
                      variant="danger"
                      onPress={() => {
                        pendingPcApproval.resolve('deny');
                        setPendingPcApproval(null);
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : !Device.pcServerAvailable() ? (
            <Text style={[styles.body, { color: colors.warning }]}>
              خادم الكمبيوتر متاح فقط في نسخة أندرويد المثبتة من التطبيق (ليست متاحة على الويب أو Expo Go).
            </Text>
          ) : null}
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
        currentModel={provider.model}
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
  proCard: { gap: 12 },
  proHead: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  proIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  proCopy: { flex: 1, alignItems: 'flex-end', gap: 5 },
  planStatus: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  planStatusText: { flex: 1, fontSize: 11.5, fontWeight: '800', textAlign: 'right' },
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
  sectionHead: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  formCard: { gap: 14 },
  presetWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  presetChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: '30%',
    alignItems: 'center',
  },
  presetChipText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  presetChipNote: { fontSize: 9, marginTop: 2, textAlign: 'center' },
  accentSwatch: {
    borderWidth: 2,
    borderRadius: 999,
    padding: 2,
  },
  accentDot: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldLabel: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  pcApproval: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  priceRow: { gap: 4, alignItems: 'flex-end' },
  probeRow: { alignItems: 'flex-end' },
  probeText: { fontSize: 12, fontWeight: '700', textAlign: 'right' },
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
