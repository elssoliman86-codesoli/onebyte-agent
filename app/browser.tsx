import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
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
import {
  getEmbeddedBrowser,
  registerEmbeddedBrowser,
  type EmbeddedBrowserDriver,
  type EmbeddedBrowserSnapshot,
  type EmbeddedBrowserRequestResult,
  type EmbeddedBrowserNetworkEntry,
} from '@/src/embedded-browser';
import { findAuthorizedTarget, isAuthorized, loadTargets, targetMatchesHost } from '@/src/hunter';

function isHostInScope(url: string, scopePattern: string): boolean {
  try {
    return targetMatchesHost(scopePattern, new URL(url).hostname);
  } catch {
    return false;
  }
}

function redactText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/("(?:password|token|secret|api[_-]?key|authorization|cookie|session|access_token|refresh_token)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/((?:password|token|secret|api[_-]?key|authorization|cookie|session|access_token|refresh_token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|authorization)\s*[:=]\s*["'`])[^"'`]+(["'`])/gi, '$1[REDACTED]$2')
    .replace(/((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access_token|refresh_token|token|secret|password)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"'<>]+/gi, '$1[REDACTED]')
    .slice(0, 5000);
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/(token|secret|password|api[_-]?key|authorization|cookie|session|credential|access[_-]?token|refresh[_-]?token)/i.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeNetworkEntry(entry: EmbeddedBrowserNetworkEntry): EmbeddedBrowserNetworkEntry {
  const headers = (source?: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(source ?? {}).map(([key, value]) => [
        key,
        /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(key)
          ? '[REDACTED]'
          : String(value).slice(0, 1000),
      ]),
    );
  return {
    ...entry,
    url: redactUrl(entry.url),
    requestHeaders: headers(entry.requestHeaders),
    responseHeaders: headers(entry.responseHeaders),
    requestBody: redactText(entry.requestBody),
    responsePreview: redactText(entry.responsePreview),
  };
}

/**
 * Instruments page-level fetch/XHR/beacon requests. This is intentionally not
 * described as a full proxy: browser internals, images and every static asset
 * cannot be captured reliably from JavaScript injection alone.
 */
function makeNetworkMonitorScript(scopePattern: string): string {
  const pattern = JSON.stringify(scopePattern.toLowerCase());
  return [
    '(function(){',
    'window.__onebyteNetworkScope=' + pattern + ';',
    'function matches(url){try{return window.__onebyteNetworkScope && (function(h,p){p=p.toLowerCase();h=h.toLowerCase();if(p.indexOf("*.")===0){var root=p.slice(2);return h!==root&&h.endsWith("."+root);}return h===p;})(new URL(url,location.href).hostname,window.__onebyteNetworkScope);}catch(_){return false;}}',
    'function safeUrl(raw){try{var u=new URL(raw,location.href);Array.from(u.searchParams.keys()).forEach(function(k){if(/token|secret|password|api[_-]?key|authorization|cookie|session|credential|access[_-]?token|refresh[_-]?token/i.test(k))u.searchParams.set(k,"[REDACTED]");});return u.toString();}catch(_){return String(raw||"");}}',
    'function safeText(value){if(value==null)return "";var s="";if(typeof value==="string")s=value;else if(typeof URLSearchParams!=="undefined"&&value instanceof URLSearchParams)s=value.toString();else if(typeof FormData!=="undefined"&&value instanceof FormData){var keys=[];value.forEach(function(v,k){keys.push(k+"="+(/token|secret|password|api[_-]?key|authorization|cookie|session|credential/i.test(k)?"[REDACTED]":(typeof v==="string"?"[text]":"[file]")));});s="[FormData "+keys.slice(0,50).join("&")+"]";}else s="[non-text body]";s=s.replace(/("(?:password|token|secret|api[_-]?key|authorization|cookie|session|access_token|refresh_token)"\\s*:\\s*")[^"]*(")/gi,"$1[REDACTED]$2");s=s.replace(/((?:password|token|secret|api[_-]?key|authorization|cookie|session|access_token|refresh_token)=)[^&\\s]+/gi,"$1[REDACTED]");return s.slice(0,4000);}',
    'function safeHeaders(input){var out={};try{new Headers(input||{}).forEach(function(v,k){out[k]=/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(k)?"[REDACTED]":String(v).slice(0,1000);});}catch(_){}return out;}',
    'function emit(e){if(!matches(e.url))return;try{window.ReactNativeWebView.postMessage(JSON.stringify({__onebyteNetworkRecord:e}));}catch(_){}}',
    'function makeEntry(src,method,url,headers,body,start,status,statusText,rheaders,preview,error){return{id:src+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),source:src,method:String(method||"GET").toUpperCase(),url:safeUrl(url),createdAt:new Date().toISOString(),elapsedMs:Math.max(0,Date.now()-start),status:typeof status==="number"?status:null,statusText:statusText||"",requestHeaders:safeHeaders(headers),requestBody:safeText(body),responseHeaders:safeHeaders(rheaders),responsePreview:safeText(preview).slice(0,5000),error:error||""};}',
    'if(!window.__onebyteNetworkTapInstalled){window.__onebyteNetworkTapInstalled=true;',
    'var originalFetch=window.fetch;',
    'if(originalFetch){window.fetch=function(input,init){var req=(typeof Request!=="undefined"&&input instanceof Request)?input:null;var rawUrl=typeof input==="string"?input:(input&&input.url)||String(input);var method=(init&&init.method)||(req&&req.method)||"GET";var headers=(init&&init.headers)||(req&&req.headers)||{};var body=init&&Object.prototype.hasOwnProperty.call(init,"body")?init.body:"";var started=Date.now();return originalFetch.apply(this,arguments).then(function(response){if(matches(rawUrl)){var copy=response.clone();copy.text().then(function(text){emit(makeEntry("fetch",method,rawUrl,headers,body,started,response.status,response.statusText,response.headers,text,""));}).catch(function(){emit(makeEntry("fetch",method,rawUrl,headers,body,started,response.status,response.statusText,response.headers,"[response body unavailable]",""));});}return response;},function(error){if(matches(rawUrl))emit(makeEntry("fetch",method,rawUrl,headers,body,started,null,"",{},"",String(error&&error.message||error)));throw error;});};}',
    'var XHR=window.XMLHttpRequest;',
    'if(XHR&&XHR.prototype){var oldOpen=XHR.prototype.open;var oldHeader=XHR.prototype.setRequestHeader;var oldSend=XHR.prototype.send;',
    'XHR.prototype.open=function(method,url){this.__onebyteRequest={method:method,url:new URL(url,location.href).toString(),headers:{},body:"",started:0};return oldOpen.apply(this,arguments);};',
    'XHR.prototype.setRequestHeader=function(k,v){if(this.__onebyteRequest)this.__onebyteRequest.headers[k]=v;return oldHeader.apply(this,arguments);};',
    'XHR.prototype.send=function(body){var xhr=this;var r=xhr.__onebyteRequest;if(r){r.body=body;r.started=Date.now();xhr.addEventListener("loadend",function(){if(!matches(r.url))return;var h={};try{xhr.getAllResponseHeaders().trim().split(/[\\r\\n]+/).forEach(function(line){var i=line.indexOf(":");if(i>0)h[line.slice(0,i).trim()]=line.slice(i+1).trim();});}catch(_){}var preview="";try{preview=typeof xhr.responseText==="string"?xhr.responseText:"[non-text response]";}catch(_){}emit(makeEntry("xhr",r.method,r.url,r.headers,r.body,r.started,xhr.status,xhr.statusText,h,preview,xhr.status===0?"request failed or blocked":""));},{once:true});}return oldSend.apply(this,arguments);};}',
    'if(navigator.sendBeacon){var oldBeacon=navigator.sendBeacon.bind(navigator);try{navigator.sendBeacon=function(url,data){var started=Date.now();var ok=oldBeacon(url,data);if(matches(url))emit(makeEntry("beacon","POST",url,{},data,started,null,"",{}, "",ok?"queued":"not queued"));return ok;};}catch(_){}}',
    '}',
    '})();',
    'true;',
  ].join('\n');
}

export default function BrowserScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const initialUrl = (Array.isArray(params.url) ? params.url[0] : params.url) ?? '';
  const [address, setAddress] = useState(redactUrl(initialUrl));
  const [url, setUrl] = useState(initialUrl);
  const [sourceUrl, setSourceUrl] = useState('');
  const [networkLog, setNetworkLog] = useState<EmbeddedBrowserNetworkEntry[]>([]);
  const [networkVisible, setNetworkVisible] = useState(false);
  const [selectedNetworkEntry, setSelectedNetworkEntry] = useState<EmbeddedBrowserNetworkEntry | null>(null);
  const [scopeHost, setScopeHost] = useState('');
  const [browserError, setBrowserError] = useState('');
  const [pageLoading, setPageLoading] = useState(false);
  const isWeb = Platform.OS === 'web';
  // Keep the WebView source object stable across URL-label/network-log state updates;
  // a fresh inline { uri } object can trigger unwanted navigations on some Android versions.
  const webSource = useMemo(() => (sourceUrl ? { uri: sourceUrl } : undefined), [sourceUrl]);
  const webRef = useRef<React.ComponentRef<typeof WebView> | null>(null);
  const currentUrlRef = useRef(sourceUrl);
  const pageReadyRef = useRef(false);
  const pendingBrowserResultsRef = useRef<Array<{
    id: string;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>([]);
  const readyWaitersRef = useRef<Array<{
    resolve: (url: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>>([]);
  const commandIdRef = useRef(0);
  const scopeHostRef = useRef('');
  const networkLogRef = useRef<EmbeddedBrowserNetworkEntry[]>([]);

  const activateScope = (host: string) => {
    scopeHostRef.current = host;
    setScopeHost(host);
  };

  const clearNetworkEntries = () => {
    networkLogRef.current = [];
    setNetworkLog([]);
    setSelectedNetworkEntry(null);
  };

  const appendNetworkEntry = (rawEntry: EmbeddedBrowserNetworkEntry) => {
    if (!scopeHostRef.current || !isHostInScope(rawEntry.url, scopeHostRef.current)) return;
    const safeEntry = sanitizeNetworkEntry(rawEntry);
    const next = [...networkLogRef.current, safeEntry].slice(-100);
    networkLogRef.current = next;
    setNetworkLog(next);
  };

  useEffect(() => {
    let active = true;
    setAddress(redactUrl(initialUrl));
    setUrl(initialUrl);
    setSourceUrl('');
    currentUrlRef.current = initialUrl;
    pageReadyRef.current = false;
    setPageLoading(Boolean(initialUrl));
    clearNetworkEntries();
    activateScope('');
    if (!initialUrl) return () => { active = false; };
    // Resolve the saved scope before mounting the page so the request monitor
    // is injected before the target's scripts issue their first requests.
    void loadTargets().then((targets) => {
      if (!active) return;
      const match = findAuthorizedTarget(initialUrl, targets);
      activateScope(match && isAuthorized(initialUrl, targets).ok ? match.host : '');
      setSourceUrl(initialUrl);
    }).catch(() => {
      if (active) setSourceUrl(initialUrl);
    });
    return () => { active = false; };
  }, [initialUrl]);

  useEffect(() => {
    if (isWeb) return;

    const evaluate = (script: string, timeoutMs = 12_000) => new Promise<string>((resolve, reject) => {
      const web = webRef.current;
      if (!web) {
        reject(new Error('المتصفح المدمج غير جاهز.'));
        return;
      }
      const id = 'onebyte-' + Date.now() + '-' + (++commandIdRef.current);
      const timer = setTimeout(() => {
        pendingBrowserResultsRef.current = pendingBrowserResultsRef.current.filter((item) => item.id !== id);
        reject(new Error('انتهت مهلة تنفيذ أمر المتصفح.'));
      }, timeoutMs);
      pendingBrowserResultsRef.current.push({ id, resolve, reject, timer });
      const encodedId = JSON.stringify(id);
      const code =
        '(() => { const id=' + encodedId + '; const send=p=>{try{window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({__onebyteRequestId:id},p)));}catch(_){}}; try { Promise.resolve((' +
        script +
        ')).then(value=>send({__onebyteBrowserResult:value})).catch(error=>send({__onebyteBrowserError:String(error)})); } catch(error) { send({__onebyteBrowserError:String(error)}); } })(); true;';
      (web as unknown as { injectJavaScript: (value: string) => void }).injectJavaScript(code);
    });

    const driver: EmbeddedBrowserDriver = {
      currentUrl: () => currentUrlRef.current,
      waitUntilReady: (timeoutMs = 15_000) => {
        if (pageReadyRef.current) return Promise.resolve(currentUrlRef.current);
        return new Promise((resolve, reject) => {
          const waiter = {
            resolve,
            reject,
            timer: setTimeout(() => {
              readyWaitersRef.current = readyWaitersRef.current.filter((item) => item !== waiter);
              reject(new Error('المتصفح لم يكمل تحميل الصفحة في الوقت المحدد.'));
            }, timeoutMs),
          };
          readyWaitersRef.current.push(waiter);
        });
      },
      navigate: async (requestedUrl, _requestedScope, requireAuthorization = true) => {
        const parsed = new URL(requestedUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
          throw new Error('يسمح فقط بروابط HTTP وHTTPS دون بيانات اعتماد مضمّنة.');
        }
        const targets = await loadTargets();
        const target = findAuthorizedTarget(parsed.toString(), targets);
        if (requireAuthorization) {
          const check = isAuthorized(parsed.toString(), targets);
          if (!check.ok) throw new Error(check.reason);
          if (!target) throw new Error('الرابط خارج النطاق المصرّح به.');
        }
        const nextScope = requireAuthorization && target ? target.host : '';
        if (scopeHostRef.current !== nextScope) clearNetworkEntries();
        activateScope(nextScope);
        setBrowserError('');
        const nextUrl = parsed.toString();
        if (currentUrlRef.current === nextUrl && pageReadyRef.current) return driver.readPage();
        setAddress(nextUrl);
        setUrl(nextUrl);
        currentUrlRef.current = nextUrl;
        pageReadyRef.current = false;
        setPageLoading(true);
        setSourceUrl(nextUrl);
        await driver.waitUntilReady(20_000);
        return driver.readPage();
      },
      readPage: async () => {
        const snapshot = JSON.parse(await evaluate(
          'JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||"").slice(0,24000),source:(document.documentElement?.outerHTML||"").slice(0,30000),elements:Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")).slice(0,160).map((el,i)=>({index:i,tag:el.tagName.toLowerCase(),role:el.getAttribute("role")||"",label:(el.innerText||el.getAttribute("aria-label")||el.getAttribute("name")||el.getAttribute("placeholder")||el.value||"").toString().trim().slice(0,240),type:el.type||"",placeholder:el.getAttribute("placeholder")||"",href:el.href||"",disabled:!!el.disabled,password:el.type==="password"}))})',
        )) as EmbeddedBrowserSnapshot;
        return { ...snapshot, url: redactUrl(snapshot.url), title: redactText(snapshot.title), text: redactText(snapshot.text).slice(0, 24000), source: redactText(snapshot.source).slice(0, 30000), elements: snapshot.elements.map((element) => ({ ...element, label: redactText(element.label), placeholder: redactText(element.placeholder), href: element.href ? redactUrl(element.href) : '' })) };
      },
      click: async (index) => evaluate(
        '(()=>{const e=Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")).slice(0,160)[' + index + '];if(!e)throw new Error("العنصر غير موجود");e.scrollIntoView({block:"center"});e.click();return "تم الضغط على "+(e.innerText||e.getAttribute("aria-label")||e.tagName)})()',
      ),
      typeText: async (index, text) => evaluate(
        '(()=>{const e=Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button],[contenteditable=true]")).slice(0,160)[' + index + '];if(!e)throw new Error("الحقل غير موجود");if(e.type==="password")throw new Error("الكتابة في حقول كلمة المرور غير مدعومة.");if(!("value" in e)&&!e.isContentEditable)throw new Error("العنصر ليس حقل كتابة.");e.focus();const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),"value")?.set;if(setter&&"value" in e)setter.call(e,' + JSON.stringify(text) + ');else if(e.isContentEditable)e.textContent=' + JSON.stringify(text) + ';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return "تم إدخال النص في الحقل "+' + index + '})()',
      ),
      scroll: async (direction) => evaluate(
        '(()=>{window.scrollBy({top:' + (direction === 'down' ? 'Math.max(400,innerHeight*0.75)' : '-Math.max(400,innerHeight*0.75)') + ',behavior:"instant"});return "تم تمرير الصفحة"})()',
      ),
      wait: async (ms) => new Promise((resolve) => setTimeout(() => resolve('انتظرت ' + ms + 'ms'), Math.max(0, Math.min(5000, ms)))),
      getNetworkLog: async () => networkLogRef.current.slice(-50),
      clearNetworkLog: async () => clearNetworkEntries(),
      sendRequest: async (input) => {
        const target = new URL(input.url, currentUrlRef.current);
        if (!scopeHostRef.current || !isHostInScope(target.toString(), scopeHostRef.current)) {
          throw new Error('رفض الطلب: الرابط خارج نطاق الاختبار المصرّح به.');
        }
        const savedTargets = await loadTargets();
        const authorizationCheck = isAuthorized(target.toString(), savedTargets);
        if (!authorizationCheck.ok) throw new Error('رفض أمني قبل الإرسال: ' + authorizationCheck.reason);
        const method = input.method.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
          throw new Error('طريقة HTTP غير مسموحة.');
        }
        const started = Date.now();
        try {
          const raw = await evaluate(
            '(async()=>{const r=await fetch(' + JSON.stringify(target.toString()) + ',{method:' + JSON.stringify(method) + ',redirect:"manual",headers:' + JSON.stringify(input.headers) +
            (['GET', 'HEAD'].includes(method) ? '' : ',body:' + JSON.stringify(input.body)) +
            ',credentials:"same-origin"});const h={};r.headers.forEach((v,k)=>h[k]=/^(set-cookie|www-authenticate)$/i.test(k)?"[REDACTED]":v);const b=' +
            JSON.stringify(method) + '==="HEAD"?"":await (async()=>{const max=524288;const len=Number(r.headers.get("content-length")||0);if(len>max){try{await r.body.cancel()}catch(_){}return "[response omitted: >512KB]"}const rd=r.body&&r.body.getReader?r.body.getReader():null;if(!rd)return (await r.text()).slice(0,max);const d=new TextDecoder();let s="",n=0,t=false;while(true){const q=await rd.read();if(q.done)break;const left=max-n;if(left<=0){t=true;await rd.cancel();break}const chunk=q.value.subarray(0,left);s+=d.decode(chunk,{stream:true});n+=chunk.byteLength;if(chunk.byteLength<q.value.byteLength){t=true;await rd.cancel();break}}s+=d.decode();return s+(t?" [truncated after 512KB]":"")})() ;return JSON.stringify({url:r.url,status:r.status,statusText:r.statusText,ok:r.ok,headers:h,body:b.slice(0,40000)})})()',
            45_000,
          );
          const result = JSON.parse(raw) as Omit<EmbeddedBrowserRequestResult, 'elapsedMs'>;
          if (result.status >= 300 && result.status < 400) throw new Error('تم إيقاف إعادة التوجيه؛ راجع Location يدويًا وتأكد أنه داخل النطاق قبل المتابعة.');
          if (!isHostInScope(result.url, scopeHostRef.current) || !isAuthorized(result.url, await loadTargets()).ok) throw new Error('تم رفض استجابة خارج النطاق أو غير مؤكدة التصريح.');
          return { ...result, url: redactUrl(result.url), headers: result.headers, body: redactText(result.body), elapsedMs: Date.now() - started };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/failed to fetch|cors|network request failed/i.test(message)) {
            throw new Error('فشل طلب المتصفح بسبب سياسة CORS أو الشبكة. جرّب طلبًا من نفس origin، أو افحص الطلب الملتقط في سجل الشبكة. المتصفح المدمج ليس Proxy ولا يستطيع تجاوز CORS.');
          }
          throw error;
        }
      },
    };

    const unregister = registerEmbeddedBrowser(driver);
    return () => {
      unregister();
      pendingBrowserResultsRef.current.splice(0).forEach((item) => {
        clearTimeout(item.timer);
        item.reject(new Error('تم إغلاق المتصفح.'));
      });
      readyWaitersRef.current.splice(0).forEach((item) => {
        clearTimeout(item.timer);
        item.reject(new Error('تم إغلاق المتصفح.'));
      });
    };
  }, [isWeb]);

  async function navigate() {
    const value = address.trim();
    if (!value) return;
    const candidate = /^https?:\/\//i.test(value) ? value : 'https://' + value;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('يسمح فقط بروابط HTTP وHTTPS دون بيانات اعتماد مضمّنة.');
      }
      const cleanUrl = parsed.toString();
      const targets = await loadTargets();
      const matchingTarget = findAuthorizedTarget(cleanUrl, targets);
      clearNetworkEntries();
      activateScope(matchingTarget && isAuthorized(cleanUrl, targets).ok ? matchingTarget.host : '');
      setBrowserError('');
      setAddress(redactUrl(cleanUrl));
      setUrl(cleanUrl);
      currentUrlRef.current = cleanUrl;
      pageReadyRef.current = false;
      setPageLoading(true);
      setSourceUrl(cleanUrl);
    } catch (error) {
      alertCompat('تعذّر فتح الرابط', error instanceof Error ? error.message : 'رابط غير صالح.');
    }
  }

  function readPageAfterNavigation(driver: EmbeddedBrowserDriver): Promise<EmbeddedBrowserSnapshot> {
    return driver.waitUntilReady().then(() => driver.readPage());
  }

  function openOutside() {
    if (!url) return;
    if (isWeb && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void Linking.openURL(url);
  }

  const host = (() => {
    try {
      return url ? new URL(url).hostname : '';
    } catch {
      return '';
    }
  })();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="رجوع للشات" onPress={() => router.back()} style={styles.iconBtn} hitSlop={6}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <View style={[styles.addressWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="globe" size={13} color={colors.mutedForeground} />
          <TextInput
            value={address}
            onChangeText={setAddress}
            onSubmitEditing={() => void navigate()}
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
        <Pressable accessibilityRole="button" accessibilityLabel="افتح الرابط" onPress={() => void navigate()} style={[styles.goBtn, { backgroundColor: colors.primary }]} hitSlop={6}>
          <Feather name="arrow-up-left" size={18} color={colors.primaryForeground} />
        </Pressable>
        {!isWeb ? (
          <Pressable accessibilityRole="button" accessibilityLabel="تحديث الصفحة" onPress={() => webRef.current?.reload()} style={styles.iconBtn} hitSlop={6}>
            <Feather name="refresh-cw" size={17} color={colors.foreground} />
          </Pressable>
        ) : null}
        {!isWeb ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="طلبات الشبكة"
            onPress={() => setNetworkVisible((current) => !current)}
            style={[styles.networkToggle, { borderColor: colors.border, backgroundColor: networkVisible ? colors.accentSubtle : colors.card }]}
            hitSlop={6}
          >
            <Feather name="activity" size={15} color={scopeHost ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.networkToggleText, { color: colors.foreground }]}>{networkLog.length}</Text>
          </Pressable>
        ) : null}
        {url ? (
          <Pressable accessibilityRole="button" accessibilityLabel="فتح في متصفح النظام" onPress={openOutside} style={styles.iconBtn} hitSlop={6}>
            <Feather name="external-link" size={17} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {!isWeb && networkVisible ? (
        <View style={[styles.networkPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.networkPanelHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.networkPanelTitle, { color: colors.foreground }]}>حركة الشبكة · {networkLog.length} طلب</Text>
              <Text style={[styles.networkPanelHint, { color: colors.mutedForeground }]}>
                {scopeHost ? 'النطاق المسجّل: ' + scopeHost : 'التقاط الطلبات متوقف خارج النطاق المسجل'}
              </Text>
            </View>
            <Pressable onPress={clearNetworkEntries} style={styles.networkPanelAction}>
              <Text style={[styles.networkPanelActionText, { color: colors.primary }]}>مسح</Text>
            </Pressable>
            <Pressable onPress={() => setNetworkVisible(false)} style={styles.networkPanelAction}>
              <Text style={[styles.networkPanelActionText, { color: colors.mutedForeground }]}>إغلاق</Text>
            </Pressable>
          </View>
          {browserError ? <Text style={[styles.networkError, { color: colors.destructive }]}>{browserError}</Text> : null}
          <ScrollView style={styles.networkList} nestedScrollEnabled>
            {[...networkLog].reverse().map((entry) => (
              <Pressable key={entry.id} onPress={() => setSelectedNetworkEntry(entry)} style={[styles.networkRow, { borderColor: selectedNetworkEntry?.id === entry.id ? colors.primary : colors.border, backgroundColor: selectedNetworkEntry?.id === entry.id ? colors.accentSubtle : colors.background }]}>
                <View style={styles.networkRowMeta}>
                  <Text style={[styles.networkMethod, { color: colors.primary }]}>{entry.method}</Text>
                  <Text style={[styles.networkStatus, { color: entry.status !== null && entry.status >= 400 ? colors.destructive : colors.mutedForeground }]}>
                    {entry.status ?? '—'} · {entry.elapsedMs}ms · {entry.source.toUpperCase()}
                  </Text>
                </View>
                <Text selectable style={[styles.networkUrl, { color: colors.foreground }]} numberOfLines={2}>{entry.url}</Text>
              </Pressable>
            ))}
            {!networkLog.length ? (
              <Text style={[styles.networkPanelHint, { color: colors.mutedForeground }]}>
                لا توجد طلبات ملتقطة. افتح هدفًا مسجلًا ثم تفاعل معه؛ يجري تسجيل fetch وXHR وsendBeacon والتنقلات الرئيسية فقط، وليس كل مورد ثابت أو حركة مثل Proxy.
              </Text>
            ) : null}
          </ScrollView>
          {selectedNetworkEntry ? (
            <ScrollView style={[styles.networkDetails, { borderTopColor: colors.border }]} nestedScrollEnabled>
              <Text style={[styles.networkPanelTitle, { color: colors.foreground }]}>تفاصيل الطلب المحدد</Text>
              <Text selectable style={[styles.networkDetailsText, { color: colors.mutedForeground }]}>
                {selectedNetworkEntry.method} {selectedNetworkEntry.url}
                {'\n'}Status: {selectedNetworkEntry.status ?? 'unknown'} · {selectedNetworkEntry.elapsedMs}ms
                {'\n'}Request headers: {JSON.stringify(selectedNetworkEntry.requestHeaders)}
                {'\n'}Request body: {selectedNetworkEntry.requestBody || '(empty)'}
                {'\n'}Response headers: {JSON.stringify(selectedNetworkEntry.responseHeaders ?? {})}
                {'\n'}Response preview: {selectedNetworkEntry.responsePreview || '(not available)'}
                {selectedNetworkEntry.error ? '\nError: ' + selectedNetworkEntry.error : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/(tabs)/hunter', params: {
                  capturedMethod: selectedNetworkEntry.method,
                  capturedUrl: selectedNetworkEntry.url,
                  capturedHeaders: JSON.stringify(selectedNetworkEntry.requestHeaders),
                  capturedBody: (selectedNetworkEntry.requestBody || '').slice(0, 4000),
                  capturedAt: selectedNetworkEntry.id,
                } })}
                style={[styles.networkToLabButton, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.networkToLabText, { color: colors.primaryForeground }]}>استخدام الطلب في مختبر HTTP</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {browserError && !isWeb ? (
        <View style={[styles.browserErrorBanner, { backgroundColor: colors.card, borderColor: colors.destructive }]}>
          <Feather name="alert-circle" size={16} color={colors.destructive} />
          <Text selectable style={[styles.browserErrorBannerText, { color: colors.foreground }]}>{browserError}</Text>
          <Pressable accessibilityRole="button" onPress={() => webRef.current?.reload()} style={styles.browserErrorRetry}>
            <Feather name="refresh-cw" size={16} color={colors.primary} />
          </Pressable>
        </View>
      ) : null}

      {pageLoading && !isWeb ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>جارٍ تحميل الصفحة…</Text>
        </View>
      ) : null}

      {sourceUrl && !isWeb ? (
        <WebView
          ref={webRef}
          source={webSource}
          style={styles.webview}
          originWhitelist={['http://*', 'https://*']}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          startInLoadingState
          injectedJavaScriptBeforeContentLoaded={
            scopeHost ? makeNetworkMonitorScript(scopeHost) : 'true;'
          }
          onShouldStartLoadWithRequest={(request) => {
            if (!/^https?:\/\//i.test(request.url)) return false;
            if (!scopeHostRef.current) return true;
            try {
              return isHostInScope(request.url, scopeHostRef.current);
            } catch {
              return false;
            }
          }}
          onLoadStart={(event) => {
            currentUrlRef.current = event.nativeEvent.url;
            pageReadyRef.current = false;
            setPageLoading(true);
          }}
          onNavigationStateChange={(state) => {
            setAddress(redactUrl(state.url));
            setUrl(state.url);
            currentUrlRef.current = state.url;
          }}
          onLoadEnd={(event) => {
            const loadedUrl = event.nativeEvent.url;
            currentUrlRef.current = loadedUrl;
            setAddress(redactUrl(loadedUrl));
            setUrl(loadedUrl);
            pageReadyRef.current = true;
            setPageLoading(false);
            setBrowserError('');
            readyWaitersRef.current.splice(0).forEach((waiter) => {
              clearTimeout(waiter.timer);
              waiter.resolve(loadedUrl);
            });
            void (async () => {
              try {
                const targets = await loadTargets();
                const match = findAuthorizedTarget(loadedUrl, targets);
                if (!scopeHostRef.current && match && isAuthorized(loadedUrl, targets).ok) activateScope(match.host);
                if (scopeHostRef.current && isHostInScope(loadedUrl, scopeHostRef.current)) {
                  appendNetworkEntry({
                    id: 'navigation-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                    source: 'navigation',
                    method: 'GET',
                    url: loadedUrl,
                    createdAt: new Date().toISOString(),
                    elapsedMs: 0,
                    status: null,
                    requestHeaders: {},
                    requestBody: '',
                  });
                  webRef.current?.injectJavaScript(makeNetworkMonitorScript(scopeHostRef.current));
                }
              } catch (error) {
                setBrowserError(error instanceof Error ? error.message : 'تعذّر تفعيل مراقبة الشبكة.');
              }
            })();
          }}
          onError={(event) => {
            const message = event.nativeEvent.description || 'تعذّر تحميل الصفحة داخل المتصفح المدمج.';
            setBrowserError(message);
            setPageLoading(false);
            pageReadyRef.current = false;
            readyWaitersRef.current.splice(0).forEach((waiter) => {
              clearTimeout(waiter.timer);
              waiter.reject(new Error(message));
            });
          }}
          onHttpError={(event) => {
            const message = 'فشل تحميل الصفحة: ' + event.nativeEvent.description;
            setBrowserError(message);
            setPageLoading(false);
          }}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data && data.__onebyteNetworkRecord && typeof data.__onebyteNetworkRecord.url === 'string') {
                appendNetworkEntry(data.__onebyteNetworkRecord as EmbeddedBrowserNetworkEntry);
                return;
              }
              const requestId = typeof data?.__onebyteRequestId === 'string' ? data.__onebyteRequestId : '';
              if (!requestId) return;
              const index = pendingBrowserResultsRef.current.findIndex((item) => item.id === requestId);
              if (index < 0) return;
              const [waiter] = pendingBrowserResultsRef.current.splice(index, 1);
              clearTimeout(waiter.timer);
              if (data.__onebyteBrowserError) waiter.reject(new Error(String(data.__onebyteBrowserError)));
              else waiter.resolve(String(data.__onebyteBrowserResult ?? 'null'));
            } catch {
              // Ignore unrelated messages posted by the page.
            }
          }}
        />
      ) : (
        <View style={styles.empty}>
          <Feather name={url ? 'monitor' : 'globe'} size={30} color={colors.mutedForeground} />
          <Text style={[styles.host, { color: colors.foreground }]} numberOfLines={1}>{host || 'المتصفح المدمج'}</Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {url
              ? 'نسخة الويب لا تملك WebView الأصلي. لقراءة الصفحات والتقاط طلبات الشبكة، افتح التطبيق المثبت على Android.'
              : 'اكتب رابط الصفحة لفتحها. التقاط الطلبات والتحكم بالصفحة متاحان في تطبيق Android المثبت.'}
          </Text>
          {url ? (
            <Pressable accessibilityRole="button" onPress={openOutside} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>افتح الصفحة</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
  topBar: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 8, borderBottomWidth: 1 },
  iconBtn: { minWidth: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  addressWrap: { flex: 1, minWidth: 0, height: 38, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  addressInput: { flex: 1, minWidth: 0, fontSize: 13, textAlign: 'left' },
  goBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  networkToggle: { minWidth: 40, height: 36, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 7 },
  networkToggleText: { fontSize: 11, fontWeight: '800' },
  networkPanel: { maxHeight: 300, borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  networkPanelHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  networkPanelTitle: { fontSize: 12, fontWeight: '800' },
  networkPanelHint: { fontSize: 10, lineHeight: 15 },
  networkPanelAction: { paddingHorizontal: 8, paddingVertical: 5 },
  networkPanelActionText: { fontSize: 11, fontWeight: '700' },
  networkList: { maxHeight: 120 },
  networkRow: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, gap: 3, marginBottom: 4 },
  networkRowMeta: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  networkMethod: { fontSize: 10, fontWeight: '800' },
  networkStatus: { fontSize: 10 },
  networkUrl: { fontSize: 10, lineHeight: 14, textAlign: 'left' },
  networkDetails: { maxHeight: 110, borderTopWidth: 1, paddingTop: 6 },
  networkDetailsText: { fontSize: 10, lineHeight: 15, textAlign: 'left' },
  networkToLabButton: { alignSelf: 'flex-start', borderRadius: 8, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8 },
  networkToLabText: { fontSize: 11, fontWeight: '800' },
  networkError: { fontSize: 11, lineHeight: 16 },
  webview: { flex: 1 },
  browserErrorBanner: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginHorizontal: 10, marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 10 },
  browserErrorBannerText: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16 },
  browserErrorRetry: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  loadingOverlay: { position: 'absolute', top: 58, left: 0, right: 0, zIndex: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 26 },
  host: { maxWidth: '100%', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 21, textAlign: 'center' },
  primaryBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  primaryText: { fontSize: 14, fontWeight: '700' },
});