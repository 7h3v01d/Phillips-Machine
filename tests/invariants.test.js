// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Category 1 (invariants) and 2 (behavioural properties). These are the tests that try to break
// the model: seeded random legal slider settings, every tank driven to empty, and step-by-step
// accounting residuals. A green run here is what lets the README say "stock-flow consistent".
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngines } = require('./load-engines.js');

const { CLASSIC, MODERN } = loadEngines();
const DT = 0.02;
const TOL = 1e-9;          // per-step accounting tolerance (model units)

// Deterministic PRNG (mulberry32) so any failure is reproducible from its seed.
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Set every slider and toggle to a random legal value, exactly as a user could.
function randomise(E, r) {
  E.reset();
  for (const g of E.groups) {
    for (const s of g.sliders) { const n = Math.floor((s.max - s.min) / s.step + 1e-9); E.p[s.id] = s.min + Math.round(r() * n) * s.step; }
    for (const t of (g.toggles || [])) E.p[t.id] = r() < 0.5;
  }
}

const MONEY = {
  classic: st => st.TB + st.SB + st.Tr + st.FB,
  modern:  st => st.TB + st.SV + st.FB
};
const TANKS = { classic: ['TB', 'SB', 'Tr', 'FB'], modern: ['TB', 'SV', 'FB'] };

// Flows actually applied in the step just taken. Engines report them in st.acct; for engines that
// do not (the pre-fix code) fall back to the flow record the step was computed from, so these tests
// fail on genuine accounting leaks rather than on a missing field.
function applied(E, fPrev) {
  if (E.st.acct) return E.st.acct;
  if (E.id === 'classic') return { created: E.st.f.omo };
  return { created: fPrev.L - fPrev.R + fPrev.q, L: fPrev.L, R: fPrev.R, q: fPrev.q, Def: fPrev.Def };
}

// Step once and return the accounting residual for that step.
function stepResidual(E) {
  const before = MONEY[E.id](E.st), fPrev = E.st.f;
  E.step(DT);
  return (MONEY[E.id](E.st) - before) - applied(E, fPrev).created * DT;
}

function checkRun(E, quarters, label) {
  for (let k = 0; k < quarters / DT; k++) {
    const legacy = !E.st.acct, r = stepResidual(E);
    // Fallback mode only: the old engines' flow record is stale for the first step after settings change.
    if (legacy && k === 0) continue;
    if (Math.abs(r) > TOL) assert.fail(`${label}: residual ${r.toExponential(3)} at step ${k}`);
    for (const t of TANKS[E.id]) if (!(E.st[t] >= 0)) assert.fail(`${label}: tank ${t} = ${E.st[t]} at step ${k}`);
  }
}

/* ---------- Category 1: invariants ---------- */

for (const E of [CLASSIC, MODERN]) {
  test(`${E.id}: money conserved every step across 300 random legal settings`, () => {
    const r = rng(E.id === 'classic' ? 1949 : 2026);
    for (let run = 0; run < 300; run++) {
      randomise(E, r);
      checkRun(E, 20, `${E.id} run ${run} ${JSON.stringify(E.p)}`);
    }
  });

  test(`${E.id}: money conserved when each tank is forced empty`, () => {
    for (const tank of TANKS[E.id]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const r = rng(seed * 97 + tank.length);
        randomise(E, r);
        E.st[tank] = 0;                       // start dry
        checkRun(E, 10, `${E.id} ${tank} dry, seed ${seed}`);
      }
    }
  });

  test(`${E.id}: every experiment conserves money`, () => {
    for (const [name, apply] of E.scenarios) { apply(); checkRun(E, 40, `${E.id} "${name}"`); }
  });
}

test('modern: debt ledgers match the flows actually applied', () => {
  const r = rng(77);
  for (let run = 0; run < 100; run++) {
    randomise(MODERN, r);
    for (let k = 0; k < 500; k++) {
      const D0 = MODERN.st.D, P0 = MODERN.st.B + MODERN.st.Bcb, C0 = MODERN.st.Bcb, pi0 = MODERN.st.pi, fPrev = MODERN.st.f;
      MODERN.step(DT);
      if (!MODERN.st.acct && k === 0) continue;   // legacy fallback: stale first-step record
      const a = applied(MODERN, fPrev), gN = (2 + pi0) / 400;
      const rD = (MODERN.st.D - D0) - (a.L - a.R) * DT;
      const rP = (MODERN.st.B + MODERN.st.Bcb - P0) - (a.Def - gN * P0) * DT;
      const rC = (MODERN.st.Bcb - C0) - (a.q - gN * C0) * DT;
      assert.ok(Math.abs(rD) < TOL && Math.abs(rP) < TOL && Math.abs(rC) < TOL, `run ${run} step ${k}: ${rD}, ${rP}, ${rC}`);
      assert.ok(MODERN.st.Bcb >= 0 && MODERN.st.D >= 0, `RBA bonds ${MODERN.st.Bcb}, household debt ${MODERN.st.D}`);
    }
  }
});

/* ---------- Category 2: behavioural properties ---------- */

test('modern: consumer confidence reallocates income between spending and saving', () => {
  for (const conf of [-10, -8, -3, 0, 2, 5]) {
    MODERN.reset(); MODERN.p.conf = conf; MODERN.init();
    const f = MODERN.st.f;
    assert.ok(Math.abs(f.C + f.S - f.Yd) < TOL, `conf ${conf}: C + S = ${f.C + f.S}, Yd = ${f.Yd}`);
  }
  MODERN.reset(); const base = MODERN.st.f;
  MODERN.reset(); MODERN.p.conf = -8; MODERN.init(); const low = MODERN.st.f;
  assert.ok(Math.abs((base.C - low.C) - 8) < 1e-6, 'confidence −8 cuts consumption by 8');
  assert.ok(Math.abs((low.S - base.S) - 8) < 1e-6, '…and raises saving by the same 8');
});

test('modern: a higher saving ratio moves spending into saving without changing disposable income', () => {
  MODERN.reset(); const a = MODERN.st.f;
  MODERN.reset(); MODERN.p.s = 0.12; MODERN.init(); const b = MODERN.st.f;
  assert.ok(Math.abs(a.Yd - b.Yd) < 1e-9, 'Yd unchanged on impact');
  assert.ok(b.S > a.S && b.C < a.C, 'saving up, consumption down');
});

test('modern: a higher cash rate lowers rate-sensitive demand, other things equal', () => {
  MODERN.reset(); MODERN.p.rule = false; MODERN.p.iManual = 4.6; MODERN.step(DT); const lo = MODERN.st.f;
  MODERN.reset(); MODERN.p.rule = false; MODERN.st.i = 6.6; MODERN.step(DT); const hi = MODERN.st.f;
  assert.ok(hi.L < lo.L, `new credit ${hi.L} < ${lo.L}`);
  assert.ok(hi.Ib < lo.Ib, `business investment ${hi.Ib} < ${lo.Ib}`);
  assert.ok(hi.mort > lo.mort, 'mortgage rate rises');
});

test('modern: QE swaps private bonds for deposits one-for-one', () => {
  MODERN.reset(); MODERN.p.qe = 5;
  MODERN.init();
  const B0 = MODERN.st.B, C0 = MODERN.st.Bcb, pi0 = MODERN.st.pi, fPrev = MODERN.st.f;
  MODERN.step(DT);
  const a = applied(MODERN, fPrev), gN = (2 + pi0) / 400;
  assert.ok(Math.abs(a.q - 5) < 1e-12, 'QE executed in full');
  assert.ok(Math.abs((MODERN.st.Bcb - C0) - (5 - gN * C0) * DT) < TOL, 'RBA holdings rise by the purchase');
  assert.ok(Math.abs((MODERN.st.B - B0) - (a.Def - 5 - gN * B0) * DT) < TOL, 'private holdings fall by the purchase');
});

test('modern: QE never buys bonds that do not exist; QT never sells bonds the RBA does not hold', () => {
  // A surplus with no debt left is fine (the government then holds net financial assets), but the RBA
  // must never purchase more bonds than private holders own, nor sell more than it holds.
  const r = rng(404);
  for (let run = 0; run < 100; run++) {
    randomise(MODERN, r);
    MODERN.st.B = r() * 5; MODERN.st.Bcb = r() * 2; MODERN.p.qe = r() < 0.5 ? 10 : -4;
    for (let k = 0; k < 300; k++) {
      const B0 = MODERN.st.B;
      MODERN.step(DT);
      const a = MODERN.st.acct;
      if (a.q > 0) assert.ok(a.q * DT <= Math.max(0, B0) + Math.max(0, a.Def) * DT + TOL, `run ${run}: bought ${a.q * DT} with ${B0} available`);
      assert.ok(MODERN.st.Bcb >= 0, `run ${run}: RBA bonds ${MODERN.st.Bcb}`);
    }
  }
});

test('modern: the rule uses underlying inflation; headline CPI adds energy on top', () => {
  MODERN.reset();
  const st = MODERN.st, f = st.f, P = MODERN.p;
  assert.equal(st.pi, 3.6, 'underlying (trimmed mean) starts at 3.6%');
  assert.ok(Math.abs(f.cpi - 4.0) < 1e-9, `headline CPI starts at 4.0%, got ${f.cpi}`);
  const fromUnderlying = 0.6 + 3.6 + P.phiPi * (3.6 - P.target) + P.phiY * f.gap;
  assert.ok(Math.abs(f.istar - fromUnderlying) < 1e-9, `rule ${f.istar} should use 3.6%, not 4.0% headline`);
});

test('modern: an oil shock lifts headline CPI more than underlying inflation', () => {
  const s = MODERN.scenarios.find(x => x[0] === 'Oil shock'); s[1]();
  let gapMax = 0;
  for (let k = 0; k < 1000; k++) { MODERN.step(DT); gapMax = Math.max(gapMax, MODERN.st.f.cpi - MODERN.st.pi); }
  assert.ok(gapMax > 1, `headline exceeds underlying by ${gapMax.toFixed(2)} pts at peak`);
});

test('every slider range lands exactly on its step grid', () => {
  // A max that is not min + n·step can never be reached in the browser (found by the browser smoke suite).
  for (const E of [CLASSIC, MODERN]) for (const g of E.groups) for (const s of g.sliders) {
    const n = (s.max - s.min) / s.step;
    assert.ok(Math.abs(n - Math.round(n)) < 1e-9, `${E.id}.${s.id}: (${s.max} − ${s.min}) / ${s.step} = ${n}`);
    assert.ok(E.DEFAULTS[s.id] >= s.min - 1e-9 && E.DEFAULTS[s.id] <= s.max + 1e-9, `${E.id}.${s.id}: default out of range`);
    const d = (E.DEFAULTS[s.id] - s.min) / s.step;
    assert.ok(Math.abs(d - Math.round(d)) < 1e-9, `${E.id}.${s.id}: default ${E.DEFAULTS[s.id]} is off the step grid`);
  }
});
