'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'react-preview.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
  },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox, { filename: 'react-preview.js' });
const { buildReactPreviewHtml } = sandbox.exports;

const vitePreview = buildReactPreviewHtml([
  {
    path: 'src/main.tsx',
    content: [
      'import React from "react";',
      'import { createRoot } from "react-dom/client";',
      'import App from "./App";',
      'createRoot(document.getElementById("root")!).render(<App />);',
    ].join('\n'),
  },
  {
    path: 'src/App.tsx',
    content: 'export default function App(){ return <main><h1>React preview works</h1></main>; }',
  },
  { path: 'src/index.css', content: 'body { color: rgb(12, 34, 56); }' },
]);

assert.equal(typeof vitePreview, 'string', 'Vite-style React TSX project should produce HTML');
assert.ok(vitePreview.includes('react@18.3.1'), 'preview should load the pinned React runtime');
assert.ok(vitePreview.includes('babel.min.js'), 'preview should load the TypeScript/JSX transformer');
assert.ok(vitePreview.includes('body { color: rgb(12, 34, 56); }'), 'project CSS should be inlined');
assert.ok(vitePreview.includes('src/App.tsx'), 'local source modules should be embedded');

const aliasProject = buildReactPreviewHtml([
  { path: 'src/main.tsx', content: 'import React from "react"; import App from "@/components/App"; <App />;' },
  { path: 'src/components/App.tsx', content: 'export default function App(){ return <h1>Alias</h1>; }' },
]);
assert.ok(aliasProject, 'React project with a common @/src alias should be recognized');

const ordinaryJavaScript = buildReactPreviewHtml([
  { path: 'src/main.js', content: 'console.log("plain JavaScript");' },
]);
assert.equal(ordinaryJavaScript, null, 'a non-React JavaScript file must not be misidentified as a React app');

const appOnly = buildReactPreviewHtml([
  { path: 'src/App.tsx', content: 'export default function App(){ return <h1>App only</h1>; }' },
]);
assert.ok(appOnly, 'an App.tsx-only project should render through the React root');

assert.throws(
  () => buildReactPreviewHtml([
    { path: 'src/main.tsx', content: 'import React from "react";' + 'x'.repeat(2_000_001) },
  ]),
  /2MB/,
  'oversized projects should fail with a clear size limit',
);

console.log('React preview regression tests passed.');
