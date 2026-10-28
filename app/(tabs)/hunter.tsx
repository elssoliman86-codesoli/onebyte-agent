import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';
import { useAssistant } from '@/src/assistant';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import {
  analysisPrompt,
  isAuthorized,
  loadHunterLog,
  loadTargets,
  runRequest,
  saveHunterLog,
  saveTargets,
  hostOf,
  type HunterLogEntry,
  type HunterRequest,
  type HunterTarget,
  type RunResult,
} from '@/src/hunter';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

/**
 * Bug Hunter — legal, scope-enforced request studio.
 *
 * A request can only leave the app when its host matches a target the user
 * explicitly authorized. Responses and every send are logged as evidence.
 * The sub-agent analysis runs in a tagged hunter chat, never silently.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type Method = (typeof METHODS)[number];

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (key) out[key] = val;
    }
  }
  return out;
}

function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

export default function HunterScreen() {
  const colors = useColors();
  const { setPendingPrompt, createSession, patchSession } = useAssistant();
  const [targets, setTargets] = useState<HunterTarget[]>([]);
  const [log, setLog] = useState<HunterLogEntry[]>([]);
  const [search, setSearch] = useState('');

  // New target form
  const [hostInput, setHostInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [authInput, setAuthInput] = useState('');

  // Request builder
  const [method, setMethod] = useState<Method>('GET');
  const [url, setUrl] = useState('https://');
  const [headersText, setHeadersText] = useState('');
  const [bodyText, setBodyText] = useState('');

  // Result + busy
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void (async () => {
      const [t, l] = await Promise.all([loadTargets(), loadHunterLog()]);
      setTargets(t);
      setLog(l);
    })();
  }, []);

  async function addTarget() {
    const host = normalizeHost(hostInput);
    if (!host || !host.includes('.')) {
      alertCompat('نطاق غير صالح', 'مثال: example.com — بنفحص النطاقات الفرعية منه تلقائيًا.');
      return;
    }
    if (!authInput.trim()) {
      alertCompat('التصريح مطلوب', 'اكتب أساس التصريح: برنامج bug bounty، أو ملكية الخادم — بدون تصريح الإرسال مرفوض.');
      return;
    }
    if (targets.some((t) => t.host === host)) {
      alertCompat('موجود بالفعل', `النطاق ${host} في قايمة التارجت.`);
      return;
    }
    const target: HunterTarget = {
      id: `target-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      host,
      note: noteInput.trim(),
      authorization: authInput.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [target, ...targets];
    await saveTargets(next);
    setTargets(next);
    setHostInput('');
    setNoteInput('');
    setAuthInput('');
  }

  function removeTarget(target: HunterTarget) {
    alertCompat('حذف التارجت؟', `${target.host} هيتشال من السكوب المصرح به.`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            const next = targets.filter((t) => t.id !== target.id);
            await saveTargets(next);
            setTargets(next);
          })(),
      },
    ]);
  }

  function draftRequest(): HunterRequest {
    return {
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      method,
      url: url.trim(),
      headers: parseHeaders(headersText),
      body: bodyText,
      createdAt: new Date().toISOString(),
    };
  }

  async function appendLog(entry: HunterLogEntry) {
    const next = [entry, ...log].slice(0, 120);
    await saveHunterLog(next);
    setLog(next);
  }

  async function sendRequest() {
    const req = draftRequest();
    // Hard scope gate — enforced here, not just suggested.
    const auth = isAuthorized(req.url, targets);
    if (!auth.ok) {
      alertCompat('مرفوض — خارج السكوب', auth.reason);
      return;
    }
    setBusy('send');
    const result = await runRequest(req);
    setLastResult(result);
    await appendLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      requestId: req.id,
      method: req.method,
      url: req.url,
      status: result.status,
      ok: result.ok,
      ms: result.ms,
      detail: result.detail,
      responsePreview: result.body.slice(0, 600),
      at: new Date().toISOString(),
    });
    setBusy('');
  }

  function previewEntry(entry: HunterLogEntry) {
    alertCompat(
      `${entry.method} ${entry.status ?? '—'}`,
      `${entry.detail}\n\nمقتطف الاستجابة:\n${entry.responsePreview || '(فاضية)'}`,
    );
  }

  function clearLog() {
    alertCompat('تفريغ السجل؟', 'كل مدخلات الفحص هتمسح من هذا الجهاز.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تفريغ',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            await saveHunterLog([]);
            setLog([]);
          })(),
      },
    ]);
  }

  function askAgent(entry: HunterLogEntry) {
    void (async () => {
      const sessionId = await createSession();
      await patchSession(sessionId, { mode: 'hunter' });
      setPendingPrompt(analysisPrompt(entry));
      router.push('/(tabs)');
    })();
  }

  function askAgentOnDraft() {
    void (async () => {
      const sessionId = await createSession();
      await patchSession(sessionId, { mode: 'hunter' });
      const headerLines = Object.entries(parseHeaders(headersText))
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      setPendingPrompt(
        [
          'اقترح اختبارات آمنة على هذا الطلب (تارجت مصرح به من قايمتي):',
          `الطلب: ${method} ${url.trim()}`,
          headerLines ? `الهيدرز:\n${headerLines}` : '',
          bodyText.trim() ? `البودي:\n${bodyText.slice(0, 1500)}` : '',
          'المطلوب: نقاط ضعف محتملة في الطلب، اختبارات غير مدمرة (فحص قراءة، إعادة إرسال بنطاق محدود)، وترتيب التنفيذ — بدون تنفيذ فعلي منك.',
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
      router.push('/(tabs)');
    })();
  }

  const filteredLog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return log;
    return log.filter(
      (e) =>
        e.url.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        String(e.status ?? '').includes(q),
    );
  }, [log, search]);

  return (
    <>
      <AppScreen
        title="صياد الثغرات"
        eyebrow="قانوني فقط — سكوب مصرح به"
        subtitle="باني طلبات مع فحص صارم للتصريح، استجابة حقيقية، وسجل كدليل — وتحليل بالوكيل في شات مخصص."
      >
        <ScreenTopBar active="hunter" />

        {/* Legal notice */}
        <Surface style={styles.card}>
          <View style={styles.legalRow}>
            <Feather name="shield" size={17} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>قواعد الاستخدام</Text>
          </View>
          <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
            الاختبار مسموح فقط على أنظمة تملكها أو مصرح لك باختبارها (برنامج bug bounty موثّق). أي
            طلب لنطاق خارج قايمة التارجت بيرفضه التطبيق نفسه. ممنوع: DoS، الاستغلال المدمّر، الوصول
            لبيانات غير مصرح بها. المتصفح المدمج مش بديل كامل عن أدوات اعتراض HTTPS — بنبدأ بالطلبات
            اللي بتتكتب هنا وبتنعاد بفعليك.
          </Text>
        </Surface>

        {/* Targets / scopes */}
        <View style={styles.section}>
          <SectionTitle title={`التارجت والسكوب (${targets.length})`} />
          {targets.length ? (
            targets.map((target) => (
              <Surface key={target.id} style={styles.card}>
                <View style={styles.targetHead}>
                  <Feather name="crosshair" size={15} color={colors.primary} />
                  <Text style={[styles.targetHost, { color: colors.foreground }]} numberOfLines={1}>
                    {target.host}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`حذف ${target.host}`}
                    hitSlop={6}
                    onPress={() => removeTarget(target)}
                  >
                    <Feather name="trash-2" size={14} color={colors.destructive} />
                  </Pressable>
                </View>
                {target.note ? (
                  <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{target.note}</Text>
                ) : null}
                <StatusPill label={target.authorization} tone="success" />
              </Surface>
            ))
          ) : (
            <EmptyState
              icon="crosshair"
              title="لا تارجت بعد"
              message="أضف نطاقًا مصرحًا به — الإرسال خارج السكوب مرفوض بالكامل."
            />
          )}
          <Surface style={styles.card}>
            <FormField label="النطاق" value={hostInput} onChangeText={setHostInput} placeholder="example.com" autoCapitalize="none" autoCorrect={false} />
            <FormField label="ملاحظة (اختياري)" value={noteInput} onChangeText={setNoteInput} placeholder="تارجت برنامج نقاط ثغرات…" />
            <FormField
              label="أساس التصريح (إلزامي)"
              value={authInput}
              onChangeText={setAuthInput}
              placeholder="برنامج bounty على hackerone/scope يشمل النطاق، أو خادمي الخاص"
              hint="بدون تصريح مكتوب، التطبيق مش هيبعت أي طلب للنطاق ده."
            />
            <ActionButton label="إضافة تارجت" icon="plus" onPress={() => void addTarget()} />
          </Surface>
        </View>

        {/* Request builder */}
        <View style={styles.section}>
          <SectionTitle title="باني الطلب (Burp-lite)" />
          <Surface style={styles.card}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>الطريقة</Text>
            <View style={styles.chipWrap}>
              {METHODS.map((m) => {
                const active = m === method;
                return (
                  <Pressable
                    key={m}
                    accessibilityRole="button"
                    accessibilityLabel={`طريقة ${m}`}
                    onPress={() => setMethod(m)}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary + '22' : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? colors.primary : colors.mutedForeground,
                        fontSize: 12,
                        fontWeight: '800',
                      }}
                    >
                      {m}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <FormField
              label="الرابط (داخل السكوب)"
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com/api/v1/…"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <FormField
              label="الهيدرز — سطر لكل هيدر بصيغة Key: value"
              value={headersText}
              onChangeText={setHeadersText}
              placeholder={'Content-Type: application/json\nAuthorization: Bearer …'}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!['GET', 'HEAD'].includes(method) ? (
              <FormField
                label="البودي"
                value={bodyText}
                onChangeText={setBodyText}
                placeholder='{"key": "value"}'
                multiline
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            <View style={styles.rowBtns}>
              <ActionButton
                label="إرسال حقيقي"
                icon="send"
                onPress={() => void sendRequest()}
                disabled={busy === 'send'}
              />
              <ActionButton
                label="اسأل الوكيل عن الاختبار"
                icon="message-circle"
                variant="secondary"
                onPress={askAgentOnDraft}
              />
            </View>
          </Surface>

          {/* Response panel */}
          {lastResult ? (
            <Surface style={styles.card}>
              <View style={styles.targetHead}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>الاستجابة</Text>
                <StatusPill
                  label={lastResult.status !== null ? `HTTP ${lastResult.status}` : 'فشل شبكة'}
                  tone={lastResult.status !== null && lastResult.status < 400 ? 'success' : 'danger'}
                />
                <Text style={[styles.msText, { color: colors.mutedForeground }]}>{lastResult.ms}ms</Text>
              </View>
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>{lastResult.detail}</Text>
              {Object.keys(lastResult.headers).length ? (
                <Text
                  style={[styles.ltrText, { color: colors.mutedForeground }]}
                  selectable
                >
                  {Object.entries(lastResult.headers)
                    .slice(0, 14)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('\n')}
                </Text>
              ) : null}
              {lastResult.body ? (
                <Text style={[styles.ltrText, { color: colors.foreground }]} selectable>
                  {lastResult.body.slice(0, 3000)}
                  {lastResult.body.length > 3000 ? '\n…(مقتطع)' : ''}
                </Text>
              ) : null}
            </Surface>
          ) : null}
        </View>

        {/* Log */}
        <View style={styles.section}>
          <SectionTitle
            title={`سجل الفحص (${log.length})`}
            trailing={
              log.length ? (
                <Pressable accessibilityRole="button" onPress={clearLog} hitSlop={4}>
                  <Text style={{ color: colors.destructive, fontSize: 12, fontWeight: '700' }}>تفريغ</Text>
                </Pressable>
              ) : null
            }
          />
          {log.length ? (
            <FormField
              label="بحث في السجل"
              value={search}
              onChangeText={setSearch}
              placeholder="نطاق أو طريقة أو كود حالة…"
              autoCapitalize="none"
            />
          ) : null}
          {filteredLog.length ? (
            filteredLog.slice(0, 30).map((entry) => (
              <Surface key={entry.id} style={styles.card}>
                <View style={styles.targetHead}>
                  <StatusPill
                    label={entry.status !== null ? String(entry.status) : 'فشل'}
                    tone={entry.ok ? 'success' : 'danger'}
                  />
                  <Text style={[styles.targetHost, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                    {entry.method} · {entry.url}
                  </Text>
                </View>
                <Text style={[styles.bodyText, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {entry.detail}
                </Text>
                <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                  {new Date(entry.at).toLocaleString('ar-EG')}
                </Text>
                <View style={styles.rowBtns}>
                  <ActionButton label="التفاصيل" icon="eye" variant="quiet" onPress={() => previewEntry(entry)} />
                  <ActionButton
                    label="حلل بالوكيل"
                    icon="cpu"
                    variant="secondary"
                    onPress={() => askAgent(entry)}
                  />
                </View>
              </Surface>
            ))
          ) : log.length ? (
            <EmptyState icon="search" title="لا نتائج" message="جرب كلمة بحث تانية." />
          ) : (
            <EmptyState
              icon="inbox"
              title="السجل فاضي"
              message="كل طلب بتتبعته هنا بيتسجل بالحالة والوقت كدليل قانوني."
            />
          )}
        </View>
      </AppScreen>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 9, padding: 14, borderRadius: 16 },
  section: { marginTop: 18, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  bodyText: { fontSize: 12.5, lineHeight: 19, textAlign: 'right' },
  legalRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  targetHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  targetHost: { fontSize: 13, fontWeight: '800' },
  msText: { fontSize: 11.5 },
  fieldLabel: { fontSize: 12.5, fontWeight: '700', textAlign: 'right' },
  chipWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  rowBtns: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  ltrText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
