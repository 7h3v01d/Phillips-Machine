// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Category 3 (regression): the calibration starts where the sources say, and every experiment caption on the
// page still matches what the model does. These pin behaviour; they do not validate the economics.
// Accounting invariants and behavioural properties live in invariants.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngines, run } = require('./load-engines.js');

const { CLASSIC, MODERN } = loadEngines();
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected} ± ${tol}, got ${actual.toFixed(3)}`);

function scenario(engine, name) {
  const s = engine.scenarios.find(x => x[0] === name);
  assert.ok(s, `scenario "${name}" exists`);
  return s;
}

// Run a modern experiment for ten years and collect the extremes its caption talks about.
function modernStats(name) {
  scenario(MODERN, name)[1]();
  const k = { iMax: -1, iMin: 99, piMax: -99, cpiMax: -99, uMax: 0, audMin: 9, hhMax: 0, rbaMax: 0, pubMax: 0 };
  run(MODERN, 40, st => {
    const f = st.f;
    k.iMax = Math.max(k.iMax, st.i); k.iMin = Math.min(k.iMin, st.i); k.piMax = Math.max(k.piMax, st.pi); k.cpiMax = Math.max(k.cpiMax, f.cpi);
    k.uMax = Math.max(k.uMax, f.u); k.audMin = Math.min(k.audMin, f.aud); k.hhMax = Math.max(k.hhMax, f.hhDebt);
    k.rbaMax = Math.max(k.rbaMax, f.rbaBonds); k.pubMax = Math.max(k.pubMax, f.pubDebt);
  });
  return { ...k, end: MODERN.st };
}

/* ---------- 1949 machine ---------- */

test('1949: water is conserved except for open-market operations', () => {
  CLASSIC.reset();
  CLASSIC.p.omo = 1.5;
  const total = st => st.TB + st.SB + st.Tr + st.FB;
  const before = total(CLASSIC.st);
  run(CLASSIC, 8);
  near(total(CLASSIC.st) - before, 1.5 * 8, 0.05, 'money stock change');
});

test('1949: baseline settles near Y = 100', () => {
  CLASSIC.reset();
  run(CLASSIC, 60);
  near(CLASSIC.st.f.Y, 100, 1.5, 'steady-state income');
});

const governor = [
  ['Governor: P only',        st => { near(st.iae, 600, 25, 'error score'); near(st.f.Y, 92, 1, 'income stuck below target'); }],
  ['Governor: P + I + D',     st => { assert.ok(st.iae < 50, `error score ${st.iae}`); assert.ok(Math.abs(st.f.gap) < 1.5, `gap ${st.f.gap.toFixed(2)}`); }]
];
for (const [name, check] of governor) {
  test(`1949: ${name}`, () => { scenario(CLASSIC, name)[1](); run(CLASSIC, 80); check(CLASSIC.st); });
}

test('1949: P + I overshoots; badly timed policy amplifies swings until the money runs out', () => {
  const range = name => { scenario(CLASSIC, name)[1](); let lo = 1e9, hi = -1e9;
    for (let q = 0; q < 80; q++) { run(CLASSIC, 1); lo = Math.min(lo, CLASSIC.st.f.Y); hi = Math.max(hi, CLASSIC.st.f.Y); }
    return [lo, hi, CLASSIC.st.iae]; };
  const [lo1, hi1, e1] = range('Governor: P + I');
  near(lo1, 86, 1.5, 'P+I trough'); near(hi1, 110, 1.5, 'P+I peak'); near(e1, 252, 15, 'P+I error score');
  const [lo2, hi2, e2] = range('Governor: lag wrecks it');
  near(lo2, 80, 1.5, 'badly timed trough'); near(hi2, 111, 1.5, 'badly timed peak'); near(e2, 360, 20, 'error score');
  // The swings stop short of exploding only because idle balances run dry: the funding limit is real plumbing.
  scenario(CLASSIC, 'Governor: lag wrecks it')[1](); run(CLASSIC, 16);
  assert.ok(CLASSIC.st.SB < 1 && CLASSIC.st.Tr < 1, `idle balances ${CLASSIC.st.SB.toFixed(2)}, Treasury ${CLASSIC.st.Tr.toFixed(2)} by year four`);
  scenario(CLASSIC, 'Governor: lag wrecks it')[1](); CLASSIC.p.Kd = 3; run(CLASSIC, 80);
  near(CLASSIC.st.iae, 130, 10, 'derivative action rescues it');
});

/* ---------- Modern Australia ---------- */

test('modern: starting point matches the October 2026 calibration', () => {
  MODERN.reset();
  const st = MODERN.st;
  assert.equal(st.i, 4.6);
  assert.equal(st.pi, 3.6);
  near(st.f.u, 4.6, 0.01, 'unemployment');
  near(st.f.aud, 0.70, 0.001, 'AUD/USD');
  near(st.f.pubDebt, 34, 0.1, 'public debt % GDP');
  near(st.f.Def, 1.4, 0.15, 'deficit % GDP');
  near(st.f.C, 51.4, 1.5, 'household consumption share');
  near(st.f.Ib, 12.6, 0.2, 'business investment share');
  near(st.f.L, 5.3, 0.1, 'credit-financed dwelling spending');
  near(st.f.X, 24.7, 0.1, 'exports share');
  near(st.f.S / st.f.Yd, 0.065, 0.001, 'household saving ratio');
});

test('modern: deposits change only through credit creation, repayment and QE', () => {
  MODERN.reset();
  MODERN.p.qe = 2;
  const money = st => st.TB + st.SV + st.FB;
  const before = money(MODERN.st);
  let created = 0;
  run(MODERN, 12, st => { created += (st.f.L - st.f.R + st.f.q) * 0.02; });
  near(money(MODERN.st) - before, created, 0.5, 'money created');
});

test('modern: the rule moves the cash rate in 25bp steps at most', () => {
  scenario(MODERN, 'Oil shock')[1]();
  run(MODERN, 40);
  const moves = MODERN.st.log.map(l => Math.abs(l[1]));
  assert.ok(moves.length >= 70, `meetings held: ${moves.length}`);
  assert.ok(moves.every(m => m === 0 || Math.abs(m - 0.25) < 1e-9), 'only 0 or 25bp moves');
});

// Each entry mirrors the numbers quoted in that experiment's on-page caption.
const captions = {
  'Baseline outlook':      k => { near(k.iMin, 3.6, 0.01, 'trims to 3.6%'); near(k.end.i, 3.85, 0.26, 'settles 3.85–4.1%'); assert.ok(k.uMax < 5.2, 'u peaks near 5%'); assert.ok(k.end.pi > 2.5 && k.end.pi < 3.0, 'inflation near top of band'); },
  'Oil shock':             k => { near(k.cpiMax, 4.6, 0.1, 'headline peaks about 4.6%'); assert.ok(k.piMax <= 3.6 + 1e-9, 'underlying never rises'); near(k.iMax, 4.6, 1e-9, 'no hike: RBA looks through'); near(k.uMax, 5.5, 0.1, 'u about 5.5%'); },
  'Iron ore slump':        k => { assert.ok(k.uMax > 8, 'u above 8%'); assert.ok(k.audMin < 0.53, 'AUD low 0.50s'); near(k.iMin, 1.35, 0.01, 'cuts to 1.35%'); assert.ok(k.iMax > 5, 'hikes again'); },
  'Housing credit boom':   k => { assert.ok(k.hhMax > 110, 'household debt over 110%'); assert.ok(k.iMin >= 4.1 - 1e-9 && k.iMax <= 4.85 + 1e-9, 'cash rate 4.1–4.85%'); },
  'Deep recession and QE': k => { near(k.iMin, 0.1, 1e-9, 'floor'); assert.ok(k.uMax > 9 && k.uMax < 10, 'u 9–10%'); near(k.rbaMax, 27, 1, 'RBA share about 27% of GDP'); },
  'US rates +2 points':    k => { near(k.audMin, 0.65, 0.01, 'AUD about 0.65'); near(k.iMin, 3.85, 0.01, 'trims to 3.85%'); assert.ok(k.end.i >= 4.6 - 1e-9, 'back to 4.6–4.85%'); },
  'Fiscal stimulus':       k => { near(k.iMax, 5.35, 0.01, 'hikes to 5.35%'); assert.ok(k.end.f.u < 4, 'u below 4%'); near(k.end.f.pubDebt, 49, 1, 'debt toward 49%'); },
  'RBA freezes rates':     k => { assert.equal(k.iMax, 4.6); assert.equal(k.iMin, 4.6); assert.ok(k.uMax > 7, 'u above 7%'); assert.ok(k.end.pi < 0, 'inflation below zero'); }
};

for (const [name, check] of Object.entries(captions)) {
  test(`modern caption holds: ${name}`, () => check(modernStats(name)));
}

test('modern: every experiment has a caption check', () => {
  // Array.from builds the list in this realm so deepEqual compares plain arrays.
  assert.deepEqual(Array.from(MODERN.scenarios, s => s[0]).sort(), Object.keys(captions).sort());
});


/* ---------- 1949 experiment captions (regression) ---------- */

function classicStats(name) {
  scenario(CLASSIC, name)[1]();
  const s0 = { ...CLASSIC.st.f, FB: CLASSIC.st.FB };
  const k = { Ymax: -1, Ymin: 1e9, wMin: 99, uMax: 0, rMax: 0, IMin: 99, eMin: 9, FBmax: 0, FBmin: 1e9, swings: 0 };
  let dir = 0, prev = s0.Y;
  for (let q = 0; q < 60; q++) {
    run(CLASSIC, 1);
    const f = CLASSIC.st.f, d = Math.sign(f.Y - prev);
    if (d && dir && d !== dir) k.swings++; if (d) dir = d; prev = f.Y;
    k.Ymax = Math.max(k.Ymax, f.Y); k.Ymin = Math.min(k.Ymin, f.Y); k.wMin = Math.min(k.wMin, f.w); k.uMax = Math.max(k.uMax, f.u);
    k.rMax = Math.max(k.rMax, f.r); k.IMin = Math.min(k.IMin, f.I); k.eMin = Math.min(k.eMin, f.e);
    k.FBmax = Math.max(k.FBmax, CLASSIC.st.FB); k.FBmin = Math.min(k.FBmin, CLASSIC.st.FB);
  }
  return { s0, k, end: CLASSIC.st.f, endFB: CLASSIC.st.FB };
}

const classicCaptions = {
  'Fiscal stimulus':     ({ s0, k, end }) => { near(k.Ymax - s0.Y, 19, 1.5, 'peaks about 19 higher'); assert.ok(s0.r < 5.2 && k.rMax > 7, 'r from about 5% to over 7%'); assert.ok(end.I < s0.I - 3, 'investment crowded out'); },
  'Austerity':           ({ k, end }) => { assert.ok(end.T - end.G > 0, 'budget in surplus'); assert.ok(end.Y < 80, 'income falls'); assert.ok(k.uMax > 8 && k.wMin < 0, 'unemployment up, wage growth negative'); },
  'Paradox of thrift':   ({ s0, end }) => { near(end.Y, 91, 1.5, 'income about 91'); assert.ok(end.S > 1.7 * s0.S, 'saving nearly doubles'); assert.ok(end.r < 1, 'r below 1%'); assert.ok(end.I > s0.I + 5, 'investment rises to match'); },
  'Credit squeeze':      ({ s0, k, end }) => { assert.ok(k.rMax > s0.r + 4, 'interest rate climbs'); assert.ok(end.I < 3, 'investment falls away'); },
  'Export boom':         ({ s0, k, end, endFB }) => { near(k.Ymax, 109, 1.5, 'income jumps to about 109'); assert.ok(endFB < s0.FB - 15, 'foreign balances run down'); assert.ok(k.eMin < 0.7, 'currency appreciates'); near(end.Y, s0.Y, 1, 'income drifts back'); },
  'Trade cycle':         ({ k }) => { assert.ok(k.swings >= 5 && k.Ymax - k.Ymin > 50, `overshoots and swings (${k.swings} turns, ${k.Ymin.toFixed(0)}–${k.Ymax.toFixed(0)})`); },
  'Fixed exchange rate': ({ s0, end, endFB }) => { assert.ok(endFB > 2 * s0.FB, 'foreign-held balances pile up'); assert.ok(end.Y < 70, 'money drains out of the domestic economy'); }
};
for (const [name, check] of Object.entries(classicCaptions)) {
  test(`1949 caption holds: ${name}`, () => check(classicStats(name)));
}

test('1949: every experiment has a caption check', () => {
  const covered = new Set([...Object.keys(classicCaptions), 'Governor: P only', 'Governor: P + I', 'Governor: P + I + D', 'Governor: lag wrecks it']);
  assert.deepEqual(Array.from(CLASSIC.scenarios, s => s[0]).sort(), [...covered].sort());
});
