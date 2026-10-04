"""P0 regression — invisible intra-token characters bypassing the
<=3-word character-cue rejection.

Physical ScriptM8 APK, Feb 2026: the Preview & Fix screen listed
`SCRIPT M8 STRESS-TEST SCRIPT` as a 1-line character even though the
subtitle has 4 whitespace-separated words. Root cause: PyPDF2 injected
an invisible character (U+200B ZWSP / U+00A0 NBSP / U+200D ZWJ /
U+200C ZWNJ / U+FEFF BOM) BETWEEN tokens of the subtitle during PDF
extraction. Python's `str.split()` does NOT treat ZWSP/ZWNJ/ZWJ/BOM as
whitespace (and JavaScript's `\\s` matches NBSP but none of the other
four), so the 4-word subtitle counted as 3 words and bypassed the
character-cue rejection.

The fix is a `_wordcount_normalize()` helper that replaces invisible
intra-token characters with ordinary spaces BEFORE the word-count
decision only. Line text, character identities, and all other parser
behaviour are unchanged.

This regression file locks the behaviour for ALL five invisible
characters, plus the plain-ASCII baseline, plus the companion title
`THE\u00A0GREAT SNACK HEIST`. Real characters JACK / EMILY / BELLA /
LILY must remain correctly detected.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
server = importlib.import_module("server")
fallback_parse_script = server.fallback_parse_script


_INVISIBLE_CHARS = [
    ("ZWSP",  "\u200B"),
    ("NBSP",  "\u00A0"),
    ("ZWJ",   "\u200D"),
    ("ZWNJ",  "\u200C"),
    ("BOM",   "\uFEFF"),
]


def _mk_script(subtitle: str) -> str:
    """Mirror the physical ScriptM8 shape: an implicit title line, an
    implicit subtitle line (where the invisible char is injected), a
    scene heading, then four cast members with one dialogue line each.
    """
    return "\n".join([
        "THE GREAT SNACK HEIST",
        "",
        subtitle,
        "",
        "INT. KITCHEN - DAY",
        "",
        "JACK",
        "I knew it. The last cookie is gone.",
        "",
        "EMILY",
        "Where?",
        "",
        "BELLA",
        "Apparently.",
        "",
        "LILY",
        "Oh no.",
    ])


@pytest.mark.parametrize("label,ch", _INVISIBLE_CHARS)
def test_subtitle_with_invisible_between_SCRIPT_and_M8(label: str, ch: str) -> None:
    """`SCRIPT<INVIS>M8 STRESS-TEST SCRIPT` must NOT be a character.
    JACK / EMILY / BELLA / LILY must remain detected."""
    subtitle = f"SCRIPT{ch}M8 STRESS-TEST SCRIPT"
    parsed = fallback_parse_script(_mk_script(subtitle))
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"[{label}] subtitle {subtitle!r} leaked. chars={sorted(chars)}"
    )
    for c in chars:
        assert "SCRIPT" not in c and "STRESS" not in c, (
            f"[{label}] subtitle fragment leaked into character {c!r}"
        )


@pytest.mark.parametrize("label,ch", _INVISIBLE_CHARS)
def test_subtitle_with_invisible_between_M8_and_STRESS(label: str, ch: str) -> None:
    subtitle = f"SCRIPT M8{ch}STRESS-TEST SCRIPT"
    parsed = fallback_parse_script(_mk_script(subtitle))
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"[{label}] subtitle {subtitle!r} leaked. chars={sorted(chars)}"
    )


@pytest.mark.parametrize("label,ch", _INVISIBLE_CHARS)
def test_subtitle_with_invisible_between_STRESSTEST_and_SCRIPT(label: str, ch: str) -> None:
    subtitle = f"SCRIPT M8 STRESS-TEST{ch}SCRIPT"
    parsed = fallback_parse_script(_mk_script(subtitle))
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"[{label}] subtitle {subtitle!r} leaked. chars={sorted(chars)}"
    )


def test_title_line_with_NBSP_between_tokens_not_a_character() -> None:
    """`THE\u00A0GREAT SNACK HEIST` must NOT be a character."""
    raw = _mk_script("SUBTITLE LINE ONE").replace(
        "THE GREAT SNACK HEIST", "THE\u00A0GREAT SNACK HEIST"
    )
    parsed = fallback_parse_script(raw)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert "THE GREAT SNACK HEIST" not in chars
    assert "THE\u00A0GREAT SNACK HEIST" not in chars
    assert {"JACK", "EMILY", "BELLA", "LILY"}.issubset(chars)


def test_plain_ascii_subtitle_still_rejected_baseline() -> None:
    """Baseline — no invisible injection. 4-word subtitle must still
    be rejected by the pre-existing word-count guard."""
    parsed = fallback_parse_script(_mk_script("SCRIPT M8 STRESS-TEST SCRIPT"))
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert "SCRIPT M8 STRESS-TEST SCRIPT" not in chars
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}


def test_wordcount_normalize_helper_is_idempotent_for_plain_text() -> None:
    """The helper must leave plain-ASCII text UNCHANGED."""
    assert server._wordcount_normalize("JACK") == "JACK"
    assert server._wordcount_normalize("SCRIPT M8") == "SCRIPT M8"
    assert server._wordcount_normalize("STRESS-TEST") == "STRESS-TEST"


@pytest.mark.parametrize("label,ch", _INVISIBLE_CHARS)
def test_wordcount_normalize_helper_converts_each_invisible_to_space(label: str, ch: str) -> None:
    """Each of the 5 invisibles must be replaced by a plain ASCII
    space so that `.split()` sees the real word boundary."""
    assert server._wordcount_normalize(f"A{ch}B") == "A B"


def test_wordcount_normalize_helper_only_affects_wordcount_not_identity() -> None:
    """Sanity: the normalisation is NOT used for identity dedup. The
    cue identity path still uses `_normalize_cue`, which only strips
    leading/trailing invisibles — intra-token invisibles are stored
    as-is in the stored line text. (We only assert the helper itself
    does not strip intra-token chars from identity-forming helpers.)"""
    s = "JACK\u200BY"
    # _normalize_cue only trims leading/trailing, so an intra-token
    # ZWSP survives — this is intentional and locked here.
    assert server._normalize_cue(s) == s


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
