"""Smart-join parser + rehearsal auto-scroll — focused physical-QA regression.

Locks two 2026-02 fixes reported from the Samsung SM-S918B / Android
16 QA build 1.0.47:

  Issue 1 — Rehearsal script movement:
    `frontend/app/rehearsal/[id].tsx` used a hardcoded
    `currentLineIndex * 80` scroll offset. Rendered script lines have
    variable height (short single-line dialogue ≈ 51 px, long wrapped
    dialogue ≈ 83+ px, stage direction ≈ 36 px), so the fixed stride
    cumulatively drifted the highlighted line off-screen. Fix:
    measured y via `<View onLayout>` into `lineYRef`.

  Issue 2 — Script text spacing (`w ant`, `unde rstand`, `isn 't`,
  `ne ver`, `y ou`):
    PDF/DOCX extraction produced intra-word newlines that
    `fallback_parse_script` then joined with `' '.join(...)`,
    converting mid-word newlines into mid-word spaces. Fix:
    `_smart_join_dialogue(fragments)` concatenates when both sides
    look mid-word, otherwise inserts a single space.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"
BACKEND = APP / "backend"

REHEARSAL = FRONTEND / "app/rehearsal/[id].tsx"

# Make `backend/server.py` importable so we can exercise the parser
# fixtures directly. The tests never hit the network.
sys.path.insert(0, str(BACKEND))
import server  # type: ignore[import-not-found]  # noqa: E402


# ───────────────────────────────────────────────────────────────────────
# Issue 2 — smart-join parser
# ───────────────────────────────────────────────────────────────────────


class TestSmartJoinDialogueObservedFixtures:
    """Every one of the five reports from the physical QA screenshot."""

    def test_w_ant(self):
        assert server._smart_join_dialogue(
            ["I don't w", "ant this."]
        ) == "I don't want this."

    def test_unde_rstand(self):
        assert server._smart_join_dialogue(["unde", "rstand"]) == "understand"

    def test_isn_t(self):
        assert server._smart_join_dialogue(["isn", "'t"]) == "isn't"

    def test_ne_ver(self):
        assert server._smart_join_dialogue(["ne", "ver"]) == "never"

    def test_y_ou(self):
        assert server._smart_join_dialogue(["y", "ou"]) == "you"


class TestSmartJoinDialogueWordBoundaries:
    """Legitimate word boundaries and punctuation continuations must
    still be joined with a single space."""

    def test_two_full_sentences(self):
        assert server._smart_join_dialogue(
            ["I said hello.", "Then I left."]
        ) == "I said hello. Then I left."

    def test_post_comma_continuation(self):
        # Comma is not in {letter, ', -}. Space required.
        assert server._smart_join_dialogue(
            ["He looked up,", "then walked away."]
        ) == "He looked up, then walked away."

    def test_period_then_uppercase_new_sentence(self):
        assert server._smart_join_dialogue(
            ["Fine.", "Whatever."]
        ) == "Fine. Whatever."

    def test_lowercase_then_uppercase_new_speaker_style(self):
        # Prev ends lowercase letter; next starts uppercase → still
        # a word boundary (not a mid-word wrap).
        assert server._smart_join_dialogue(
            ["yes", "Now"]
        ) == "yes Now"

    def test_hyphen_continuation_joins(self):
        # Hyphenated word wrap: "self-\naware" is a real style used by
        # some screenplay tools. Smart-join must concatenate cleanly.
        assert server._smart_join_dialogue(["self-", "aware"]) == "self-aware"


class TestSmartJoinDialogueEdgeCases:
    def test_empty_list(self):
        assert server._smart_join_dialogue([]) == ""

    def test_single_fragment(self):
        assert server._smart_join_dialogue(["only"]) == "only"

    def test_leading_empty_fragment(self):
        assert server._smart_join_dialogue(["", "x"]) == "x"

    def test_trailing_empty_fragment(self):
        assert server._smart_join_dialogue(["x", ""]) == "x"

    def test_none_like_middle_empty(self):
        # A stray empty fragment in the middle should not add a space
        # or corrupt the surrounding content.
        assert server._smart_join_dialogue(["a", "", "b"]) == "ab" or \
               server._smart_join_dialogue(["a", "", "b"]) == "a b"
        # The exact result is implementation-defined; the assertion
        # above accepts either sensible outcome. What matters is that
        # no `"a  b"` (double space) or crash occurs.
        joined = server._smart_join_dialogue(["a", "", "b"])
        assert "  " not in joined
        assert joined.startswith("a")
        assert joined.endswith("b")


class TestFallbackParseScriptEndToEnd:
    """Feed synthetic PDF-like `raw_text` with mid-word newlines and
    assert none of the observed artefacts survive to `lines[i].text`.
    """

    def test_synthetic_mid_word_wraps_are_cleaned(self):
        raw = (
            "JACK\n"
            "I don't w\n"
            "ant this.\n"
            "SARAH\n"
            "Y\n"
            "ou never unde\n"
            "rstand.\n"
        )
        parsed = server.fallback_parse_script(raw)
        assert set(parsed["characters"]) == {"JACK", "SARAH"}
        # First dialogue: JACK
        jack = next(l for l in parsed["lines"] if l["character"] == "JACK")
        assert jack["text"] == "I don't want this."
        # Second dialogue: SARAH — all three mid-word wraps repaired.
        sarah = next(l for l in parsed["lines"] if l["character"] == "SARAH")
        assert sarah["text"] == "You never understand."
        for artefact in ("w ant", "y ou", "unde rstand", "Y ou"):
            assert artefact not in sarah["text"]
            assert artefact not in jack["text"]

    def test_legitimate_multi_line_dialogue_preserved(self):
        # Two complete sentences on separate source lines must remain
        # separated by a single space in the joined output.
        raw = "JACK\nHello there.\nHow are you today?\n"
        parsed = server.fallback_parse_script(raw)
        assert (
            parsed["lines"][0]["text"] == "Hello there. How are you today?"
        )

    def test_stage_direction_flush_preserved(self):
        raw = (
            "JACK\n"
            "Line one contin\n"
            "ues here.\n"
            "(pausing)\n"
            "SARAH\n"
            "Okay.\n"
        )
        parsed = server.fallback_parse_script(raw)
        # Mid-word wrap repaired.
        jack = next(l for l in parsed["lines"] if l["character"] == "JACK")
        assert jack["text"] == "Line one continues here."
        # Stage direction preserved verbatim.
        stage = next(l for l in parsed["lines"] if l["is_stage_direction"])
        assert stage["text"] == "(pausing)"


# ───────────────────────────────────────────────────────────────────────
# Issue 1 — rehearsal auto-scroll source guard
# ───────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def rehearsal_src() -> str:
    return REHEARSAL.read_text()


class TestRehearsalAutoScrollSourceGuard:
    def test_hardcoded_80px_stride_is_gone(self, rehearsal_src: str) -> None:
        # Strip block and line comments before scanning so the fix's
        # own documentation ("hardcoded `currentLineIndex * 80`
        # scroll math which assumed…") doesn't false-positive.
        stripped = re.sub(r"/\*[\s\S]*?\*/", "", rehearsal_src)
        stripped = re.sub(r"//.*", "", stripped)
        assert "currentLineIndex * 80" not in stripped, (
            "Hardcoded currentLineIndex*80 scroll math must be gone — "
            "it caused the S23 Ultra rehearsal-scroll drift."
        )

    def test_line_y_ref_exists(self, rehearsal_src: str) -> None:
        assert re.search(
            r"const\s+lineYRef\s*=\s*useRef<Record<number,\s*number>>",
            rehearsal_src,
        ), "lineYRef must be declared as useRef<Record<number, number>>."

    def test_on_layout_populates_line_y_ref(self, rehearsal_src: str) -> None:
        # onLayout callback writes e.nativeEvent.layout.y into
        # lineYRef.current[index] for the mapped script-line View.
        assert re.search(
            r"onLayout=\{\(e\)\s*=>\s*\{[\s\S]*?"
            r"lineYRef\.current\[index\]\s*=\s*e\.nativeEvent\.layout\.y",
            rehearsal_src,
        ), (
            "onLayout must populate lineYRef.current[index] from "
            "e.nativeEvent.layout.y."
        )

    def test_auto_scroll_reads_measured_y(self, rehearsal_src: str) -> None:
        assert re.search(
            r"lineYRef\.current\[currentLineIndex\]",
            rehearsal_src,
        ), "Auto-scroll effect must read lineYRef.current[currentLineIndex]."
        assert re.search(
            r"scrollViewRef\.current\??\.scrollTo\(\{[\s\S]*?y:\s*target",
            rehearsal_src,
        ), (
            "Auto-scroll must call scrollTo({ y: target, ... }) with a "
            "value derived from the measured lineYRef reading."
        )

    def test_animated_scrolling_preserved(self, rehearsal_src: str) -> None:
        assert re.search(
            r"scrollViewRef\.current\??\.scrollTo\(\{[\s\S]*?animated:\s*true",
            rehearsal_src,
        ), "Auto-scroll must remain animated: true."

    def test_missing_measurement_bails_safely(self, rehearsal_src: str) -> None:
        """If the current line has no measurement yet the effect must
        bail rather than crashing or scrolling to `undefined`."""
        assert re.search(
            r"if\s*\(typeof\s+y\s*!==\s*['\"]number['\"]\)\s*return",
            rehearsal_src,
        ), (
            "Auto-scroll effect must safely skip when the current "
            "line's y is not yet a number."
        )


# ───────────────────────────────────────────────────────────────────────
# Issue 1 — deterministic synthetic mixed-height scroll target check.
# Pure math (no React runtime) — validates the algorithm using the
# heights the physical device reports.
# ───────────────────────────────────────────────────────────────────────


def _synthetic_layout(lines_kinds: list) -> list:
    """Return cumulative y-positions for a mixed-height script.

    Heights modelled from the physical Samsung S23 Ultra rendering:
        'short'  →  51 px (single-line dialogue)
        'long'   →  83 px (multi-line wrapped dialogue)
        'stage'  →  36 px (stage direction)
    """
    heights = {"short": 51, "long": 83, "stage": 36}
    ys: list = []
    y = 0
    for kind in lines_kinds:
        ys.append(y)
        y += heights[kind]
    return ys


def _target_for(y: float) -> float:
    """Mirror the effect's `Math.max(0, y - 80)` math."""
    return max(0.0, y - 80)


class TestAutoScrollTargetAlgorithm:
    def test_targets_are_valid_for_every_line(self) -> None:
        # 33-line mixed pattern loosely matching a typical scene.
        kinds = (
            ["short", "long", "stage", "short", "short", "long"] * 5
            + ["short", "long", "stage"]
        )
        assert len(kinds) == 33
        ys = _synthetic_layout(kinds)
        for i, y in enumerate(ys):
            t = _target_for(y)
            assert t >= 0, f"Line {i}: negative scroll target {t}."
            assert t <= y, (
                f"Line {i}: target {t} must be <= line y {y} so the "
                f"line sits below the top of the viewport."
            )

    def test_targets_are_monotonic_non_decreasing(self) -> None:
        kinds = ["short", "long", "stage", "short", "long"] * 6
        ys = _synthetic_layout(kinds)
        targets = [_target_for(y) for y in ys]
        for i in range(1, len(targets)):
            assert targets[i] >= targets[i - 1], (
                f"Scroll targets must be monotonic non-decreasing; "
                f"broke at index {i}: {targets[i - 1]} -> {targets[i]}."
            )

    def test_targets_stay_within_content_bounds(self) -> None:
        kinds = ["short"] * 40 + ["long"] * 10
        ys = _synthetic_layout(kinds)
        # Compute total content size.
        total_content = ys[-1] + 83  # last line height
        for i, y in enumerate(ys):
            t = _target_for(y)
            assert t <= total_content, (
                f"Line {i} scroll target {t} exceeds contentSize "
                f"{total_content}."
            )

    def test_old_fixed_stride_would_have_drifted(self) -> None:
        """Sanity check documenting *why* the fix is needed."""
        kinds = ["short"] * 20
        ys = _synthetic_layout(kinds)
        old_target_for_last = 19 * 80          # 1520 — old algorithm
        actual_y_for_last = ys[19]             # 969  — real position
        drift = old_target_for_last - actual_y_for_last
        assert drift > 400, (
            "Sanity: the old fixed-stride math should drift the "
            "highlight well off-screen (> 400 px) after 20 short "
            "lines. If this assertion fails, the model or the fix "
            "changed."
        )
