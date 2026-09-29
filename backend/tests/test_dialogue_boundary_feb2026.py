"""Feb-2026 dialogue-boundary hardening regression suite.

Locks in the fix for the Feb-2026 physical Samsung S23 Ultra QA build
where TTS/Rehearsal was reading scene headings and action prose as
part of a character's dialogue. Concrete failing shape from the
physical stress-test:

    SARAH
    You're not listening. We're running out of time, and
    I'll tell you exactly what happened.

    2. INT. KITCHEN — MORNING

    A kettle clicks off. Sarah enters carrying two mugs.
    Jack looks at the clock.

Before the fix, SARAH's stored `text` was:
    "You're not listening. ... what happened. 2. INT. KITCHEN — MORNING
     A kettle clicks off. Sarah enters carrying two mugs. Jack looks
     at the clock."

Root cause: `fallback_parse_script`'s scene-heading detector correctly
rejected the heading as a *character cue*, but the "else" branch then
appended it to `current_text` — the accumulator for the previous
character's dialogue. Same fall-through absorbed the action lines that
followed. Fix: (a) treat scene headings as an explicit stage-direction
line that terminates the preceding dialogue; (b) after a scene heading
the accumulator has no current character, so free-text lines are
routed to the stage-direction path instead of dialogue.

These tests enforce the boundary invariant:
    "A dialogue line must contain ONLY that character's dialogue."
"""

import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docx import Document
from docx.oxml.ns import qn
from lxml import etree

from server import extract_text_from_docx, fallback_parse_script

# ---------------------------------------------------------------------------
# Layer 1 — the exact physical failure shape.
# ---------------------------------------------------------------------------

PHYSICAL_STRESS_TEXT = """1. INT. APARTMENT — NIGHT

Jack sits on the couch. He looks tired.

JACK
Hello there. I've been waiting.

2. INT. KITCHEN — MORNING

A kettle clicks off. Sarah enters carrying two mugs. Jack looks at the clock.

SARAH
You're not listening. We're running out of time, and I'll tell you exactly what happened.

3. EXT. STREET — DAY

DET. HARRIS
This is disciplinary.
"""


def _dialogue_by(parsed, name):
    return [
        ln["text"]
        for ln in parsed["lines"]
        if ln["character"] == name and not ln["is_stage_direction"]
    ]


def test_physical_stress_sarah_dialogue_is_only_dialogue():
    """SARAH's dialogue must contain ONLY her spoken line — not the
    scene heading that follows, not the kettle-clicks action, not
    JACK's subsequent line."""
    parsed = fallback_parse_script(PHYSICAL_STRESS_TEXT)
    sarah = _dialogue_by(parsed, "SARAH")
    assert sarah, "SARAH must have at least one dialogue line"
    combined = " ".join(sarah)
    assert "INT." not in combined, combined
    assert "EXT." not in combined, combined
    assert "kettle" not in combined, combined
    assert "carrying two mugs" not in combined, combined
    assert "clock" not in combined, combined


def test_physical_stress_jack_dialogue_is_only_dialogue():
    parsed = fallback_parse_script(PHYSICAL_STRESS_TEXT)
    jack = _dialogue_by(parsed, "JACK")
    assert jack
    combined = " ".join(jack)
    assert "INT." not in combined
    assert "MORNING" not in combined
    assert "kettle" not in combined


def test_physical_stress_scene_headings_stored_as_stage():
    """Every scene heading in the stress text is stored with
    `character=""` and `is_stage_direction=True`."""
    parsed = fallback_parse_script(PHYSICAL_STRESS_TEXT)
    headings = [
        ln for ln in parsed["lines"]
        if ln["is_stage_direction"] and "INT." in ln["text"] or (
            ln["is_stage_direction"] and "EXT." in ln["text"]
        )
    ]
    heading_texts = {ln["text"] for ln in headings}
    assert "1. INT. APARTMENT — NIGHT" in heading_texts
    assert "2. INT. KITCHEN — MORNING" in heading_texts
    assert "3. EXT. STREET — DAY" in heading_texts
    for ln in headings:
        assert ln["character"] == ""


def test_physical_stress_action_stored_as_stage():
    """Action prose between scene headings and character cues is
    stored as stage direction (character empty) — never as dialogue."""
    parsed = fallback_parse_script(PHYSICAL_STRESS_TEXT)
    action_texts = {
        ln["text"] for ln in parsed["lines"]
        if ln["is_stage_direction"] and "kettle" in ln["text"]
    }
    assert any("kettle clicks off" in t for t in action_texts)
    couch_texts = {
        ln["text"] for ln in parsed["lines"]
        if ln["is_stage_direction"] and "couch" in ln["text"]
    }
    assert any("Jack sits" in t for t in couch_texts)


# ---------------------------------------------------------------------------
# Layer 2 — parametrised boundary invariants.
# ---------------------------------------------------------------------------

BOUNDARY_INVARIANT_CASES = [
    pytest.param(
        # Numbered scene heading terminates dialogue.
        (
            "JACK\n"
            "This is my line.\n\n"
            "2. INT. KITCHEN — MORNING\n\n"
            "SARAH\n"
            "This is Sarah's line.\n"
        ),
        {"JACK": ["This is my line."], "SARAH": ["This is Sarah's line."]},
        id="numbered_scene",
    ),
    pytest.param(
        # Unnumbered scene heading terminates dialogue.
        (
            "JACK\n"
            "Line one.\n\n"
            "INT. KITCHEN — NIGHT\n\n"
            "SARAH\n"
            "Line two.\n"
        ),
        {"JACK": ["Line one."], "SARAH": ["Line two."]},
        id="unnumbered_scene",
    ),
    pytest.param(
        # INT/EXT slugline terminates dialogue.
        (
            "JACK\n"
            "Alpha.\n\n"
            "INT./EXT. CAR — NIGHT\n\n"
            "SARAH\n"
            "Beta.\n"
        ),
        {"JACK": ["Alpha."], "SARAH": ["Beta."]},
        id="int_ext_slug",
    ),
    pytest.param(
        # Transition terminates dialogue.
        (
            "JACK\n"
            "Original.\n\n"
            "CUT TO:\n\n"
            "SARAH\n"
            "Reply.\n"
        ),
        {"JACK": ["Original."], "SARAH": ["Reply."]},
        id="transition_cut_to",
    ),
    pytest.param(
        # Action after dialogue with intervening scene heading.
        (
            "JACK\n"
            "Hello.\n\n"
            "2. INT. ROOM\n\n"
            "A door slams. Sarah enters.\n\n"
            "SARAH\n"
            "Hi.\n"
        ),
        {"JACK": ["Hello."], "SARAH": ["Hi."]},
        id="action_after_scene",
    ),
    pytest.param(
        # Parenthetical between dialogue lines stays attached.
        (
            "JACK\n"
            "First line.\n"
            "(pausing)\n"
            "Second line.\n\n"
            "SARAH\n"
            "Reply.\n"
        ),
        {"JACK": ["First line.", "Second line."], "SARAH": ["Reply."]},
        id="parenthetical_between_dialogue",
    ),
    pytest.param(
        # Consecutive character cues — each character's line is only
        # theirs, no swallow of the following name.
        (
            "JACK\n"
            "Mine.\n\n"
            "SARAH\n"
            "Mine too.\n\n"
            "JACK\n"
            "Back to me.\n"
        ),
        {"JACK": ["Mine.", "Back to me."], "SARAH": ["Mine too."]},
        id="consecutive_dialogue",
    ),
    pytest.param(
        # Multi-line dialogue split across paragraphs still concatenates
        # to a single dialogue line for THAT character.
        (
            "JACK\n"
            "First sentence of a longer thought.\n"
            "Second sentence continuing.\n\n"
            "SARAH\n"
            "Reply.\n"
        ),
        {
            "JACK": [
                "First sentence of a longer thought. Second sentence continuing."
            ],
            "SARAH": ["Reply."],
        },
        id="multiparagraph_dialogue",
    ),
    pytest.param(
        # FADE OUT closes the last character's dialogue.
        (
            "JACK\n"
            "Final word.\n\n"
            "FADE OUT.\n"
        ),
        {"JACK": ["Final word."]},
        id="fade_out_terminates",
    ),
]


@pytest.mark.parametrize("raw,expected", BOUNDARY_INVARIANT_CASES)
def test_boundary_invariant(raw, expected):
    parsed = fallback_parse_script(raw)
    for name, expected_lines in expected.items():
        got = _dialogue_by(parsed, name)
        # Compare after `_repair` — trailing whitespace tolerated.
        got_stripped = [g.strip() for g in got]
        expected_stripped = [e.strip() for e in expected_lines]
        assert got_stripped == expected_stripped, (
            f"{name}: got {got_stripped!r}, want {expected_stripped!r}"
        )


# ---------------------------------------------------------------------------
# Layer 3 — end-to-end DOCX round-trip with the physical stress text.
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


def test_e2e_docx_dialogue_boundary_holds_after_extraction():
    """Round-trip the physical stress-test shape through a synthesised
    DOCX and confirm no character's dialogue leaks into another line's
    scene heading or action content."""
    blob = _synth_docx([
        _run("1. INT. APARTMENT — NIGHT"),
        _run("Jack sits on the couch. He looks tired."),
        _run("JACK"),
        _run("Hello there. I've been waiting."),
        _run("2. INT. KITCHEN — MORNING"),
        _run("A kettle clicks off. Sarah enters carrying two mugs. Jack looks at the clock."),
        _run("SARAH"),
        _run("You're not listening. We're running out of time, and I'll tell you exactly what happened."),
        _run("3. EXT. STREET — DAY"),
        _run("DET. HARRIS"),
        _run("This is disciplinary."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH", "DET. HARRIS"}
    sarah = _dialogue_by(parsed, "SARAH")
    assert sarah
    for line in sarah:
        for forbidden in ("INT.", "EXT.", "kettle", "carrying two mugs"):
            assert forbidden not in line, (line, forbidden)
    jack = _dialogue_by(parsed, "JACK")
    for line in jack:
        for forbidden in ("INT.", "EXT.", "kettle", "MORNING"):
            assert forbidden not in line, (line, forbidden)


# ---------------------------------------------------------------------------
# Layer 4 — TTS payload invariant.
# ---------------------------------------------------------------------------

def test_tts_payload_dialogue_is_pure_dialogue():
    """The TTS reads `line["text"]` for lines where `is_stage_direction`
    is False. This test asserts that after the fix, every non-stage
    line has a text that would be pronounced as pure dialogue — no
    scene numbers, no `INT.` / `EXT.` / `FADE` / `CUT TO` fragments,
    no obviously narrative action fragments like `kettle`, `Jack looks`,
    `door slams`."""
    parsed = fallback_parse_script(PHYSICAL_STRESS_TEXT)
    for ln in parsed["lines"]:
        if ln["is_stage_direction"]:
            continue
        text = ln["text"]
        for pattern in (
            "INT.", "EXT.", "FADE ", "CUT TO", "DISSOLVE",
            "SCENE ", "kettle clicks", "carrying two mugs",
        ):
            assert pattern not in text, (
                f"TTS payload for {ln['character']} contains {pattern!r}: {text!r}"
            )


def test_regression_word_boundary_repair_still_holds():
    """The Feb-2026 word-boundary repair (`kno w`, `nothinghappens`,
    `disciplinary .`) must not regress after the dialogue-boundary
    fix — combined-fix invariant."""
    text = (
        "1. INT. APARTMENT — NIGHT\n\n"
        "JACK\n"
        "I kno w what you mean. Nothinghappens today.\n\n"
        "2. INT. KITCHEN — MORNING\n\n"
        "SARAH\n"
        "You are disciplinary .\n"
    )
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"JACK", "SARAH"}
    jack = " ".join(_dialogue_by(parsed, "JACK"))
    sarah = " ".join(_dialogue_by(parsed, "SARAH"))
    assert "know" in jack
    assert ("nothing happens" in jack.lower())
    assert "disciplinary." in sarah
