// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (github.com/7h3v01d)
// Loads src/js/engines.js into an isolated VM context so the simulation can be tested without a browser.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Only what the engines touch while stepping; drawing helpers are never called headlessly.
const PRELUDE = `
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sgn = v => (v >= 0 ? '+' : '');
  const C = {}; const FONT = ''; let running = true;
  function setCaption() {}
`;

function loadEngines() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'engines.js'), 'utf8');
  const ctx = vm.createContext({ Math, console });
  vm.runInContext(PRELUDE + '\n' + src, ctx, { filename: 'engines.js' });
  return ctx.MONIAC_ENGINES;
}

// Run `quarters` of simulated time at the browser's step size and collect simple statistics.
function run(engine, quarters, onStep) {
  const dt = 0.02, steps = Math.round(quarters / dt);
  for (let k = 0; k < steps; k++) { engine.step(dt); if (onStep) onStep(engine.st); }
  return engine.st;
}

module.exports = { loadEngines, run };
