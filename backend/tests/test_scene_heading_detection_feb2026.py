"""Feb-2026 scene-heading / character-detection hardening regression suite.

Locks in the fix for the Feb-2026 physical Samsung S23 Ultra QA build
where the DOCX maximum-stress-test document surfaced screenplay
section headings incorrectly classified as speaking characters:

    SCENE 2 — CONTRACTIONS
    SCENE 5 — PUNCTUATION
    SCENE 6 — PARENTHETICALS
    SCENE 7 — STAGE DIRECTIONS

Plus the tighter (compact) variants observed on device when DOCX runs
collapse the em-dash and surrounding whitespace:

    SCENE 1
    SCENE 2-CONTRACTS
    SCENE 2—CONTRACTIONS
    INT. KITCHEN
    FADE IN:
    ACT ONE

These are the deterministic end-to-end cases. Each positive case (a
heading that SHOULD be rejected) is paired with adversarial negative
guards (real character names that MUST keep being detected).
"""

import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

from server import (
    _looks_like_scene_heading,
    _strip_character_cue_extension,
    extract_text_from_docx,
    fallback_parse_script,
)

# ---------------------------------------------------------------------------
# Layer 1 — `_looks_like_scene_heading` classifier
# ---------------------------------------------------------------------------

SCENE_HEADING_POSITIVE = [
    # Physical failure signatures from the stress-test document.
    "SCENE 1",
    "SCENE 2 — CONTRACTIONS",
    "SCENE 2 - CONTRACTIONS",
    "SCENE 2—CONTRACTIONS",         # compact em-dash (no spaces)
    "SCENE 2-CONTRACTIONS",         # compact hyphen
    "SCENE 5 — PUNCTUATION",
    "SCENE 6 — PARENTHETICALS",
    "SCENE 7 — STAGE DIRECTIONS",
    "SCENE ONE",
    # Sluglines.
    "INT. KITCHEN",
    "INT. KITCHEN - NIGHT",
    "INT. KITCHEN — NIGHT",
    "EXT. STREET — DAY",
    "INT./EXT. CAR — NIGHT",
    "EXT./INT. HALLWAY - DAY",
    "I/E. CAR",
    "E/I. TRUCK",
    # Transitions.
    "FADE IN:",
    "FADE OUT.",
    "FADE OUT:",
    "FADE TO BLACK",
    "CUT TO:",
    "DISSOLVE TO:",
    "DISSOLVE",
    "SMASH CUT TO:",
    "MATCH CUT TO:",
    "JUMP CUT",
    "TIME CUT",
    "IRIS IN",
    "IRIS OUT",
    "FREEZE FRAME",
    # Structural headings.
    "ACT ONE",
    "ACT 1",
    "CHAPTER 3",
    "PART TWO",
    "SECTION A",
    # Editorial markers.
    "MONTAGE",
    "FLASHBACK",
    "FLASHFORWARD",
    "INTERCUT",
    "BACK TO SCENE",
    "ANGLE ON",
    "CLOSE ON",
    "WIDE ON",
    "TITLE CARD",
    "THE END",
    "END OF SCENE",
    "PRELAP",
    "SUPERIMPOSE",
]


@pytest.mark.parametrize("heading", SCENE_HEADING_POSITIVE)
def test_scene_heading_detected(heading):
    assert _looks_like_scene_heading(heading) is True


LEGIT_CHARACTER_NAMES = [
    # Simple.
    "JACK",
    "SARAH",
    "DREW",
    "ANG",
    "HANN AH",              # user-called-out preservation case
    # Titled.
    "MRS. SMITH",
    "MR. JONES",
    "DR. HOUSE",
    # Character extensions (kept before extension-stripping).
    "JACK (V.O.)",
    "SARAH (O.S.)",
    "MARY (CONT'D)",
    "BOB (OFF SCREEN)",
    "JOHN (INTO PHONE)",
    # Descriptive but legit character cues.
    "POLICE OFFICER",
    "OLD MAN",
    "YOUNG WOMAN",
]


@pytest.mark.parametrize("name", LEGIT_CHARACTER_NAMES)
def test_legit_name_not_flagged_as_scene(name):
    assert _looks_like_scene_heading(name) is False


# ---------------------------------------------------------------------------
# Layer 2 — `_strip_character_cue_extension`
# ---------------------------------------------------------------------------

EXTENSION_CASES = [
    ("JACK (V.O.)", "JACK"),
    ("SARAH (O.S.)", "SARAH"),
    ("MARY (CONT'D)", "MARY"),
    ("BOB (OFF SCREEN)", "BOB"),
    ("JOHN (INTO PHONE)", "JOHN"),
    ("BOB (PRE-LAP)", "BOB"),
    ("BOB (V.O., CONT'D)", "BOB"),
    # No extension — return unchanged.
    ("JACK", "JACK"),
    ("MRS. SMITH", "MRS. SMITH"),
    ("HANN AH", "HANN AH"),
    # Bare parenthetical — extension stripping would produce empty
    # string; the guard returns the original so the caller's stage-
    # direction path handles it.
    ("(V.O.)", "(V.O.)"),
]


@pytest.mark.parametrize("raw,expected", EXTENSION_CASES)
def test_strip_character_cue_extension(raw, expected):
    assert _strip_character_cue_extension(raw) == expected


# ---------------------------------------------------------------------------
# Layer 3 — end-to-end `fallback_parse_script` classification.
# ---------------------------------------------------------------------------

STRESS_TEXT = """SCENE 1

JACK
Hello there.

SCENE 2 — CONTRACTIONS

JACK
I don't want to go.

SARAH
You're not serious.

SCENE 5 — PUNCTUATION

JACK
Wait, what?

SCENE 6 — PARENTHETICALS

SARAH
(quietly)
Please stop.

SCENE 7 — STAGE DIRECTIONS

JACK
(pacing)
This is disciplinary.
"""


def test_stress_text_only_real_characters():
    """The physical stress-test document must yield exactly {JACK, SARAH}
    — no SCENE / INT. / FADE / ACT headings promoted."""
    parsed = fallback_parse_script(STRESS_TEXT)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}


def test_stress_text_dialogue_attributed_correctly():
    """After the fix, every attributed dialogue line points at a real
    character, never at a heading."""
    parsed = fallback_parse_script(STRESS_TEXT)
    for line in parsed["lines"]:
        if line["is_stage_direction"]:
            continue
        assert line["character"] in {"JACK", "SARAH"}, line


COMPACT_STRESS_TEXT = """SCENE 1
JACK
Hello.
SCENE 2—CONTRACTS
SARAH
Bye.
SCENE 3-PUNCTUATION
DREW
Later.
INT. KITCHEN
JACK
Home.
FADE OUT.
"""


def test_compact_stress_only_real_characters():
    """The compact (no-spaces-around-dash) variant must also yield
    only real characters — this is the shape the S23 physical build
    hit when DOCX run boundaries collapsed the surrounding whitespace."""
    parsed = fallback_parse_script(COMPACT_STRESS_TEXT)
    assert set(parsed["characters"]) == {"JACK", "SARAH", "DREW"}


def test_transitions_never_promoted_to_character():
    text = "FADE IN:\n\nJACK\nHello.\n\nCUT TO:\n\nSARAH\nBye.\n\nFADE OUT."
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}


def test_slugline_never_promoted_to_character():
    text = (
        "INT. KITCHEN — NIGHT\n\n"
        "JACK\nHello.\n\n"
        "EXT. STREET — DAY\n\n"
        "SARAH\nBye.\n\n"
        "INT./EXT. CAR — NIGHT\n\n"
        "DREW\nLater.\n"
    )
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH", "DREW"}


def test_slugline_without_time_marker_not_promoted():
    """Even the truncated `INT. KITCHEN` (no NIGHT/DAY suffix) shape
    must be recognised as a slugline, not a character."""
    text = "INT. KITCHEN\n\nJACK\nHello."
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK"}


def test_act_and_chapter_headings_not_promoted():
    text = "ACT ONE\n\nJACK\nHello.\n\nACT TWO\n\nSARAH\nBye.\n"
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}


def test_character_extension_stripped_from_stored_name():
    """`JACK (V.O.)` on a cue line should store as `JACK` (extensions
    are cosmetic, not distinct characters)."""
    text = "JACK (V.O.)\nOffscreen line.\n\nJACK\nOn-camera line.\n"
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK"}


def test_parenthetical_alone_not_promoted():
    """`(V.O.)` alone (no name) is a bare parenthetical — routed to
    the stage-direction path, never stored as a character."""
    text = "(V.O.)\nOffscreen narration.\n"
    parsed = fallback_parse_script(text)
    assert parsed["characters"] == []
    # It should be recorded as a stage direction line.
    stage = [ln for ln in parsed["lines"] if ln["is_stage_direction"]]
    assert stage and stage[0]["text"].startswith("(")


def test_preserves_all_documented_legit_names():
    """Every character shape the user called out MUST survive."""
    text = (
        "JACK\nLine 1.\n\n"
        "SARAH\nLine 2.\n\n"
        "DREW\nLine 3.\n\n"
        "ANG\nLine 4.\n\n"
        "HANN AH\nLine 5.\n\n"
        "MRS. SMITH\nLine 6.\n\n"
        "POLICE OFFICER\nLine 7.\n"
    )
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {
        "JACK", "SARAH", "DREW", "ANG",
        "HANN AH", "MRS. SMITH", "POLICE OFFICER",
    }


# ---------------------------------------------------------------------------
# Layer 4 — end-to-end DOCX round-trip with the actual stress structure.
# ---------------------------------------------------------------------------

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _synth_docx(paragraph_xml_snippets):
    doc = Document()
    body = doc.element.body
    for p in list(body.findall(qn("w:p"))):
        body.remove(p)
    for snippet in paragraph_xml_snippets:
        p = etree.SubElement(body, qn("w:p"))
        inner = etree.fromstring(
            f'<w:root xmlns:w="{W_NS}">{snippet}</w:root>'
        )
        for child in inner:
            p.append(child)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _run(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def test_e2e_docx_stress_test_document_shape():
    """Reproduce the physical DOCX stress-test paragraph structure and
    confirm no scene heading is stored as a character."""
    blob = _synth_docx([
        _run("SCENE 1"),
        _run("JACK"),
        _run("Hello there."),
        _run("SCENE 2 — CONTRACTIONS"),
        _run("JACK"),
        _run("I don't want to go."),
        _run("SARAH"),
        _run("You're not serious."),
        _run("SCENE 5 — PUNCTUATION"),
        _run("JACK"),
        _run("Wait, what?"),
        _run("SCENE 6 — PARENTHETICALS"),
        _run("SARAH"),
        _run("(quietly)"),
        _run("Please stop."),
        _run("SCENE 7 — STAGE DIRECTIONS"),
        _run("JACK"),
        _run("(pacing)"),
        _run("This is disciplinary."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}
    # No stored character can start with SCENE / INT / EXT / FADE / CUT / ACT.
    for char in parsed["characters"]:
        assert not _looks_like_scene_heading(char), char


def test_e2e_docx_mixed_slugline_and_transition():
    """Slug + transition + real character. Only the real name persists."""
    blob = _synth_docx([
        _run("FADE IN:"),
        _run("INT. KITCHEN — NIGHT"),
        _run("JACK"),
        _run("Hello."),
        _run("CUT TO:"),
        _run("EXT. STREET — DAY"),
        _run("SARAH"),
        _run("Goodbye."),
        _run("FADE OUT."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}


# ---------------------------------------------------------------------------
# Regression: original DOCX word-boundary fixes must still hold.
# ---------------------------------------------------------------------------

def test_scene_fix_does_not_regress_word_boundary_repair():
    """The Feb-2026 word-boundary hardening (`kno w` → `know`,
    `nothinghappens` → `nothing happens`, `disciplinary .` →
    `disciplinary.`) must still hold after the character-detection
    fix — this is a combined-fix invariant."""
    text = (
        "SCENE 1\n\n"
        "JACK\n"
        "I kno w what you mean. Nothinghappens today.\n\n"
        "SARAH\n"
        "You are disciplinary .\n"
    )
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}
    dialogue = {
        ln["character"]: ln["text"]
        for ln in parsed["lines"]
        if not ln["is_stage_direction"]
    }
    assert "know" in dialogue["JACK"]
    assert "Nothing happens" in dialogue["JACK"] or "nothing happens" in dialogue["JACK"]
    assert "disciplinary." in dialogue["SARAH"]
