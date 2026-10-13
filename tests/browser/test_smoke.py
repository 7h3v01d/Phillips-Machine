# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Leon Priest (github.com/7h3v01d)
"""Browser smoke tests: the integration layer the headless engine tests cannot see.

Runs every check against both the source build (src/index.html) and the bundled single file
(dist/phillips-machine.html), so the two cannot drift apart.

    python -m pip install -r tests/browser/requirements.txt
    python -m playwright install chromium
    python -m pytest tests/browser
"""
from pathlib import Path
import subprocess
import sys

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src" / "index.html"
DIST = ROOT / "dist" / "phillips-machine.html"
# The web font is optional; offline or sandboxed runs may block it. Anything else is a real error.
IGNORED = ("fonts.googleapis.com", "fonts.gstatic.com", "ERR_TUNNEL_CONNECTION_FAILED", "ERR_INTERNET_DISCONNECTED", "ERR_NAME_NOT_RESOLVED")


@pytest.fixture(scope="session", autouse=True)
def build_single_file():
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_single_file.py")], check=True)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture(params=["src", "dist"])
def page(request, browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and not any(s in m.text for s in IGNORED) and pg.errors.append(m.text))
    target = SRC if request.param == "src" else DIST
    pg.goto(target.as_uri())
    pg.evaluate("localStorage.clear()")
    pg.reload()
    pg.wait_for_timeout(400)
    yield pg
    ctx.close()


def canvas_has_ink(pg, selector):
    """True if the canvas has drawn more than a flat background."""
    return pg.evaluate(
        """sel => { const c = document.querySelector(sel), x = c.getContext('2d');
                    const d = x.getImageData(0, 0, c.width, c.height).data, first = d.slice(0, 4).join();
                    for (let i = 0; i < d.length; i += 4 * 97) if (d.slice(i, i + 4).join() !== first) return true;
                    return false; }""", selector)


def test_loads_without_errors_and_draws(page):
    page.wait_for_timeout(800)
    for sel in ("#machine", "#recorder", "#pcurve"):
        assert canvas_has_ink(page, sel), f"{sel} is blank"
    assert page.errors == []


def test_mode_switch_swaps_panels_and_persists(page):
    assert page.locator("#rbaPanel").is_visible() and not page.locator("#govPanel").is_visible()
    page.click("#mode-classic")
    assert page.locator("#govPanel").is_visible() and not page.locator("#rbaPanel").is_visible()
    assert page.get_attribute("#mode-classic", "aria-pressed") == "true"
    page.reload(); page.wait_for_timeout(300)
    assert page.get_attribute("#mode-classic", "aria-pressed") == "true", "mode should survive a reload"
    assert page.locator("#govPanel").is_visible()
    assert page.errors == []


@pytest.mark.parametrize("mode", ["modern", "classic"])
def test_every_slider_and_toggle_drives_its_parameter(page, mode):
    page.click(f"#mode-{mode}")
    engine = "MODERN" if mode == "modern" else "CLASSIC"
    controls = page.evaluate(
        f"""() => {engine}.groups.flatMap(g => [
              ...g.sliders.map(s => ({{id: s.id, kind: 'range', min: s.min, max: s.max, step: s.step}})),
              ...(g.toggles || []).map(t => ({{id: t.id, kind: 'checkbox'}}))])""")
    assert controls, "no controls found"
    for c in controls:
        el = f"#{mode}-{c['id']}"
        if c["kind"] == "range":
            # pick a legal value different from the current one, set it like a user would
            target = c["max"] if page.evaluate(f"{engine}.p['{c['id']}']") != c["max"] else c["min"]
            page.eval_on_selector(el, "(e, v) => { e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); }", target)
            got = page.evaluate(f"{engine}.p['{c['id']}']")
            assert abs(got - target) < 1e-9, f"{c['id']}: slider set {target}, engine has {got}"
            assert page.text_content(f"#{mode}-o-{c['id']}").strip(), f"{c['id']}: readout empty"
        else:
            before = page.evaluate(f"{engine}.p['{c['id']}']")
            page.click(el)
            assert page.evaluate(f"{engine}.p['{c['id']}']") is (not before), f"{c['id']}: toggle not wired"
    assert page.errors == []


def test_scenario_buttons_set_controls_and_reset_restores_them(page):
    page.click("#scen button:has-text('Oil shock')")
    assert float(page.input_value("#modern-oil")) == pytest.approx(1.6)
    assert page.evaluate("MODERN.p.oil") == pytest.approx(1.6)
    assert "Oil prices up 60%" in page.text_content("#caption")
    page.click("#resetBtn")
    assert float(page.input_value("#modern-oil")) == pytest.approx(1.0)
    assert page.evaluate("MODERN.p.oil") == pytest.approx(1.0)
    assert page.evaluate("MODERN.st.t") < 0.5, "reset should restart the clock"
    assert page.errors == []


def test_pause_stops_the_simulation(page):
    page.click("#runBtn")
    t0 = page.evaluate("MODERN.st.t"); page.wait_for_timeout(600)
    assert page.evaluate("MODERN.st.t") == t0
    assert page.text_content("#statusTag").strip() == "PUMP STOPPED"
    page.click("#runBtn"); page.wait_for_timeout(400)
    assert page.evaluate("MODERN.st.t") > t0


def test_reduced_motion_freezes_pipe_animation_but_not_the_model(browser):
    ctx = browser.new_context(reduced_motion="reduce")
    pg = ctx.new_page()
    pg.goto(SRC.as_uri()); pg.wait_for_timeout(800)
    assert pg.evaluate("Object.values(MODERN.phase).every(v => !v)"), "pipes should not animate"
    assert pg.evaluate("MODERN.st.t") > 0, "the economy still runs"
    ctx.close()


def test_phone_width_has_no_horizontal_scroll_and_survives_dpr(browser):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3)
    pg = ctx.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(SRC.as_uri()); pg.wait_for_timeout(600)
    assert pg.evaluate("document.documentElement.scrollWidth") <= 390
    pg.set_viewport_size({"width": 1400, "height": 900}); pg.wait_for_timeout(300)
    assert canvas_has_ink(pg, "#machine")
    assert errors == []
    ctx.close()
