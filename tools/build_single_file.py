# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Leon Priest (github.com/7h3v01d)
"""Bundle src/ into one self-contained HTML file (dist/phillips-machine.html).

Handy for emailing the simulation or dropping it on a USB stick: the output
inlines the stylesheet and the three scripts, so it opens with no other files.
Usage:  python tools/build_single_file.py
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "phillips-machine.html"


def main() -> None:
    html = (SRC / "index.html").read_text(encoding="utf-8")

    def inline_css(match: re.Match) -> str:
        css = (SRC / match.group(1)).read_text(encoding="utf-8")
        return f"<style>\n{css}</style>"

    def inline_js(match: re.Match) -> str:
        js = (SRC / match.group(1)).read_text(encoding="utf-8")
        return f"<script>\n{js}</script>"

    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', inline_css, html)
    html = re.sub(r'<script src="(js/[^"]+)"></script>', inline_js, html)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
