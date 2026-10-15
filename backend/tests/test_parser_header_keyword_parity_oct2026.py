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
    body = PARSER_SRC[i:i + 500]
    assert "upper.startsWith(kw + ':') || upper === kw" in body
    assert "/[.!?]$/.test(rest)" in body
    assert "trimmed.startsWith(kw + ' ') || isNameLike(rest)" in body


# ─── Title pages, shouted dialogue, mixed-case labels (2026-10-15) ───────

TITLE_PAGE_CREDITS = [
    "Written by Jane Doe", "WRITTEN BY JANE DOE", "Written By Jane Doe",
    "by Jane Doe", "By Jane Doe", "BY JANE DOE", "Written by Jane Doe and John Smith",
    "WRITTEN BY: Jane Doe", "Author: Jane Doe",
]


@pytest.mark.parametrize("credit", TITLE_PAGE_CREDITS)
def test_title_page_credit_is_metadata_in_both_parsers(credit):
    raw = f"THE HEIST\n{credit}\n\nJACK\nHello.\n\nSARAH\nHi."
    expected = [("JACK", "Hello."), ("SARAH", "Hi.")]
    for side in (fe(raw), be(raw)):
        assert side["dialogue"] == expected, credit
        assert {"JACK", "SARAH"} <= side["characters"], credit


@pytest.mark.parametrize("header", [
    "Title The Heist", "Characters", "Synopsis", "Cast Jack, Sarah", "Setting Downtown Chicago",
])
def test_mixed_case_labels_without_colon(header):
    raw = f"{header}\n\nJACK\nHello.\n\nSARAH\nHi."
    for side in (fe(raw), be(raw)):
        assert side["dialogue"] == [("JACK", "Hello."), ("SARAH", "Hi.")], header


@pytest.mark.parametrize("shout", ["TIME IS UP!", "BY GOD, YES!", "CAST THE NET?", "PLACE IT THERE."])
def test_shouted_keyword_dialogue_kept(shout):
    raw = f"JACK\n{shout}\n\nSARAH\nNo."
    for side in (fe(raw), be(raw)):
        assert side["dialogue"] == [("JACK", shout), ("SARAH", "No.")], shout


def test_representative_full_script_title_page_scene_and_counts():
    raw = (
        "THE HEIST\n\nWritten by Jane Doe\n\nCHARACTERS:\nJACK, SARAH\n\n"
        "INT. KITCHEN - NIGHT\n\n"
        "JACK\nTime will tell.\n\n"
        "(She laughs)\n\n"
        "SARAH\nBY GOD, YES!\n\n"
        "JACK\nPlace it there.\nCast your vote.\n\n"
        "SARAH\nBy a name I know not.\n"
    )
    expected = [
        ("JACK", "Time will tell."),
        ("SARAH", "BY GOD, YES!"),
        ("JACK", "Place it there. Cast your vote."),
        ("SARAH", "By a name I know not."),
    ]
    def blocks(dialogue):
        # FE preview emits one entry per physical line; BE joins a speech. Compare speeches.
        out = []
        for c, t in dialogue:
            t = t.replace("\n", " ")
            if out and out[-1][0] == c:
                out[-1] = (c, out[-1][1] + " " + t)
            else:
                out.append((c, t))
        return out

    f, b = fe(raw), be(raw)
    assert blocks(b["dialogue"]) == expected
    assert blocks(f["dialogue"]) == expected
    for side in (f, b):
        speeches = blocks(side["dialogue"])
        assert {c: sum(1 for x, _ in speeches if x == c) for c in ("JACK", "SARAH")} == {"JACK": 2, "SARAH": 2}
