const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { mkdirSync, rmSync } = require('node:fs');

const root = resolve(__dirname, '..');
const output = join(root, 'node_modules', '.cache', 'onebyte-hunter-tests');
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  join(root, 'src', 'hunter-parsers.ts'),
  '--target', 'ES2020',
  '--module', 'Node16',
  '--moduleResolution', 'Node16',
  '--ignoreConfig',
  '--skipLibCheck',
  '--outDir', output,
], { stdio: 'inherit' });

const { collectEndpointCandidates, collectJavaScriptAssets } = require(join(output, 'hunter-parsers.js'));
const snapshot = {
  url: 'https://example.com/',
  title: 'Example',
  text: 'https://example.com/about https://evil.example.net/steal',
  source: '<script>fetch("/api/v2/users"); const x="https://api.example.com/graphql";</script>',
  elements: [
    { index: 0, tag: 'a', role: '', label: 'Docs', href: '/docs', disabled: false },
    { index: 1, tag: 'a', role: '', label: 'External', href: 'https://outside.invalid/', disabled: false },
  ],
};
const network = [
  { id: '1', source: 'fetch', method: 'GET', url: 'https://example.com/api/me', createdAt: '', elapsedMs: 1, status: 200, requestHeaders: {}, requestBody: '' },
];
const endpoints = collectEndpointCandidates(snapshot, network, 'example.com');
assert(endpoints.includes('https://example.com/about'), 'absolute same-scope page URL should be collected');
assert(endpoints.includes('https://example.com/api/v2/users'), 'quoted API path from source should be collected');
assert(endpoints.includes('https://example.com/docs'), 'relative DOM link should be resolved');
assert(endpoints.includes('https://example.com/api/me'), 'captured same-scope network URL should be collected');
assert(!endpoints.some((url) => url.includes('evil.example.net') || url.includes('outside.invalid')), 'unrelated external hosts must be excluded');
assert(endpoints.includes('https://api.example.com/graphql'), 'saved root-domain scope includes its subdomains');
assert.equal(new Set(endpoints).size, endpoints.length, 'endpoint results should be deduplicated');

const js = collectJavaScriptAssets([
  'https://example.com/app.js',
  'https://example.com/chunk.mjs?v=2',
  'https://example.com/app.js',
  'https://example.com/image.png',
]);
assert.deepEqual(js, ['https://example.com/app.js', 'https://example.com/chunk.mjs?v=2']);

console.log('Hunter parser tests passed: source paths, DOM links, network URLs, scope filtering, deduplication and JS assets.');
rmSync(output, { recursive: true, force: true });
