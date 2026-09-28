"""Phase 4 — LEARN system source-level regression suite.

Locks the shape of the Learn foundation, engine, UI, storage, and
navigation entry point:

  * `frontend/services/learnEngine.ts` — pure, deterministic, offline.
  * `frontend/services/learnStorage.ts` — AsyncStorage-only, defensive.
  * `frontend/app/learn/index.tsx`     — Learn Hub (character + mode).
  * `frontend/app/learn/session.tsx`   — practice loop (cue/reveal/assess).
  * `frontend/app/learn/summary.tsx`   — post-session summary.
  * `frontend/app/script/[id].tsx`     — Learn button entry.

Also locks the invariants below, all of which are non-negotiable per
the Phase 4 master execution directive:

  * No LLM / OpenAI / ElevenLabs / speech recognition in the core loop.
  * No backend `/api/*` fetches in the core loop.
  * No `Animated.*` in the Learn screens (Fabric-safe like Phase 3).
  * No `@react-native-community/slider` in the Learn screens.
  * Stable record IDs of shape `${scriptId}:${characterId}:${lineId}` —
    never by array index.
  * Deterministic mask proportions per difficulty level.
  * Reversible mastery (a recent miss can drop mastery).
  * Weak-line recovery clause (3 consecutive successes clears weak).
  * Phase 3 Self-Tape / Teleprompter files untouched.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"
ENGINE = FRONTEND / "services/learnEngine.ts"
STORAGE = FRONTEND / "services/learnStorage.ts"
HUB = FRONTEND / "app/learn/index.tsx"
SESSION = FRONTEND / "app/learn/session.tsx"
SUMMARY = FRONTEND / "app/learn/summary.tsx"
SCRIPT_SCREEN = FRONTEND / "app/script/[id].tsx"

TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"
PREP = FRONTEND / "app/selftape/prep.tsx"
PATCH = FRONTEND / "patches/expo-camera+17.0.10.patch"


@pytest.fixture(scope="module")
def engine_src() -> str:
    return ENGINE.read_text()


@pytest.fixture(scope="module")
def storage_src() -> str:
    return STORAGE.read_text()


@pytest.fixture(scope="module")
def hub_src() -> str:
    return HUB.read_text()


@pytest.fixture(scope="module")
def session_src() -> str:
    return SESSION.read_text()


@pytest.fixture(scope="module")
def summary_src() -> str:
    return SUMMARY.read_text()


# ─── 4A: Foundation files exist ─────────────────────────────────────────


def test_learn_engine_file_exists() -> None:
    assert ENGINE.exists(), f"Missing {ENGINE}"


def test_learn_storage_file_exists() -> None:
    assert STORAGE.exists(), f"Missing {STORAGE}"


def test_learn_hub_file_exists() -> None:
    assert HUB.exists(), f"Missing {HUB}"


def test_learn_session_file_exists() -> None:
    assert SESSION.exists(), f"Missing {SESSION}"


def test_learn_summary_file_exists() -> None:
    assert SUMMARY.exists(), f"Missing {SUMMARY}"


# ─── 4A.2 / 4E: Stable IDs (no array-index persistence) ─────────────────


def test_stable_record_id_shape(engine_src: str) -> None:
    """Records must be keyed by ${scriptId}:${characterId}:${lineId}, not
    by array index — matches the master directive."""
    assert re.search(
        r"return\s*`\$\{scriptId\}:\$\{characterId\}:\$\{lineId\}`",
        engine_src,
    ), "makeRecordId must return `${scriptId}:${characterId}:${lineId}`."


def test_engine_reuses_existing_script_model(engine_src: str) -> None:
    """No duplicate Script/DialogueLine model — must import types from
    the existing scriptStore."""
    assert "from '../store/scriptStore'" in engine_src
    assert re.search(
        r"import\s+type\s+\{[^}]*Script[^}]*Character[^}]*DialogueLine[^}]*\}",
        engine_src,
    ), "Engine must import Script/Character/DialogueLine from scriptStore."


# ─── 4A.3 / 4D: Session state machine ───────────────────────────────────


def test_session_states_are_declared(engine_src: str) -> None:
    for state in ('ready', 'active', 'paused', 'completed'):
        assert f"'{state}'" in engine_src, f"Session state '{state}' missing."


def test_session_type_declarations(engine_src: str) -> None:
    for t in ('full', 'scene', 'weak', 'custom'):
        assert f"'{t}'" in engine_src, f"SessionType '{t}' missing."


def test_session_lifecycle_functions_exported(engine_src: str) -> None:
    for fn in (
        'createSession', 'advanceSession', 'pauseSession', 'resumeSession',
        'restartSession', 'goToNext', 'goToPrevious',
    ):
        assert re.search(rf"export function {fn}\b", engine_src), (
            f"Session lifecycle function `{fn}` must be exported."
        )


# ─── 4B: Recall modes / cue words / blackout ────────────────────────────


def test_five_difficulty_levels_define_mask_proportion(engine_src: str) -> None:
    match = re.search(
        r"function maskProportionFor\([^)]*\)[^{]*\{(.*?)^\}",
        engine_src, re.DOTALL | re.MULTILINE,
    )
    assert match, "maskProportionFor function not found."
    body = match.group(1)
    for lvl in ('1', '2', '3', '4', '5'):
        assert f"case {lvl}:" in body, f"Level {lvl} missing from maskProportionFor."


def test_derive_cue_words_deterministic_and_no_llm(engine_src: str) -> None:
    assert "deriveCueWords" in engine_src
    assert "STOP_WORDS" in engine_src, (
        "Cue-word extraction must use a deterministic stop-word set."
    )
    # No LLM/OpenAI/API IMPORT or CALL in the engine. Historical mentions
    # in comments (documenting the AI boundary) are allowed and useful.
    import_re = re.compile(
        r"import\s+[^;]*from\s+['\"]([^'\"]+)['\"]",
    )
    imported = {m.group(1) for m in import_re.finditer(engine_src)}
    for banned in ('openai', '@anthropic-ai/sdk', 'elevenlabs',
                   '../services/elevenLabsService',
                   '../services/actingCoachService'):
        assert banned not in imported, (
            f"Learn engine must not import `{banned}`."
        )


@pytest.mark.parametrize("path,label", [
    (ENGINE, "engine"), (STORAGE, "storage"), (HUB, "hub"),
    (SESSION, "session"), (SUMMARY, "summary"),
])
def test_learn_files_have_no_backend_api_calls(path: Path, label: str) -> None:
    """No backend/AI runtime references in the core Learn loop. We check
    imports and function calls, not comments (which document the AI
    boundary and are welcome)."""
    src = path.read_text()
    # Imports.
    import_re = re.compile(r"import\s+[^;]*from\s+['\"]([^'\"]+)['\"]")
    imported = {m.group(1) for m in import_re.finditer(src)}
    for banned in ('axios', 'openai', '@anthropic-ai/sdk', 'elevenlabs',
                   '../services/elevenLabsService',
                   '../services/actingCoachService',
                   '../services/dialectCoachService'):
        assert banned not in imported, (
            f"{label} must not import `{banned}` — core Learn loop is "
            "offline / no-AI per Phase 4 directive."
        )
    # Calls.
    for pat in (r"\bfetch\s*\(", r"\baxios\s*\.", r"['\"]/api/"):
        assert not re.search(pat, src), (
            f"{label} must not perform HTTP calls or reference /api/ — "
            f"pattern `{pat}` matched."
        )


def test_tokenize_for_mode_returns_typed_tokens(engine_src: str) -> None:
    assert "export function tokenizeForMode" in engine_src
    assert "kind: 'word'" in engine_src
    assert "kind: 'space'" in engine_src


# ─── 4C: Weak-line classifier + recovery ────────────────────────────────


def test_weak_classifier_has_recovery_clause(engine_src: str) -> None:
    body = _extract_function(engine_src, 'classifyWeak')
    assert 'consecutiveSuccesses' in body, (
        "classifyWeak must consider consecutiveSuccesses for recovery."
    )
    assert re.search(r"consecutiveSuccesses\s*>=\s*3", body), (
        "classifyWeak must implement the '3 consecutive successes clears "
        "weak' recovery rule."
    )


def test_apply_assessment_is_pure_and_reversible(engine_src: str) -> None:
    body = _extract_function(engine_src, 'applyAssessment')
    # Must return a NEW record, not mutate in place.
    assert 'const next' in body
    assert 'return next' in body
    # Mastery must be recomputed each time (so it can regress).
    assert 'classifyMastery' in body
    assert 'classifyWeak' in body


# ─── 4E: Mastery states + reversibility ─────────────────────────────────


def test_five_mastery_states_declared(engine_src: str) -> None:
    for m in ('new', 'learning', 'developing', 'strong', 'mastered'):
        assert f"'{m}'" in engine_src, f"MasteryLevel '{m}' missing."


def test_mastery_is_reversible_by_a_miss(engine_src: str) -> None:
    apply_body = _extract_function(engine_src, 'applyAssessment')
    # 'missed' must reset consecutiveSuccesses; classifyMastery is called
    # AFTER, so a mastered line naturally regresses.
    assert re.search(r"result === 'missed'.*?consecutiveSuccesses\s*=\s*0",
                     apply_body, re.DOTALL), (
        "A 'missed' assessment must reset consecutiveSuccesses to 0."
    )


# ─── 4F: Persistence — three keys, defensive read ───────────────────────


def test_storage_uses_three_namespaced_keys(storage_src: str) -> None:
    for key in (
        "'@scriptmate/learn/records'",
        "'@scriptmate/learn/session/active'",
        "'@scriptmate/learn/history'",
    ):
        assert key in storage_src, f"Storage key {key} missing."


def test_storage_defensive_json_parse(storage_src: str) -> None:
    """Corrupted local JSON must not crash — every reader wraps in try/catch
    and returns a safe empty shape."""
    for fn in ('loadAllRecords', 'loadActiveSession', 'loadHistory'):
        body = _extract_function(storage_src, fn)
        assert 'try {' in body and 'catch' in body, (
            f"{fn} must be defensive against corrupted JSON."
        )


def test_storage_purge_orphans_present(storage_src: str) -> None:
    assert "purgeOrphans" in storage_src, (
        "purgeOrphans is required so deleted scripts do not silently "
        "corrupt unrelated learning records."
    )


def test_history_capped(storage_src: str) -> None:
    assert re.search(r"HISTORY_MAX\s*=\s*\d+", storage_src)


# ─── 4A.4 / UI: user-facing controls + testIDs ──────────────────────────


def test_hub_has_expected_testids(hub_src: str) -> None:
    for tid in (
        'learn-hub',
        'learn-hub-start',
        'learn-hub-mode-full',
        'learn-hub-mode-scene',
        'learn-hub-mode-weak',
        'learn-hub-progress',
    ):
        assert f'testID="{tid}"' in hub_src, f"Hub testID `{tid}` missing."


def test_session_has_expected_testids(session_src: str) -> None:
    # testIDs on the difficulty pills use a template literal
    # `learn-session-difficulty-${d}`, so match by pattern rather than
    # exact string for 1..5.
    for tid in (
        'learn-session',
        'learn-session-progress',
        'learn-session-cue-card',
        'learn-session-reveal',
        'learn-session-assess-missed',
        'learn-session-assess-almost',
        'learn-session-assess-got',
        'learn-session-prev',
        'learn-session-next',
        'learn-session-pauseresume',
        'learn-session-restart',
        'learn-session-quit',
        'learn-session-mastery',
    ):
        assert f'testID="{tid}"' in session_src, f"Session testID `{tid}` missing."
    # Difficulty pills use a template literal.
    assert re.search(
        r'testID=\{`learn-session-difficulty-\$\{d\}`\}',
        session_src,
    ), "Difficulty pill testIDs must be learn-session-difficulty-${d} (1..5)."


def test_summary_has_expected_testids(summary_src: str) -> None:
    for tid in ('learn-summary', 'learn-summary-again', 'learn-summary-overall'):
        assert f'testID="{tid}"' in summary_src, f"Summary testID `{tid}` missing."


def test_script_detail_has_learn_entry() -> None:
    src = SCRIPT_SCREEN.read_text()
    assert "/learn?scriptId=" in src, "Script screen must have a /learn entry."
    assert 'testID="script-learn-btn"' in src, (
        "Learn button must expose testID=\"script-learn-btn\"."
    )


# ─── UI: Fabric-safe (no Animated, no community slider) ─────────────────


@pytest.mark.parametrize("path,label", [
    (HUB, "hub"), (SESSION, "session"), (SUMMARY, "summary"),
])
def test_learn_screens_are_fabric_safe(path: Path, label: str) -> None:
    src = path.read_text()
    # No @react-native-community/slider import or usage.
    assert "from '@react-native-community/slider'" not in src, (
        f"{label} screen must not import community slider (Fabric-risky)."
    )
    assert "<Slider" not in src
    # No Animated import from react-native (JS-only interactions).
    m = re.search(r"import\s*\{([^}]+)\}\s*from\s*'react-native'", src)
    assert m, f"{label}: react-native import block not found."
    names = {n.strip() for n in m.group(1).split(',')}
    assert 'Animated' not in names, (
        f"{label} must not import `Animated` — Fabric-safe interactions only."
    )


# ─── AI/API boundary: core loop is offline ──────────────────────────────


def test_masked_line_rendered_as_flat_string(session_src: str) -> None:
    """2026-02 Fabric-safety refactor: the masked line must render as a
    FLAT single string inside a single <Text> child, NOT as a mix of
    bare strings and nested <Text> siblings. The previous mixed pattern
    crashed on Android 16 when the difficulty changed rapidly (Fabric
    re-parenting of Text descendants).

    Concretely: the masked-line JSX must call a helper `renderMaskedLine`
    and must NOT map tokens to inline <Text> children."""
    assert "renderMaskedLine(" in session_src, (
        "The masked-line render must delegate to renderMaskedLine() so it "
        "produces a single flat string."
    )
    # The prior crash-prone pattern must be gone.
    assert "tokens.map(" not in session_src, (
        "The nested-<Text>-from-tokens.map pattern must not return; it is "
        "Fabric-unsafe on Android 16."
    )
    # No <Text> nested inside the masked-line <Text> child.
    m = re.search(
        r'testID="learn-session-masked-text"[^>]*>(.*?)</Text>',
        session_src, re.DOTALL,
    )
    assert m, "learn-session-masked-text <Text> block not found."
    inner = m.group(1)
    assert '<Text' not in inner, (
        "learn-session-masked-text must have a single string child — no "
        "nested <Text>. Got:\n" + inner
    )


def test_render_masked_line_helper_declared(session_src: str) -> None:
    """The helper must be a pure top-level function returning a string."""
    assert re.search(
        r"function\s+renderMaskedLine\s*\([^)]*\)\s*:\s*string\b",
        session_src,
    ), "renderMaskedLine must be declared with `: string` return type."


def test_render_masked_line_uses_engine_mask_proportion(session_src: str) -> None:
    """The refactored helper must reuse the engine's deterministic mask
    proportion function so the visual behaviour matches the engine
    tests."""
    assert "maskProportionFor(difficulty)" in session_src


def test_run_time_masked_line_smoke() -> None:
    """Bridges to the runtime engine smoke test — the renderMaskedLine
    behaviour is asserted through the shared maskProportionFor function
    (already covered by scripts/learn_engine_smoketest.js which asserts
    tokenizeForMode masks at 0/30/55/80/100% for difficulties 1..5).

    This test exists as a lightweight sentinel so a regression here
    surfaces in the Phase 4 suite even if the runtime smoke is skipped."""
    src = SESSION.read_text()
    # Difficulty 4 first-letter branch present.
    assert re.search(
        r"if\s*\(\s*showFirstLetter\s+&&\s+p\.length\s*>\s*1\s*\)",
        src,
    ), "renderMaskedLine must preserve the first letter at difficulty 4."


# ─── Phase 3 integrity: not modified by Phase 4 ─────────────────────────


def test_phase3_teleprompter_hardening_intact() -> None:
    src = TELEPROMPTER.read_text()
    # Sentinel Phase 3 markers.
    for token in (
        'requestAnimationFrame(step)',
        'runTeleprompterLoop',
        'isCameraReady',
        'cameraMountError',
        'showFramingGuides',
        'testID="framing-guides-toggle"',
        'testID="framing-guides-overlay"',
    ):
        assert token in src, (
            f"Phase 3 sentinel `{token}` missing from teleprompter.tsx — "
            "Phase 4 must not disturb Phase 3."
        )
    # UX defaults still 'top' and 2.
    assert re.search(
        r"useState\s*<\s*'top'\s*\|\s*'middle'\s*\|\s*'bottom'\s*>\s*\(\s*'top'\s*\)",
        src,
    ), "Phase 3 UX default position must remain 'top'."
    assert re.search(r"const\s*\[\s*speed[^\]]*\]\s*=\s*useState\s*\(\s*2\s*\)",
                     src), "Phase 3 UX default speed must remain 2."


def test_phase3_record_and_prep_untouched() -> None:
    r = RECORD.read_text()
    p = PREP.read_text()
    # Phase 4 must not have leaked Learn-only symbols into these files.
    for src, name in ((r, 'record.tsx'), (p, 'prep.tsx')):
        for token in ('learnEngine', 'learnStorage', 'LearningRecord',
                      'LearningSession', 'LearnItem'):
            assert token not in src, (
                f"Phase 3 file {name} unexpectedly references `{token}`."
            )


def test_phase3_expo_camera_patch_intact() -> None:
    patch = PATCH.read_text()
    assert "isStabilizationSupported" in patch
    assert "Camera provider unavailable" in patch
    assert "expo/expo#47696" in patch


# ─── Runtime engine smoke — 22 deterministic checks ─────────────────────


def test_runtime_engine_smoke_passes() -> None:
    """Executes `scripts/learn_engine_smoketest.js` via node — the same
    22 pure-function assertions used during Phase 4A/B/C/D/E authoring."""
    result = subprocess.run(
        ["node", "scripts/learn_engine_smoketest.js"],
        cwd=str(APP),
        capture_output=True,
        text=True,
        timeout=120,
    )
    tail = result.stdout.splitlines()[-5:]
    assert result.returncode == 0, (
        f"Engine smoke failed:\nSTDOUT:\n{result.stdout}\n\n"
        f"STDERR:\n{result.stderr}"
    )
    # Sanity: the summary line reports zero failures.
    assert any("0 failed" in ln for ln in tail), (
        f"Engine smoke did not report '0 failed':\n{result.stdout}"
    )


# ─── Storage key registry present ───────────────────────────────────────


def test_storage_exports_key_registry(storage_src: str) -> None:
    assert "LearnStorageKeys" in storage_src, (
        "Storage must export a LearnStorageKeys registry so tests / debug "
        "tools can reference the keys by name."
    )


# ─── Helpers ────────────────────────────────────────────────────────────


def _extract_function(src: str, name: str) -> str:
    """Extract a top-level `export [async] function <name>(...) { ... }` body,
    balancing braces. Deliberately simple; sufficient for these files."""
    m = re.search(rf"export\s+(?:async\s+)?function\s+{re.escape(name)}\b",
                  src)
    assert m, f"Function `{name}` not found."
    idx = m.start()
    brace_start = src.find('{', idx)
    depth = 0
    for i in range(brace_start, len(src)):
        c = src[i]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[brace_start : i + 1]
    raise AssertionError(f"Unbalanced braces for `{name}`.")
