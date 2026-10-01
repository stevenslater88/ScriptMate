"""
Parser regression — front-matter header block + inline-cue dialogue
====================================================================

Reproduces and locks the fix for the Feb-2026 physical bug:

  scriptId=e7d151ff-4343-4a5f-a075-7ffaf0b2cc6c
  firstThreeCharacters=CHARACTERS, JACK, SARAH
  linesCount=1
  rehearsal spoke all 5 lines combined, in SARAH's assigned voice

Root cause (now fixed in `fallback_parse_script`):

  1. `TITLE: THE CALL` and `CHARACTERS:` were being classified as
     character cues because they are all-uppercase, short, and did
     not match the scene-heading regex. A `_HEADER_KEYWORDS` guard
     now routes them into the stage-direction path.

  2. `JACK: Are you ready?` (inline-cue format common in stage plays
     and Fountain drafts) had NO code path — mixed-case failed the
     cue test and the line fell into the "else" dialogue buffer,
     accumulating onto whichever character was current. An
     `_INLINE_CUE_RE` regex now emits each inline cue as its own
     dialogue line.

The classic two-line Hollywood style (CUE on its own line, dialogue
on the next) must remain intact — see `test_cast_list_followed_by_...`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
load_dotenv(ROOT / "backend" / ".env")

from server import fallback_parse_script  # noqa: I001


# ─── Physical reproduction from the RCA ────────────────────────────────

JACK_SARAH_SCRIPT = """TITLE: THE CALL
CHARACTERS:
JACK
SARAH

JACK: Are you ready?
SARAH: I've been ready for ten minutes.
JACK: Then let's do this.
SARAH: Together?
JACK: Together."""


# ─── Test 1 — header block must NOT become characters ─────────────────

def test_front_matter_header_block_is_not_characters():
    r = fallback_parse_script(JACK_SARAH_SCRIPT)
    chars = set(r["characters"])
    # Only speaking roles.
    assert "JACK" in chars
    assert "SARAH" in chars
    # Front-matter labels must NEVER appear as characters.
    forbidden = {
        "TITLE", "TITLE THE CALL", "THE CALL",
        "CHARACTERS", "CAST", "AUTHOR", "BY", "WRITTEN BY",
        "DRAMATIS PERSONAE", "SETTING", "TIME", "PLACE",
        "SYNOPSIS", "LOGLINE",
    }
    leaked = chars & forbidden
    assert not leaked, (
        f"header-block labels leaked into characters: {leaked}; "
        f"full char set: {chars}"
    )
    # The header lines themselves ARE preserved — as stage-direction
    # entries, not as speaking lines — so no information is lost.
    stage_texts = [
        line["text"] for line in r["lines"] if line["is_stage_direction"]
    ]
    assert any("TITLE" in t.upper() for t in stage_texts), (
        "TITLE line must be preserved as a stage-direction, not dropped"
    )
    assert any("CHARACTERS" in t.upper() for t in stage_texts), (
        "CHARACTERS line must be preserved as a stage-direction, not dropped"
    )


def test_each_header_keyword_is_rejected_from_character_set():
    """Every keyword in `_HEADER_KEYWORDS` must be routed to the
    stage-direction path regardless of whether a colon is present or
    whether content follows on the same line."""
    import server as _s
    for kw in _s._HEADER_KEYWORDS:
        for form in (f"{kw}:", f"{kw}: value here", f"{kw} some trailing text"):
            r = fallback_parse_script(form + "\n\nJACK\nHello.")
            chars = set(r["characters"])
            assert kw not in chars, (
                f"header keyword '{kw}' leaked as a character via form '{form}'"
            )
            assert "JACK" in chars, (
                f"legitimate character JACK was lost when preceded by '{form}'"
            )


# ─── Test 2 — inline-cue dialogue alternates correctly ────────────────

def test_inline_cue_dialogue_splits_into_alternating_lines():
    r = fallback_parse_script(JACK_SARAH_SCRIPT)
    dialogue = [ln for ln in r["lines"] if not ln["is_stage_direction"]]

    expected = [
        ("JACK",  "Are you ready?"),
        ("SARAH", "I've been ready for ten minutes."),
        ("JACK",  "Then let's do this."),
        ("SARAH", "Together?"),
        ("JACK",  "Together."),
    ]
    actual = [(ln["character"], ln["text"]) for ln in dialogue]
    assert actual == expected, (
        f"inline-cue dialogue should alternate JACK/SARAH over 5 lines; "
        f"got {actual}"
    )
    # The literal `NAME: ` prefix must NOT be retained inside the
    # dialogue text (would be spoken aloud by TTS otherwise).
    for ln in dialogue:
        assert not ln["text"].startswith(ln["character"] + ":"), (
            f"inline-cue prefix leaked into dialogue text: {ln}"
        )
        assert "JACK:" not in ln["text"]
        assert "SARAH:" not in ln["text"]


# ─── Test 3 — mixed inline + two-line cues in the same script ─────────

def test_mixed_cue_styles():
    raw = (
        "JACK: You're late.\n"      # inline
        "SARAH\n"                   # two-line cue
        "I had to pick up groceries.\n"
        "JACK: Groceries?\n"        # inline again
        "SARAH\n"                   # two-line
        "For dinner. We're hosting.\n"
    )
    r = fallback_parse_script(raw)
    dialogue = [
        (ln["character"], ln["text"])
        for ln in r["lines"]
        if not ln["is_stage_direction"]
    ]
    assert dialogue == [
        ("JACK",  "You're late."),
        ("SARAH", "I had to pick up groceries."),
        ("JACK",  "Groceries?"),
        ("SARAH", "For dinner. We're hosting."),
    ], f"mixed cue styles should interleave correctly; got {dialogue}"
    assert set(r["characters"]) == {"JACK", "SARAH"}


# ─── Test 4 — classic two-line cue path must still work ───────────────

def test_cast_list_followed_by_two_line_dialogue():
    raw = (
        "TITLE: The Reunion\n"
        "AUTHOR: Alex\n"
        "CHARACTERS:\n"
        "DREW\n"
        "MIKE\n"
        "\n"
        "DREW\n"
        "You came back.\n"
        "MIKE\n"
        "You asked me to.\n"
        "DREW\n"
        "I know I did.\n"
    )
    r = fallback_parse_script(raw)
    chars = set(r["characters"])
    # Front-matter rejected; speaking roles kept.
    assert chars == {"DREW", "MIKE"}, f"got {chars}"
    dialogue = [
        (ln["character"], ln["text"])
        for ln in r["lines"]
        if not ln["is_stage_direction"]
    ]
    assert dialogue == [
        ("DREW", "You came back."),
        ("MIKE", "You asked me to."),
        ("DREW", "I know I did."),
    ], f"classic two-line dialogue regression; got {dialogue}"


# ─── Guards against over-reach ────────────────────────────────────────

def test_inline_cue_requires_uppercase_name():
    """`Jack: hi` (mixed case) must NOT be treated as an inline cue —
    it's narrative action text."""
    r = fallback_parse_script("Jack: hi there\n")
    assert "Jack" not in r["characters"]
    assert "JACK" not in r["characters"]


def test_inline_cue_rejects_scene_heading_with_colon():
    """`FADE IN: on the ocean` must remain a scene heading, not become
    a character named `FADE IN`."""
    r = fallback_parse_script("FADE IN: on the ocean\n\nJACK\nHello.\n")
    assert "FADE IN" not in r["characters"]
    assert set(r["characters"]) == {"JACK"}


def test_inline_cue_rejects_more_than_three_word_name():
    """`THIS IS A LONG LINE: speaking` is 4 pre-colon words — exceeds
    the character-cue word budget and must be treated as narrative."""
    r = fallback_parse_script("THIS IS A LONG LINE: speaking words\n")
    assert "THIS IS A LONG LINE" not in r["characters"]
