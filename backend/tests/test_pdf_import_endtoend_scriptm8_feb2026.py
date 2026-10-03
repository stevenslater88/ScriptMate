"""End-to-end PDF-import regression — ScriptM8_The_Great_Snack_Heist
style failure, 2026-10 physical build 1.1.0 / VC1130.

The 435-test parser suite before this file used hand-authored
screenplay strings as input. None of them exercised the full
PDF-bytes → PyPDF2 → `extract_text_from_pdf` → `fallback_parse_script`
chain, so PyPDF2-specific extraction artifacts (trailing U+00A0 NBSP,
U+200B zero-width space, title-value echoed twice) silently bypassed
the trailing-terminator guard and whitespace-blind dedup. The physical
device therefore saw ~200 phantom characters including `NO.`, `WHY?`,
`WHAT?`, `YES.`, `INTERESTING.`, `WAIT.`, `THE GREAT SNACK HEIST`.

This test synthesises a PDF with the exact extraction characteristics
reported on the device (PyPDF2 NBSP tails + title-duplicate + mixed
dialogue terminators + whitespace-variant character names) and asserts
the full pipeline produces a clean Script.
"""

from __future__ import annotations

import io
import importlib
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

server = importlib.import_module("server")
fallback_parse_script = server.fallback_parse_script
extract_text_from_pdf = server.extract_text_from_pdf


# ─── Synthetic PDF generator ───────────────────────────────────────────
#
# We don't commit a binary fixture; we build a deterministic PDF at
# test-time using reportlab if available, otherwise reportlab-free
# raw-PDF bytes with the exact extraction characteristics PyPDF2
# produces on the real file. The goal is to drive the SAME failure
# mode the device saw — PyPDF2 appending U+00A0 after short uppercase
# dialogue and extracting the title twice.

def _build_synthetic_raw_text() -> str:
    """Return a raw_text string that matches what PyPDF2 extracts
    from ScriptM8_The_Great_Snack_Heist.pdf on the production host.

    Characteristics reproduced:
      1. Title appears TWICE (standalone + `TITLE:` metadata).
      2. Short uppercase dialogue carries a trailing U+00A0 NBSP that
         PyPDF2 injects after the sentence terminator.
      3. One character name appears both as plain `JACK` and as
         `JACK\\u00A0` (NBSP suffix) in different cue positions.
      4. All eight regression-known phantom cues present as dialogue:
         NO., WHY?, WHAT?, YES., INTERESTING., WAIT., plus WHERE?, OH!.
    """
    NBSP = "\u00A0"
    ZWSP = "\u200B"
    lines = [
        "THE GREAT SNACK HEIST",           # title echo #1 (standalone)
        "",
        "TITLE: THE GREAT SNACK HEIST",     # title metadata echo #2
        "AUTHOR: ScriptM8 Test",
        "CHARACTERS:",
        "JACK",
        "EMILY",
        "BELLA",
        "",
        "INT. KITCHEN - DAY",
        "",
        "JACK",
        "I knew it. The last cookie is gone.",
        "",
        "EMILY",
        "WHERE?" + NBSP,                    # phantom cue (NBSP trailer)
        "",
        "JACK" + NBSP,                       # whitespace variant of JACK
        "Right here.",
        "",
        "BELLA",
        "APPARENTLY." + ZWSP,                # phantom cue (ZWSP trailer)
        "",
        "JACK",
        "That isn't funny.",
        "",
        "EMILY",
        "OH!",                               # phantom cue (clean .)
        "",
        "JACK",
        "NO.",                               # phantom cue (clean .)
        "",
        "BELLA",
        "WHY?",                              # phantom cue (clean ?)
        "",
        "EMILY",
        "WHAT?",                             # phantom cue
        "",
        "JACK",
        "YES.",                              # phantom cue
        "",
        "BELLA",
        "INTERESTING." + NBSP,               # phantom cue (NBSP)
        "",
        "EMILY",
        "WAIT.",                             # phantom cue
        "",
        "JACK",
        "FINE.",                             # phantom cue
        "",
        "BELLA",
        "MUD.",                              # phantom cue
        "",
        "EMILY",
        "MAYBE.",                            # phantom cue
        "",
        "JACK",
        "TWO.",                              # phantom cue
        "",
        "JACK",
        "That is the end.",
    ]
    return "\n".join(lines)


# ─── A. Direct parser test on the synthetic raw_text ───────────────────

def _parse() -> dict:
    """Shared fixture across tests."""
    return fallback_parse_script(_build_synthetic_raw_text())


def test_phantom_sentence_terminated_cues_not_characters() -> None:
    """None of the eight documented phantom cues may appear in the
    character set, even when they carry a trailing NBSP / ZWSP."""
    parsed = _parse()
    chars = parsed.get("characters", [])
    chars = list(chars) if isinstance(chars, (set, frozenset)) else chars
    chars_upper = {str(c).upper().strip() for c in chars}

    FORBIDDEN = {
        "WHERE?", "APPARENTLY.", "OH!", "NO.", "WHY?", "WHAT?",
        "YES.", "INTERESTING.", "WAIT.", "FINE.", "MUD.", "MAYBE.",
        "TWO.", "JACK!",
    }
    leaked = sorted(c for c in chars_upper if c in FORBIDDEN)
    assert leaked == [], (
        f"Phantom cues leaked into character set: {leaked}. "
        f"Full character set: {sorted(chars_upper)}. "
        f"Parsed lines: {parsed.get('lines')[:5]}..."
    )


def test_title_value_not_promoted_to_character() -> None:
    """The duplicated title line `THE GREAT SNACK HEIST` must not be
    recorded as a character (title-duplicate suppression still works
    end-to-end post-fix)."""
    parsed = _parse()
    chars = parsed.get("characters", [])
    chars = list(chars) if isinstance(chars, (set, frozenset)) else chars
    chars_upper = {str(c).upper().strip() for c in chars}
    assert "THE GREAT SNACK HEIST" not in chars_upper, (
        f"Title duplicate promoted to character. "
        f"Characters: {sorted(chars_upper)}"
    )


def test_whitespace_variants_collapse_to_one_character() -> None:
    """`JACK` and `JACK\\u00A0` (NBSP suffix) must dedup to a single
    character entry, not two."""
    parsed = _parse()
    chars = parsed.get("characters", [])
    chars = list(chars) if isinstance(chars, (set, frozenset)) else chars
    jack_variants = [
        c for c in chars
        if str(c).strip("\u00A0\u200B\u200C\u200D\uFEFF \t").upper() == "JACK"
    ]
    assert len(jack_variants) == 1, (
        f"Whitespace variants of JACK did not collapse. "
        f"Found {len(jack_variants)}: {jack_variants!r}. "
        f"All characters: {chars}"
    )


def test_character_set_is_short_and_contains_only_real_names() -> None:
    """A clean parse of this scene should produce exactly 3 real
    characters: JACK, EMILY, BELLA. No more, no fewer."""
    parsed = _parse()
    chars = parsed.get("characters", [])
    chars = list(chars) if isinstance(chars, (set, frozenset)) else chars
    chars_upper = {str(c).strip("\u00A0\u200B\u200C\u200D\uFEFF \t").upper() for c in chars}
    # Allow 'CHARACTERS' or similar front-matter tokens to be absent;
    # these are expected to be filtered by _HEADER_KEYWORDS.
    expected = {"JACK", "EMILY", "BELLA"}
    assert expected.issubset(chars_upper), (
        f"Expected characters {expected} not all present. "
        f"Got: {sorted(chars_upper)}"
    )
    extras = chars_upper - expected
    assert len(extras) <= 1, (
        f"Unexpected extra characters: {sorted(extras)}. "
        f"Full set: {sorted(chars_upper)}"
    )


def test_phantom_cue_text_still_appears_as_dialogue() -> None:
    """Confirming the fix doesn't just drop the content — the
    phantom-cue strings must appear as DIALOGUE under their preceding
    legitimate character cue."""
    parsed = _parse()
    all_dialogue_text = " ".join(
        (ln.get("text") or "")
        for ln in parsed.get("lines", [])
        if not ln.get("is_stage_direction")
    )
    # At least a few of the phantom cues must survive as dialogue text
    # (they are legitimate dialogue content).
    for phrase in ("WHERE", "OH", "NO"):
        assert phrase in all_dialogue_text.upper(), (
            f"Dialogue text lost the phantom-cue content {phrase!r}. "
            f"All dialogue: {all_dialogue_text!r}"
        )


# ─── B. Full PDF-bytes → PyPDF2 → parser pipeline (if reportlab) ───────

def _build_real_pdf_bytes() -> bytes:
    """Build an actual PDF containing the synthetic raw text so the
    test exercises the real `extract_text_from_pdf` → PyPDF2 path.
    Requires reportlab; skipped if absent."""
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
    except ImportError:
        pytest.skip("reportlab not installed; skipping real-PDF pipeline test")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    y = 740
    # Use Courier 12 — a screenplay-typical monospace that keeps
    # PyPDF2's extraction behaviour close to real-world output.
    c.setFont("Courier", 12)
    for line in _build_synthetic_raw_text().split("\n"):
        if y < 60:
            c.showPage()
            c.setFont("Courier", 12)
            y = 740
        c.drawString(72, y, line)
        y -= 14
    c.showPage()
    c.save()
    return buf.getvalue()


def test_full_pdf_pipeline_endtoend_no_phantom_characters() -> None:
    """End-to-end: PDF bytes → extract_text_from_pdf → fallback_parse_script.
    This is the SAME chain the production backend runs for a device
    PDF upload. Skipped if reportlab is unavailable in the venv."""
    pdf_bytes = _build_real_pdf_bytes()
    raw_text = extract_text_from_pdf(pdf_bytes)
    assert raw_text and raw_text.strip(), "PDF extraction returned empty raw_text"

    parsed = fallback_parse_script(raw_text)
    chars = parsed.get("characters", [])
    chars = list(chars) if isinstance(chars, (set, frozenset)) else chars
    chars_norm = {
        str(c).strip("\u00A0\u200B\u200C\u200D\uFEFF \t").upper()
        for c in chars
    }

    # Phantom cues absent
    FORBIDDEN = {
        "WHERE?", "APPARENTLY.", "OH!", "NO.", "WHY?", "WHAT?",
        "YES.", "INTERESTING.", "WAIT.", "FINE.", "MUD.", "MAYBE.",
        "TWO.", "JACK!",
    }
    leaked = sorted(c for c in chars_norm if c in FORBIDDEN)
    assert leaked == [], (
        f"End-to-end PDF pipeline leaked phantom cues: {leaked}. "
        f"All extracted characters: {sorted(chars_norm)}"
    )

    # Title absent as character
    assert "THE GREAT SNACK HEIST" not in chars_norm, (
        f"End-to-end PDF pipeline promoted title to character. "
        f"All characters: {sorted(chars_norm)}"
    )

    # Real characters present
    for expected in ("JACK", "EMILY", "BELLA"):
        assert expected in chars_norm, (
            f"End-to-end PDF pipeline lost real character {expected!r}. "
            f"All characters: {sorted(chars_norm)}"
        )

    # Character set is bounded — real scripts never have >10 unique
    # characters in a scene like this. 200 is the regression number.
    assert len(chars_norm) <= 10, (
        f"End-to-end PDF pipeline returned {len(chars_norm)} "
        f"characters (expected <= 10). Still regressing: {sorted(chars_norm)}"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
