<div align="center">

# Phillips Machine · MONIAC

**A working, visual simulation of Bill Phillips's 1949 hydraulic economy computer, and the same idea rebuilt for Australia in 2026.**

[![CI](https://github.com/7h3v01d/phillips-machine/actions/workflows/ci.yml/badge.svg)](https://github.com/7h3v01d/phillips-machine/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-2fd6c3)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-4be08a)](https://7h3v01d.github.io/phillips-machine/)
![No build step](https://img.shields.io/badge/dependencies-none-ffb454)

[**Open the live demo →**](https://7h3v01d.github.io/phillips-machine/)

<img src="docs/img/modern.png" alt="The modern Australian board: tanks of money, a Reserve Bank box, bank credit, debt ledgers, chart recorder and Phillips curve" width="100%">

</div>

---

## About

In 1949 a New Zealand engineer-turned-economist, A.W.H. (Bill) Phillips, built a two-metre machine at the London School of Economics that computed the national economy with water. Coloured water stood for money. Tanks held stocks such as idle balances and the Treasury. Pipes carried flows such as income, taxes, saving, investment and trade. Slotted valves set the behavioural rules. He called it the **MONIAC** (Monetary National Income Analogue Computer). About fourteen were built, and working examples survive at Cambridge and at the Reserve Bank of New Zealand. The LSE's original is in the Science Museum, London.

This project recreates the machine's principal hydraulic relationships closely enough to explore experiments inspired by Phillips's work, including the PID stabilisation policy of his 1954 paper. It then asks what the same board looks like if you plumb in a modern economy: an inflation-targeting central bank, banks that create money by lending, public debt and quantitative easing, and a floating currency driven by capital flows. The modern board is calibrated to Australian data as of October 2026.

Both boards are designed to be stock-flow consistent: money moves only through pipes, an emptying tank throttles its outlets instead of going negative, and only explicit creation (open-market operations; bank lending, repayment and QE) changes the total. The invariant suite verifies per-step conservation across randomised legal controls and the supplied experiments, over horizons of up to 400 quarters. That is strong evidence over a large finite domain, not a proof for arbitrary settings and time.

Everything runs client-side in plain HTML, CSS and JavaScript. There are no dependencies and no build step.

## Two machines, one page

Switch between them with the toggle in the header. Each keeps its own state, so you can flip back and forth mid-experiment.

| | **1949 · Phillips original** | **2026 · Modern Australia** |
|---|---|---|
| Who sets interest rates | A float on the idle-balances tank: more idle money means a lower rate | The Reserve Bank, via an inflation-targeting rule, in 25bp steps at 8 meetings a year |
| Where money comes from | A fixed stock of water, plus open-market operations | Bank lending creates deposits, repayments destroy them, and QE adds reserves |
| Government | Treasury tank, which can borrow idle balances | Bonds sold out of savings; debt ledger with the RBA's share hatched |
| External sector | Foreign-held balances and an optional floating rate | Capital flows chase the AUD–US rate gap; commodity prices and oil feed the dollar and CPI |
| Inflation | Money wages, via the 1958 curve | Underlying (trimmed-mean) inflation drives the RBA rule; headline CPI adds energy on top |
| Policy panel | Phillips's 1954 **PID Treasury governor** | **Reserve Bank board**: live rule arithmetic, next call, decision log |
| Phillips curve | His 1958 fitted curve, `ẇ + 0.900 = 9.638·u^−1.394` | Expectations-augmented short-run curve, NAIRU line, 1958 curve as a ghost |

<table>
<tr>
<td width="50%"><img src="docs/img/classic-1949.png" alt="The 1949 board running the trade-cycle experiment"><br><sub><b>1949 board</b>, trade-cycle experiment: the accelerator makes income overshoot and swing.</sub></td>
<td width="50%"><img src="docs/img/oil-shock.png" alt="The modern board during an oil shock: headline CPI rises above underlying inflation while the RBA looks through it"><br><sub><b>2026 board</b>, oil shock: headline CPI (dashed) jumps above underlying inflation, and the RBA looks through the supply shock instead of hiking.</sub></td>
</tr>
</table>

## Quick start

| Option | How |
|---|---|
| **Live demo** | Open <https://7h3v01d.github.io/phillips-machine/> |
| **Local, no install** | Clone or download the repo and double-click `src/index.html` |
| **Local server (Windows)** | Run `serve.bat` (uses Python), then open <http://localhost:8000> |
| **Local server (any OS)** | `python -m http.server 8000 --directory src` |
| **Single portable file** | `python tools/build_single_file.py` writes `dist/phillips-machine.html` with all application HTML, CSS and JS inlined (the optional web font stays external) |

The page works offline. Only the JetBrains Mono web font is fetched from Google Fonts, and the page falls back to a system monospace font without it.

## Using it

**The board.** Every tank is a stock of money and every pipe a flow per quarter. Dash speed and pipe width show flow size; amber pipes are money being created (bank credit, QE). The production-lag box shows the order backlog between spending and output. The readouts below the board update live.

**Experiments.** Each button applies one shock and explains what to watch. Every experiment first resets its board to a known starting point (a settled 1949 machine, or October 2026), so runs are directly comparable.

| 1949 board | 2026 board |
|---|---|
| Fiscal stimulus · Austerity · Paradox of thrift · Credit squeeze · Export boom · Trade cycle · Fixed exchange rate | Baseline outlook · Oil shock · Iron ore slump · Housing credit boom · Deep recession and QE · US rates +2 points · Fiscal stimulus · RBA freezes rates |
| Governor: P only · P + I · P + I + D · Lag wrecks it | |

**Valve settings.** Every behavioural parameter is a slider, including tax and saving rates, the RBA's inflation target and rule weights, credit appetite, commodity and oil prices, US rates, the PID gains and the production lag. Toggles switch the RBA to manual, turn off automatic QE, peg the exchange rate, or engage Phillips's governor.

**Recorders.** The chart recorder shows a moving 15-year strip. On the modern board, ▲▼ marks every RBA move and a band marks the 2–3% target. The Phillips-curve panel leaves a fading trail of where the economy has been.

## How the model works

Both boards integrate the same kind of system: stocks change by inflows minus outflows, with time measured in quarters (step 0.02 q).

Each step has two stages. First the economics proposes flows: how much people want to spend, save, import, lend and so on. Then a small **hydraulic solver** (`solveFlows` in [`engines.js`](src/js/engines.js)) checks every tank. A tank can deliver only what it holds plus what flows in during the step, so if its outlets ask for more, all of them are throttled together, like a tank losing pressure. Only then are the stocks updated. No stock is repaired by clamping after an impossible transfer (the only normalisation is floating-point residue smaller than 10⁻⁹ being set to zero), so no money is created or destroyed by accident, and the debt ledgers follow the flows that actually ran. The throttle factors are solved exactly: for the tanks that are short, outflow × factor = stock + inflow is a small linear system (at most four equations), and the set of short tanks is adjusted until it is stable, usually in one or two passes. Plain iteration was used before 1.3 and could crawl when nearly empty tanks feed each other (deposits ⇄ savings).

Each step keeps two records. `st.desired` is what the economy wanted to do; `st.f` is what actually happened, and it is what the board, readouts and recorders show. They are identical until a tank runs short; then the tank is labelled **RUNNING DRY** with the share of its payments that got through, and every displayed identity (consumption + saving = disposable income, spending − income = the change in deposits) still adds up exactly.

<details>
<summary><b>1949 board equations</b></summary>

| | |
|---|---|
| Income | Output follows the transactions balances through a production lag, `dY/dt = (TB − Y)/τp` |
| Transactions balances | `dTB/dt = C − Im + I + G + X − Y` |
| Leakages | taxes `tY`, saving `s(Y − T)`, imports `m·C/e^0.6`; all throttled together if the transactions tank runs dry |
| Interest-rate float | `r = 12 − 0.14·SB` (0.5–15%) |
| Investment | `I = 12 + b(5 − r) + a·dY/dt` |
| Exchange rate (floating) | `e = 1 + 0.6(FB − 40)/40`, exports `X₀·e^0.9` |
| Treasury governor (Phillips 1954) | demand `D = Kp·gap + Ki·∫gap + Kd·d(gap)/dt`, applied through a policy lag `dΔG/dt = (D − ΔG)/τ`. Deficits are financed by borrowing idle balances, so the governor cannot spend money that is not there |
| Unemployment (illustrative) | `u = 1.5 + 30(1 − Y/105)`%, mapped onto the 1958 curve |

Coefficients give a steady state near Y ≈ 100. They are not Phillips's UK calibration.
</details>

<details>
<summary><b>2026 board equations</b></summary>

Units: 100 = one quarter of potential GDP, about A$730bn. Rates and inflation are in % a year.

| | |
|---|---|
| RBA rule | `i* = 0.6 + π + φπ(π − target) + φy·gap` on **underlying** inflation; the cash rate moves 25bp toward `i*` at each meeting (floor 0.1%) |
| Underlying inflation | `π → πᵉ + 0.25·gap − AUD pass-through + 0.3·energy`, with a two-quarter lag; starts at the 3.6% trimmed mean. Deflation saturates smoothly toward −5% a year (prices and wages are sticky downwards) |
| Headline CPI | `π + energy`, where energy ≈ 4% CPI weight × year-ended change in oil prices; starts at 4.0% |
| Expectations | `dπᵉ/dt = 0.12(headline − πᵉ) + 0.10(target − πᵉ)`: people see headline prices, but expectations stay anchored |
| Household income | `Yd = Y − net taxes − retained profits − mortgage interest and principal + bank payout` |
| Consumption and saving | `C = (1 − s)·Yd + confidence`, `S = Yd − C`: confidence moves money between spending and saving, never in or out of existence |
| Credit | new lending `L = credit·L̄·(1 − 0.10(i − πᵉ − 0.6))`, repayments `D/75`, mortgage rate `i + spread` |
| Business investment | falls with the real bond yield; optional accelerator |
| Public debt | `dB/dt = deficit − QE − (2% + π)·B`, where the last term is nominal growth eroding the ratio |
| Government financing | deficits draw on the government account first, then sell bonds out of savings; surpluses buy back private bonds first, then build the government account. Private bonds never go negative |
| QE | slider-driven, or automatic at the lower bound when the output gap is below −1%; the RBA can only buy bonds private holders own, and only sell bonds it holds |
| Capital flows and AUD | inflow `∝ (i − i_US)`; AUD follows foreign-held balances and commodity prices |
| Unemployment | Okun's law, `u = 4.5 − 0.5·gap` |

Retained profits are solved at load time so that spending equals output at neutral settings (cash rate 3.1%, inflation 2.5%).
</details>

## Calibration (October 2026)

| Figure | Value | Source |
|---|---|---|
| Cash rate (raised 30 Sep 2026) | 4.60% | [RBA cash rate target](https://www.rba.gov.au/statistics/cash-rate/); corroborated by [CommBank](https://www.commbank.com.au/articles/newsroom/2026/09/rba-official-cash-rate-decision-september-2026.html) |
| Headline CPI / trimmed mean, year to Aug 2026 | 4.0% / 3.6% | [ABS](https://www.abs.gov.au/media-centre/media-releases/cpi-rose-40-year-august-2026) |
| Unemployment, Aug 2026 | 4.6% | [ABS](https://www.abs.gov.au/media-centre/media-releases/unemployment-rate-rises-46-august) |
| NAIRU / neutral cash rate (RBA Statement on Monetary Policy, Aug 2025) | ≈4.5% / ≈3.1% | reported by [Livewire](https://www.livewiremarkets.com/wires/the-rba-trims-the-neutral-policy-rate-and-lowers-potential-output-productivity-growth-the-nairu) |
| Household saving ratio, Jun qtr 2026 | 6.5% | [ABS](https://www.abs.gov.au/media-centre/media-releases/australian-economy-grew-04-june-quarter) |
| Consumption / government / business investment / dwellings, % GDP | 51 / 28 / 13 / 5 | ABS national accounts via [NT Treasury](https://treasury.nt.gov.au/__data/assets/pdf_file/0004/1616026/gross-domestic-product-2026-march-quarter.pdf) (volume shares) |
| Exports / imports, % GDP | 25 / 24 | as above |
| Commonwealth deficit / gross debt 2025–26, % GDP | 1.3 / 34 | [MYEFO 2025–26](https://budget.gov.au/content/myefo/download/03_Part_3.pdf) |
| AUD/USD | ≈0.70 | market report, [OrbitRemit](https://blog.orbitremit.com/rba-rate-hike-september-2026/) |
| Household debt, RBA bond holdings, mortgage spread | approximate | stylised, labelled as such in the app |

The calibration lives in the `K` constants and `init()` of the modern engine in [`src/js/engines.js`](src/js/engines.js). To refresh it after a new RBA decision or CPI release, update those numbers and run the tests. The invariant tests confirm the accounting still holds, and the regression tests tell you which experiment descriptions now quote stale numbers.

## Tests

```bash
node --test                    # engine tests (or: npm test, or test.bat on Windows)
node tools/check_isolation.js  # every engine test again, each on its own in a fresh process
python -m pytest tests/browser # browser smoke tests (see tests/browser/requirements.txt)
```

The tests are split by what they can and cannot prove.

| Category | File | What it establishes |
|---|---|---|
| **1. Invariants** | `tests/invariants.test.js` | Money is conserved **at every step** on both boards: across 300 seeded random combinations of legal slider settings each, with every tank forced empty, through every experiment, and in 80- and 400-quarter random runs. In every one of those runs, at every step, all state stays finite and the money tanks, private bonds, RBA holdings, household debt and output are checked to be non-negative; the debt ledgers match the flows that actually ran; and what the board **displays** reconciles exactly with what moved the stocks, including when tanks are throttled. The flow solver is checked against an independent brute-force reference on 3,000 random tank networks, and on near-empty tanks that feed each other. |
| **2. Behavioural properties** | `tests/invariants.test.js` | Mechanisms point the right way: confidence and the saving ratio move money between spending and saving without changing disposable income; a higher cash rate lowers credit and investment; QE swaps bonds for deposits one-for-one and never buys bonds that don't exist; surpluses retire debt and then build a government account; the rule reads underlying, not headline, inflation; and every slider can reach its own minimum, maximum and default. |
| **3. Regression** | `tests/engines.test.js`, plus pinned cases in `invariants.test.js` | The calibration starts at the published figures, every claim in every experiment caption on both boards still comes out of the model, and previously found failures (such as a century of frozen high rates that once diverged) stay fixed. These pin behaviour so changes are deliberate; they do not validate the economics. |
| **Browser smoke** | `tests/browser/test_smoke.py` | Run against both `src/` and the bundled single file: no console errors, canvases draw, every slider and toggle drives its parameter, scenarios and reset update UI and engine together, pause works, mode persists across reloads, reduced-motion is honoured, no horizontal scroll at phone width. |

The random tests use fixed seeds, so any failure reproduces exactly and prints the settings that caused it. Every fix was checked the other way round too: the tests written for it fail on the code before the fix.

Tests are hermetic. Every experiment, on both boards, starts from its own known state whatever ran before (a test checks this), and `tools/check_isolation.js` runs each test alone in a fresh process to prove no test relies on another. The checker is itself tested (`tests/tooling.test.js`): it fails if a test file crashes during discovery, if a test cannot be re-run on its own, or if a test hangs past its time limit, rather than reporting those as passes. The same file checks that `package.json`, `CITATION.cff` and the changelog agree on the version. The full engine suite takes about a minute, a third of it in the checker's own tests, which deliberately run hanging and crashing test files.

CI runs the engine tests on Node 18, 20 and 22, the isolation check, and the browser suite in Chromium. GitHub Pages deploys only when all of them pass on the same commit.

## Project structure

```
phillips-machine/
├── src/                     ← the site (deployed to GitHub Pages as-is)
│   ├── index.html
│   ├── css/moniac.css
│   └── js/
│       ├── draw.js          palette and canvas drawing helpers
│       ├── engines.js       the two simulation engines, controls and experiments
│       └── app.js           mode switch, UI, recorders, animation loop
├── tests/                   engine tests (node:test) + browser/ smoke tests (pytest + Playwright)
├── tools/                   build_single_file.py (portable single HTML) · check_isolation.js
├── docs/img/                screenshots
├── .github/workflows/ci.yml tests, isolation, browser smoke, then (only if all pass) Pages deploy
├── serve.bat · test.bat     Windows helpers
├── CHANGELOG.md · CITATION.cff · NOTICE · LICENSE
```

## Limitations

- **A teaching model, not a forecast.** The modern board is a stylised, stock-flow-consistent sketch calibrated to real figures. In the baseline, the model's rule trims the cash rate within a year, while markets and banks in October 2026 leaned toward a hold or further hikes.
- **Empty tanks throttle, they do not borrow.** When a tank runs dry its outflows shrink. The 1949 governor experiments show this: badly timed policy drains the idle balances, and the plumbing then caps what it can spend.
- **The government account earns no interest.** Surpluses beyond the debt build a deposit account that later deficits draw on first.
- **Deflation is floored near −5% a year.** This is a modelling choice standing in for sticky wages and prices; without it, extreme settings held for decades produce runaway debt deflation.
- **No trend growth.** Flows are measured relative to potential output. The public-debt ratio uses the textbook growth-erosion term instead of modelling nominal GDP growth directly.
- **Phillips's annual data is not included.** He never published the 1861–1957 series behind his 1958 curve. The panel shows his fitted equation, not the scatter.
- **The 1949 coefficients are illustrative.** They reproduce the machine's behaviour, not its original UK calibration.

## References

- Phillips, A.W. (1950). Mechanical Models in Economic Dynamics. *Economica*, 17(67), 285–305.
- Phillips, A.W. (1954). Stabilisation Policy in a Closed Economy. *The Economic Journal*, 64(254), 290–323.
- Phillips, A.W. (1958). The Relation between Unemployment and the Rate of Change of Money Wage Rates in the United Kingdom, 1861–1957. *Economica*, 25(100), 283–299.
- Reserve Bank of New Zealand. [Bill Phillips and the MONIAC](https://www.rbnz.govt.nz/-/media/project/sites/rbnz/files/publications/factsheets-and-guides/factsheet-bill-phillips-and-the-moniac.pdf) (factsheet).
- University of Cambridge, Faculty of Economics. [The Phillips machine](https://econ.cam.ac.uk/node/1383).
- Shadman-Mehta, F. (1996). [Does Modern Econometrics Replicate the Phillips Curve?](https://sites.uclouvain.be/econ/DP/IRES/9615.pdf) IRES, UCLouvain.

## Citing

If you use this in teaching or research, GitHub's **"Cite this repository"** button uses [`CITATION.cff`](CITATION.cff).

## License

Copyright 2026 Leon Priest ([@7h3v01d](https://github.com/7h3v01d)). Licensed under the [Apache License 2.0](LICENSE). See [`NOTICE`](NOTICE).

This is an independent educational reconstruction. It is not affiliated with or endorsed by the LSE, the Reserve Bank of New Zealand, the Reserve Bank of Australia or any other institution mentioned.
