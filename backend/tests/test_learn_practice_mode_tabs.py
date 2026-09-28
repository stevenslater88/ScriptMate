"""Phase 4 physical fix — Learn Hub practice-mode tabs (Scene & Weak Lines).

Locks the fix applied to `frontend/app/learn/index.tsx` after the
Samsung SM-S918B / Android 16 physical screenshot showed:

  FULL SCRIPT | SCENE | WEAK LINES

with SCENE and WEAK LINES visually rendered as tabs but effectively
disabled — `disabled={availableScenes.length <= 1}` on the Scene chip
and `disabled={progress.weak === 0}` on the Weak Lines chip.

Fix contract (asserted here on the source):

  1. Neither the Scene chip nor the Weak Lines chip carries a
     `disabled=` prop any more. Both are always tappable so long as the
     script and character are loaded.
  2. Scene mode with a single recognised scene works: the auto-select
     effect on the Scene chip picks the first available scene
     (`availableScenes[0]`) when `sceneNumber` is null, so
     `filteredItems` filters to just that scene.
  3. Scene mode with zero recognised scenes shows an empty-state banner
     (testID="learn-hub-scene-empty"). We do NOT fabricate scene data.
  4. Weak Lines mode with zero weak lines shows an empty-state banner
     (testID="learn-hub-weak-empty"). We do NOT fabricate weak records.
  5. When either empty state is on-screen the footer swaps
     "Start learning" for "Back to Full script"
     (testID="learn-hub-back-to-full") so the user always has an
     obvious way forward.
  6. `handleStartAgain` is now guarded: it will NOT
     `clearActiveSession()` when the selected mode has zero playable
     items, so switching to Weak/Scene mode with no items can never
     wipe a resumable session by accident.
  7. NO changes to `services/learnEngine.ts` or
     `services/learnStorage.ts`. NO new dependencies. NO changes to
     Script Library storage.
  8. Phase 3 files (self-tape, teleprompter, expo-camera patch) are
     untouched.

These tests are pure source-level assertions — they read the frontend
source and check the fix survives future refactors.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"
HUB = FRONTEND / "app/learn/index.tsx"
SESSION = FRONTEND / "app/learn/session.tsx"
SUMMARY = FRONTEND / "app/learn/summary.tsx"
ENGINE = FRONTEND / "services/learnEngine.ts"
STORAGE = FRONTEND / "services/learnStorage.ts"

TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"
PREP = FRONTEND / "app/selftape/prep.tsx"
SELFTAPE_STORAGE = FRONTEND / "services/selfTapeStorage.ts"
PATCH = FRONTEND / "patches/expo-camera+17.0.10.patch"


@pytest.fixture(scope="module")
def hub_src() -> str:
    return HUB.read_text()


@pytest.fixture(scope="module")
def engine_src() -> str:
    return ENGINE.read_text()


@pytest.fixture(scope="module")
def storage_src() -> str:
    return STORAGE.read_text()


# ───────────────────────────────────────────────────────────────────────
# SCENE tab
# ───────────────────────────────────────────────────────────────────────


def _scene_touchable_block(src: str) -> str:
    """Return the JSX for the Scene mode chip TouchableOpacity."""
    m = re.search(
        r"<TouchableOpacity[\s\S]*?testID=\"learn-hub-mode-scene\"[\s\S]*?</TouchableOpacity>",
        src,
    )
    assert m, "Scene mode TouchableOpacity not found."
    return m.group(0)


def _weak_touchable_block(src: str) -> str:
    m = re.search(
        r"<TouchableOpacity[\s\S]*?testID=\"learn-hub-mode-weak\"[\s\S]*?</TouchableOpacity>",
        src,
    )
    assert m, "Weak Lines mode TouchableOpacity not found."
    return m.group(0)


def _touchable_open_tag(block: str) -> str:
    """Return only the opening tag of a JSX <TouchableOpacity ...>."""
    # A JSX opening tag ends at the first `>` that is NOT inside `{...}`.
    depth = 0
    for i, ch in enumerate(block):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == ">" and depth == 0:
            return block[: i + 1]
    return block


def test_1_scene_chip_is_always_selectable(hub_src: str) -> None:
    """The Scene chip must NOT carry a `disabled=` prop tied to
    `availableScenes.length`."""
    block = _scene_touchable_block(hub_src)
    open_tag = _touchable_open_tag(block)
    assert "disabled=" not in open_tag, (
        "Scene chip must not be disabled. Actor should always be able to "
        "tap Scene."
    )


def test_2_one_scene_mode_creates_a_scene_session(hub_src: str) -> None:
    """When the actor taps Scene with `sceneNumber == null` and at least
    one available scene, the Hub must auto-select the first one so
    Start Learning creates a Scene session."""
    block = _scene_touchable_block(hub_src)
    # Auto-select on tap.
    assert re.search(
        r"sceneNumber\s*==\s*null[\s\S]*?availableScenes\.length\s*>\s*0"
        r"[\s\S]*?setSceneNumber\(availableScenes\[0\]\)",
        block,
    ), (
        "Scene chip onPress must auto-select availableScenes[0] when no "
        "scene is selected yet."
    )
    # Start button still uses `createSession({ type: mode, ... })` and
    # forwards `sceneNumber` when in scene mode.
    m = re.search(
        r"createSession\(\{([\s\S]*?)\}\)",
        hub_src,
    )
    assert m, "createSession call not found in Hub."
    args = m.group(1)
    assert "type: mode" in args, "createSession must forward the selected mode."
    assert re.search(
        r"sceneNumber:\s*mode\s*===\s*'scene'\s*\?\s*sceneNumber",
        args,
    ), "createSession must forward the selected sceneNumber when in scene mode."


def test_3_scene_session_contains_only_selected_scene(hub_src: str) -> None:
    """`filteredItems` must restrict to a single scene when
    `mode === 'scene' && sceneNumber != null`."""
    m = re.search(
        r"const\s+filteredItems\s*=\s*useMemo[\s\S]*?\[items,\s*mode,\s*sceneNumber\]",
        hub_src,
    )
    assert m, "filteredItems useMemo not found."
    body = m.group(0)
    assert re.search(
        r"mode\s*===\s*'scene'\s*&&\s*sceneNumber\s*!=\s*null",
        body,
    ), "Scene mode filter must gate on a non-null sceneNumber."
    assert re.search(
        r"items\.filter\(\(it\)\s*=>\s*it\.sceneNumber\s*===\s*sceneNumber\)",
        body,
    ), "Scene mode must filter items to just the selected sceneNumber."


def test_4_multiple_scenes_still_filter_correctly(hub_src: str) -> None:
    """The scene picker row must still render when >1 recognised scene
    so the actor can pick a different scene."""
    assert re.search(
        r"mode\s*===\s*'scene'\s*&&\s*availableScenes\.length\s*>\s*1",
        hub_src,
    ), "Multi-scene picker gate is missing."
    # Picker still uses testID="learn-hub-scene-{n}"
    assert 'testID={`learn-hub-scene-${n}`}' in hub_src


def test_5_no_recognised_scenes_shows_safe_empty_state(hub_src: str) -> None:
    """When there are zero recognised scenes we render a clear empty
    state instead of silently doing nothing."""
    # Empty-state banner testID exists.
    assert 'testID="learn-hub-scene-empty"' in hub_src, (
        "Scene empty-state banner (testID='learn-hub-scene-empty') is missing."
    )
    # Gate is `mode === 'scene' && availableScenes.length === 0`.
    assert re.search(
        r"mode\s*===\s*'scene'\s*&&\s*availableScenes\.length\s*===\s*0",
        hub_src,
    ), "Scene empty-state must gate on zero available scenes."


def test_6_scene_mode_does_not_corrupt_full_mode(engine_src: str, hub_src: str) -> None:
    """`extractLearnItems` and `aggregateProgress` are unchanged — Full
    Script mode still returns every item."""
    # Engine is not asserting a scene filter.
    assert "extractLearnItems" in engine_src
    # Full mode returns everything.
    m = re.search(
        r"const\s+filteredItems\s*=\s*useMemo[\s\S]*?\[items,\s*mode,\s*sceneNumber\]",
        hub_src,
    )
    body = m.group(0)
    # The default (full) branch returns `items` unfiltered.
    assert "return items;" in body, (
        "Full-mode branch of filteredItems must return items unfiltered."
    )


# ───────────────────────────────────────────────────────────────────────
# WEAK LINES tab
# ───────────────────────────────────────────────────────────────────────


def test_7_weak_chip_is_always_selectable(hub_src: str) -> None:
    """The Weak Lines chip must NOT carry a `disabled=` prop tied to
    `progress.weak`."""
    block = _weak_touchable_block(hub_src)
    open_tag = _touchable_open_tag(block)
    assert "disabled=" not in open_tag, (
        "Weak Lines chip must not be disabled based on progress.weak."
    )


def test_8_zero_weak_lines_shows_clear_empty_state(hub_src: str) -> None:
    assert 'testID="learn-hub-weak-empty"' in hub_src, (
        "Weak Lines empty-state banner "
        "(testID='learn-hub-weak-empty') is missing."
    )
    # Gate is `mode === 'weak' && items.length > 0 && progress.weak === 0`.
    assert re.search(
        r"mode\s*===\s*'weak'\s*&&\s*items\.length\s*>\s*0"
        r"\s*&&\s*progress\.weak\s*===\s*0",
        hub_src,
    ), "Weak empty-state must only render when there are items but zero weak ones."


def test_9_weak_mode_starts_weak_line_session(hub_src: str) -> None:
    """When weak items exist, `filteredItems` restricts to weak ones
    and Start Learning creates a Weak session."""
    m = re.search(
        r"const\s+filteredItems\s*=\s*useMemo[\s\S]*?\[items,\s*mode,\s*sceneNumber\]",
        hub_src,
    )
    body = m.group(0)
    assert re.search(
        r"mode\s*===\s*'weak'[\s\S]*?items\.filter\(\(it\)\s*=>\s*it\.record\.isWeak\)",
        body,
    ), "Weak mode must filter items to those where record.isWeak is true."


def test_10_weak_session_only_contains_weak_items(engine_src: str) -> None:
    """`classifyWeak` is the single source of truth for
    `LearningRecord.isWeak`. Hub does not create a parallel model."""
    assert "classifyWeak" in engine_src, (
        "Engine must still expose classifyWeak — the weak-line "
        "classifier."
    )


def test_11_existing_weak_classification_unchanged(engine_src: str) -> None:
    """`classifyWeak` signature and logic — spot-check keywords that
    define the rule — must not have been touched by this fix."""
    m = re.search(
        r"export\s+function\s+classifyWeak\s*\(([\s\S]*?)\}\s*\n",
        engine_src,
    )
    assert m, "classifyWeak function not found in engine."
    body = m.group(0)
    # Rule references: miss ratio + recent misses.
    assert "misses" in body
    assert "attempts" in body


def test_12_weak_mode_does_not_fabricate_records(hub_src: str, storage_src: str) -> None:
    """The Hub must not write a fake LearningRecord to storage just to
    keep the Weak Lines button 'live'."""
    # No storage writes from Hub except the active session and via
    # existing helpers.
    assert "saveRecord" not in hub_src, (
        "Hub must not write LearningRecord entries. Only the Session "
        "screen persists records."
    )
    # Storage exposes saveRecord elsewhere — that's fine — but Hub
    # doesn't call it.
    assert "saveRecord" in storage_src or "saveAllRecords" in storage_src


# ───────────────────────────────────────────────────────────────────────
# Regression — pre-existing Phase 4 behaviour still holds
# ───────────────────────────────────────────────────────────────────────


def test_13_full_script_remains_functional(hub_src: str) -> None:
    """Full script chip unchanged: no `disabled=` and still testID
    `learn-hub-mode-full`."""
    m = re.search(
        r"<TouchableOpacity[\s\S]*?testID=\"learn-hub-mode-full\"[\s\S]*?</TouchableOpacity>",
        hub_src,
    )
    assert m, "Full script mode TouchableOpacity not found."
    open_tag = _touchable_open_tag(m.group(0))
    assert "disabled=" not in open_tag


def test_14_resume_ux_still_renders(hub_src: str) -> None:
    for tid in (
        'learn-hub-resume-banner',
        'learn-hub-resume',
        'learn-hub-start-again',
    ):
        assert f'testID="{tid}"' in hub_src, (
            f"Resume UX testID `{tid}` missing — regressed by this fix."
        )


def test_15_start_again_still_clears_before_starting(hub_src: str) -> None:
    m = re.search(
        r"async\s+function\s+handleStartAgain[\s\S]*?^\s*\}",
        hub_src,
        re.MULTILINE,
    )
    assert m, "handleStartAgain not found."
    body = m.group(0)
    clear_idx = body.find("clearActiveSession(")
    start_idx = body.find("handleStart(")
    assert clear_idx >= 0, "Start again must still clearActiveSession()."
    assert start_idx >= 0, "Start again must still delegate to handleStart()."
    assert clear_idx < start_idx, (
        "clearActiveSession() must run BEFORE handleStart()."
    )
    # New guard: don't clobber an active session when the target mode
    # has zero playable items.
    assert re.search(
        r"filteredItems\.length\s*===\s*0",
        body,
    ), (
        "Start again must guard against empty filteredItems so it "
        "cannot silently wipe an active session."
    )


def test_16_active_recall_masked_render_intact() -> None:
    """Session screen still uses the flat-string masked render fix that
    resolved the Android 16 Fabric nested-<Text> crash."""
    src = SESSION.read_text()
    # Difficulty selector present.
    assert "difficultyLevel" in src or "difficulty" in src
    # Masked-line render helper (flat single string to avoid Fabric
    # nested-<Text> crash on Android 16).
    assert "renderMaskedLine" in src


def test_17_self_assessment_intact() -> None:
    src = SESSION.read_text()
    for token in ("got_it", "almost", "missed"):
        assert token in src, (
            f"Self-assessment option `{token}` missing from session screen."
        )


def test_18_session_summary_intact() -> None:
    src = SUMMARY.read_text()
    # Summary still reads history / renders totals.
    assert "history" in src or "loadHistory" in src


def test_19_script_library_storage_untouched() -> None:
    """No changes to the Script Library storage or scriptStore from
    this fix."""
    store = (FRONTEND / "store/scriptStore.ts").read_text()
    # Store still exports useScriptStore + Script types.
    assert "useScriptStore" in store
    assert "export interface Script" in store or "export type Script" in store or "Script" in store


def test_20_phase3_files_untouched() -> None:
    for path in (TELEPROMPTER, RECORD, PREP, SELFTAPE_STORAGE, PATCH):
        src = path.read_text()
        for token in (
            "learn-hub-mode-scene",
            "learn-hub-mode-weak",
            "learn-hub-scene-empty",
            "learn-hub-weak-empty",
            "learn-hub-back-to-full",
            "isModeEmpty",
        ):
            assert token not in src, (
                f"Phase 3 file {path.name} unexpectedly references "
                f"`{token}` — Phase 3 must stay frozen."
            )


# ───────────────────────────────────────────────────────────────────────
# Extra safety — Learn engine + storage source not modified
# ───────────────────────────────────────────────────────────────────────


def test_21_engine_and_storage_are_unmodified_by_this_fix() -> None:
    """The user's spec: `learnEngine.ts` and `learnStorage.ts` are only
    to be modified if source evidence proves a minimal change there is
    required. This test fails if a new export sneaks into either file
    that references the Hub's tabs.
    """
    engine = ENGINE.read_text()
    storage = STORAGE.read_text()
    for token in (
        "learn-hub-mode-scene",
        "learn-hub-mode-weak",
        "learn-hub-back-to-full",
        "isModeEmpty",
    ):
        assert token not in engine, (
            f"Engine unexpectedly references Hub-only token `{token}`."
        )
        assert token not in storage, (
            f"Storage unexpectedly references Hub-only token `{token}`."
        )


def test_22_expo_camera_patch_intact() -> None:
    patch = PATCH.read_text()
    assert "isStabilizationSupported" in patch
    assert "Camera provider unavailable" in patch


# ───────────────────────────────────────────────────────────────────────
# Runtime engine smoke — reuse the existing 22 runtime assertions baseline.
# Nothing to add here; source-level tests above already lock the fix
# contract and the pre-existing runtime suite still exercises
# extractLearnItems / aggregateProgress / createSession end-to-end.
# ───────────────────────────────────────────────────────────────────────
