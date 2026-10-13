# Changelog

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
