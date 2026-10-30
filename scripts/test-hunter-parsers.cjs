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
  join(root, 'src', 'hunter-scope.ts'),
  '--target', 'ES2020',
  '--module', 'Node16',
  '--moduleResolution', 'Node16',
  '--ignoreConfig',
  '--skipLibCheck',
  '--outDir', output,
], { stdio: 'inherit' });

const { collectEndpointCandidates, collectJavaScriptAssets } = require(join(output, 'hunter-parsers.js'));
const { targetMatchesHost, isHttpUrlInScope, normalizeTargetPattern } = require(join(output, 'hunter-scope.js'));
assert.equal(normalizeTargetPattern('example.com'), 'example.com');
assert.equal(normalizeTargetPattern('*.example.com'), '*.example.com');
assert.equal(normalizeTargetPattern('https://example.com/path'), null, 'target patterns must not include paths or schemes');
assert.equal(normalizeTargetPattern('example.com:8443'), null, 'target patterns must not include ports');
assert.equal(normalizeTargetPattern('*.example.com/'), null, 'wildcards must not include paths');
assert.equal(targetMatchesHost('example.com', 'example.com'), true, 'exact scope should match its host');
assert.equal(targetMatchesHost('example.com', 'api.example.com'), false, 'exact scope must not silently include subdomains');
assert.equal(targetMatchesHost('*.example.com', 'api.example.com'), true, 'explicit wildcard should include subdomains');
assert.equal(targetMatchesHost('*.example.com', 'example.com'), false, 'wildcard should not include the apex');
assert.equal(isHttpUrlInScope('https://example.com/path', 'example.com'), true);
assert.equal(isHttpUrlInScope('https://api.example.com/path', 'example.com'), false);
assert.equal(isHttpUrlInScope('javascript:alert(1)', 'example.com'), false);
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
assert(!endpoints.includes('https://api.example.com/graphql'), 'exact host scope must exclude subdomains');
const wildcardEndpoints = collectEndpointCandidates(snapshot, network, '*.example.com');
assert(wildcardEndpoints.includes('https://api.example.com/graphql'), 'explicit wildcard scope should include subdomains');
assert.equal(new Set(endpoints).size, endpoints.length, 'endpoint results should be deduplicated');

const js = collectJavaScriptAssets([
  'https://example.com/app.js',
  'https://example.com/chunk.mjs?v=2',
  'https://example.com/app.js',
  'https://example.com/image.png',
]);
assert.deepEqual(js, ['https://example.com/app.js', 'https://example.com/chunk.mjs?v=2']);

console.log('Hunter tests passed: exact/wildcard scope boundaries, URL protocols, endpoint filtering, deduplication and JS assets.');
rmSync(output, { recursive: true, force: true });
