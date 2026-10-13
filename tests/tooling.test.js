// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// The assurance tools are tested too: an isolation checker that can be fooled, or release metadata that
// drifts, would quietly undermine everything else. Each case builds a throwaway project in a temp folder.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(ROOT, 'tools', 'check_isolation.js');

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-'));
  fs.mkdirSync(path.join(dir, 'tests'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'tests', name), body);
  return dir;
}
function check(dir) {
  return spawnSync(process.execPath, [CHECKER, '--root', dir], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, ISOLATION_TIMEOUT_MS: '3000' }
  });
}
const HEADER = "const test = require('node:test');\n";

test('isolation checker passes a healthy project', () => {
  const r = check(project({ 'a.test.js': HEADER + "test('one', () => {});\ntest('two', () => {});\n" }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2\/2 tests pass when run on their own/);
});

test('isolation checker fails when a test file crashes during discovery', () => {
  const r = check(project({
    'a.test.js': HEADER + "test('fine', () => {});\n",
    'b.test.js': HEADER + "test('first', () => {});\ntest('kills the process', () => { process.exit(3); });\ntest('never runs', () => {});\n"
  }));
  assert.notEqual(r.status, 0, 'a crashing file must fail the check');
  assert.match(r.stdout + r.stderr, /Discovery failed for tests[\\/]b\.test\.js/);
});

test('isolation checker never counts a test it could not re-run alone as passing', () => {
  // TAP escapes the newline, so this name cannot be matched on its own: zero tests run. That is a failure.
  const r = check(project({ 'a.test.js': HEADER + "test('ok', () => {});\ntest('multi\\nline', () => {});\n" }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL .*multi/);
});

test('discovery parser rejects TAP whose result lines disagree with its reported count', () => {
  const { parseDiscovery } = require(CHECKER);
  assert.deepEqual(parseDiscovery('ok 1 - a\nnot ok 2 - b\n# tests 2\n'), ['a', 'b']);
  assert.throws(() => parseDiscovery('ok 1 - a\n# tests 2\n'), /found 1 test names but Node reported 2/);
  assert.throws(() => parseDiscovery('ok 1 - a\n'), /no "# tests" summary/);
});

test('isolation checker reports a hanging test as TIMEOUT instead of hanging', () => {
  const dir = project({ 'a.test.js': HEADER + "test('quick', () => {});\ntest('hangs only when run alone', () => { if (process.env.ISO_SINGLE) while (true) {} });\n" });
  const t0 = Date.now(), r = check(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /TIMEOUT .*hangs only when run alone/);
  assert.ok(Date.now() - t0 < 30_000, 'the checker must give up on its own');
});

test('isolation checker fails a test that fails only when run alone', () => {
  const r = check(project({ 'a.test.js': HEADER + "test('order dependent', () => { if (process.env.ISO_SINGLE) throw new Error('needs setup'); });\n" }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /FAIL .*order dependent/);
});

/* ---------- release metadata ---------- */

test('release metadata agrees: package.json, CITATION.cff and CHANGELOG', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cff = fs.readFileSync(path.join(ROOT, 'CITATION.cff'), 'utf8');
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(cff, /^cff-version: 1\.2\.0$/m, 'cff-version is the Citation File Format schema version and must stay 1.2.0');
  assert.match(cff, new RegExp(`^version: ${pkg.version.replace(/\./g, '\\.')}$`, 'm'), 'CITATION.cff version matches package.json');
  const top = /^## (\d+\.\d+\.\d+)/m.exec(changelog);
  assert.ok(top && top[1] === pkg.version, `newest CHANGELOG entry (${top && top[1]}) matches package.json (${pkg.version})`);
});

test('isolation checker ignores an ISO_SINGLE marker inherited from its own environment', () => {
  // Found when the real checker ran this file in isolation: the inner checker inherited the marker.
  const dir = project({ 'a.test.js': HEADER + "test('fails only when run alone', () => { if (process.env.ISO_SINGLE) throw new Error('x'); });\n" });
  const r = spawnSync(process.execPath, [CHECKER, '--root', dir], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, ISOLATION_TIMEOUT_MS: '3000', ISO_SINGLE: '1' }
  });
  assert.doesNotMatch(r.stdout + r.stderr, /Discovery failed/, 'discovery must not see the marker');
  assert.match(r.stdout, /FAIL .*fails only when run alone/);
});
