// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Runs every engine test on its own, in a fresh Node process, to prove no test depends on another having
// run first (an order dependence a whole-suite run cannot see).
//
//   node tools/check_isolation.js [--root <project dir>]
//   ISOLATION_TIMEOUT_MS   per-test limit (default 120000; the slowest real test takes about 7 s)
//
// The checker validates itself: a test file that fails or crashes during discovery, a TAP stream whose
// result lines disagree with its own count, a test that cannot be re-run alone, and a test that hangs
// all fail the check instead of being silently skipped.
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A clean environment for the child test runs. NODE_TEST_CONTEXT is set by Node inside a test run; if a
// nested `node --test` inherits it, it switches to Node's internal child protocol instead of printing TAP.
// ISO_SINGLE marks the isolated runs only; it is stripped everywhere else so an inherited marker (say, from a
// checker started inside another checker's isolated run) can never leak into discovery.
const childEnv = extra => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; delete env.ISO_SINGLE;
  return { ...env, ...extra };
};

// Turn one file's TAP output into its list of top-level test names, insisting the count adds up.
function parseDiscovery(tap) {
  const names = [];
  for (const line of tap.split('\n')) {
    const m = /^(?:not )?ok \d+ - (.+)$/.exec(line);
    if (m) names.push(m[1].replace(/ # (?:SKIP|TODO).*$/i, ''));
  }
  const summary = /^# tests (\d+)$/m.exec(tap);
  if (!summary) throw new Error('no "# tests" summary in TAP output');
  if (Number(summary[1]) !== names.length) throw new Error(`found ${names.length} test names but Node reported ${summary[1]}`);
  return names;
}

function main() {
  const argRoot = process.argv.indexOf('--root');
  const root = argRoot > -1 ? path.resolve(process.argv[argRoot + 1]) : path.resolve(__dirname, '..');
  const limit = Number(process.env.ISOLATION_TIMEOUT_MS) || 120_000;
  const files = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.js')).sort().map(f => path.join('tests', f));

  // 1. Discovery: run each file once and list its tests. Any failure here fails the whole check.
  const plan = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: root, encoding: 'utf8', timeout: limit * 20, env: childEnv({}) });
    const why = r.error ? (r.error.code === 'ETIMEDOUT' ? 'timed out' : r.error.message)
      : r.signal ? `killed by ${r.signal}` : r.status !== 0 ? `exit status ${r.status}` : null;
    let names = [];
    try { names = parseDiscovery(r.stdout || ''); } catch (e) { if (!why) return fail(`Discovery failed for ${file}: ${e.message}`, r); }
    if (why) return fail(`Discovery failed for ${file}: ${why} (${names.length} tests listed before it stopped)`, r);
    for (const name of names) plan.push({ file, name });
  }
  if (!plan.length) return fail('No tests found.');

  // 2. Run each test alone. ISO_SINGLE lets the checker's own tests simulate order-dependent tests.
  let failed = 0;
  for (const { file, name } of plan) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=^${escape(name)}$`, file],
      { cwd: root, encoding: 'utf8', timeout: limit, env: childEnv({ ISO_SINGLE: '1' }) });
    const ms = Date.now() - t0;
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    // Passing means the named test itself reported ok. Counting "# pass 1" is not enough: when the pattern
    // matches nothing, Node reports the file as one passing test even though the test never ran.
    const results = [...(r.stdout || '').matchAll(/^\s*(not )?ok \d+ - (.+)$/gm)].map(m => ({ ok: !m[1], name: m[2] }));
    const own = results.filter(x => x.name === name);
    const passed = !r.error && r.status === 0 && own.length === 1 && own[0].ok && results.every(x => x.ok);
    const label = timedOut ? 'TIMEOUT' : passed ? 'ok     ' : 'FAIL   ';
    console.log(`${label} ${String(ms).padStart(6)} ms  ${file} :: ${name}`);
    if (!passed){
      failed++;
      if (!timedOut) console.log((r.stdout || '').split('\n').filter(l => /error|not ok|expected|Error|# pass|# tests/.test(l)).slice(0, 6).join('\n'));
    }
  }
  console.log(`\n${plan.length - failed}/${plan.length} tests pass when run on their own.`);
  process.exitCode = failed ? 1 : 0;
}

function fail(message, r) {
  console.error(message);
  if (r && r.stderr) console.error(r.stderr.split('\n').slice(-10).join('\n'));
  process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { parseDiscovery };
