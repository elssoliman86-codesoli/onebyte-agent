import React, { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { AppScreen, Surface } from '@/components/Ui';
import { alertCompat } from '@/src/web-alert';
import { loadHunterRuns, runBrowserRecon, runSafeHttpHeaderChecks, type HunterRunRecord } from '@/src/hunter-tools';
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
import { normalizeTargetPattern } from '@/src/hunter-scope';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export default function CyberSecurityScreen() {
  const colors = useColors();
  const routeParams = useLocalSearchParams<{ capturedMethod?: string | string[]; capturedUrl?: string | string[]; capturedHeaders?: string | string[]; capturedBody?: string | string[]; capturedAt?: string | string[] }>();
  const [targets, setTargets] = useState<HunterTarget[]>([]);
  const [log, setLog] = useState<HunterLogEntry[]>([]);
  const [targetHost, setTargetHost] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [showRequestEditor, setShowRequestEditor] = useState(false);
  const [authorization, setAuthorization] = useState('');
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('{"Accept":"*/*"}');
  const [body, setBody] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HunterLogEntry | null>(null);
  const [error, setError] = useState('');
  const [huntRunning, setHuntRunning] = useState(false);
  const [safeChecksRunning, setSafeChecksRunning] = useState(false);
  const [activePanel, setActivePanel] = useState<'overview' | 'request' | 'activity'>('overview');
  const [lastHunt, setLastHunt] = useState<HunterRunRecord | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const lastImportedCaptureRef = useRef('');
  const capturedMethod = Array.isArray(routeParams.capturedMethod) ? routeParams.capturedMethod[0] : routeParams.capturedMethod;
  const capturedUrl = Array.isArray(routeParams.capturedUrl) ? routeParams.capturedUrl[0] : routeParams.capturedUrl;
  const capturedHeaders = Array.isArray(routeParams.capturedHeaders) ? routeParams.capturedHeaders[0] : routeParams.capturedHeaders;
  const capturedBody = Array.isArray(routeParams.capturedBody) ? routeParams.capturedBody[0] : routeParams.capturedBody;
  const capturedAt = Array.isArray(routeParams.capturedAt) ? routeParams.capturedAt[0] : routeParams.capturedAt;

  const refresh = useCallback(async () => {
    const [nextTargets, nextLog, nextRuns] = await Promise.all([loadTargets(), loadHunterLog(), loadHunterRuns()]);
    if (aliveRef.current) {
      setTargets(nextTargets);
      setLog(nextLog);
      setLastHunt(nextRuns[0] ?? null);
      setSelectedTargetId((current) => current && nextTargets.some((target) => target.id === current) ? current : nextTargets.find((target) => isAuthorized(`https://${target.host.startsWith('*.') ? 'www.' + target.host.slice(2) : target.host}/`, [target]).ok)?.id ?? null);
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

  useEffect(() => {
    if (!capturedUrl) return;
    const signature = [capturedAt || '', capturedMethod || '', capturedUrl, capturedHeaders || '', capturedBody || ''].join('|');
    if (lastImportedCaptureRef.current === signature) return;
    lastImportedCaptureRef.current = signature;
    const upperMethod = (capturedMethod || 'GET').toUpperCase();
    setMethod(METHODS.includes(upperMethod) ? upperMethod : 'GET');
    setUrl(capturedUrl);
    setHeadersText(capturedHeaders || '{"Accept":"*/*"}');
    setBody(capturedBody || '');
    setResult(null);
    setError('تم استيراد الطلب الملتقط. راجع الرابط والهيدرز، وسيظل الإرسال ممنوعًا خارج النطاق المسجل. المفاتيح السرية حُجبت أثناء الالتقاط.');
  }, [capturedAt, capturedMethod, capturedUrl, capturedHeaders, capturedBody]);

  async function addTarget() {
    const normalized = normalizeTargetPattern(targetHost);
    if (!normalized) {
      alertCompat('نطاق غير صالح', 'اكتب اسم المضيف فقط مثل example.com. استخدم *.example.com فقط إذا كان التصريح يشمل النطاقات الفرعية صراحةً. لا تضع مسارًا أو منفذًا أو رابط صفحة.');
      return;
    }
    if (!authorization.trim()) {
      alertCompat('مصدر التصريح مطلوب', 'اكتب رابط البرنامج أو تفاصيل الإذن المكتوب والنطاق المسموح.');
      return;
    }
    if (!authorizationConfirmed) {
      alertCompat('تأكيد الإذن مطلوب', 'فعّل إقرار التصريح بعد التأكد من أنك تملك الإذن وأن النطاق مطابق لشروط البرنامج.');
      return;
    }
    const next: HunterTarget = {
      id: `scope-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      host: normalized,
      note: 'Added by the user',
      authorization: authorization.trim(),
      authorizationConfirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const updated = [next, ...targets.filter((item) => item.host !== normalized)];
    await saveTargets(updated);
    setTargets(updated);
    setTargetHost('');
    setAuthorization('');
    setAuthorizationConfirmed(false);
    setSelectedTargetId(next.id);
    setShowRequestEditor(false);
    setActivePanel('overview');
    setError('');
  }

  function reconfirmTarget(target: HunterTarget) {
    alertCompat(
      'إعادة تأكيد تصريح الاختبار',
      `هل تؤكد أن الإذن الخاص بـ ${target.host} ما زال صالحًا، وأن المصدر والنطاق المسجلين يسمحان بهذا الاختبار؟ هذا إقرار منك وليس تحققًا من مالك الموقع.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'أؤكد وأفعّل النطاق',
          onPress: () => {
            const updated = targets.map((item) => item.id === target.id
              ? { ...item, authorizationConfirmedAt: new Date().toISOString() }
              : item);
            setTargets(updated);
            void saveTargets(updated).then(() => setError('تم تسجيل إقرارك. راجع حدود البرنامج قبل كل اختبار.'))
              .catch(() => alertCompat('تعذّر حفظ التأكيد', 'حاول مرة أخرى.'));
          },
        },
      ],
    );
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
    setActivePanel('activity');
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
      title="مختبر الأمن السيبراني"
      eyebrow="Authorized HTTP testing"
      subtitle="عدّل الطلبات وأرسلها وأوقفها واقرأ الاستجابة. أضف نطاقًا مصرحًا به أولًا؛ لا يتم إرسال طلبات خارج النطاق."
      topBar={<ScreenTopBar active="hunter" />}
    >
      <View style={styles.panelTabs}>
        {([
          { key: 'overview', label: 'النطاق والاستطلاع', icon: 'shield' },
          { key: 'request', label: 'مختبر HTTP', icon: 'terminal' },
          { key: 'activity', label: 'النتائج والسجل', icon: 'activity' },
        ] as const).map((tab) => (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: activePanel === tab.key }} onPress={() => setActivePanel(tab.key)} style={[styles.panelTab, { borderColor: activePanel === tab.key ? colors.primary : colors.border, backgroundColor: activePanel === tab.key ? colors.accentSubtle : colors.card }]}>
            <Feather name={tab.icon} size={14} color={activePanel === tab.key ? colors.primary : colors.mutedForeground} />
            <Text numberOfLines={1} style={[styles.panelTabText, { color: activePanel === tab.key ? colors.primary : colors.mutedForeground }]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      {activePanel === 'overview' ? (
        <>
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
          placeholder="example.com أو *.example.com"
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
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: authorizationConfirmed }}
          onPress={() => setAuthorizationConfirmed((value) => !value)}
          style={styles.attestationRow}
        >
          <Feather name={authorizationConfirmed ? 'check-square' : 'square'} size={18} color={authorizationConfirmed ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.muted, { color: colors.foreground, flex: 1 }]}>أؤكد أن لدي تصريحًا صالحًا، وأن هذا النطاق داخل حدود البرنامج المسموح بها. هذا إقرار مني وليس تحققًا آليًا من الجهة المالكة.</Text>
        </Pressable>
        <Pressable onPress={() => void addTarget()} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
          <Feather name="plus-circle" size={16} color={colors.primaryForeground} />
          <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>إضافة النطاق</Text>
        </Pressable>
        {targets.length ? targets.map((target) => (
          <View key={target.id} style={[styles.scopeRow, { borderColor: colors.border }]}>
            <Feather name={target.authorizationConfirmedAt ? 'shield-check' : 'alert-triangle'} size={16} color={target.authorizationConfirmedAt ? colors.success : colors.warning} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.scopeHost, { color: colors.foreground }]}>{target.host}</Text>
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>{target.authorization}</Text>
              <Text style={[styles.muted, { color: target.authorizationConfirmedAt ? colors.success : colors.warning }]}>{target.authorizationConfirmedAt ? 'إقرار المستخدم مسجل · ليس تحققًا خارجيًا' : 'قديم — يحتاج إعادة تأكيد التصريح'}</Text>
            </View>
            {!target.authorizationConfirmedAt ? (
              <Pressable accessibilityRole="button" onPress={() => reconfirmTarget(target)} style={[styles.secondaryButton,{borderColor:colors.warning,paddingHorizontal:8,paddingVertical:5}]}>
                <Feather name="alert-circle" size={13} color={colors.warning} />
                <Text style={[styles.secondaryText,{color:colors.warning}]}>تأكيد التصريح</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => { setSelectedTargetId(target.id); setUrl(`https://${target.host.startsWith('*.') ? 'www.' + target.host.slice(2) : target.host}/`); setShowRequestEditor(true); setActivePanel('request'); setError('تم اختيار النطاق المحفوظ. راجع قواعد البرنامج وحدود النطاق قبل إرسال أي طلب.'); }} style={[styles.secondaryButton,{borderColor:colors.border,paddingHorizontal:8,paddingVertical:5}]}>
              <Feather name="shield" size={14} color={colors.primary} />
              <Text style={[styles.secondaryText,{color:colors.primary}]}>فتح المختبر</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`حذف نطاق ${target.host}`} onPress={() => {
              const next = targets.filter((item) => item.id !== target.id);
              setTargets(next);
              if (selectedTargetId === target.id) { setSelectedTargetId(null); setShowRequestEditor(false); }
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
          <Feather name="activity" size={18} color={colors.primary} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Autonomous Hunting</Text>
        </View>
        <Text style={[styles.muted, { color: colors.mutedForeground }]}>
          يبدأ باستطلاع المتصفح المدمج، ثم يجمع روابط الصفحة وطلبات الشبكة المرصودة وملفات JavaScript داخل النطاق المحفوظ. لا ينفذ تخمين كلمات مرور أو brute-force أو اختبارات نشطة تلقائيًا.
        </Text>
        <View style={styles.actions}>
          <Pressable
            disabled={huntRunning || targets.length === 0}
            onPress={() => {
              const target = targets.find((item) => item.id === selectedTargetId) ?? targets[0];
              if (!target) return;
              setHuntRunning(true);
              const rootHost = target.host.startsWith('*.') ? target.host.slice(2) : target.host;
              const startUrl = target.host.startsWith('*.') ? `https://www.${rootHost}/` : `https://${rootHost}/`;
              router.push({ pathname: '/browser', params: { url: startUrl } });
              void runBrowserRecon(target).then((run) => {
                setLastHunt(run);
                alertCompat(
                  run.status === 'completed' ? 'اكتمل الاستطلاع الأولي' : 'اكتمل جزء من الاستطلاع',
                  `الهدف: ${run.target}\nالروابط المرصودة: ${run.discoveredUrls.length}\nالنطاقات الفرعية: ${run.discoveredSubdomains.length}\nطلبات الشبكة: ${run.networkRequests}\nالحالة: ${run.status}\nراجع مكتبة الأدوات وسجل Hunting للتفاصيل.`,
                );
              }).catch((e) => alertCompat('تعذّر بدء Hunting', e instanceof Error ? e.message : 'خطأ غير معروف'))
                .finally(() => setHuntRunning(false));
            }}
            style={[styles.primaryButton, { flex: 1, backgroundColor: colors.primary, opacity: huntRunning || targets.length === 0 ? 0.5 : 1 }]}
          >
            {huntRunning ? <ActivityIndicator color={colors.primaryForeground} size="small" /> : <Feather name="crosshair" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>{huntRunning ? 'جارٍ الاستطلاع…' : 'ابدأ Hunting تلقائي'}</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/hunter-tools')} style={[styles.secondaryButton, { borderColor: colors.border }]}>
            <Feather name="database" size={15} color={colors.foreground} />
            <Text style={[styles.secondaryText, { color: colors.foreground }]}>مكتبة الأدوات</Text>
          </Pressable>
        </View>
        {lastHunt ? (
          <>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              آخر تشغيل: {lastHunt.target} · {lastHunt.discoveredUrls.length} روابط · {lastHunt.status}
            </Text>
            <Pressable
              disabled={safeChecksRunning || huntRunning || lastHunt.discoveredUrls.length === 0}
              onPress={() => {
                const target = targets.find((item) => item.id === selectedTargetId) ?? targets.find((item) => item.host.toLowerCase() === lastHunt.target.toLowerCase());
                if (!target) { alertCompat('النطاق غير موجود', 'أعد إضافة النطاق المصرح به أولًا.'); return; }
                setSafeChecksRunning(true);
                void runSafeHttpHeaderChecks(target, lastHunt.id)
                  .then((run) => { setLastHunt(run); alertCompat('انتهت فحوص HTTP الآمنة', run.notes.filter((note) => note.startsWith('Safe HTTP header checks')).join('\\n') || 'تم حفظ نتائج الفحص في سجل Hunting.'); })
                  .catch((error) => alertCompat('تعذّر تشغيل الفحوص', error instanceof Error ? error.message : 'خطأ غير معروف'))
                  .finally(() => setSafeChecksRunning(false));
              }}
              style={[styles.secondaryButton, { borderColor: colors.border, opacity: safeChecksRunning ? 0.5 : 1 }]}
            >
              {safeChecksRunning ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="shield" size={15} color={colors.primary} />}
              <Text style={[styles.secondaryText, { color: colors.primary }]}>{safeChecksRunning ? 'جارٍ فحص Security Headers…' : 'تشغيل فحوص HTTP الآمنة (HEAD)'}</Text>
            </Pressable>
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>الفحص الإضافي اختياري ويتطلب ضغطك عليه. يرسل HEAD فقط إلى 6 روابط HTTPS كحد أقصى، دون payload أو تغيير بيانات.</Text>
          </>
        ) : null}
      </Surface>
        </>
      ) : null}

      {activePanel === 'request' ? (
        showRequestEditor && selectedTargetId && targets.some((target) => target.id === selectedTargetId) ? <Surface style={styles.requestCard}>
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
      </Surface> : (
        <Surface style={styles.requestCard}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>لا يوجد طلب مفتوح</Text>
          <Text style={[styles.muted, { color: colors.mutedForeground }]}>ارجع إلى «النطاق والاستطلاع»، واختر تارجتًا مؤكد التصريح، ثم اضغط «فتح المختبر» لبدء إعداد طلب HTTP.</Text>
        </Surface>
        )
      ) : null}

      {activePanel === 'activity' ? (
      <>
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
            setShowRequestEditor(true);
            setActivePanel('request');
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

      </>) : null}

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
  panelTabs: { flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 1 },
  panelTab: { flex: 1, minWidth: 0, minHeight: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 5, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 5 },
  panelTabText: { fontSize: 10, fontWeight: '800' },
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
  attestationRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 9, paddingVertical: 4 },
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
