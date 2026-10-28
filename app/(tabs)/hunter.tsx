import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { AppScreen, Surface } from '@/components/Ui';
import { alertCompat } from '@/src/web-alert';
import {
  hostOf,
  isAuthorized,
  loadHunterLog,
  loadTargets,
  saveTargets,
  runRequest,
  saveHunterLog,
  type HunterLogEntry,
  type HunterRequest,
  type HunterTarget,
} from '@/src/hunter';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export default function CyberSecurityScreen() {
  const colors = useColors();
  const [targets, setTargets] = useState<HunterTarget[]>([]);
  const [log, setLog] = useState<HunterLogEntry[]>([]);
  const [targetHost, setTargetHost] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('{"Accept":"*/*"}');
  const [body, setBody] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HunterLogEntry | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    const [nextTargets, nextLog] = await Promise.all([loadTargets(), loadHunterLog()]);
    if (aliveRef.current) {
      setTargets(nextTargets);
      setLog(nextLog);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, [refresh]);

  async function addTarget() {
    const normalized = targetHost.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
    if (!normalized || /[\s/@?#]/.test(normalized)) {
      alertCompat('نطاق غير صالح', 'اكتب اسم النطاق فقط، مثل example.com.');
      return;
    }
    if (!authorization.trim()) {
      alertCompat('التأكيد مطلوب', 'اكتب مصدر الإذن أو رابط برنامج HackerOne ونطاق الاختبار المسموح.');
      return;
    }
    const next: HunterTarget = {
      id: `scope-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      host: normalized,
      note: 'Added by the user',
      authorization: authorization.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [next, ...targets.filter((item) => item.host !== normalized)];
    await saveTargets(updated);
    setTargets(updated);
    setTargetHost('');
    setAuthorization('');
    setError('');
  }

  async function sendRequest() {
    if (running) return;
    setError('');
    setResult(null);
    let parsedHeaders: Record<string, string>;
    try {
      const parsed = JSON.parse(headersText || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Headers must be a JSON object.');
      parsedHeaders = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch {
      setError('الهيدرز لازم تكون JSON صحيح، مثل {"Accept":"application/json"}.');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      setError('الرابط غير صالح. استخدم رابط HTTP أو HTTPS كاملًا.');
      return;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      setError('المختبر يسمح بطلبات HTTP وHTTPS فقط.');
      return;
    }
    const scope = isAuthorized(parsedUrl.toString(), targets);
    if (!scope.ok) {
      setError(scope.reason);
      return;
    }
    if (!['GET', 'HEAD'].includes(method) && !body.trim()) {
      // Empty bodies are valid for PUT/POST too, but warn about likely accidental omission.
    }

    const request: HunterRequest = {
      id: `request-${Date.now()}`,
      method,
      url,
      headers: parsedHeaders,
      body,
      createdAt: new Date().toISOString(),
    };
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    const started = Date.now();
    try {
      const response = await runRequest(request, controller.signal);
      const entry: HunterLogEntry = {
        id: `log-${Date.now()}`,
        requestId: request.id,
        method,
        url,
        status: response.status,
        ok: response.ok,
        ms: response.ms || Date.now() - started,
        detail: response.detail,
        responsePreview: response.body.slice(0, 12_000),
        at: new Date().toISOString(),
      };
      const next = [entry, ...(await loadHunterLog())].slice(0, 120);
      await saveHunterLog(next);
      if (aliveRef.current) {
        setResult(entry);
        setLog(next);
        if (controller.signal.aborted) setError('تم طلب إيقاف الطلب. راجع حالة الاستجابة أدناه.');
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : 'فشل الطلب.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (aliveRef.current) setRunning(false);
    }
  }

  function stopRequest() {
    abortRef.current?.abort();
  }

  async function openHistory(entry: HunterLogEntry) {
    setResult(entry);
    setMethod(entry.method);
    setUrl(entry.url);
  }

  return (
    <AppScreen
      title="Cybersecurity Lab"
      eyebrow="Authorized HTTP testing"
      subtitle="عدّل الطلبات وأرسلها وأوقفها واقرأ الاستجابة. أضف نطاقًا مصرحًا به أولًا؛ لا يتم إرسال طلبات خارج النطاق."
      topBar={<ScreenTopBar active="hunter" />}
    >
      <Surface style={styles.scopeCard}>
        <View style={styles.sectionHeading}>
          <Feather name="shield" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>نطاقات الاختبار المصرّح بها</Text>
        </View>
        <TextInput
          value={targetHost}
          onChangeText={setTargetHost}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="example.com"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <TextInput
          value={authorization}
          onChangeText={setAuthorization}
          placeholder="رابط برنامج HackerOne أو تفاصيل الإذن والـscope"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[styles.input, styles.multiline, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <Pressable onPress={() => void addTarget()} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Feather name="plus-circle" size={16} color={colors.primaryForeground} />
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>إضافة النطاق</Text>
        </Pressable>
        {targets.length ? targets.map((target) => (
          <View key={target.id} style={[styles.scopeRow, { borderColor: colors.border }]}>
            <Feather name="check-circle" size={15} color={colors.primary} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.scopeHost, { color: colors.foreground }]}>{target.host}</Text>
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>{target.authorization}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`حذف نطاق ${target.host}`} onPress={() => {
              const next = targets.filter((item) => item.id !== target.id);
              setTargets(next);
              void saveTargets(next);
            }}>
              <Feather name="trash-2" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )) : (
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>لا توجد نطاقات مضافة بعد. يمكنك إضافة نطاقات برنامج HackerOne أو أنظمة تملكها أو لديك تصريح مكتوب لاختبارها.</Text>
        )}
      </Surface>

      <Surface style={styles.requestCard}>
        <View style={styles.sectionHeading}>
          <Feather name="git-pull-request" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>HTTP Request Editor</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.methods}>
          {METHODS.map((item) => (
            <Pressable key={item} onPress={() => setMethod(item)} style={[styles.method, { borderColor: method === item ? colors.primary : colors.border, backgroundColor: method === item ? colors.accent : colors.background }]}>
              <Text style={[styles.methodText, { color: method === item ? colors.primary : colors.foreground }]}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://example.com/path?param=value"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Headers (JSON)</Text>
        <TextInput
          value={headersText}
          onChangeText={setHeadersText}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          textAlignVertical="top"
          placeholder='{"Accept":"application/json"}'
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, styles.codeInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        {!['GET', 'HEAD'].includes(method) ? (
          <>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Request Body</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              autoCapitalize="none"
              multiline
              textAlignVertical="top"
              placeholder="JSON أو نص الطلب"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, styles.codeInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
          </>
        ) : null}
        <View style={styles.actions}>
          <Pressable disabled={running} onPress={() => void sendRequest()} style={[styles.primaryButton, { flex: 1, backgroundColor: colors.primary, opacity: running ? 0.6 : 1 }]}>
            {running ? <ActivityIndicator color={colors.primaryForeground} size="small" /> : <Feather name="send" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>{running ? 'جارٍ الإرسال…' : 'إرسال الطلب'}</Text>
          </Pressable>
          <Pressable disabled={!running} onPress={stopRequest} style={[styles.stopButton, { borderColor: colors.border, opacity: running ? 1 : 0.45 }]}>
            <Feather name="square" size={15} color={'#FF5F56'} />
            <Text style={[styles.primaryText, { color: '#FF5F56' }]}>إيقاف</Text>
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={[styles.error, { color: '#FF5F56' }]}>{error}</Text> : null}
      </Surface>

      {result ? (
        <Surface style={styles.resultCard}>
          <View style={styles.sectionHeading}>
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Response</Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.status, { color: result.status && result.status < 400 ? colors.primary : '#FF5F56' }]}>{result.status ?? 'NETWORK'} · {result.ms} ms</Text>
          </View>
          <Text selectable style={[styles.muted, { color: colors.mutedForeground }]}>{result.method} {result.url}</Text>
          <Text selectable style={[styles.codeBlock, { color: colors.foreground, backgroundColor: colors.background }]}>{result.responsePreview || result.detail}</Text>
          <Pressable onPress={() => {
            setMethod(result.method);
            setUrl(result.url);
          }} style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Feather name="rotate-ccw" size={15} color={colors.foreground} />
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>إعادة تجهيز الطلب</Text>
          </Pressable>
        </Surface>
      ) : null}

      <Surface style={styles.historyCard}>
        <View style={styles.sectionHeading}>
          <Feather name="clock" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>سجل الطلبات</Text>
        </View>
        {log.length ? log.slice(0, 12).map((entry) => (
          <Pressable key={entry.id} onPress={() => void openHistory(entry)} style={[styles.historyRow, { borderColor: colors.border }]}>
            <View style={[styles.methodBadge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.methodText, { color: colors.primary }]}>{entry.method}</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text numberOfLines={1} style={[styles.scopeHost, { color: colors.foreground }]}>{hostOf(entry.url)}{URLSafePath(entry.url)}</Text>
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>{entry.detail}</Text>
            </View>
            <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
          </Pressable>
        )) : <Text style={[styles.muted, { color: colors.mutedForeground }]}>طلباتك ونتائجها هتظهر هنا بعد الإرسال.</Text>}
      </Surface>

      <Text style={[styles.footer, { color: colors.mutedForeground }]}>
        ملاحظات مهمة: إيقاف الطلب يعتمد على دعم الشبكة للإلغاء، وقراءة الردود الكبيرة محدودة لحماية الذاكرة. في نسخة الويب، قد تمنع CORS بعض الطلبات؛ أندرويد يتبع صلاحيات الشبكة الخاصة به. لا تستخدم أدوات الاختبار خارج النطاق المصرّح.
      </Text>
    </AppScreen>
  );
}

function URLSafePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  scopeCard: { gap: 10, padding: 13 },
  requestCard: { gap: 11, padding: 13 },
  resultCard: { gap: 10, padding: 13 },
  historyCard: { gap: 10, padding: 13 },
  sectionHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '800', textAlign: 'right' },
  input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 10, minHeight: 43, fontSize: 12, textAlign: 'right' },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  codeInput: { minHeight: 92, fontFamily: 'monospace', textAlign: 'left' },
  fieldLabel: { fontSize: 12, fontWeight: '700', textAlign: 'right' },
  methods: { flexDirection: 'row', gap: 7, paddingVertical: 2 },
  method: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 },
  methodText: { fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  primaryButton: { minHeight: 43, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, paddingHorizontal: 12 },
  primaryText: { fontSize: 12, fontWeight: '800' },
  stopButton: { minHeight: 43, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryButton: { minHeight: 38, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryText: { fontSize: 12, fontWeight: '700' },
  scopeRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9 },
  scopeHost: { fontSize: 12, fontWeight: '700', textAlign: 'left' },
  muted: { fontSize: 11, lineHeight: 17, textAlign: 'right' },
  error: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  status: { fontSize: 12, fontWeight: '800' },
  codeBlock: { padding: 11, borderRadius: 10, fontFamily: 'monospace', fontSize: 11, lineHeight: 18, textAlign: 'left' },
  methodBadge: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  historyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9 },
  footer: { fontSize: 11, lineHeight: 18, textAlign: 'right', marginBottom: 12 },
});
