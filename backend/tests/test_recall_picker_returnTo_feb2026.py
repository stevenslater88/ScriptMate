"""
V1 Release Blocker regression tests — Recall script-picker return path.

Context
-------
After the first guard fix (test_recall_scriptid_guard_feb2026.py) Home →
Recall correctly redirects to /scripts when no scriptId is supplied, but
tapping a script on /scripts hard-coded `router.push('/script/${id}')`
— which lands on the Rehearsal page, NOT the Adaptive Recall configuration
screen. Physical test reproduced this.

Fix contract
------------
- `recall.tsx` now redirects with `returnTo=recall` query param.
- `scripts.tsx` reads `returnTo` and routes selection to `/recall?scriptId=<id>`
  via `router.replace({ pathname: '/recall', params: { scriptId: id } })` when
  `returnTo === 'recall'`; otherwise preserves the pre-existing Rehearsal
  (`router.push('/script/${id}')`) behaviour so My Scripts / Upload are
  completely unchanged.
- Header title flips to "Pick a Script to Recall" in return-to-recall mode.
- Scripts in return-to-recall mode use testID `recall-pick-script-<id>` so
  automated UI drivers can target the right entry point.

Scope
-----
Pure structural + behavioural assertions over the two files. We do not
touch Rehearsal, parser, RevenueCat, Daily Drill, dependencies, or any
frozen tests. Frontend has no Jest harness and the user forbids dep
changes; pytest structural checks are the correct contract.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

RECALL_PATH = Path("/app/frontend/app/recall.tsx")
SCRIPTS_PATH = Path("/app/frontend/app/scripts.tsx")
INDEX_PATH = Path("/app/frontend/app/index.tsx")


@pytest.fixture(scope="module")
def recall_source() -> str:
    assert RECALL_PATH.exists()
    return RECALL_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def scripts_source() -> str:
    assert SCRIPTS_PATH.exists()
    return SCRIPTS_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def index_source() -> str:
    assert INDEX_PATH.exists()
    return INDEX_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# A. Home → Recall (no scriptId) → /scripts?returnTo=recall
# ---------------------------------------------------------------------------

def test_home_recall_toolcard_still_targets_recall_route(index_source: str):
    """Minimal blast radius: the home-screen card still routes to /recall."""
    assert 'route="/recall"' in index_source


def test_recall_guard_redirects_with_returnTo_param(recall_source: str):
    """recall.tsx must redirect to /scripts?returnTo=recall when guard trips."""
    assert "router.replace('/scripts?returnTo=recall')" in recall_source


# ---------------------------------------------------------------------------
# B. Scripts library reads returnTo and routes selection back to Recall
# ---------------------------------------------------------------------------

def test_scripts_library_reads_returnTo_query_param(scripts_source: str):
    """scripts.tsx must read the returnTo query parameter via useLocalSearchParams."""
    assert "useLocalSearchParams" in scripts_source
    # Typed read of returnTo
    assert re.search(
        r"useLocalSearchParams<\{\s*returnTo\?:\s*string\s*\}>",
        scripts_source,
    ), "Expected typed useLocalSearchParams<{ returnTo?: string }>."


def test_scripts_library_detects_recall_mode(scripts_source: str):
    """scripts.tsx must flip to recall-return mode only when returnTo === 'recall'."""
    assert "const isReturnToRecall = returnTo === RETURN_TO_RECALL;" in scripts_source
    assert "const RETURN_TO_RECALL = 'recall';" in scripts_source


def test_scripts_library_routes_selection_back_to_recall(scripts_source: str):
    """When returnTo=recall, selecting a script must go to /recall with scriptId."""
    pattern = re.compile(
        r"if\s*\(isReturnToRecall\)\s*\{\s*"
        r"router\.replace\(\s*\{\s*pathname:\s*['\"]/recall['\"],\s*"
        r"params:\s*\{\s*scriptId:\s*id\s*\}\s*\}\s*\);",
        re.DOTALL,
    )
    assert pattern.search(scripts_source), (
        "Expected `if (isReturnToRecall) { router.replace({ pathname: '/recall', "
        "params: { scriptId: id } }) }` branch."
    )


def test_scripts_library_default_selection_preserved_for_normal_flow(scripts_source: str):
    """When returnTo is absent, selecting a script must still open Rehearsal
    at /script/${id} — My Scripts / Upload behaviour unchanged."""
    assert "router.push(`/script/${id}`)" in scripts_source


def test_scripts_card_uses_handleSelectScript_not_hardcoded_route(scripts_source: str):
    """The TouchableOpacity onPress must dispatch through handleSelectScript,
    not call router.push directly — the single dispatch is the whole fix."""
    pattern = re.compile(
        r"onPress=\{\(\)\s*=>\s*handleSelectScript\(script\.id\)\}",
        re.DOTALL,
    )
    assert pattern.search(scripts_source), (
        "Script card onPress must be `() => handleSelectScript(script.id)`."
    )


def test_scripts_card_has_recall_mode_testid(scripts_source: str):
    """Script card testID must flip to `recall-pick-script-<id>` in Recall mode."""
    assert "isReturnToRecall ? `recall-pick-script-${script.id}` : `open-script-${script.id}`" in scripts_source


def test_scripts_header_flips_in_recall_mode(scripts_source: str):
    """Header text must reflect Recall selection so the user understands
    why the library opened in a non-default context."""
    assert "'Pick a Script to Recall'" in scripts_source
    assert "'My Scripts'" in scripts_source
    assert 'testID="scripts-header-title"' in scripts_source


# ---------------------------------------------------------------------------
# C. Valid scriptId still works; invalid id still redirects (regression)
# ---------------------------------------------------------------------------

def test_recall_still_resolves_valid_script_id_without_detour(recall_source: str):
    """A valid scriptId must NOT trigger the redirect — direct Recall still works."""
    # The guard is the ONLY entry to the redirect path.
    assert "const needsScriptSelection = !scriptId || !script;" in recall_source
    # Core Recall mechanic preserved.
    assert "initializeGame" in recall_source
    assert "revealWord" in recall_source


def test_recall_invalid_scriptId_still_caught_by_guard(recall_source: str):
    """`!script` branch covers nonexistent / stale ids."""
    assert "scripts.find(s => s.id === scriptId)" in recall_source
    # Both branches of the guard must remain combined with `||`.
    assert "!scriptId || !script" in recall_source


# ---------------------------------------------------------------------------
# D. No new Recall component / no second Recall implementation
# ---------------------------------------------------------------------------

def test_no_duplicate_recall_implementation(recall_source: str):
    """There must be exactly one Recall screen export (not duplicated)."""
    # Exactly one default export of a RecallScreen.
    assert recall_source.count("export default function RecallScreen()") == 1


def test_no_new_script_picker_file_was_created():
    """The fix must not spawn a parallel picker screen."""
    picker_candidates = list(Path("/app/frontend/app").glob("recall-picker*"))
    picker_candidates += list(Path("/app/frontend/app").glob("script-picker*"))
    assert picker_candidates == [], (
        f"Unexpected new picker screen(s): {picker_candidates}. "
        "The fix must reuse the existing /scripts library route."
    )
