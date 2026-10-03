"""Regression lock — screenplay parser must NOT promote ordinary
dialogue/exclamation lines (`WHERE?`, `APPARENTLY.`, `OH!`, `JACK!`,
`MUD.`, `FINE.`, `MAYBE.`, `TWO.`) to character cues.

Context — 2026-10 physical build 1.1.0 production/internal regression:
=======================================================================

In `ScriptM8_The_Great_Snack_Heist`, the parser (both the frontend
`smartScriptParser.ts::parseScript` which ships in the APK AND the
backend `server.py::fallback_parse_script` which backs `/api/scripts`)
promoted sentence-terminating all-caps dialogue to characters, e.g.:

    WHERE?            ← should be dialogue
    APPARENTLY.       ← should be dialogue
    OH!               ← should be dialogue
    JACK!             ← should be dialogue
    MUD.              ← should be dialogue
    FINE.             ← should be dialogue
    MAYBE.            ← should be dialogue
    TWO.              ← should be dialogue

Resulting counts: 301 Dialogue / 23 Action / 0 Parentheticals / 413
Total — with 60+ phantom characters.

Root cause — frontend (`services/smartScriptParser.ts::isLikelyCharacterName`):
--------------------------------------------------------------------------------
Line 155-158 accepts any line whose "non-safe" character count is <= 2.
Trailing `?` or `!` counts as ONE non-safe char (passes), and trailing
`.` is INSIDE the safe-set regex `[a-zA-Z\\s.\\-']` → counts as zero
non-safe chars (also passes). Combined with all-caps letters, the
caps ratio is 1.0 → confidence 0.95 → likely=true → classified as
CHARACTER.

Root cause — backend (`server.py::fallback_parse_script`):
-----------------------------------------------------------
Line 1659-1665 uses `potential_char.isupper()` which returns `True`
for `"WHERE?"`, `"APPARENTLY."`, `"OH!"` because Python's `str.isupper`
ignores non-cased characters. There is no trailing-punctuation guard.

Both parsers must reject lines ending in `.`, `!`, or `?` as character
cues (except for well-known honorifics in multi-word cues, which do
NOT end in a bare terminator anyway).

Smallest-safe-fix (NOT implemented yet — this test is the regression
lock that will go GREEN as soon as the fix lands):

Frontend `isLikelyCharacterName` — add immediately after the
`cleaned` normalisation (currently line 147):

    if (/[.!?]$/.test(cleaned)) {
      return { likely: false, confidence: 0 };
    }

Backend `fallback_parse_script` — strengthen the character-cue
predicate (currently line 1659) to also reject trailing sentence
terminators:

    if (
        potential_char.isupper()
        and len(potential_char.split()) <= 3
        and len(potential_char) > 1
        and not potential_char.startswith(('(', '['))
        and not potential_char.endswith(('.', '!', '?'))   # NEW
        and not _looks_like_scene_heading(potential_char)
    ):

Both changes are additive and only tighten the rejection path. No
existing legitimate character cue (`JACK`, `MARY`, `MR. SMITH`,
`JACK (V.O.)`, `JACK (CONT'D)`) is affected — none of them end in a
bare `.`, `!`, or `?` after the existing `(V.O.)` strip step.

This test file locks the fix and will FAIL until the fix lands.
"""

from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SMART_PARSER_TS = ROOT / "frontend" / "services" / "smartScriptParser.ts"

# ─── A: Backend `fallback_parse_script` behaviour test ────────────────

sys.path.insert(0, str(ROOT / "backend"))
server = importlib.import_module("server")
fallback_parse_script = server.fallback_parse_script

FAILING_DIALOGUE_LINES = [
    "WHERE?",
    "APPARENTLY.",
    "OH!",
    "JACK!",
    "MUD.",
    "FINE.",
    "MAYBE.",
    "TWO.",
]


def _build_scene(bare_line: str) -> str:
    """Minimal screenplay context that would legitimately route the
    bare line to dialogue (under a prior character cue) if the parser
    is correct, OR to action if the parser is correct and no prior
    cue is active. In either case the bare line must NOT itself be
    recorded as a NEW character."""
    return (
        "INT. KITCHEN - DAY\n"
        "\n"
        "JACK\n"
        "I knew it.\n"
        "\n"
        "MARY\n"
        "(annoyed)\n"
        f"{bare_line}\n"
    )


def test_backend_parser_never_promotes_sentence_terminated_caps_to_character() -> None:
    """Each of WHERE?, APPARENTLY., OH!, JACK!, MUD., FINE., MAYBE.,
    TWO. must NOT appear in the parsed character set."""
    for bare in FAILING_DIALOGUE_LINES:
        raw = _build_scene(bare)
        parsed = fallback_parse_script(raw)

        # Characters surface in `parsed["characters"]` (set/list)
        characters = parsed.get("characters", [])
        if isinstance(characters, (set, frozenset)):
            characters = list(characters)
        characters_upper = {str(c).upper() for c in characters}

        # The exact bare line must NEVER be a character.
        assert bare.upper() not in characters_upper, (
            f"Backend parser wrongly promoted {bare!r} to a character."
            f" Characters: {sorted(characters_upper)}. Full parsed output "
            f"for debugging: {parsed}"
        )

        # Also assert the stripped version (sans terminator) is not a
        # character — covers `JACK!` whose stripped form `JACK` IS a
        # legitimate character already in the scene; here we only
        # guard against the bare line itself being classified.
        # (See fine-grained line-level assertion below.)

        # Fine-grained: no `lines_data` entry may carry the bare line
        # verbatim as `character`.
        for entry in parsed.get("lines", []):
            char = entry.get("character") or ""
            assert char.upper() != bare.upper(), (
                f"Backend parser wrote {bare!r} as the character field "
                f"of a dialogue entry: {entry}"
            )


def test_backend_parser_still_detects_legitimate_character_cues() -> None:
    """Guardrail: the fix must not break ordinary character detection.
    JACK and MARY must still be detected in the sample scenes."""
    for bare in FAILING_DIALOGUE_LINES:
        raw = _build_scene(bare)
        parsed = fallback_parse_script(raw)
        characters = parsed.get("characters", [])
        if isinstance(characters, (set, frozenset)):
            characters = list(characters)
        chars_upper = {str(c).upper() for c in characters}
        assert "JACK" in chars_upper, (
            f"Legitimate character JACK missing after parsing scene "
            f"containing bare line {bare!r}. Characters: {sorted(chars_upper)}"
        )
        assert "MARY" in chars_upper, (
            f"Legitimate character MARY missing after parsing scene "
            f"containing bare line {bare!r}. Characters: {sorted(chars_upper)}"
        )


def test_backend_parser_routes_sentence_terminated_caps_to_dialogue() -> None:
    """Positive assertion: once the fix lands, the bare line should
    appear as DIALOGUE attributed to MARY (because MARY was the last
    legitimate character cue). This locks the correct routing, not
    just the absence of the wrong routing."""
    for bare in FAILING_DIALOGUE_LINES:
        raw = _build_scene(bare)
        parsed = fallback_parse_script(raw)
        # Find any entry whose text contains the bare line and whose
        # character is MARY (not stage direction, not phantom cue).
        found = False
        for entry in parsed.get("lines", []):
            if entry.get("is_stage_direction"):
                continue
            if entry.get("character", "").upper() != "MARY":
                continue
            if bare in (entry.get("text") or ""):
                found = True
                break
        assert found, (
            f"Bare line {bare!r} was not routed to MARY's dialogue. "
            f"Parsed entries: {parsed.get('lines')}"
        )


# ─── B: Frontend `smartScriptParser.ts` static source assertion ────────

def test_frontend_parser_has_trailing_terminator_guard() -> None:
    """Static assertion against the frontend parser source.

    The fix must add — inside `isLikelyCharacterName`, after the
    (V.O.)-strip at line 146 and before the caps-ratio check — a
    rejection for any `cleaned` line that ends in `.`, `!`, or `?`.
    This test fails until that guard is present in the TS source.
    """
    src = SMART_PARSER_TS.read_text(encoding="utf-8")
    # Any of these equivalent forms is acceptable; the test matches
    # the regex-based form which is the smallest, cleanest fix.
    acceptable_patterns = [
        r"\/\[\.\!\?\]\$\/\.test\(cleaned\)",            # /[.!?]$/.test(cleaned)
        r"\/\[\!\?\\\.\]\$\/\.test\(cleaned\)",           # /[!?\.]$/.test(cleaned)
        r"cleaned\.match\(\s*\/\[\.\!\?\]\$\/\s*\)",      # cleaned.match(/[.!?]$/)
        r"endsWith\(['\"]\.['\"]\)\s*\|\|\s*cleaned\.endsWith\(['\"]!['\"]\)",
    ]
    hits = [p for p in acceptable_patterns if re.search(p, src)]
    assert hits, (
        "frontend/services/smartScriptParser.ts::isLikelyCharacterName "
        "must reject lines whose `cleaned` form ends in `.`, `!`, or "
        "`?`. Expected one of these guard patterns to appear in the "
        "source: /[.!?]$/.test(cleaned) — none were found. This is "
        "the fix the 2026-10 physical build 1.1.0 regression requires."
    )


def test_frontend_parser_isLikelyCharacterName_still_present() -> None:
    """Guardrail: the function signature must still exist (the fix
    should be ADDITIVE, not a rewrite). Prevents an accidental
    deletion that would hide the bug behind an entirely different
    code path."""
    src = SMART_PARSER_TS.read_text(encoding="utf-8")
    assert re.search(
        r"function\s+isLikelyCharacterName\s*\(",
        src,
    ), "`isLikelyCharacterName` function missing from smartScriptParser.ts"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
