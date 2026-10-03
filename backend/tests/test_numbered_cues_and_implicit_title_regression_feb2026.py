"""P0 regression — numbered character cues + implicit title suppression.

Physical build 1.1.0 / VC1130 — the user's ScriptM8_The_Great_Snack_Heist
PDF reproduced two distinct corruption modes NOT covered by the existing
441-test parser suite:

  BUG 1 — Numbered character cues
    PyPDF2 extraction of theater/stage-play PDFs with embedded line
    numbers produces cues like ``1 JACK``, ``2 EMILY``, ``61 — JACK``,
    ``192 - JACK``. These leaked into the characters set as separate
    entries from the real ``JACK`` / ``EMILY``.

  BUG 2 — Implicit title/subtitle promoted to characters
    When the PDF has NO explicit ``TITLE:`` header, PyPDF2 extracts the
    centered title and subtitle as standalone uppercase cue-shaped
    lines at the top (``THE GREAT SNACK HEIST`` / ``SCRIPT M8 STRESS-
    TEST SCRIPT``), which pass the character-cue heuristic and are
    wrongly promoted to speaking characters.

The fixes are:
  * ``_strip_leading_line_number()`` — strips ``\\d+[\\s.\\-\\u2013\\u2014]+``
    at the start of a cue before dedup. Conservative: requires a
    separator so purely-numeric strings, digit-letter concatenations,
    and names with trailing numbers are never modified.
  * ``_implicit_title_indices`` pre-scan — detects >=2 consecutive
    cue-shaped uppercase lines at the top of a script when NO explicit
    ``TITLE:`` header exists, before any dialogue / scene heading /
    header keyword. A single leading uppercase line followed by
    non-uppercase dialogue is a REAL character cue and is NEVER
    suppressed.

Tests here lock the exact user-reported pattern and guard the fix
against regression into non-numbered / explicit-TITLE paths.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

server = importlib.import_module("server")
fallback_parse_script = server.fallback_parse_script
_strip_leading_line_number = server._strip_leading_line_number


# ─── A. Direct unit tests on _strip_leading_line_number ────────────────

def test_strip_leading_number_single_digit_space() -> None:
    assert _strip_leading_line_number("1 JACK") == "JACK"


def test_strip_leading_number_multi_digit_space() -> None:
    assert _strip_leading_line_number("192 JACK") == "JACK"


def test_strip_leading_number_em_dash_separator() -> None:
    # U+2014 em-dash, as reported on the physical device Scene Partner.
    assert _strip_leading_line_number("61 \u2014 JACK") == "JACK"


def test_strip_leading_number_ascii_hyphen_separator() -> None:
    assert _strip_leading_line_number("192 - JACK") == "JACK"


def test_strip_leading_number_en_dash_separator() -> None:
    # U+2013 en-dash.
    assert _strip_leading_line_number("61 \u2013 JACK") == "JACK"


def test_strip_leading_number_dot_separator() -> None:
    assert _strip_leading_line_number("1. JACK") == "JACK"


def test_strip_leading_number_multiple_spaces() -> None:
    assert _strip_leading_line_number("3  BELLA") == "BELLA"


def test_strip_leading_number_combined_separator() -> None:
    assert _strip_leading_line_number("12 -  LILY") == "LILY"


def test_strip_leading_number_no_leading_digits_unchanged() -> None:
    assert _strip_leading_line_number("JACK") == "JACK"


def test_strip_leading_number_name_only_unchanged() -> None:
    assert _strip_leading_line_number("MARY") == "MARY"


def test_strip_leading_number_trailing_number_unchanged() -> None:
    # Names with trailing numbers (SARAH 2) must NOT be stripped.
    assert _strip_leading_line_number("SARAH 2") == "SARAH 2"


def test_strip_leading_number_digit_letter_concatenation_unchanged() -> None:
    # No separator between digit and letter: do NOT strip (would change
    # legitimate stage-name or codename content).
    assert _strip_leading_line_number("J4CK") == "J4CK"
    assert _strip_leading_line_number("1JACK") == "1JACK"


def test_strip_leading_number_purely_numeric_unchanged() -> None:
    # No separator-plus-remainder; return original.
    assert _strip_leading_line_number("100") == "100"


def test_strip_leading_number_empty_remainder_unchanged() -> None:
    # Stripping would produce empty string — return original unchanged.
    assert _strip_leading_line_number("1 ") == "1 "
    assert _strip_leading_line_number("12. ") == "12. "


def test_strip_leading_number_mr_smith_unchanged() -> None:
    # Legitimate character name with a dot must not be affected.
    assert _strip_leading_line_number("MR. SMITH") == "MR. SMITH"


def test_strip_leading_number_character_cue_extension_unchanged() -> None:
    # Trailing parenthetical kept here; `_strip_character_cue_extension`
    # removes it in the parser pipeline step after this one.
    assert _strip_leading_line_number("JACK (V.O.)") == "JACK (V.O.)"


# ─── B. End-to-end parser tests — numbered cues ────────────────────────

def _raw_numbered_cues() -> str:
    """Script with mixed numbered-cue separators + repeated characters."""
    return "\n".join([
        "TITLE: NUMBERED CUES TEST",
        "",
        "INT. KITCHEN - DAY",
        "",
        "1 JACK",
        "Hey everyone.",
        "",
        "2 EMILY",
        "Hi Jack.",
        "",
        "3 BELLA",
        "Good morning!",
        "",
        "4 LILY",
        "Nice day.",
        "",
        "5 JACK",
        "Still me.",
        "",
        "6 EMILY",
        "Still me too.",
        "",
        "61 \u2014 JACK",   # em-dash separator
        "Later in the script.",
        "",
        "192 - JACK",       # ASCII hyphen separator
        "Much later.",
        "",
        "1. EMILY",         # dot separator
        "Back again.",
    ])


def test_numbered_cues_normalise_to_real_characters() -> None:
    parsed = fallback_parse_script(_raw_numbered_cues())
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"Expected {{JACK, EMILY, BELLA, LILY}}, got {sorted(chars)}"
    )


def test_numbered_cues_no_numeric_prefix_leaked() -> None:
    parsed = fallback_parse_script(_raw_numbered_cues())
    for c in parsed.get("characters", []):
        assert not c.lstrip()[:1].isdigit(), (
            f"Character {c!r} still has a leading digit after fix"
        )


def test_numbered_cues_different_separators_collapse_to_one_character() -> None:
    """`1 JACK`, `61 — JACK`, `192 - JACK`, `1. JACK` all one character."""
    raw = "\n".join([
        "TITLE: SEP TEST",
        "",
        "INT. OFFICE - DAY",
        "",
        "1 JACK",
        "Line one.",
        "",
        "61 \u2014 JACK",
        "Line two.",
        "",
        "192 - JACK",
        "Line three.",
        "",
        "1. JACK",
        "Line four.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK"}, (
        f"Expected {{JACK}}, got {sorted(chars)}"
    )


def test_numbered_cues_dialogue_text_preserved_under_normalised_character() -> None:
    """After normalisation, dialogue is attributed to the real
    character name (not the numbered variant)."""
    parsed = fallback_parse_script(_raw_numbered_cues())
    jack_dialogue = [
        ln.get("text", "")
        for ln in parsed.get("lines", [])
        if not ln.get("is_stage_direction")
        and str(ln.get("character", "")).upper().strip() == "JACK"
    ]
    # JACK speaks four times (1 JACK, 5 JACK, 61 — JACK, 192 - JACK).
    assert len(jack_dialogue) == 4, (
        f"Expected 4 JACK dialogue blocks after normalisation, "
        f"got {len(jack_dialogue)}: {jack_dialogue!r}"
    )


# ─── C. End-to-end parser tests — implicit title suppression ───────────

def _raw_implicit_title() -> str:
    """ScriptM8_The_Great_Snack_Heist-style: title + subtitle on
    separate lines at the very top of the script, NO explicit TITLE:
    header, cast list follows."""
    return "\n".join([
        "THE GREAT SNACK HEIST",
        "",
        "SCRIPT M8 STRESS-TEST SCRIPT",
        "",
        "INT. KITCHEN - DAY",
        "",
        "JACK",
        "I knew it.",
        "",
        "EMILY",
        "What is it?",
        "",
        "BELLA",
        "The last cookie.",
        "",
        "LILY",
        "Oh no.",
    ])


def test_implicit_title_not_promoted_to_character() -> None:
    parsed = fallback_parse_script(_raw_implicit_title())
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert "THE GREAT SNACK HEIST" not in chars
    assert "SCRIPT M8 STRESS-TEST SCRIPT" not in chars


def test_implicit_title_real_characters_still_detected() -> None:
    parsed = fallback_parse_script(_raw_implicit_title())
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"Expected {{JACK, EMILY, BELLA, LILY}}, got {sorted(chars)}"
    )


def test_implicit_title_stored_as_stage_direction() -> None:
    """The suppressed title line must still appear in the lines list
    as a stage direction so no authored content is lost."""
    parsed = fallback_parse_script(_raw_implicit_title())
    stage_texts = [
        ln.get("text", "")
        for ln in parsed.get("lines", [])
        if ln.get("is_stage_direction")
    ]
    assert any("THE GREAT SNACK HEIST" in t for t in stage_texts), (
        f"Title line lost; stage directions: {stage_texts}"
    )
    assert any("SCRIPT M8 STRESS-TEST SCRIPT" in t for t in stage_texts), (
        f"Subtitle line lost; stage directions: {stage_texts}"
    )


def test_implicit_title_with_numbered_cues_combined() -> None:
    """Combined failure mode: implicit title + numbered cues (the exact
    physical ScriptM8 pattern). Must produce exactly 4 characters."""
    raw = "\n".join([
        "THE GREAT SNACK HEIST",
        "",
        "SCRIPT M8 STRESS-TEST SCRIPT",
        "",
        "INT. KITCHEN - DAY",
        "",
        "1 JACK",
        "I knew it.",
        "",
        "2 EMILY",
        "What is it?",
        "",
        "3 BELLA",
        "The last cookie.",
        "",
        "4 LILY",
        "Oh no.",
        "",
        "5 JACK",
        "Still me.",
        "",
        "6 EMILY",
        "Still me too.",
        "",
        "7 JACK",
        "And again.",
        "",
        "8 BELLA",
        "Me as well.",
        "",
        "9 JACK",
        "Last one.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"Expected exactly 4 characters, got {sorted(chars)}"
    )


# ─── D. Negative tests — legitimate cases must NOT be suppressed ───────

def test_single_leading_uppercase_cue_followed_by_dialogue_is_real() -> None:
    """A SINGLE uppercase line at the top, immediately followed by
    non-uppercase dialogue, is a legitimate character cue and MUST be
    preserved. The implicit-title pre-scan requires >=2 consecutive
    uppercase lines before firing."""
    raw = "\n".join([
        "JACK",
        "Hello.",
        "",
        "EMILY",
        "Hi there.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY"}, (
        f"Expected {{JACK, EMILY}}, got {sorted(chars)}"
    )


def test_explicit_title_header_path_still_works() -> None:
    """When a `TITLE:` header exists, the explicit path handles title
    suppression and the implicit pre-scan does NOT run."""
    raw = "\n".join([
        "TITLE: HAMLET",
        "AUTHOR: Shakespeare",
        "",
        "INT. CASTLE - NIGHT",
        "",
        "HAMLET",
        "To be or not to be.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"HAMLET"}
    assert "HAMLET" in {str(c).upper().strip() for c in parsed.get("characters", [])}


def test_phantom_sentence_terminated_cues_still_rejected() -> None:
    """The trailing-terminator guard still rejects WHERE?/NO./WHY? etc.
    even after the new numbered-cue + implicit-title fixes."""
    raw = "\n".join([
        "TITLE: PHANTOM TEST",
        "",
        "INT. ROOM - DAY",
        "",
        "JACK",
        "WHERE?",
        "",
        "EMILY",
        "NO.",
        "",
        "BELLA",
        "WHY?",
        "",
        "LILY",
        "WHAT?",
        "",
        "JACK",
        "YES.",
        "",
        "EMILY",
        "WAIT.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    FORBIDDEN = {"WHERE?", "NO.", "WHY?", "WHAT?", "YES.", "WAIT."}
    leaked = chars & FORBIDDEN
    assert leaked == set(), (
        f"Phantom-cue regression: {sorted(leaked)} leaked back into "
        f"characters. Full set: {sorted(chars)}"
    )
    assert {"JACK", "EMILY", "BELLA", "LILY"}.issubset(chars)


def test_legitimate_character_cue_shapes_still_accepted() -> None:
    """Standard screenplay cue shapes must still be accepted:
    JACK, MARY, MR. SMITH, JACK (V.O.), SARAH (CONT'D)."""
    raw = "\n".join([
        "TITLE: CUE SHAPES",
        "",
        "INT. ROOM - DAY",
        "",
        "JACK",
        "Line one.",
        "",
        "MARY",
        "Line two.",
        "",
        "MR. SMITH",
        "Line three.",
        "",
        "JACK (V.O.)",
        "Voice over line.",
        "",
        "SARAH (CONT'D)",
        "Continued line.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    # Trailing parentheticals get stripped by _strip_character_cue_extension.
    for expected in ("JACK", "MARY", "MR. SMITH", "SARAH"):
        assert expected in chars, (
            f"Legitimate cue {expected!r} missing from characters: "
            f"{sorted(chars)}"
        )


def test_cast_list_at_top_without_title_header_not_suppressed_as_titles() -> None:
    """A `CHARACTERS:` cast list at the top is handled by the existing
    header-keyword path, NOT the implicit-title scan. Cast names after
    the header still become speaking characters when they speak."""
    raw = "\n".join([
        "CHARACTERS:",
        "JACK",
        "EMILY",
        "",
        "INT. ROOM - DAY",
        "",
        "JACK",
        "Hello.",
        "",
        "EMILY",
        "Hi.",
    ])
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert {"JACK", "EMILY"}.issubset(chars), (
        f"Cast list members missing: {sorted(chars)}"
    )


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
