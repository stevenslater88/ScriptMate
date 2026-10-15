"""Parser regression (2026-10-01, commit f5c6a5b): dialogue lines beginning with a
front-matter word ("By", "Time", "Place", "Cast", "Setting", "Author") were matched
case-insensitively against `_HEADER_KEYWORDS`, classified as stage directions and
dropped from the character's dialogue. Header detection now matches colon forms in
any case, but bare/space forms only when the keyword itself is uppercase."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")

import server  # noqa: E402
from server import fallback_parse_script  # noqa: E402

DIALOGUE_EXAMPLES = [
    "By a name I know not how to tell thee who I am.",
    "Time will tell.",
    "Place it there.",
    "Cast your vote.",
    "Setting the table was your job.",
    "Author of my own misfortune, that's me.",
]


def _dialogue(r):
    return [(ln["character"], ln["text"]) for ln in r["lines"] if not ln["is_stage_direction"]]


@pytest.mark.parametrize("text", DIALOGUE_EXAMPLES)
def test_keyword_led_dialogue_is_kept_and_attributed(text):
    r = fallback_parse_script(f"ROMEO\n{text}")
    assert _dialogue(r) == [("ROMEO", text)]
    assert "ROMEO" in r["characters"]


def test_reported_scene_partner_script_keeps_all_three_lines():
    raw = (
        "ROMEO\nO, she doth teach the torches to burn bright!\n\n"
        "(He gazes at Juliet across the room)\n\n"
        "JULIET\nWhat man art thou that thus bescreen'd in night?\n\n"
        "[Stage Direction: She moves to the balcony]\n\n"
        "ROMEO\nBy a name I know not how to tell thee who I am."
    )
    r = fallback_parse_script(raw)
    assert _dialogue(r) == [
        ("ROMEO", "O, she doth teach the torches to burn bright!"),
        ("JULIET", "What man art thou that thus bescreen'd in night?"),
        ("ROMEO", "By a name I know not how to tell thee who I am."),
    ]
    stage = [ln["text"] for ln in r["lines"] if ln["is_stage_direction"]]
    assert stage == ["(He gazes at Juliet across the room)", "[Stage Direction: She moves to the balcony]"]


def test_multi_line_dialogue_with_keyword_led_line_stays_in_block():
    r = fallback_parse_script("MARY\nI waited.\nTime will tell if it mattered.\n\nJOHN\nIt did.")
    chars = [c for c, _ in _dialogue(r)]
    assert chars == ["MARY", "JOHN"]
    assert "Time will tell if it mattered." in _dialogue(r)[0][1]


@pytest.mark.parametrize("header", [
    "TITLE: THE CALL", "Title: The Reunion", "AUTHOR: Alex", "Author: Alex",
    "CHARACTERS:", "CAST:", "WRITTEN BY Jane Doe", "BY JANE DOE",
    "SETTING some trailing text", "DRAMATIS PERSONAE", "SYNOPSIS",
])
def test_legitimate_headers_still_recognised(header):
    r = fallback_parse_script(f"{header}\n\nJACK\nHello.")
    first = r["lines"][0]
    assert first["is_stage_direction"] and first["character"] == ""
    assert set(r["characters"]) == {"JACK"}
    assert _dialogue(r) == [("JACK", "Hello.")]


def test_header_helper_rules():
    h = server._is_header_keyword_line
    for yes in ["TITLE:", "TITLE: X", "Title: X", "time: 8pm", "CHARACTERS", "WRITTEN BY Jane", "BY JANE"]:
        assert h(yes), yes
    for no in DIALOGUE_EXAMPLES + ["Bye.", "Timeless.", "Castle walls."]:
        assert not h(no), no
