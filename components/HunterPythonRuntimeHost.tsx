import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { registerHunterPythonRuntime, type PythonRuntime } from '@/src/hunter-tools';

const PYODIDE_VERSION = '0.29.5';
const HTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net blob:; worker-src blob:; connect-src https://cdn.jsdelivr.net; style-src 'unsafe-inline';">
</head><body><script>
(function(){
  var workers = Object.create(null);
  window.__hunterPythonRun = function(message) {
    var id = message.id;
    var workerSource = [
      "let pyodide = null;",
      "self.onmessage = async function(event) {",
      " const data = event.data;",
      " try {",
      "  importScripts('https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js');",
      "  pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/' });",
      "  const blocked = function(){ throw new Error('Network access is disabled in the Python tool runtime.'); };",
      "  self.fetch = blocked; self.XMLHttpRequest = function(){ blocked(); }; self.WebSocket = function(){ blocked(); }; self.importScripts = blocked;",
      "  pyodide.setStdout({ batched: function(s){ self.__stdout = ((self.__stdout || '') + s).slice(0, 32000); } });",
      "  pyodide.setStderr({ batched: function(s){ self.__stderr = ((self.__stderr || '') + s).slice(0, 32000); } });",
      "  pyodide.globals.set('__hunter_args_json', JSON.stringify(data.args || {}));",
      "  const wrapper = 'import json, io, contextlib, inspect, sys\\n' +",
      "   'for _name in (\\\"socket\\\", \\\"subprocess\\\", \\\"urllib\\\", \\\"http\\\", \\\"ftplib\\\", \\\"telnetlib\\\"):\\n sys.modules.pop(_name, None)\\n' +",
      "   'import json as _json\\n__hunter_args = _json.loads(__hunter_args_json)\\n' +",
      "   '__hunter_out = io.StringIO()\\n' +",
      "   'if not callable(globals().get(\\\"run\\\")): raise TypeError(\\\"Tool must define run(args)\\\")\\n' +",
      "   'if not callable(globals().get(\\\"run\\\")): raise TypeError(\\\"Tool must define run(args)\\\")\\n' +",
      "   'with contextlib.redirect_stdout(__hunter_out):\\n __hunter_result = run(__hunter_args)\\n' +",
      "   'if inspect.isawaitable(__hunter_result): __hunter_result = await __hunter_result\\n' +",
      "   'if not isinstance(__hunter_result, (dict, list, str, int, float, bool, type(None))): raise TypeError(\\\"Tool result must be JSON-compatible\\\")\\n' +",
      "   '__hunter_json = _json.dumps(__hunter_result, ensure_ascii=False)';",
      "  await pyodide.runPythonAsync(data.source);",
      "  await pyodide.runPythonAsync(wrapper);",
      "  const result = pyodide.globals.get('__hunter_json');",
      "  const output = (self.__stdout || '') + (self.__stderr || '') + String(result || 'null');",
      "  self.postMessage({ id: data.id, ok: true, output: output.slice(0, 64000), value: String(result || 'null') });",
      " } catch(error) { self.postMessage({ id: data.id, ok: false, error: String(error && error.message || error).slice(0, 4000) }); }",
      "};"
    ].join('\\n');
    var worker = new Worker(URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'})));
    workers[id] = worker;
    worker.onmessage = function(event) {
      window.ReactNativeWebView.postMessage(JSON.stringify(event.data));
      worker.terminate(); delete workers[id];
    };
    worker.onerror = function(event) {
      window.ReactNativeWebView.postMessage(JSON.stringify({id:id,ok:false,error:String(event.message || 'Python worker failed')}));
      worker.terminate(); delete workers[id];
    };
    worker.postMessage(message);
  };
  window.__hunterPythonCancel = function(id) {
    if (workers[id]) { workers[id].terminate(); delete workers[id]; }
  };
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'runtime-ready',version:'${PYODIDE_VERSION}'}));
})();
</script></body></html>`;

type Pending = { resolve: (value: { output: string; value?: unknown }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export function HunterPythonRuntimeHost() {
  const webRef = useRef<React.ComponentRef<typeof WebView> | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const ready = useRef(false);
  const runtime = useRef<PythonRuntime | null>(null);

  const execute = useCallback<PythonRuntime['execute']>((input) => new Promise((resolve, reject) => {
    if (!ready.current || !webRef.current) {
      reject(new Error('محرك Python لم يجهز بعد. افتح شاشة Hunter Tools وانتظر تحميل المحرك.'));
      return;
    }
    if (input.source.length > 64_000) { reject(new Error('كود الأداة يتجاوز 64KB.')); return; }
    const id = 'py-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const timer = setTimeout(() => {
      pending.current.delete(id);
      webRef.current?.injectJavaScript('window.__hunterPythonCancel(' + JSON.stringify(id) + '); true;');
      reject(new Error('انتهت مهلة تشغيل Python وتم إنهاء Worker.'));
    }, 90_000);
    pending.current.set(id, { resolve, reject, timer });
    const message = JSON.stringify({ id, source: input.source, args: input.args });
    webRef.current.injectJavaScript('window.__hunterPythonRun(' + message.replace(/</g, '\\u003c') + '); true;');
  }), []);

  useEffect(() => {
    const adapter: PythonRuntime = { execute };
    runtime.current = adapter;
    const unregister = registerHunterPythonRuntime(adapter);
    return () => {
      unregister();
      ready.current = false;
      for (const item of pending.current.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('تم إغلاق محرك Python.'));
      }
      pending.current.clear();
    };
  }, [execute]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let data: { type?: string; id?: string; ok?: boolean; output?: string; value?: string; error?: string };
    try { data = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (data.type === 'runtime-ready') { ready.current = true; return; }
    if (!data.id) return;
    const item = pending.current.get(data.id);
    if (!item) return;
    pending.current.delete(data.id);
    clearTimeout(item.timer);
    if (!data.ok) { item.reject(new Error(data.error || 'فشل تشغيل Python.')); return; }
    let value: unknown;
    try { value = JSON.parse(data.value || 'null'); } catch { value = data.value; }
    item.resolve({ output: (data.output || '').slice(0, 64_000), value });
  }, []);

  return (
    <View pointerEvents="none" style={styles.host}>
      <WebView
        ref={webRef}
        source={{ html: HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled
        mixedContentMode="never"
        onMessage={onMessage}
        onError={() => { ready.current = false; }}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 1, height: 1, opacity: 0.01, left: -4, top: -4 },
  webview: { width: 1, height: 1, backgroundColor: 'transparent' },
});
