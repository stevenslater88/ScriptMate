"""Rehearsal speech scoring (Jun 2026).

Root causes addressed in frontend/app/rehearsal/[id].tsx + services/rehearsalScoring.ts:
1. The post-line "% match" was only rendered for lines that did NOT auto-advance (a passing
   line reset the score to 0 first), so users only ever saw failed attempts (< ~65%).
2. Android ends a recognition session at a pause and the mic re-arms; the new session's
   fragment was scored alone against the whole line. Finalised text is now carried over.
3. Harmless recogniser formatting (contractions, digits, ok/okay, Mr/Dr, dashes/ellipses
   gluing words) lowered the score. Normalisation now treats these as equal.
The weighted similarity formula and the 65%/60%/85% advance thresholds are unchanged."""
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parents[1] / "frontend"
HARNESS = HERE / "fixtures/rehearsal_scoring_harness.js"
SCREEN = (FRONTEND / "app/rehearsal/[id].tsx").read_text()


def _call(*calls):
    payload = json.dumps([{"fn": fn, "args": list(args)} for fn, *args in calls])
    out = subprocess.run(["node", str(HARNESS), payload], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def sim(spoken, expected):
    return _call(("calculateSimilarity", spoken, expected))[0]


LINE = "I don't know what you want from me, Sarah."
LONG = ("Nobody touches the snack cupboard until midnight, and if I catch any of you "
        "near it before then, you'll be washing dishes for a month.")


def test_exact_transcript_scores_full():
    assert sim(LINE, LINE) == 1


def test_punctuation_and_capitalisation_ignored():
    assert sim("i don't know what you want from me sarah", LINE) == 1
    assert sim("I DON'T KNOW WHAT YOU WANT FROM ME SARAH!!!", LINE) == 1


def test_contractions_equivalent():
    assert sim("I do not know what you want from me Sarah", LINE) == 1
    assert sim("I am not going anywhere", "I'm not going anywhere.") == 1
    assert sim("im not going anywhere", "I'm not going anywhere.") == 1
    assert sim("we will see", "We\u2019ll see.") == 1
    assert sim("it is over", "It's over.") == 1


def test_digits_and_common_recogniser_spellings():
    assert sim("we have 2 hours before the guards change", "We have two hours before the guards change.") == 1
    assert sim("twenty one days", "21 days") == 1
    assert sim("ok", "Okay.") == 1
    assert sim("mister henderson is waiting", "Mr. Henderson is waiting.") == 1


def test_dashes_and_ellipses_do_not_glue_words():
    assert sim("wait what are you doing", "Wait\u2014what are you doing?") == 1
    assert sim("i i cant do this", "I...I can't do this.") == 1


def test_one_omitted_word_penalised_but_high():
    s = sim("I don't know what you want from Sarah", LINE)
    assert 0.8 <= s < 1


def test_one_substituted_word_penalised():
    s = sim("I don't know what you need from me Sarah", LINE)
    assert 0.75 <= s < 1


def test_one_additional_word_penalised():
    s = sim("I really don't know what you want from me Sarah", LINE)
    assert 0.8 <= s < 1


def test_substantially_wrong_line_scores_low():
    assert sim("the weather is lovely this afternoon", LINE) < 0.35


def test_short_and_long_lines():
    assert sim("Yes.", "Yes!") == 1
    assert sim("no", "Yes.") < 0.35
    assert sim(LONG.lower().replace(",", ""), LONG) == 1
    long_missing_tail = "nobody touches the snack cupboard until midnight"
    assert sim(long_missing_tail, LONG) < 0.6


def test_empty_transcript_scores_zero():
    assert sim("", LINE) == 0
    assert sim("   ", LINE) == 0
    assert sim("", "") == 0


def test_genuine_errors_still_cost_points_after_normalisation():
    assert sim("I do know what you want from me Sarah", LINE) < 1  # dropped "not"
    assert sim("we have 3 hours", "We have two hours.") < 1


def test_regression_correct_line_can_score_above_60_percent():
    # The observed ~60% "ceiling": correct dialogue must be able to score well above it.
    for spoken in ["I do not know what you want from me Sarah", "i dont know what you want from me sarah"]:
        assert sim(spoken, LINE) > 0.95


def test_line_split_by_pause_is_scored_as_a_whole():
    first, second = "I don't know", "what you want from me Sarah"
    alone = sim(second, LINE)
    joined = _call(("scoreLineAttempt", first, second, LINE))[0]
    assert alone < 0.65  # previously the fragment alone was scored -> never auto-advanced
    assert joined["similarity"] == 1
    assert joined["transcript"] == "I don't know what you want from me Sarah"


def test_restarting_line_from_top_not_penalised_by_carried_text():
    r = _call(("scoreLineAttempt", "I don't know", LINE, LINE))[0]
    assert r["similarity"] == 1
    assert r["transcript"] == LINE


def test_final_after_partials_scores_full_transcript():
    partials = ["I", "I don't", "I don't know what", "I don't know what you want from me Sarah"]
    scores = _call(*[("scoreLineAttempt", "", p, LINE) for p in partials])
    vals = [s["similarity"] for s in scores]
    assert vals == sorted(vals) and vals[-1] == 1
    assert vals[1] < 0.5  # a partial is not reported as a completed line


def test_duplicate_final_event_does_not_double_count():
    # Same final delivered twice in one session: both are scored against the same session base.
    a, b = _call(("scoreLineAttempt", "", LINE, LINE), ("scoreLineAttempt", "", LINE, LINE))
    assert a == b and a["similarity"] == 1


# ---- screen wiring -------------------------------------------------------------------

def test_screen_uses_shared_scorer_and_keeps_thresholds():
    assert "import { scoreLineAttempt } from '../../services/rehearsalScoring';" in SCREEN
    assert "const calculateSimilarity" not in SCREEN
    assert "scoreLineAttempt(heardRef.current.sessionBase, safeTranscript, expectedText)" in SCREEN
    for t in ["similarity >= 0.65", "spokenRatio >= 0.6", "(isFinal || similarity >= 0.85)"]:
        assert t in SCREEN, t


def test_carried_text_resets_per_line_and_session():
    assert "heardRef.current.sessionBase = heardRef.current.committed;" in SCREEN
    assert "heardRef.current.line !== currentLineIndexRef.current" in SCREEN
    done = SCREEN[SCREEN.index("const onUserLineDone"):SCREEN.index("const onLineMissed")]
    assert "heardRef.current = { line: -1, committed: '', sessionBase: '' };" in done


def test_completed_line_score_is_displayed():
    done = SCREEN[SCREEN.index("const onUserLineDone"):SCREEN.index("const onLineMissed")]
    assert "showLineFeedback(speechAccuracy)" in done
    assert 'testID="rehearsal-line-score"' in SCREEN
    assert "showAccuracyFeedback" not in SCREEN
    # Rendered outside the user-line branch so it survives the advance to the next line.
    render = SCREEN.index('testID="rehearsal-line-score"')
    assert SCREEN.rindex("<Text style={styles.aiLineText}>", 0, render) > SCREEN.rindex("isUserLine ? (", 0, render)


def test_end_of_rehearsal_aggregate_unchanged():
    assert "Math.round(((completedUserLines - safeMissed.length) / totalUserLines) * 100)" in SCREEN
