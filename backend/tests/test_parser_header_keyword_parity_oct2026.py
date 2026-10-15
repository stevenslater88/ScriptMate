"""Frontend/backend parity for the header-keyword dialogue regression (2026-10-01,
f5c6a5b). The frontend `smartScriptParser.isHeaderLine` had the same case-insensitive
prefix rule as the backend: dialogue such as "Time will tell." was classified as a
front-matter label and dropped from the speaker's lines. Both parsers now match colon
headers in any case and bare/space headers only when the keyword is uppercase.
Frontend runs via the existing `_frontend_parser_shim.js` (Babel, no new deps)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")

from server import fallback_parse_script  # noqa: E402

SHIM = HERE / "_frontend_parser_shim.js"
PARSER_SRC = (ROOT / "frontend/services/smartScriptParser.ts").read_text()

DIALOGUE_EXAMPLES = [
    "By a name I know not how to tell thee who I am.",
    "Time will tell.",
    "Place it there.",
    "Cast your vote.",
    "Setting the table was your job.",
    "Author of my own misfortune, that's me.",
]


def fe(raw: str) -> dict:
    out = subprocess.run(["node", str(SHIM), raw], capture_output=True, text=True, timeout=60)
    if out.returncode == 2:
        pytest.skip("babel unavailable for frontend shim")
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    return {"dialogue": [(d["character"], d["text"]) for d in r["dialogue"]], "characters": set(r["characters"])}


def be(raw: str) -> dict:
    r = fallback_parse_script(raw)
    return {
        "dialogue": [(ln["character"], ln["text"]) for ln in r["lines"] if not ln["is_stage_direction"]],
        "characters": set(r["characters"]),
    }


@pytest.mark.parametrize("text", DIALOGUE_EXAMPLES)
def test_keyword_led_dialogue_kept_by_both_parsers(text):
    raw = f"ROMEO\n{text}\n\nJULIET\nAnd then?"
    expected = [("ROMEO", text), ("JULIET", "And then?")]
    assert fe(raw)["dialogue"] == expected
    assert be(raw)["dialogue"] == expected
    assert fe(raw)["characters"] == be(raw)["characters"] == {"ROMEO", "JULIET"}


def test_reported_scene_partner_script_parity():
    raw = (
        "ROMEO\nO, she doth teach the torches to burn bright!\n\n"
        "(He gazes at Juliet across the room)\n\n"
        "JULIET\nWhat man art thou that thus bescreen'd in night?\n\n"
        "[Stage Direction: She moves to the balcony]\n\n"
        "ROMEO\nBy a name I know not how to tell thee who I am."
    )
    expected = [
        ("ROMEO", "O, she doth teach the torches to burn bright!"),
        ("JULIET", "What man art thou that thus bescreen'd in night?"),
        ("ROMEO", "By a name I know not how to tell thee who I am."),
    ]
    assert fe(raw)["dialogue"] == expected  # stage directions excluded, 3 dialogue lines
    assert be(raw)["dialogue"] == expected


@pytest.mark.parametrize("header", [
    "TITLE: THE CALL", "Title: The Reunion", "AUTHOR: Alex", "Author: Alex",
    "CHARACTERS:", "CAST:", "WRITTEN BY Jane Doe", "BY JANE DOE",
    "SETTING some trailing text", "DRAMATIS PERSONAE", "SYNOPSIS",
])
def test_legitimate_headers_recognised_by_both_parsers(header):
    raw = f"{header}\n\nJACK\nHello.\n\nSARAH\nHi."
    expected = [("JACK", "Hello."), ("SARAH", "Hi.")]
    for side in (fe(raw), be(raw)):
        assert side["dialogue"] == expected, header
        assert side["characters"] == {"JACK", "SARAH"}, header


def test_frontend_rule_mirrors_backend_rule():
    i = PARSER_SRC.index("function isHeaderLine(trimmed: string): boolean")
    body = PARSER_SRC[i:i + 400]
    assert "upper.startsWith(kw + ':')" in body
    assert "trimmed === kw || trimmed.startsWith(kw + ' ')" in body
    assert "upper.startsWith(kw + ' ')" not in body
