"""
V1 Release Blocker regression test — Adaptive Recall `scriptId` guard.

Context
-------
The Home-screen Recall tool card navigates to `/recall` with no `scriptId`
query parameter. Previously `frontend/app/recall.tsx` would silently fall
back to `{ name: 'Full Script', lines: script?.lines || [] }` and present
the user with a usable but 0-line Recall session (physical test failure
reported Feb 2026).

Fix
---
`recall.tsx` now:
  1. Computes `needsScriptSelection = !scriptId || !script` at the top.
  2. Runs a `useEffect` that `router.replace('/scripts')` when the guard trips.
  3. Returns a dedicated redirect view (no empty session rendered) with
     testIDs `recall-redirect-screen` and `recall-redirect-title`.

These structural tests pin the guard in place so a future regression cannot
re-introduce the 0-line Recall session. They intentionally do NOT exercise
RN rendering — the frontend has no Jest harness and the user forbids
dependency changes. Source-level assertions are the appropriate contract
for this fix.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

RECALL_PATH = Path("/app/frontend/app/recall.tsx")
INDEX_PATH = Path("/app/frontend/app/index.tsx")
SCRIPTS_PATH = Path("/app/frontend/app/scripts.tsx")


@pytest.fixture(scope="module")
def recall_source() -> str:
    assert RECALL_PATH.exists(), f"missing {RECALL_PATH}"
    return RECALL_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def index_source() -> str:
    assert INDEX_PATH.exists(), f"missing {INDEX_PATH}"
    return INDEX_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def scripts_source() -> str:
    assert SCRIPTS_PATH.exists(), f"missing {SCRIPTS_PATH}"
    return SCRIPTS_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# A. /recall WITHOUT scriptId → guard trips, redirect to library, no session
# ---------------------------------------------------------------------------

def test_guard_variable_is_computed_from_both_missing_id_and_missing_script(recall_source: str):
    """`needsScriptSelection` must trip for BOTH missing param and missing script."""
    assert "const needsScriptSelection = !scriptId || !script;" in recall_source, (
        "Expected `needsScriptSelection = !scriptId || !script` guard variable."
    )


def test_guard_redirects_to_existing_library_route(recall_source: str):
    """Guard must call `router.replace('/scripts')` — reusing the existing route."""
    # The redirect effect: calls router.replace('/scripts') only when guard trips.
    pattern = re.compile(
        r"useEffect\(\(\)\s*=>\s*\{\s*if\s*\(needsScriptSelection\)\s*\{\s*"
        r"router\.replace\(['\"]/scripts['\"]\);?\s*\}\s*\},\s*\[needsScriptSelection\]\);",
        re.DOTALL,
    )
    assert pattern.search(recall_source), (
        "Expected a useEffect that calls router.replace('/scripts') when "
        "needsScriptSelection is true, keyed on [needsScriptSelection]."
    )


def test_guard_renders_dedicated_redirect_view_not_empty_session(recall_source: str):
    """When guard trips, a dedicated view renders — not the main Recall screen."""
    # Early return for needsScriptSelection must exist and include the redirect
    # screen testID. This prevents the transient 0-line Recall session.
    assert 'testID="recall-redirect-screen"' in recall_source
    assert 'testID="recall-redirect-title"' in recall_source
    guard_block = re.compile(
        r"if\s*\(needsScriptSelection\)\s*\{\s*return\s*\(\s*<SafeAreaView[^>]*testID=\"recall-redirect-screen\"",
        re.DOTALL,
    )
    assert guard_block.search(recall_source), (
        "Expected `if (needsScriptSelection) { return <SafeAreaView testID=\"recall-redirect-screen\" .../> }`."
    )


def test_loadprogress_effect_is_skipped_during_redirect(recall_source: str):
    """`loadProgress` must NOT fire when guard trips (prevents empty-session side effects)."""
    pattern = re.compile(
        r"useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!needsScriptSelection\)\s*\{\s*loadProgress\(\);?\s*\}\s*\},\s*"
        r"\[sceneId,\s*needsScriptSelection\]\);",
        re.DOTALL,
    )
    assert pattern.search(recall_source), (
        "loadProgress effect must be gated by `if (!needsScriptSelection)` and "
        "include `needsScriptSelection` in the deps array."
    )


# ---------------------------------------------------------------------------
# B. /recall?scriptId=<valid> → existing Recall flow preserved
# ---------------------------------------------------------------------------

def test_existing_recall_flow_preserved_for_valid_script_id(recall_source: str):
    """The main render paths (settings/game/results) must still be present."""
    # Settings-screen branch
    assert "if (!gameStarted) {" in recall_source
    # Results-screen branch
    assert "if (gameComplete) {" in recall_source
    # Core Recall mechanic
    assert "initializeGame" in recall_source
    assert "revealWord" in recall_source
    # The script resolution still uses the same store+lookup
    assert "scripts.find(s => s.id === scriptId)" in recall_source


def test_scene_fallback_still_present_but_unreachable_for_invalid_ids(recall_source: str):
    """The `[{ name: 'Full Script', ... }]` fallback remains — but gated behind the guard.

    We confirm the guard is declared BEFORE the fallback expression in the source
    (so with a missing/invalid id, the guard short-circuits render before any
    0-line session can be presented).
    """
    guard_idx = recall_source.find("const needsScriptSelection =")
    fallback_idx = recall_source.find("const scenes = script?.scenes || [{ name: 'Full Script'")
    guard_check_idx = recall_source.find("if (needsScriptSelection) {")
    assert guard_idx != -1 and fallback_idx != -1 and guard_check_idx != -1
    # Guard variable declared before fallback expression
    assert guard_idx < fallback_idx, "Guard must be declared before scenes fallback."
    # Guard early-return must happen BEFORE the main `if (!gameStarted)` render
    main_render_idx = recall_source.find("// Settings screen\n  if (!gameStarted) {")
    assert guard_check_idx < main_render_idx, (
        "Guard early-return must occur before the main `if (!gameStarted)` render."
    )


# ---------------------------------------------------------------------------
# C. /recall?scriptId=<nonexistent> → handled safely by same guard
# ---------------------------------------------------------------------------

def test_guard_covers_nonexistent_script_id_case(recall_source: str):
    """`!script` branch inside the guard covers the stale/nonexistent id case."""
    # The guard variable combines both conditions with `||`.
    assert "!scriptId || !script" in recall_source, (
        "Guard must cover BOTH the missing param AND the stale/nonexistent id cases."
    )


# ---------------------------------------------------------------------------
# D. Home-screen Recall ToolCard still targets /recall — the guard, not the home
#    screen, is the correct fix location (minimal blast radius).
# ---------------------------------------------------------------------------

def test_home_screen_recall_toolcard_still_targets_recall_route(index_source: str):
    assert 'route="/recall"' in index_source, (
        "Home-screen Recall ToolCard should still navigate to `/recall`; "
        "the fix lives in recall.tsx, not in the home navigation."
    )
    assert 'testId="recall-btn"' in index_source


def test_library_route_scripts_exists(scripts_source: str):
    """The redirect target `/scripts` must exist as the library screen."""
    assert "export default function ScriptsScreen()" in scripts_source
    # Library screen reads from the same store Recall reads from
    assert "useScriptStore" in scripts_source


# ---------------------------------------------------------------------------
# Rules-of-Hooks sanity: all hooks run before the conditional early return.
# ---------------------------------------------------------------------------

def test_hooks_run_before_conditional_early_return(recall_source: str):
    """The guard early return must sit AFTER every hook call to satisfy
    React's Rules of Hooks (needsScriptSelection can flip when the async
    `scripts` store populates)."""
    # Positions of the last hook calls that MUST run every render
    last_use_effect_idx = recall_source.rfind("useEffect(")  # redirect effect is the last useEffect at top
    use_callback_idx = recall_source.find("useCallback(")
    use_ref_fade_idx = recall_source.find("useRef(new Animated.Value(1)")
    guard_return_idx = recall_source.find("if (needsScriptSelection) {\n    return (")
    assert all(i != -1 for i in [use_callback_idx, use_ref_fade_idx, guard_return_idx]), (
        "Expected to find useCallback, fadeAnim useRef, and guard early-return."
    )
    assert use_callback_idx < guard_return_idx, "useCallback must execute before the guard return."
    assert use_ref_fade_idx < guard_return_idx, "fadeAnim useRef must execute before the guard return."
    assert last_use_effect_idx < guard_return_idx, "All useEffect hooks must execute before the guard return."
