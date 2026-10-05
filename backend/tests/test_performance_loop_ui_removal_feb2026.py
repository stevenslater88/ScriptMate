"""
V1 Launch Simplification — Performance / Loop modes REMOVED (Feb 2026).

Decision
--------
After the physical build cycle, the Performance and Loop rehearsal modes
are REMOVED from the user-facing UI for the V1 launch. The modes remain
declared on the backend's `PREMIUM_TIER_LIMITS.available_modes` so legacy
clients and any in-flight rehearsals never 404 the gate, but the user
cannot select either through the normal UI.

Scope (deliberately narrow)
---------------------------
* `frontend/app/script/[id].tsx::MODE_OPTIONS`
    → Performance and Loop card entries removed.
* `frontend/app/stats.tsx`
    → "Performance mode" pro-tip rewritten to reference Full Read.
* `frontend/app/rehearsal/[id].tsx`
    → "Ready to Rehearse" subtitle now falls through to "Full Read"
      instead of labelling unknown modes as "Performance".

NOT touched
-----------
* Backend `FREE_TIER_LIMITS` / `PREMIUM_TIER_LIMITS` are untouched —
  the modes remain declared for legacy clients.
* The internal `LinePerformance` type and performance-stats bookkeeping
  are untouched (unrelated to the "Performance" mode name).
* ElevenLabs, RevenueCat, Premium pricing, SEC-003/004, parser, Recall,
  Daily Drill, Teleprompter, Self-Tape all untouched.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

SCRIPT_PAGE = Path("/app/frontend/app/script/[id].tsx")
STATS_PAGE = Path("/app/frontend/app/stats.tsx")
REHEARSAL_PAGE = Path("/app/frontend/app/rehearsal/[id].tsx")
SERVER_PY = Path("/app/backend/server.py")


@pytest.fixture(scope="module")
def script_page_source() -> str:
    return SCRIPT_PAGE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def stats_source() -> str:
    return STATS_PAGE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def rehearsal_source() -> str:
    return REHEARSAL_PAGE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def server_source() -> str:
    return SERVER_PY.read_text(encoding="utf-8")


# ─── 1. Mode selector no longer offers Performance or Loop ────────────

def test_mode_options_does_not_expose_performance(script_page_source: str):
    """The MODE_OPTIONS array must not contain any card with id='performance'."""
    # Find the MODE_OPTIONS block.
    start = script_page_source.find("const MODE_OPTIONS")
    end = script_page_source.find("];", start)
    assert start != -1 and end != -1
    block = script_page_source[start:end]
    assert "id: 'performance'" not in block, (
        "Performance mode card must be removed from MODE_OPTIONS."
    )


def test_mode_options_does_not_expose_loop(script_page_source: str):
    """The MODE_OPTIONS array must not contain any card with id='loop'."""
    start = script_page_source.find("const MODE_OPTIONS")
    end = script_page_source.find("];", start)
    assert start != -1 and end != -1
    block = script_page_source[start:end]
    assert "id: 'loop'" not in block, (
        "Loop mode card must be removed from MODE_OPTIONS."
    )


def test_mode_options_still_exposes_full_read(script_page_source: str):
    """Full Read must remain a selectable card and remains the default."""
    start = script_page_source.find("const MODE_OPTIONS")
    end = script_page_source.find("];", start)
    block = script_page_source[start:end]
    assert "id: 'full_read'" in block
    assert "name: 'Full Read'" in block
    # Default selected mode is still full_read.
    assert "useState('full_read')" in script_page_source


def test_mode_options_still_exposes_cue_only_and_recall(script_page_source: str):
    """Only Performance + Loop are being removed. Cue Only and Recall stay."""
    start = script_page_source.find("const MODE_OPTIONS")
    end = script_page_source.find("];", start)
    block = script_page_source[start:end]
    assert "id: 'cue_only'" in block
    assert "id: 'recall'" in block


def test_no_premium_locked_mode_remains(script_page_source: str):
    """Every remaining mode card must declare `premium: false` — no
    user-visible Premium lock on the mode selector."""
    start = script_page_source.find("const MODE_OPTIONS")
    end = script_page_source.find("];", start)
    block = script_page_source[start:end]
    assert "premium: true" not in block, (
        "No remaining MODE_OPTIONS card may be flagged `premium: true`."
    )


def test_removal_comment_is_present_for_future_contributors(script_page_source: str):
    """The removal is documented in-source so future contributors do not
    accidentally re-add the cards without reviewing the launch decision."""
    start = script_page_source.find("const MODE_OPTIONS")
    end = script_page_source.find("];", start)
    block = script_page_source[start:end]
    assert "Performance and Loop modes REMOVED" in block


# ─── 2. Supporting UI references cleaned up ───────────────────────────

def test_stats_tip_no_longer_recommends_performance_mode(stats_source: str):
    assert '"Performance" mode' not in stats_source
    assert "Full Read mode" in stats_source


def test_rehearsal_idle_subtitle_no_longer_labels_unknown_as_performance(rehearsal_source: str):
    """The idle-screen fallback label for an unknown mode must no longer
    read "Performance"."""
    # The old string: ...? 'Cue Only' : 'Performance'
    assert "? 'Cue Only' : 'Performance'" not in rehearsal_source
    # The new fallback is 'Full Read'.
    assert "? 'Cue Only' : 'Full Read'" in rehearsal_source


# ─── 3. Backend contract preserved (modes still declared) ─────────────

def test_backend_premium_tier_limits_still_declare_performance_and_loop(server_source: str):
    """Backend still accepts these modes for legacy clients. We are only
    hiding them from the UI. The modes remain declared so any already-
    created rehearsal with mode=performance|loop (from an older APK) can
    still be opened / finished without a 404 at the gate."""
    # Find the PREMIUM_TIER_LIMITS block.
    start = server_source.find("PREMIUM_TIER_LIMITS = {")
    end = server_source.find("}", start)
    block = server_source[start:end]
    assert "'performance'" in block or '"performance"' in block
    assert "'loop'" in block or '"loop"' in block


# ─── 4. Dead-reference audit — no new orphans introduced ──────────────

def test_no_user_facing_performance_mode_card_remains_elsewhere():
    """Sweep the frontend/app tree for any user-visible string that still
    presents Performance as a selectable rehearsal mode."""
    offenders: list[tuple[str, str]] = []
    for p in Path("/app/frontend/app").rglob("*.tsx"):
        text = p.read_text(encoding="utf-8")
        # Flag only user-visible presentations of the "Performance mode"
        # concept — skip internal perf tracking (LinePerformance etc.)
        # and skip the Self-Tape "Performance recording" line.
        if '"Performance" mode' in text:
            offenders.append((str(p), '"Performance" mode'))
        if "name: 'Performance'" in text and "id: 'performance'" in text:
            offenders.append((str(p), "MODE_OPTIONS entry"))
    assert offenders == [], (
        f"Residual user-visible Performance mode references: {offenders}"
    )


def test_no_user_facing_loop_mode_card_remains_elsewhere():
    offenders: list[tuple[str, str]] = []
    for p in Path("/app/frontend/app").rglob("*.tsx"):
        text = p.read_text(encoding="utf-8")
        if "name: 'Loop'" in text and "id: 'loop'" in text:
            offenders.append((str(p), "MODE_OPTIONS entry"))
    assert offenders == [], (
        f"Residual user-visible Loop mode references: {offenders}"
    )


# ─── 5. Full Read regression contract ─────────────────────────────────

def test_full_read_remains_in_both_tier_limits(server_source: str):
    """Full Read is the shared default — must remain in both FREE and
    PREMIUM available_modes so a free user can still start a rehearsal."""
    # Find the FREE_TIER_LIMITS block.
    start = server_source.find("FREE_TIER_LIMITS = {")
    end = server_source.find("}", start)
    free_block = server_source[start:end]
    assert "'full_read'" in free_block or '"full_read"' in free_block
    # Find the PREMIUM_TIER_LIMITS block.
    start = server_source.find("PREMIUM_TIER_LIMITS = {")
    end = server_source.find("}", start)
    prem_block = server_source[start:end]
    assert "'full_read'" in prem_block or '"full_read"' in prem_block


def test_create_rehearsal_endpoint_signature_unchanged(server_source: str):
    """The createRehearsal API contract is unchanged — only the UI
    changed. This pins the signature so a future accidental edit of the
    endpoint shape (e.g., removing the mode field) is caught here."""
    assert "@api_router.post(\"/rehearsals\", response_model=RehearsalSession)" in server_source
    assert "rehearsal_data: RehearsalCreate" in server_source
    assert "rc_app_user_id: Optional[str] = Depends(extract_rc_app_user_id_header)" in server_source
