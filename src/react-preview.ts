/**
 * Lightweight React/TSX browser preview for small client-side projects.
 *
 * This is not a package manager or a production bundler. It loads pinned React
 * and Babel browser builds, compiles project-local TS/TSX/JS/JSX modules, and
 * displays a useful error when a third-party npm dependency is not bundled.
 * Native modules, server code and compiled languages require their own runtime.
 */
export type ReactPreviewFile = { path: string; content: string };

const ENTRY_CANDIDATES = [
  'src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx',
  'src/main.ts', 'src/main.js', 'src/index.ts', 'src/index.js',
  'main.tsx', 'main.jsx', 'index.tsx', 'index.jsx', 'main.js', 'index.js',
  'src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx',
];

function normalizeModulePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function inlineCss(files: ReactPreviewFile[]): string {
  return files
    .filter(file => /\\.css$/i.test(file.path))
    .map(file => file.content.replace(/<\\/style/gi, '<\\\\/style'))
    .join('\\n');
}

export function buildReactPreviewHtml(files: ReactPreviewFile[]): string | null {
  const sources: Record<string, string> = {};
  const sourceFiles = files.filter(file =>
    /\\.(?:tsx?|jsx?|mjs|cjs|json)$/i.test(file.path) &&
    !/(?:^|\\/)package-lock\\.json$/i.test(file.path) &&
    !/(?:^|\\/)node_modules\\//i.test(file.path),
  );
  if (!sourceFiles.length) return null;

  const totalBytes = sourceFiles.reduce((sum, file) => sum + file.content.length, 0);
  if (totalBytes > 2_000_000) {
    throw new Error('مشروع React أكبر من حد المعاينة البالغ 2MB. قلّل ملفات المصدر أو استبعد الملفات غير المستخدمة.');
  }
  for (const file of sourceFiles) sources[normalizeModulePath(file.path)] = file.content;

  const entry = ENTRY_CANDIDATES.find(path => Object.prototype.hasOwnProperty.call(sources, path));
  if (!entry) return null;

  const appEntry = /(^|\\/)App\\.(?:tsx|jsx)$/i.test(entry);
  const moduleJson = JSON.stringify(sources).replace(/</g, '\\u003c');
  const css = inlineCss(files);
  const runner = String.raw`(function () {
    const output = document.getElementById('preview-error');
    const showError = (error) => {
      output.hidden = false;
      output.textContent = 'تعذّر تشغيل مشروع React داخل المعاينة:\\n' +
        String(error && (error.stack || error.message) || error);
    };
    window.addEventListener('error', event => showError(event.error || event.message));
    window.addEventListener('unhandledrejection', event => showError(event.reason));
    try {
      const sources = JSON.parse(document.getElementById('onebyte-module-data').textContent);
      const cache = Object.create(null);
      const dirname = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const normalize = path => {
        const parts = [];
        path.replace(/\\\\/g, '/').split('/').forEach(part => {
          if (!part || part === '.') return;
          if (part === '..') parts.pop();
          else parts.push(part);
        });
        return parts.join('/');
      };
      function resolve(from, request) {
        if (request.endsWith('.css')) return null;
        let raw;
        if (request.startsWith('@/')) raw = request.slice(2);
        else if (request.startsWith('.')) raw = (dirname(from) ? dirname(from) + '/' : '') + request;
        else throw new Error('المكتبة "' + request + '" غير مضمّنة في المعاينة. يدعم المشغّل React وملفات المشروع المحلية فقط.');
        const base = normalize(raw);
        const options = [
          base, base + '.tsx', base + '.ts', base + '.jsx', base + '.js',
          base + '.mjs', base + '.cjs', base + '.json',
          base + '/index.tsx', base + '/index.ts', base + '/index.jsx',
          base + '/index.js', base + '/index.json'
        ];
        const match = options.find(path => Object.prototype.hasOwnProperty.call(sources, path));
        if (!match) throw new Error('لم يتم العثور على الملف المستورد "' + request + '" من ' + from + '.');
        return match;
      }
      function load(path) {
        if (cache[path]) return cache[path].exports;
        if (/\\.json$/i.test(path)) {
          const jsonModule = { exports: JSON.parse(sources[path]) };
          cache[path] = jsonModule;
          return jsonModule.exports;
        }
        const module = { exports: {} };
        cache[path] = module;
        const transformed = Babel.transform(sources[path], {
          filename: path,
          sourceType: 'unambiguous',
          presets: [
            ['env', { modules: 'commonjs' }],
            ['react', { runtime: 'classic' }],
            ['typescript', { allExtensions: true, isTSX: true }]
          ]
        }).code;
        const localRequire = request => {
          if (request === 'react') return React;
          if (request === 'react-dom') return ReactDOM;
          if (request === 'react-dom/client') return {
            createRoot: ReactDOM.createRoot.bind(ReactDOM),
            hydrateRoot: ReactDOM.hydrateRoot && ReactDOM.hydrateRoot.bind(ReactDOM)
          };
          if (request === 'react/jsx-runtime') {
            return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
          }
          if (request.endsWith('.css')) return {};
          return load(resolve(path, request));
        };
        const processShim = { env: { NODE_ENV: 'production' } };
        new Function('require', 'module', 'exports', 'React', 'ReactDOM', 'process', transformed)(
          localRequire, module, module.exports, React, ReactDOM, processShim
        );
        return module.exports;
      }
      const exported = load(${JSON.stringify(entry)});
      if (${appEntry ? 'true' : 'false'}) {
        const component = exported.default || exported.App || exported;
        const root = document.getElementById('root');
        if (!root) throw new Error('ملف HTML الافتراضي لا يحتوي على عنصر root.');
        if (React.isValidElement(component)) ReactDOM.createRoot(root).render(component);
        else if (typeof component === 'function') ReactDOM.createRoot(root).render(React.createElement(component));
        else throw new Error('ملف App يجب أن يصدّر React component افتراضيًا.');
      }
      output.hidden = true;
    } catch (error) { showError(error); }
  })();`;
  const csp = "default-src 'none'; img-src data: blob: https:; style-src 'unsafe-inline' data: https://cdn.jsdelivr.net; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; font-src data: https://cdn.jsdelivr.net; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '<title>OneByte React Preview</title>',
    '<style>html,body,#root{min-height:100%;margin:0}body{font-family:Arial,sans-serif;background:#fff;color:#111}#root{padding:12px}#preview-error{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0f0;color:#a11;border:1px solid #e99;border-radius:8px;padding:12px;margin:12px;font:12px/1.5 monospace}</style>',
    '<style>' + css + '</style></head><body><div id="root"></div><pre id="preview-error" hidden></pre>',
    '<script id="onebyte-module-data" type="application/json">' + moduleJson + '</script>',
    '<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js" onerror="document.getElementById(\'preview-error\').hidden=false;document.getElementById(\'preview-error\').textContent=\'تعذّر تحميل React من CDN. تحقق من اتصال الإنترنت ثم أعد المحاولة.\'"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js" onerror="document.getElementById(\'preview-error\').hidden=false;document.getElementById(\'preview-error\').textContent=\'تعذّر تحميل ReactDOM من CDN.\'"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.10/babel.min.js" onerror="document.getElementById(\'preview-error\').hidden=false;document.getElementById(\'preview-error\').textContent=\'تعذّر تحميل Babel من CDN.\'"></script>',
    '<script>' + runner + '</script></body></html>'
  ].join('');
}
