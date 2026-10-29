const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { zipSync, strToU8 } = require('fflate');

const root = resolve(__dirname, '..');
const output = join(root, 'node_modules', '.cache', 'onebyte-zip-safety-tests');
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  join(root, 'src', 'zip-safety.ts'),
  '--target', 'ES2020',
  '--module', 'Node16',
  '--moduleResolution', 'Node16',
  '--ignoreConfig',
  '--skipLibCheck',
  '--esModuleInterop',
  '--outDir', output,
], { stdio: 'inherit' });

const { preflightZip, base64ToBytes } = require(join(output, 'zip-safety.js'));
const valid = zipSync({ 'src/main.py': strToU8('print("OneByte")') });
assert.doesNotThrow(() => preflightZip(valid), 'normal project ZIP should pass');
const encoded = Buffer.from(valid).toString('base64');
assert.deepEqual(base64ToBytes(encoded), valid, 'base64 decoder should preserve every byte');
assert.throws(() => preflightZip(strToU8('not a zip')), /ZIP|zip/i, 'invalid archive should be rejected');

const traversal = zipSync({ '../escape.py': strToU8('print(1)') });
assert.throws(() => preflightZip(traversal), /مسار غير آمن/, 'parent traversal path should be rejected');

const zipBomb = zipSync({ 'large.txt': strToU8('A'.repeat(3 * 1024 * 1024)) }, { level: 9 });
assert.throws(() => preflightZip(zipBomb), /نسبة ضغط غير آمنة/, 'high compression-ratio archive should be rejected');

console.log('ZIP safety tests passed: valid archive, Base64 roundtrip, invalid archive, traversal, and ZIP-bomb ratio.');
rmSync(output, { recursive: true, force: true });
