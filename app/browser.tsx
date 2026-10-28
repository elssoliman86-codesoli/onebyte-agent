import React, { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';
import { registerEmbeddedBrowser, type EmbeddedBrowserDriver, type EmbeddedBrowserElement, type EmbeddedBrowserSnapshot, type EmbeddedBrowserRequestResult } from '@/src/embedded-browser';
import { isAuthorized, loadTargets } from '@/src/hunter';

export default function BrowserScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const initialUrl = (Array.isArray(params.url) ? params.url[0] : params.url) ?? '';
  const [address, setAddress] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const isWeb = Platform.OS === 'web';
  const webRef = useRef<React.ComponentRef<typeof WebView> | null>(null);
  const pendingBrowserResultsRef = useRef<Array<{ resolve: (value: string) => void; reject: (error: Error) => void }>>([]);
  const currentUrlRef = useRef(url);
  const pageReadyRef = useRef(false);
  const readyWaitersRef = useRef<Array<{ resolve: (url: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>>([]);
  const scopeHostRef = useRef('');
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setAddress(initialUrl);
    setUrl(initialUrl);
    currentUrlRef.current = initialUrl;
    pageReadyRef.current = false;
  }, [initialUrl]);

  useEffect(() => {
    if (isWeb) return;
    const evaluate = (script: string) => new Promise<string>((resolve, reject) => {
      const web = webRef.current;
      if (!web) { reject(new Error('المتصفح المدمج غير جاهز.')); return; }
      const timer = setTimeout(() => reject(new Error('انتهت مهلة تنفيذ أمر المتصفح.')), 12_000);
      (web as unknown as { injectJavaScript: (code: string) => void }).injectJavaScript(
        `(() => { try { Promise.resolve((${script})).then(value => window.ReactNativeWebView.postMessage(JSON.stringify({__onebyteBrowserResult: value}))).catch(error => window.ReactNativeWebView.postMessage(JSON.stringify({__onebyteBrowserError: String(error)}))); } catch (error) { window.ReactNativeWebView.postMessage(JSON.stringify({__onebyteBrowserError: String(error)})); } })(); true;`
      );
      pendingBrowserResultsRef.current.push({ resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
    const driver: EmbeddedBrowserDriver = {
      currentUrl: () => currentUrlRef.current,
      waitUntilReady: (timeoutMs = 15_000) => {
        if (pageReadyRef.current) return Promise.resolve(currentUrlRef.current);
        return new Promise((resolve, reject) => {
          const waiter = { resolve, reject, timer: setTimeout(() => { readyWaitersRef.current = readyWaitersRef.current.filter((x) => x !== waiter); reject(new Error('المتصفح لم يكمل تحميل الصفحة في الوقت المحدد.')); }, timeoutMs) };
          readyWaitersRef.current.push(waiter);
        });
      },
      navigate: async (requestedUrl, _scopeHost) => {
        const parsed = new URL(requestedUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('يسمح فقط بروابط HTTP وHTTPS دون بيانات اعتماد مضمّنة.');
        const targets = await loadTargets();
        const scope = isAuthorized(parsed.toString(), targets);
        if (!scope.ok) throw new Error(scope.reason);
        const matchingTarget = targets.find((target) => parsed.hostname.toLowerCase() === target.host.toLowerCase() || parsed.hostname.toLowerCase().endsWith('.' + target.host.toLowerCase()));
        if (!matchingTarget) throw new Error('الرابط خارج النطاق المصرّح به.');
        scopeHostRef.current = matchingTarget.host.toLowerCase();
        const nextUrl = parsed.toString();
        if (currentUrlRef.current === nextUrl && pageReadyRef.current) {
          return driver.readPage();
        }
        setAddress(nextUrl);
        setUrl(nextUrl);
        currentUrlRef.current = nextUrl;
        pageReadyRef.current = false;
        return readPageAfterNavigation(driver);
      },
      readPage: async () => JSON.parse(await evaluate(`JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,24000),elements:Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=button],[contenteditable=true]')).slice(0,160).map((el,i)=>({index:i,tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||'',label:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('name')||el.getAttribute('placeholder')||el.value||'').toString().trim().slice(0,240),type:el.type||'',placeholder:el.getAttribute('placeholder')||'',href:el.href||'',disabled:!!el.disabled,password:el.type==='password'}))})`)) as EmbeddedBrowserSnapshot,
      click: async (index) => evaluate(`(()=>{const e=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=button],[contenteditable=true]')).slice(0,160)[${index}];if(!e)throw new Error('العنصر غير موجود');e.scrollIntoView({block:'center'});e.click();return 'تم الضغط على '+(e.innerText||e.getAttribute('aria-label')||e.tagName)})()`),
      typeText: async (index, text) => evaluate(`(()=>{const e=Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=button],[contenteditable=true]')).slice(0,160)[${index}];if(!e)throw new Error('الحقل غير موجود');if(e.type==='password')throw new Error('الكتابة في حقول كلمة المرور غير مدعومة.');if(!('value' in e)&&!e.isContentEditable)throw new Error('العنصر ليس حقل كتابة.');e.focus();const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(setter&&'value' in e)setter.call(e,${JSON.stringify(text)});else if(e.isContentEditable)e.textContent=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'تم إدخال النص في الحقل '+${index}})()`),
      scroll: async (direction) => evaluate(`(()=>{window.scrollBy({top:${direction === 'down' ? 'Math.max(400,innerHeight*0.75)' : '-Math.max(400,innerHeight*0.75)'},behavior:'instant'});return 'تم تمرير الصفحة'})()`),
      wait: async (ms) => new Promise((resolve) => setTimeout(() => resolve('انتظرت '+ms+'ms'), Math.max(0, Math.min(5000, ms)))),
      sendRequest: async (input) => {
        const target = new URL(input.url);
        if (!scopeHostRef.current || !(target.hostname.toLowerCase() === scopeHostRef.current || target.hostname.toLowerCase().endsWith('.'+scopeHostRef.current))) throw new Error('رفض الطلب: الرابط خارج نطاق الاختبار المصرّح به.');
        const method = input.method.toUpperCase();
        if (!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)) throw new Error('طريقة HTTP غير مسموحة.');
        const started = Date.now();
        const raw = await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(target.toString())},{method:${JSON.stringify(method)},headers:${JSON.stringify(input.headers)}${['GET','HEAD'].includes(method) ? '' : `,body:${JSON.stringify(input.body)},credentials:"same-origin"`}});const h={};r.headers.forEach((v,k)=>h[k]=v);const b=${JSON.stringify(method)}==='HEAD'?'':await r.text();return JSON.stringify({url:r.url,status:r.status,statusText:r.statusText,ok:r.ok,headers:h,body:b.slice(0,40000)})})()`);
        return { ...(JSON.parse(raw) as Omit<EmbeddedBrowserRequestResult, 'elapsedMs'>), elapsedMs: Date.now()-started };
      },
    };
    const unregister = registerEmbeddedBrowser(driver);
    return () => { unregister(); requestControllerRef.current?.abort(); readyWaitersRef.current.splice(0).forEach((w) => { clearTimeout(w.timer); w.reject(new Error('تم إغلاق المتصفح.')); }); };
  }, [isWeb]);

  let host = '';
  try {
    host = url ? new URL(url).hostname : '';
  } catch {
    host = '';
  }

  function navigate() {
    const value = address.trim();
    if (!value) return;
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('رابط غير مسموح');
      }
      const cleanUrl = parsed.toString();
      setAddress(cleanUrl);
      setUrl(cleanUrl);
    } catch {
      alertCompat('الرابط غير صالح', 'اكتبي رابطًا يبدأ بـ https:// أو http://');
    }
  }

  async function readPageAfterNavigation(driver: EmbeddedBrowserDriver): Promise<EmbeddedBrowserSnapshot> {
    await driver.waitUntilReady();
    return driver.readPage();
  }

  function openOutside() {
    if (!url) return;
    if (isWeb && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void Linking.openURL(url);
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="رجوع للشات"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={6}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <View style={[styles.addressWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={13} color={colors.mutedForeground} />
          <TextInput
            value={address}
            onChangeText={setAddress}
            onSubmitEditing={navigate}
            placeholder="اكتبي رابط الصفحة"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            style={[styles.addressInput, { color: colors.foreground }]}
            accessibilityLabel="رابط الصفحة"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="افتح الرابط"
          onPress={navigate}
          style={[styles.goBtn, { backgroundColor: colors.primary }]}
          hitSlop={6}
        >
          <Feather name="arrow-up-left" size={18} color={colors.primaryForeground} />
        </Pressable>
        {!isWeb && url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة تحميل الصفحة"
            onPress={() => webRef.current?.reload()}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <Feather name="refresh-cw" size={17} color={colors.foreground} />
          </Pressable>
        ) : null}
        {url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="فتح في متصفح النظام"
            onPress={openOutside}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <Feather name="external-link" size={17} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {url && !isWeb ? (
        <WebView
          ref={webRef}
          source={{ uri: url }}
          style={styles.webview}
          originWhitelist={['http://*', 'https://*']}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          onShouldStartLoadWithRequest={(request) => {
            if (!/^https?:\/\//i.test(request.url)) return false;
            if (!scopeHostRef.current) return true;
            try {
              const host = new URL(request.url).hostname.toLowerCase();
              return host === scopeHostRef.current || host.endsWith('.' + scopeHostRef.current);
            } catch { return false; }
          }}
          onNavigationStateChange={(state) => {
            setAddress(state.url);
            setUrl(state.url);
            currentUrlRef.current = state.url;
            pageReadyRef.current = false;
          }}
          onLoadEnd={(event) => {
            currentUrlRef.current = event.nativeEvent.url;
            pageReadyRef.current = true;
            readyWaitersRef.current.splice(0).forEach((w) => { clearTimeout(w.timer); w.resolve(event.nativeEvent.url); });
          }}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              const waiter = pendingBrowserResultsRef.current.shift();
              if (waiter) data.__onebyteBrowserError ? waiter.reject(new Error(data.__onebyteBrowserError)) : waiter.resolve(String(data.__onebyteBrowserResult ?? 'null'));
            } catch { /* Ignore unrelated page messages. */ }
          }}
        />
      ) : (
        <View style={styles.empty}>
          <Feather name={url ? 'monitor' : 'globe'} size={30} color={colors.mutedForeground} />
          <Text style={[styles.host, { color: colors.foreground }]} numberOfLines={1}>
            {host || 'المتصفح الخاص'}
          </Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {url
              ? 'المواقع قد تمنع العرض داخل متصفح الويب. افتحي الرابط في متصفح الجهاز، أو أرسليه في الشات لقراءته وتحليله.'
              : 'اكتبي رابط الصفحة لفتحها. لقراءة المصدر ومناقشته، ارسلي الرابط في الشات.'}
          </Text>
          {url ? (
            <Pressable
              accessibilityRole="button"
              onPress={openOutside}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>افتح الصفحة</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.primaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.primaryText, { color: colors.foreground }]}>العودة للشات</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  iconBtn: { padding: 4 },
  addressWrap: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  addressInput: { flex: 1, minWidth: 0, fontSize: 13, textAlign: 'left' },
  goBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  webview: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 26 },
  host: { maxWidth: '100%', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 21, textAlign: 'center' },
  primaryBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  primaryText: { fontSize: 14, fontWeight: '700' },
});
