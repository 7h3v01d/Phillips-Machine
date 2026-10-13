# Changelog

## 1.3.2 · 2026-10-13

### Changed
- GitHub Pages deploy uses `actions/upload-pages-artifact@v4`, matching GitHub's current Pages documentation (`configure-pages@v5`, `upload-pages-artifact@v4`, `deploy-pages@v4`). v4's one breaking change, excluding dotfiles from the uploaded site, does not affect this project: `src/` contains none.


## 1.3.1 · 2026-10-13

Assurance clean-up after the fourth adversarial review. No change to the simulation's behaviour.

### Fixed
- **The isolation checker could report tests as passing that never ran.** If a test file crashed during discovery, its tests vanished from the plan silently, and an isolated run counted as passing whenever Node printed `# pass 1`, which it also does when the name pattern matches nothing (it then reports the file itself as one passing test). The checker now fails on any discovery error, cross-checks the names it parsed against Node's own count, and only accepts an isolated run whose output contains an `ok` line for that exact test.
- **A hanging test could stall the isolation check indefinitely.** Every subprocess now has a time limit (120 s per test by default, `ISOLATION_TIMEOUT_MS` to change it) and is reported as `TIMEOUT`.
- **The checker misbehaved when started from inside a Node test run**, because nested `node --test` processes inherited `NODE_TEST_CONTEXT` and switched protocols. Found while testing the checker; its child processes now get a clean environment. The same applies to the checker's own `ISO_SINGLE` marker, which leaked into discovery when one checker ran inside another's isolated run (found when the hardened checker first ran the real suite).
- **`CITATION.cff` declared a non-existent schema (`cff-version: 1.3.0`)**, introduced by the 1.3.0 version bump, which would break GitHub's "Cite this repository". Restored to 1.2.0.

### Changed
- `checkRun()` checks that every state variable is finite at every step, so every long run (not just the 80-quarter ones) backs the README's "at every step" statement.
- Solver comment and README now say exactly what is normalised: sub-10⁻⁹ floating-point residue, never an impossible transfer.

### Added
- `tests/tooling.test.js`: the isolation checker run against throwaway projects (healthy, crashing, unmatchable name, hanging, order-dependent, inherited marker), its TAP parser, and a release-metadata consistency check.


## 1.3.0 · 2026-10-13

Response to the third adversarial review: assurance and release engineering. Each finding was reproduced first; each fix has tests that fail without it.

### Fixed
- **Tests were order-dependent.** Run on its own, "classic: every experiment conserves money" crashed: several 1949 experiments assumed an already-running machine. Every 1949 experiment now starts from a settled 1949 machine, as the modern ones already started from October 2026. A new test proves each experiment produces an identical machine whatever state it is applied to, and `tools/check_isolation.js` runs every test alone in a fresh process.
- **GitHub Pages could deploy with failing browser tests.** The separate Pages workflow only ran the engine tests. One CI workflow now runs engine, isolation and browser jobs, and the deploy job depends on all three.
- **Solver cost was state-dependent.** Profiling confirmed the reviewer's suspicion: in throttled states 61% of solver calls ran to the 200-iteration cap. The iteration is replaced by an exact active-set solve (one or two passes on average, checked against a brute-force reference on 3,000 random networks). The engine suite went from 67 to about 35 seconds while gaining tests; the century regression from 6.5 to 0.5 seconds.
- **Three 1949 captions were wrong** (found while adding the missing caption tests): *Fiscal stimulus* rises about 19, not 24, because of crowding out; in *Paradox of thrift* saving nearly doubles rather than "barely rises", because Phillips's interest-rate float revives investment; in *Export boom* the floating rate prices away the whole boom, not part of it.

### Changed
- Long random runs now check that private bonds, RBA holdings, household debt and output stay non-negative at every step, so the README's coverage statement is literally true.
- Clicking a 1949 experiment now restarts from the settled 1949 machine (previously it modified whatever was running).

### Added
- Regression tests for all seven non-governor 1949 captions, and a check that every experiment on both boards has one.
- `npm run test:isolation`, `npm run test:browser`.


## 1.2.0 · 2026-10-13

Response to the second adversarial review. Each finding was reproduced before fixing, and each fix has tests that fail without it.

### Fixed
- **Displayed flows could disagree with what actually happened.** After the flow solver throttled a tank, the board showed a mix of freshly recalculated wishes and last step's executed flows: consumption + saving could miss disposable income by up to 22 units, and spending − income could disagree with the change in deposits. Each step now keeps two complete records, `st.desired` and the executed `st.f`; the board shows the executed one, built so every identity holds exactly. Throttled tanks are labelled **RUNNING DRY** with the share paid out.
- **Private bond holdings could go negative**, so a surplus government "received" bond interest from bondholders (−4,282 units after 80 quarters at a 38% tax rate). Surpluses now buy back bonds and then build a separate government account; deficits draw on that account before selling bonds.
- **Very long runs could diverge to non-finite values** (2 of 200 random 400-quarter runs). Root cause: a frozen high cash rate with QT drove underlying inflation to −53% a year, the debt ratio exploded, and near-empty tanks that feed each other slowed the solver's iteration enough to leave negative residues. Fixed twice over: deflation now saturates smoothly near −5% a year (sticky wages and prices), and the solver finishes with an exact linear solve of the throttle factors.

### Added
- Tests: display reconciliation under throttling, desired-versus-executed exposure, balance-sheet boundaries (bonds, RBA holdings, household debt and output never negative; surpluses build the government account), 80- and 400-quarter random runs with finite-value checks, a solver unit test for near-empty mutually feeding tanks, and the diverging century run pinned as a regression case.

### Changed
- README describes conservation as verified over the tested domain and horizons rather than as an unlimited guarantee, and documents the two flow records, the government account and the deflation floor.


## 1.1.0 · 2026-10-13

Response to an external adversarial review. Every finding was reproduced against the code before it was fixed, and each fix is covered by tests that fail on 1.0.0.

### Fixed
- **Consumer confidence created and destroyed money.** The slider added an unbalanced term to consumption, so confidence −8 destroyed about 32 units of deposits over four quarters. Confidence now shifts disposable income between spending and saving (`C = (1 − s)·Yd + confidence`, `S = Yd − C`).
- **Empty tanks leaked water on both boards.** Stocks were clamped at zero after integration, so a payment out of an empty tank still arrived at the other end. A random sweep of legal settings found leaks of several hundred units. A shared hydraulic solver now throttles every outlet of a tank before integrating, so nothing is ever clamped and conservation is structural.
- **The RBA could hold slightly negative bonds** under QT, because the sale limit ignored the growth-erosion term. QE purchases are now also limited to bonds that private holders actually own.
- **The manual cash-rate slider could not reach its 10% maximum** (it snaps to 9.85% on the 25bp grid), and the modern **net tax rate default (28.4%) sat off its slider grid**, so the first touch changed fiscal policy. Both found by the new browser smoke tests.

### Changed
- **Headline CPI and underlying inflation are now separate.** The model's inflation state is underlying (trimmed-mean) inflation, starting at 3.6%; headline CPI adds an energy term and starts at 4.0%. The RBA rule reads underlying inflation, expectations learn from headline. The board, readouts, recorder (dashed headline line) and Phillips-curve panel are relabelled.
- **Three experiment captions changed because the fixes changed the results:**
  - *Oil shock:* headline CPI now peaks near 4.6% while underlying inflation keeps easing, and the RBA looks through the supply shock instead of hiking to 6.35%.
  - *Deep recession and QE:* money households stop spending is saved rather than destroyed; RBA bond holdings peak near 27% of GDP (was about 31%).
  - *Governor: lag wrecks it (1949):* the old 47→151 explosion was partly funded by leaked water. With conservation enforced, badly timed policy swings income between about 80 and 111 until it drains the idle balances dry, and then the plumbing caps it.
- README: softer historical claim, accurate single-file wording, primary sources where available (ABS, RBA), and a description of the solver.

### Added
- `tests/invariants.test.js`: per-step conservation across 300 seeded random settings per board, every tank forced empty, every experiment; debt-ledger identities; behavioural properties (confidence, saving, rates, QE, inflation measure); slider grid checks.
- `tests/browser/`: Playwright smoke suite run against both `src/` and the bundled single file.
- Tests are now labelled by category: invariants, behavioural properties, regression.

## 1.0.0 · 2026-10-13

First public release: the 1949 Phillips machine with the PID Treasury governor, and the modern Australian board calibrated to October 2026.
