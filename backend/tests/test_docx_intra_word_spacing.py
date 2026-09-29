"""DOCX intra-word spacing repair — focused physical-QA regression.

Locks the 2026-02 two-layer fix for the confirmed DOCX intra-word
spacing defect on Samsung SM-S918B build 1.0.47:

  Layer 1 — `_normalize_docx_whitespace(s)` canonicalises every
  DOCX-side non-newline whitespace variant (`\\t`, `\\xa0`, `\\u2007`,
  `\\u202f`) into a regular space, and strips zero-width space
  (`\\u200b`).

  Layer 2 — `_repair_intra_word_spaces(text)` deterministically
  merges the three observed corruption patterns per source line:
  apostrophe/hyphen glue, single-letter non-vowel prefix, and short-
  fragment with stopword guard.

Together these repair every artefact reported by the physical QA run
(`isn 't`, `w anto`, `unde rstand`, `w hat`, `don 't`, `we 're`,
`mid - way`, `w ant`, `y ou`, `ne ver`) without disturbing legitimate
dialogue phrases (`a bike`, `I said`, `the man`, `did not`,
`you know`, `say hello`, `how are`, `o my king`).
"""

from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import pytest

APP = Path("/app")
BACKEND = APP / "backend"

sys.path.insert(0, str(BACKEND))
import server  # type: ignore[import-not-found]  # noqa: E402


# ───────────────────────────────────────────────────────────────────────
# Layer 1 — `_normalize_docx_whitespace`
# ───────────────────────────────────────────────────────────────────────


class TestNormalizeDocxWhitespace:
    def test_tab_becomes_regular_space(self):
        assert server._normalize_docx_whitespace("a\tb") == "a b"

    def test_nbsp_becomes_regular_space(self):
        assert server._normalize_docx_whitespace("a\xa0b") == "a b"

    def test_figure_space_becomes_regular_space(self):
        assert server._normalize_docx_whitespace("a\u2007b") == "a b"

    def test_narrow_nbsp_becomes_regular_space(self):
        assert server._normalize_docx_whitespace("a\u202fb") == "a b"

    def test_zero_width_space_is_removed_not_spaced(self):
        assert server._normalize_docx_whitespace("a\u200bb") == "ab"

    def test_newline_is_preserved(self):
        assert server._normalize_docx_whitespace("a\nb") == "a\nb"

    def test_empty_string_safe(self):
        assert server._normalize_docx_whitespace("") == ""

    def test_regular_text_unchanged(self):
        assert server._normalize_docx_whitespace("Hello world.") == "Hello world."

    def test_mixed_variants_all_normalised(self):
        raw = "isn\ta\xa0b\u200bc\u2007d\u202fe"
        assert server._normalize_docx_whitespace(raw) == "isn a bc d e"


# ───────────────────────────────────────────────────────────────────────
# Layer 2 — `_repair_intra_word_spaces` — Rule A (apostrophe/hyphen)
# ───────────────────────────────────────────────────────────────────────


class TestRepairApostropheHyphenGlue:
    def test_isn_t(self):
        assert server._repair_intra_word_spaces("isn 't") == "isn't"

    def test_don_t(self):
        assert server._repair_intra_word_spaces("don 't") == "don't"

    def test_we_re(self):
        assert server._repair_intra_word_spaces("we 're") == "we're"

    def test_mid_way_spaced_hyphen(self):
        assert server._repair_intra_word_spaces("mid - way") == "mid-way"

    def test_apostrophe_glue_in_full_sentence(self):
        assert (
            server._repair_intra_word_spaces("She isn 't ready and don 't lie.")
            == "She isn't ready and don't lie."
        )


# ───────────────────────────────────────────────────────────────────────
# Layer 2 — Rule B (single-letter non-vowel prefix)
# ───────────────────────────────────────────────────────────────────────


class TestRepairSingleLetterPrefix:
    def test_w_hat(self):
        assert server._repair_intra_word_spaces("w hat") == "what"

    def test_w_ant(self):
        assert server._repair_intra_word_spaces("w ant") == "want"

    def test_w_anto(self):
        assert server._repair_intra_word_spaces("w anto") == "wanto"

    def test_y_ou(self):
        assert server._repair_intra_word_spaces("y ou") == "you"

    def test_single_letter_prefix_in_sentence(self):
        assert (
            server._repair_intra_word_spaces("y ou w ant this")
            == "you want this"
        )

    # Negative controls — legitimate short-word phrases must survive.
    def test_a_bike_unchanged(self):
        assert server._repair_intra_word_spaces("a bike") == "a bike"

    def test_I_said_unchanged(self):
        assert server._repair_intra_word_spaces("I said") == "I said"

    def test_o_my_king_unchanged(self):
        assert server._repair_intra_word_spaces("o my king") == "o my king"


# ───────────────────────────────────────────────────────────────────────
# Layer 2 — Rule C (short-fragment merge with stopword guard)
# ───────────────────────────────────────────────────────────────────────


class TestRepairShortFragmentMerge:
    def test_unde_rstand(self):
        assert server._repair_intra_word_spaces("unde rstand") == "understand"

    def test_ne_ver(self):
        assert server._repair_intra_word_spaces("ne ver") == "never"

    def test_repair_in_sentence(self):
        assert (
            server._repair_intra_word_spaces(
                "You unde rstand what I ne ver said."
            )
            == "You understand what I never said."
        )

    # Negative controls — legitimate stopword-anchored phrases untouched.
    @pytest.mark.parametrize(
        "phrase",
        [
            "the man",
            "did not",
            "you know",
            "say hello",
            "how are",
            "she was",
            "his own",
            "our own",
            "get out",
            "say see",
            "who has",
            "why not",
            "let me",
            "our new",
            "was one",
            "not far",
            "way off",
        ],
    )
    def test_stopword_anchored_pairs_unchanged(self, phrase):
        assert server._repair_intra_word_spaces(phrase) == phrase


# ───────────────────────────────────────────────────────────────────────
# Stage directions and character cues must pass through unchanged
# ───────────────────────────────────────────────────────────────────────


class TestPassThroughInvariants:
    @pytest.mark.parametrize(
        "text",
        [
            "(pausing softly)",
            "(He looks at her)",
            "(quietly, into the phone)",
            "(beat)",
            "JACK",
            "SARAH-BEATRICE",
            "MR. JONES",
        ],
    )
    def test_stage_directions_and_character_cues_untouched(self, text):
        assert server._repair_intra_word_spaces(text) == text

    def test_empty_string_safe(self):
        assert server._repair_intra_word_spaces("") == ""


# ───────────────────────────────────────────────────────────────────────
# In-memory DOCX fixtures — the exact shapes traced in the RCA
# ───────────────────────────────────────────────────────────────────────


def _build_docx(paragraph_xml: str) -> bytes:
    """Return DOCX bytes containing exactly one paragraph with the given
    inner XML. Uses the minimal .docx skeleton python-docx accepts."""
    doc_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/'
        'wordprocessingml/2006/main">\n'
        "  <w:body>\n"
        f"    {paragraph_xml}\n"
        "    <w:sectPr/>\n"
        "  </w:body>\n"
        "</w:document>"
    )
    ctypes = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
        'content-types">\n'
        '  <Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.'
        'relationships+xml"/>\n'
        '  <Default Extension="xml" ContentType="application/xml"/>\n'
        '  <Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.'
        'wordprocessingml.document.main+xml"/>\n'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/'
        'package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/'
        'officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>\n'
        "</Relationships>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ctypes)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc_xml)
    return buf.getvalue()


# Paragraph XML shapes matching the four DOCX-side origins traced in the
# investigation. Each embeds an intra-word artefact between "isn" and "'t".
DOCX_SHAPE_A = (
    # Literal space inside <w:t xml:space="preserve">
    '<w:p><w:r><w:t xml:space="preserve">isn </w:t></w:r>'
    "<w:r><w:t>'t</w:t></w:r></w:p>"
)
DOCX_SHAPE_B = (
    # <w:tab/> between mid-word runs
    "<w:p><w:r><w:t>isn</w:t></w:r>"
    "<w:r><w:tab/></w:r>"
    "<w:r><w:t>'t</w:t></w:r></w:p>"
)
DOCX_SHAPE_D = (
    # Non-breaking space \xa0 inside run text
    '<w:p><w:r><w:t xml:space="preserve">isn\xa0\'t</w:t></w:r></w:p>'
)
DOCX_SHAPE_G = (
    # Three runs with a whitespace-only middle run
    "<w:p><w:r><w:t>isn</w:t></w:r>"
    '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
    "<w:r><w:t>'t</w:t></w:r></w:p>"
)


class TestDocxExtractionEndToEnd:
    """Build in-memory DOCXs of every shape and verify
    `extract_text_from_docx` → `fallback_parse_script` produces the
    clean `"isn't"` output."""

    @pytest.mark.parametrize(
        "shape_id, paragraph_xml",
        [
            ("A_literal_space_preserve", DOCX_SHAPE_A),
            ("B_wtab_between_runs", DOCX_SHAPE_B),
            ("D_nbsp_in_run_text", DOCX_SHAPE_D),
            ("G_whitespace_only_middle_run", DOCX_SHAPE_G),
        ],
    )
    def test_each_docx_shape_extracts_clean_isnt(self, shape_id, paragraph_xml):
        # We wrap the artefact paragraph in a dialogue context so
        # fallback_parse_script recognises a character cue and stores
        # the fixed dialogue line.
        docx_body = (
            "<w:p><w:r><w:t>JACK</w:t></w:r></w:p>\n"
            f"    {paragraph_xml}"
        )
        docx_bytes = _build_docx(docx_body)
        raw_text = server.extract_text_from_docx(docx_bytes)
        # Layer 1 must have normalised any non-newline whitespace variant.
        # Only regular ASCII space (0x20) or newline should remain.
        for ch in raw_text:
            assert ch in " \n" or not ch.isspace(), (
                f"Shape {shape_id}: unexpected whitespace char "
                f"0x{ord(ch):04x} survived Layer 1"
            )
        parsed = server.fallback_parse_script(raw_text)
        dialogue = [
            ln for ln in parsed["lines"]
            if ln["character"] == "JACK" and not ln["is_stage_direction"]
        ]
        assert dialogue, f"Shape {shape_id}: no JACK dialogue parsed."
        assert dialogue[0]["text"] == "isn't", (
            f"Shape {shape_id}: expected 'isn\\'t', "
            f"got {dialogue[0]['text']!r}"
        )


# ───────────────────────────────────────────────────────────────────────
# `fallback_parse_script` end-to-end on the full observed pattern set
# ───────────────────────────────────────────────────────────────────────


class TestFallbackParseScriptWithArtefactSentences:
    def test_all_confirmed_docx_artefacts_repaired(self):
        raw = (
            "JACK\n"
            "I don 't w ant this and you unde rstand isn 't easy.\n"
            "SARAH\n"
            "Y ou w hat? I ne ver said that.\n"
            "MARY\n"
            "Try the mid - way path.\n"
        )
        parsed = server.fallback_parse_script(raw)
        jack = next(ln for ln in parsed["lines"] if ln["character"] == "JACK")
        sarah = next(ln for ln in parsed["lines"] if ln["character"] == "SARAH")
        mary = next(ln for ln in parsed["lines"] if ln["character"] == "MARY")
        assert jack["text"] == (
            "I don't want this and you understand isn't easy."
        ), jack["text"]
        assert sarah["text"] == "You what? I never said that.", sarah["text"]
        assert mary["text"] == "Try the mid-way path.", mary["text"]

    def test_legitimate_dialogue_untouched(self):
        raw = (
            "JACK\n"
            "The man did not know you.\n"
            "SARAH\n"
            "Say hello. How are you?\n"
            "MARY\n"
            "I said a bike and o my king.\n"
        )
        parsed = server.fallback_parse_script(raw)
        outputs = {ln["character"]: ln["text"] for ln in parsed["lines"]}
        assert outputs["JACK"] == "The man did not know you."
        assert outputs["SARAH"] == "Say hello. How are you?"
        assert outputs["MARY"] == "I said a bike and o my king."


# ───────────────────────────────────────────────────────────────────────
# `_smart_join_dialogue` regression — must still fire for PDF-style
# newline-split fragments, unchanged by the DOCX fix.
# ───────────────────────────────────────────────────────────────────────


class TestSmartJoinDialogueStillWorks:
    def test_w_ant_across_newline(self):
        assert (
            server._smart_join_dialogue(["I don't w", "ant this."])
            == "I don't want this."
        )

    def test_unde_rstand_across_newline(self):
        assert server._smart_join_dialogue(["unde", "rstand"]) == "understand"

    def test_isn_t_across_newline(self):
        assert server._smart_join_dialogue(["isn", "'t"]) == "isn't"

    def test_y_ou_across_newline(self):
        assert server._smart_join_dialogue(["y", "ou"]) == "you"

    def test_ne_ver_across_newline(self):
        assert server._smart_join_dialogue(["ne", "ver"]) == "never"

    def test_word_boundary_preserved(self):
        assert (
            server._smart_join_dialogue(["I said hello.", "Then I left."])
            == "I said hello. Then I left."
        )


# ───────────────────────────────────────────────────────────────────────
# Stage directions preserved end-to-end inside fallback_parse_script
# ───────────────────────────────────────────────────────────────────────


class TestStageDirectionsEndToEnd:
    def test_stage_direction_line_preserved_verbatim(self):
        raw = (
            "JACK\n"
            "Hello.\n"
            "(pausing softly, then continues)\n"
            "JACK\n"
            "How are you?\n"
        )
        parsed = server.fallback_parse_script(raw)
        stage = [ln for ln in parsed["lines"] if ln["is_stage_direction"]]
        assert len(stage) == 1
        assert stage[0]["text"] == "(pausing softly, then continues)"
