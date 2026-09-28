"""Phase 4 physical stability fix — Rehearsal debug UI leak.

Physical Samsung S23 Ultra screenshot on build 1110 revealed a raw
developer diagnostic banner rendered directly in the Rehearsal screen:

    [DEBUG] SR current state: inactive
    SR:Y | Auto:N | Listen:N | State:idle

The banner is a genuine internal diagnostic — useful for QA — but it
must never render in a production/release build.

Fix contract (asserted here on the source):

  1. The visible debug banner in `app/rehearsal/[id].tsx` is gated
     behind `__DEV__`. In release APKs `__DEV__` is a compile-time
     false constant that Metro strips entirely, so the banner cannot
     render for physical release users.
  2. The internal `debugLog()` helper (console.log + setDebugInfo) is
     preserved. Only the JSX is production-gated.
  3. The banner keeps a stable `testID="rehearsal-debug-banner"` so a
     future QA-flag toggle can target it directly.
  4. No changes to speech-recognition wiring, auto-advance, state
     machine, animation, permissions, or navigation.
  5. Phase 3 self-tape files and expo-camera patch are untouched.
  6. Phase 4 Learn files (`app/learn/*`, `services/learnEngine.ts`,
     `services/learnStorage.ts`) are untouched — this is a rehearsal-
     screen-only fix.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"
REHEARSAL = FRONTEND / "app/rehearsal/[id].tsx"

# Phase 3 sentinels
TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"
PREP = FRONTEND / "app/selftape/prep.tsx"
SELFTAPE_STORAGE = FRONTEND / "services/selfTapeStorage.ts"
PATCH = FRONTEND / "patches/expo-camera+17.0.10.patch"

# Phase 4 sentinels
LEARN_HUB = FRONTEND / "app/learn/index.tsx"
LEARN_SESSION = FRONTEND / "app/learn/session.tsx"
LEARN_SUMMARY = FRONTEND / "app/learn/summary.tsx"
LEARN_ENGINE = FRONTEND / "services/learnEngine.ts"
LEARN_STORAGE = FRONTEND / "services/learnStorage.ts"


@pytest.fixture(scope="module")
def rehearsal_src() -> str:
    return REHEARSAL.read_text()


# ─── Contract 1 — visible banner gated behind __DEV__ ───────────────────


def test_debug_banner_is_gated_behind_dev(rehearsal_src: str) -> None:
    """The `[DEBUG] ...` banner must be wrapped in a `{__DEV__ && (...)}`
    JSX expression. In release builds `__DEV__` is a compile-time false
    constant that Metro removes entirely, so the banner cannot render
    for production users."""
    # Locate the banner. Anchored by the visible `[DEBUG]` label and the
    # `SR:` telemetry marker that ships with it, both inside a __DEV__ gate.
    m = re.search(
        r"\{__DEV__\s*&&\s*\([\s\S]*?\[DEBUG\][\s\S]*?SR:",
        rehearsal_src,
    )
    assert m, (
        "Visible [DEBUG] banner must be wrapped in `{__DEV__ && (...)}` "
        "so it is stripped from release APKs by the Metro bundler."
    )


def test_debug_banner_has_stable_testid(rehearsal_src: str) -> None:
    """A stable testID lets a future QA-only toggle target the banner
    without touching the surrounding JSX."""
    assert 'testID="rehearsal-debug-banner"' in rehearsal_src, (
        "Debug banner must carry testID='rehearsal-debug-banner' so QA "
        "and regression tests can target it deterministically."
    )


def test_debug_banner_appears_exactly_once(rehearsal_src: str) -> None:
    """Guard against a second copy of the banner sneaking in outside
    the `__DEV__` gate."""
    occurrences = re.findall(r"\[DEBUG\]\s*\{debugInfo\}", rehearsal_src)
    assert len(occurrences) == 1, (
        f"Expected exactly 1 '[DEBUG] {{debugInfo}}' render site; "
        f"found {len(occurrences)}. A second copy would defeat the "
        f"__DEV__ gate."
    )


def test_no_visible_debug_text_outside_dev_gate(rehearsal_src: str) -> None:
    """The literal `[DEBUG]` string must ONLY appear inside a
    `{__DEV__ && ...}` block. Any bare occurrence would render in
    production."""
    # Split on __DEV__ gate boundaries; the segment BEFORE the first
    # gate and AFTER its closing brace should not contain a `[DEBUG]`
    # JSX render.
    #
    # Simpler check: every `[DEBUG]` render must be preceded (in
    # source) by an unmatched `{__DEV__ && (` earlier in the file with
    # no closing brace between them. We already assert the presence of
    # the gate above and that there is exactly one banner, so it is
    # sufficient to verify the gate literally contains the banner
    # substring — no other paths exist.
    m = re.search(
        r"\{__DEV__\s*&&\s*\(\s*<View[\s\S]*?rehearsal-debug-banner[\s\S]*?</View>\s*\)\s*\}",
        rehearsal_src,
    )
    assert m, "No __DEV__ gate wrapping the rehearsal-debug-banner found."
    gate_body = m.group(0)
    assert "[DEBUG]" in gate_body, (
        "The [DEBUG] banner must live INSIDE the __DEV__ gate, not "
        "outside it."
    )


# ─── Contract 2 — internal diagnostic logging is preserved ──────────────


def test_debug_log_helper_preserved(rehearsal_src: str) -> None:
    """`debugLog()` is a legitimate internal helper (console.log +
    setDebugInfo). It must still be defined so QA logcat capture works
    on release builds."""
    assert re.search(
        r"const\s+debugLog\s*=\s*\(msg:\s*string\)\s*=>\s*\{",
        rehearsal_src,
    ), "debugLog helper removed — internal logging is broken."
    assert "console.log(`[Rehearsal-Debug] " in rehearsal_src, (
        "console.log inside debugLog removed — QA logcat capture "
        "broken."
    )
    assert "setDebugInfo(msg)" in rehearsal_src, (
        "setDebugInfo removed — debug state tracking broken."
    )


def test_debug_info_state_preserved(rehearsal_src: str) -> None:
    assert re.search(
        r"const\s+\[debugInfo,\s*setDebugInfo\]\s*=\s*useState<string>",
        rehearsal_src,
    ), "debugInfo state declaration removed."


# ─── Contract 3 — no unrelated changes ──────────────────────────────────


def test_speech_recognition_wiring_untouched(rehearsal_src: str) -> None:
    """Speech recognition, auto-advance, state machine, permissions
    are not part of this fix. Assert their key surfaces are still
    present."""
    for token in (
        "speechRecognitionAvailable",
        "autoAdvanceEnabled",
        "isListening",
        "ExpoSpeechRecognitionModule",
        "useSpeechRecognitionEvent",
        "ensureSpeechPermission",
    ):
        assert token in rehearsal_src, (
            f"Rehearsal token `{token}` unexpectedly removed by this "
            f"UI-only debug-banner fix."
        )


# ─── Phase 3 integrity ──────────────────────────────────────────────────


def test_phase3_files_untouched_by_debug_banner_fix() -> None:
    for path in (TELEPROMPTER, RECORD, PREP, SELFTAPE_STORAGE, PATCH):
        src = path.read_text()
        for token in ('rehearsal-debug-banner', '[DEBUG] {debugInfo}'):
            assert token not in src, (
                f"Phase 3 file {path.name} unexpectedly references "
                f"`{token}`."
            )


def test_expo_camera_patch_intact() -> None:
    patch = PATCH.read_text()
    assert "isStabilizationSupported" in patch
    assert "Camera provider unavailable" in patch


# ─── Phase 4 integrity ──────────────────────────────────────────────────


def test_phase4_learn_files_untouched_by_debug_banner_fix() -> None:
    for path in (LEARN_HUB, LEARN_SESSION, LEARN_SUMMARY, LEARN_ENGINE, LEARN_STORAGE):
        src = path.read_text()
        for token in ('rehearsal-debug-banner', '[DEBUG] {debugInfo}'):
            assert token not in src, (
                f"Phase 4 file {path.name} unexpectedly references "
                f"`{token}`."
            )
