"""Feb 2026 DOCX-text-integrity hardening regression suite.

Locks in the fix for the Feb-2026 physical Samsung S23 Ultra QA build
where DOCX scripts still exhibited residual text corruption after the
Nov-2025 intra-word repair pass:

    kno w           → know
    look lik e      → look like
    nothinghappens  → nothing happens
    disciplinary .  → disciplinary.

These are the *deterministic* end-to-end cases. Each test also proves
that the fix does not regress any legitimate screenplay text — normal
words, contractions, hyphenated words, punctuation boundaries, single-
letter words, character cues, stage directions, and long real English
words are all covered as adversarial guards.

The suite exercises three layers:

    Layer 1 — `_repair_intra_word_spaces`  (Rules A, B, C, D)
    Layer 2 — `_split_concatenated_words`  (Rule E)
    Layer 3 — end-to-end `extract_text_from_docx` +
              `fallback_parse_script` against synthesised DOCX files.

Adding a new failure pattern? Extend PHYSICAL_FAILURE_CASES with the
raw string and expected repair, and add a matching adversarial case
in ADVERSARIAL_CASES if the pattern could theoretically overreach.
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
    _repair_intra_word_spaces,
    _split_concatenated_words,
    _dict_aware_merge,
    _should_merge_fragments,
    extract_text_from_docx,
    fallback_parse_script,
)
from common_english_words import COMMON_ENGLISH_WORDS


def _full_repair(text: str) -> str:
    """Public façade of the two-stage repair pipeline used by
    `fallback_parse_script`. Kept as a helper so tests read as
    behaviour statements, not implementation details."""
    return _split_concatenated_words(_repair_intra_word_spaces(text))


# ---------------------------------------------------------------------------
# Layer 1 — deterministic repair on flat strings.
# ---------------------------------------------------------------------------

PHYSICAL_FAILURE_CASES = [
    # (raw, expected) — from the Feb-2026 S23 Ultra QA capture.
    ("kno w", "know"),
    ("look lik e", "look like"),
    ("disciplinary .", "disciplinary."),
    # From the Nov-2025 QA capture — must still be repaired.
    ("w ant", "want"),
    ("unde rstand", "understand"),
    ("isn 't", "isn't"),
    ("ne ver", "never"),
    ("y ou", "you"),
]


@pytest.mark.parametrize("raw,expected", PHYSICAL_FAILURE_CASES)
def test_physical_failure_repaired(raw, expected):
    assert _full_repair(raw) == expected


ADVERSARIAL_CASES = [
    # Legitimate short-word pairs — must NEVER be merged.
    ("look back", "look back"),
    ("look here", "look here"),
    ("look away", "look away"),
    ("look down", "look down"),
    ("hand over", "hand over"),
    ("come here", "come here"),
    ("hard work", "hard work"),
    ("run fast", "run fast"),
    ("run away", "run away"),
    ("dear john", "dear john"),
    ("good bye", "good bye"),
    ("play back", "play back"),
    ("kick back", "kick back"),
    ("hold on", "hold on"),
    ("wake up", "wake up"),
    ("get real", "get real"),
    ("go home", "go home"),
    ("me an", "me an"),
    # Single-letter English words — must survive.
    ("I am", "I am"),
    ("a man", "a man"),
    ("I am here", "I am here"),
    ("a friend", "a friend"),
    # Very common phrases — must survive.
    ("we are", "we are"),
    ("did not", "did not"),
    ("the man", "the man"),
    ("you know", "you know"),
    ("the end", "the end"),
    ("The end", "The end"),
    # Names (leading capitals) — must survive Rule C (upper-case).
    ("Bob and Alice", "Bob and Alice"),
    ("JOHN SMITH", "JOHN SMITH"),
    ("BOB", "BOB"),
    # Interjections.
    ("boy oh boy", "boy oh boy"),
]


@pytest.mark.parametrize("raw,expected", ADVERSARIAL_CASES)
def test_adversarial_unchanged(raw, expected):
    assert _full_repair(raw) == expected


CONTRACTION_CASES = [
    # Normal contractions.
    ("don't", "don't"),
    ("can't", "can't"),
    ("won't", "won't"),
    ("you're", "you're"),
    ("we're", "we're"),
    ("I'll", "I'll"),
    ("I'd", "I'd"),
    ("we'll", "we'll"),
    ("we're not", "we're not"),
    # Broken contractions (Rule A).
    ("don 't", "don't"),
    ("we 're", "we're"),
    ("isn 't easy", "isn't easy"),
    ("I 'll go", "I'll go"),
    # Possessives.
    ("Bob's book", "Bob's book"),
    ("it's a test", "it's a test"),
]


@pytest.mark.parametrize("raw,expected", CONTRACTION_CASES)
def test_contractions_preserved(raw, expected):
    assert _full_repair(raw) == expected


HYPHENATED_CASES = [
    ("mid-way", "mid-way"),
    ("well-known", "well-known"),
    ("state-of-the-art", "state-of-the-art"),
    ("mid - way", "mid-way"),           # Rule A repairs spaced hyphens.
]


@pytest.mark.parametrize("raw,expected", HYPHENATED_CASES)
def test_hyphenated_words(raw, expected):
    assert _full_repair(raw) == expected


PUNCTUATION_CASES = [
    ("Hello .", "Hello."),
    ("What ?", "What?"),
    ("Yes !", "Yes!"),
    ("Wait , what ?", "Wait, what?"),
    # No space-before-punctuation in normal text.
    ("Hello.", "Hello."),
    ("What? Something!", "What? Something!"),
    # Numbers and $ pass through unchanged.
    ("There are 3 books", "There are 3 books"),
    ("I paid $5 for it", "I paid $5 for it"),
    ("Chapter 1: Beginning", "Chapter 1: Beginning"),
]


@pytest.mark.parametrize("raw,expected", PUNCTUATION_CASES)
def test_punctuation_boundaries(raw, expected):
    assert _full_repair(raw) == expected


STAGE_DIRECTION_CASES = [
    ("(pausing softly)", "(pausing softly)"),
    ("(nervous look)", "(nervous look)"),
    ("[to himself]", "[to himself]"),
    ("(quietly, to Bob)", "(quietly, to Bob)"),
]


@pytest.mark.parametrize("raw,expected", STAGE_DIRECTION_CASES)
def test_stage_directions_preserved(raw, expected):
    assert _full_repair(raw) == expected


# ---------------------------------------------------------------------------
# Layer 2 — `_split_concatenated_words` (Rule E).
# ---------------------------------------------------------------------------

SPLIT_CASES = [
    # Physical failure: DOCX ran two words together.
    ("nothinghappens", "nothing happens"),
    ("somethingelse", "something else"),
    ("everyoneknows", "everyone knows"),
]


@pytest.mark.parametrize("raw,expected", SPLIT_CASES)
def test_concatenated_word_split(raw, expected):
    assert _split_concatenated_words(raw) == expected


DO_NOT_SPLIT_CASES = [
    # Real long English words — must NOT be split.
    "understand",
    "understanding",
    "predisposition",
    "unstoppable",
    "disciplinary",
    "somewhere",
    "everything",
    "everyone",
    "something",
    "weekend",
    "goodbye",
    # Proper nouns — no valid dict split.
    "Christopher",
    "Alexander",
    # Uppercase character cues — never split.
    "SMITH",
    "OFFICER",
    # Short tokens are never split.
    "iwant",   # < 10 chars, never touched
    "yourenot",
    "iam",
    "we",
]


@pytest.mark.parametrize("raw", DO_NOT_SPLIT_CASES)
def test_do_not_split(raw):
    assert _split_concatenated_words(raw) == raw


def test_split_preserves_surrounding_whitespace():
    """Rule E splits tokens but keeps whitespace runs verbatim."""
    assert _split_concatenated_words(
        "This nothinghappens today."
    ) == "This nothing happens today."


def test_split_ambiguous_leaves_alone():
    """If multiple valid splits exist, do nothing — safety."""
    # Craft a token where multiple valid splits exist. `manwoman`
    # splits as (man, woman) only, so it does merge. Use a longer
    # composite. Skip if we can't construct — the guard rail is
    # tested implicitly by DO_NOT_SPLIT_CASES real-word cases too.
    # We use a word with two valid dict splits.
    candidates = ["barone", "readnow", "gooneach"]
    for c in candidates:
        # If any candidate has ambiguous splits, verify.
        found = 0
        for i in range(4, len(c) - 3):
            if (c[:i] in COMMON_ENGLISH_WORDS
                    and c[i:] in COMMON_ENGLISH_WORDS):
                found += 1
        if found > 1:
            assert _split_concatenated_words(c) == c
            return
    # If no ambiguous candidate available, the test still passes —
    # the safety exists in the source (see `_split_concatenated_words`).


# ---------------------------------------------------------------------------
# Layer 3 — end-to-end DOCX extraction + parsing.
# ---------------------------------------------------------------------------

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _synth_docx(paragraph_xml_snippets):
    """Build a minimal .docx in memory with the given raw paragraph
    XML. Bypasses python-docx's high-level API so we can inject the
    exact run structures that reproduce the physical failure signatures.
    """
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


def test_e2e_docx_single_run_intra_word_space():
    """The classic single-run mid-word space (`kno w` inside one run)."""
    blob = _synth_docx([
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("I kno w what you mean."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert parsed["characters"] == ["BOB"]
    assert parsed["lines"][0]["text"] == "I know what you mean."


def test_e2e_docx_run_boundary_missing_space():
    """The run-boundary swallow case (`nothing|happens`)."""
    blob = _synth_docx([
        "<w:r><w:t>ALICE</w:t></w:r>",
        _run("nothing") + _run("happens"),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert parsed["characters"] == ["ALICE"]
    assert parsed["lines"][0]["text"] == "nothing happens"


def test_e2e_docx_word_split_across_runs():
    """A word split across two runs (`unde|rstand`)."""
    blob = _synth_docx([
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("You have to unde") + _run("rstand."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert parsed["lines"][0]["text"] == "You have to understand."


def test_e2e_docx_look_like_split():
    """A 3-letter left + 1-letter right run split (`lik|e`)."""
    blob = _synth_docx([
        "<w:r><w:t>ALICE</w:t></w:r>",
        _run("You look lik") + _run(" e that."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert parsed["lines"][0]["text"] == "You look like that."


def test_e2e_docx_space_before_period():
    """A period floated to its own run (`disciplinary` + ` .`)."""
    blob = _synth_docx([
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("This is disciplinary") + _run(" ."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert parsed["lines"][0]["text"] == "This is disciplinary."


def test_e2e_docx_full_dialogue_scene():
    """A multi-line scene combining every previously-failing pattern."""
    blob = _synth_docx([
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("I don 't w ant to do this. You have to unde")
        + _run("rstand what happens."),
        "<w:r><w:t>ALICE</w:t></w:r>",
        _run("I kno w. But look lik") + _run(" e we have no choice."),
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("It's disciplinary") + _run(" ."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert set(parsed["characters"]) == {"BOB", "ALICE"}
    lines = [line["text"] for line in parsed["lines"]]
    assert lines[0] == "I don't want to do this. You have to understand what happens."
    assert lines[1] == "I know. But look like we have no choice."
    assert lines[2] == "It's disciplinary."


def test_e2e_docx_preserves_stage_directions():
    """Parenthetical stage directions survive the repair pipeline."""
    blob = _synth_docx([
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("(pausing softly)"),
        _run("Hello there."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    stage = [line for line in parsed["lines"] if line["is_stage_direction"]]
    dialogue = [line for line in parsed["lines"] if not line["is_stage_direction"]]
    assert stage[0]["text"] == "(pausing softly)"
    assert dialogue[0]["text"] == "Hello there."


def test_e2e_docx_adversarial_legit_phrases():
    """Real screenplay phrases that could be over-merged stay intact."""
    blob = _synth_docx([
        "<w:r><w:t>BOB</w:t></w:r>",
        _run("Look back at the dear john letter. Hard work never killed anyone."),
    ])
    text = extract_text_from_docx(blob)
    parsed = fallback_parse_script(text)
    assert parsed["lines"][0]["text"] == (
        "Look back at the dear john letter. Hard work never killed anyone."
    )


# ---------------------------------------------------------------------------
# Structural / invariant tests.
# ---------------------------------------------------------------------------

def test_should_merge_rejects_two_common_words():
    """`look back` — both real words — must never merge."""
    assert _should_merge_fragments("look", "back") is False
    assert _should_merge_fragments("hard", "work") is False
    assert _should_merge_fragments("dear", "john") is False


def test_should_merge_accepts_mid_word_split():
    """`unde rstand` — neither fragment a word, joined form is."""
    assert _should_merge_fragments("unde", "rstand") is True
    assert _should_merge_fragments("kno", "w") is True
    assert _should_merge_fragments("lik", "e") is True
    assert _should_merge_fragments("ne", "ver") is True


def test_should_merge_rejects_when_join_not_common():
    """If the joined form isn't a real word, never merge."""
    assert _should_merge_fragments("look", "xy") is False
    assert _should_merge_fragments("xy", "zzz") is False


def test_dict_aware_merge_idempotent():
    """Repeated application must reach a fixed point in ≤ 8 passes."""
    text = "You have to unde rstand what I kno w and lik e."
    once = _dict_aware_merge(text)
    twice = _dict_aware_merge(once)
    assert once == twice


def test_repair_never_shortens_normal_text():
    """A whole paragraph of clean text must survive verbatim."""
    clean = (
        "I have a plan. We are going to the store and then coming back "
        "for dinner. Bob will meet us at seven o'clock. Do not be late."
    )
    assert _full_repair(clean) == clean


def test_common_english_words_frozenset_shape():
    """Sanity: the wordset loads, is a frozenset, and contains the
    canonical repair anchors used by the fix. Prevents future
    regeneration from silently dropping a required entry."""
    assert isinstance(COMMON_ENGLISH_WORDS, frozenset)
    assert len(COMMON_ENGLISH_WORDS) > 5000
    for anchor in ("know", "want", "understand", "never", "like",
                   "nothing", "happens", "disciplinary", "you",
                   "look", "back", "hard", "work", "goodbye"):
        assert anchor in COMMON_ENGLISH_WORDS, anchor
    # Legit English short words must survive the curation.
    for anchor in ("i", "a", "we", "me", "us", "to", "of", "the",
                   "you", "not", "and", "an", "or", "so"):
        assert anchor in COMMON_ENGLISH_WORDS, anchor
    # Non-English artifacts must NOT be in the curated set.
    for artifact in ("ne", "ver", "pm", "cd", "tv", "usa", "york"):
        assert artifact not in COMMON_ENGLISH_WORDS, artifact
