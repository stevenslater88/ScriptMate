"""Regression guard for the Feb-2026 "END OF SCREENPLAY" false-character
finding.

Physical S23 Ultra QA reported that after DOCX import the character list
contained `END OF SCREENPLAY` (a screenplay terminator, not a speaking
character). The Feb-2026 scene-heading regex had `END OF SCENE|ACT|
EPISODE|PART|SHOW|FILM|MOVIE` but did NOT include `SCREENPLAY`, `STORY`,
`PLAY`, `TEASER`, `COLD OPEN`, `PILOT`, and had no matcher for a bare
`END` / `END.` terminator on its own line.

This test locks the corrected regex behaviour for both the backend
(`fallback_parse_script`, `_looks_like_scene_heading`) and — via the
end-to-end round-trip — proves the character list produced from a
representative stress DOCX no longer contains any of these terminators.

Also asserts that legitimate character names (`JACK`, `SARAH`,
`DET. HARRIS`, `MRS. SMITH`, `POLICE OFFICER`) and near-misses that
begin with the letters "END" (`ENDER`, `ENDANGERED SPECIES`) are NOT
disqualified — i.e. the fix is precise, not a broad uppercase blacklist.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import _looks_like_scene_heading, fallback_parse_script

# ---- Terminators that MUST be rejected as scene headings ------------------

TERMINATORS = [
    "END OF SCREENPLAY",
    "THE END",
    "END",
    "END.",
    "END:",
    "END OF SCENE",
    "END OF ACT",
    "END OF EPISODE",
    "END OF SHOW",
    "END OF FILM",
    "END OF STORY",
    "END OF PLAY",
    "END OF PILOT",
    "END OF TEASER",
    "END OF COLD OPEN",
    "FADE OUT",
    "FADE OUT.",
    "CUT TO:",
]


@pytest.mark.parametrize("line", TERMINATORS)
def test_terminator_is_rejected_as_scene_heading(line: str) -> None:
    """Every screenplay terminator / transition MUST be identified as a
    scene heading so the character-detection heuristic skips it."""
    assert _looks_like_scene_heading(line), (
        f"expected {line!r} to be rejected as a scene heading — got False"
    )


# ---- Real characters that MUST NOT be rejected ----------------------------

REAL_CHARACTERS = [
    "JACK",
    "SARAH",
    "DET. HARRIS",
    "MRS. SMITH",
    "POLICE OFFICER",
    "JACK (V.O.)",
    "SARAH (O.S.)",
    "MARY (CONT'D)",
    "DREW",
    # Near-misses that begin with the letters "END" — the fix must be
    # precise, not a broad blacklist.
    "ENDER",
    "ENDANGERED SPECIES",
    "BENDER",
    "PENDING",  # unusual name but must not be excluded
]


@pytest.mark.parametrize("line", REAL_CHARACTERS)
def test_real_character_is_not_rejected(line: str) -> None:
    """Legitimate character names must NOT be tagged as scene headings."""
    assert not _looks_like_scene_heading(line), (
        f"expected {line!r} to be treated as a potential character — "
        f"got True (scene heading)"
    )


# ---- End-to-end stress DOCX round-trip -----------------------------------


STRESS_DOCX_TEXT = """FADE IN:

INT. WAREHOUSE - NIGHT

JACK enters the dim warehouse.

JACK
It's here somewhere. I can feel it.

DET. HARRIS
(stepping from the shadows)
You looking for this?

Harris holds up a small metal device.

JACK
Back to me.

DET. HARRIS
Not this time.

CUT TO:

INT. HOSPITAL - DAY

JACK sits beside a hospital bed.

JACK
I never got to tell you.

SARAH
(weakly)
Tell me now.

FADE OUT.

END OF SCREENPLAY
"""


def test_end_to_end_stress_docx_character_list_is_exactly_the_three_real_characters():
    """The full stress DOCX must parse to exactly {JACK, DET. HARRIS,
    SARAH}. Any additional entry (especially any terminator) fails the
    test."""
    result = fallback_parse_script(STRESS_DOCX_TEXT)
    names = set(result["characters"])
    expected = {"JACK", "DET. HARRIS", "SARAH"}
    forbidden = {
        "END OF SCREENPLAY",
        "THE END",
        "END",
        "END OF SCENE",
        "END OF ACT",
        "END OF EPISODE",
        "END OF SHOW",
        "END OF FILM",
        "FADE OUT",
        "FADE OUT.",
        "FADE IN",
        "FADE IN:",
        "CUT TO",
        "CUT TO:",
    }
    assert names == expected, (
        f"expected character set {expected}, got {names} "
        f"(extras: {names - expected})"
    )
    intersection = names & forbidden
    assert not intersection, (
        f"forbidden terminator(s)/transition(s) leaked into the "
        f"character list: {intersection}"
    )


def test_end_to_end_dialogue_is_preserved_for_real_characters():
    """Fix scope-guarantee: real character dialogue is untouched (no
    over-aggressive filtering). 'Back to me.' — the historically
    problematic dialogue line — must still be attributed to JACK."""
    result = fallback_parse_script(STRESS_DOCX_TEXT)
    lines = result["lines"]
    jack_lines = [
        line["text"]
        for line in lines
        if line["character"] == "JACK" and not line["is_stage_direction"]
    ]
    assert any("Back to me" in ln for ln in jack_lines), (
        f"'Back to me.' must remain JACK's dialogue; got: {jack_lines}"
    )


# ---- Frontend regex parity check -----------------------------------------


def test_frontend_smart_parser_regex_mirrors_backend_terminators():
    """The frontend `HEADING_RE` in services/smartScriptParser.ts must
    contain the same terminator alternatives as the backend regex —
    parity is the contract that keeps both parsing paths in sync.
    """
    ts_path = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "services"
        / "smartScriptParser.ts"
    )
    src = ts_path.read_text()
    # Every terminator token added by the Feb-2026 fix must be findable
    # in the frontend regex.
    required_tokens = [
        "SCREENPLAY",   # the specific finding
        "STORY",
        "PLAY",
        "PILOT",
        "TEASER",
        "COLD\\s+OPEN",
        "END\\s*[.:!]?\\s*$",
    ]
    for tok in required_tokens:
        assert tok in src, (
            f"frontend smartScriptParser.ts is missing the token "
            f"{tok!r} — regex parity with backend is broken"
        )
