"""Regression lock — Premium downgrade race (ScriptMate Pro).

2026-02 Physical QA Blocker — Samsung S23 Ultra, build 1.0.69 / VC1115:
after the entitlement identifier was corrected from "ScriptM8 Pro" to
"ScriptMate Pro", a user with an active RevenueCat subscription whose
backend row was still 'free' (because the server-side /subscribe step
had previously failed under the old entitlement name) saw Performance
and Loop rehearsal modes locked while Recall remained available.

Root cause: scriptStore.fetchUserLimits() unconditionally overwrote the
client-side `isPremium` with the backend's `is_premium` field. The
backend lags RevenueCat whenever /subscribe has not run successfully,
so the clobber demoted the UI even when the RC entitlement was active.

Fix: when the backend reports is_premium=false, re-check the local
RevenueCat SDK (via checkPremiumAccess) and the dev-test flag; only
demote the UI if both agree. Backend-side feature gates still enforce
real access via check_user_limits().

This test is a static-source audit on the single file that owns
`isPremium`. We avoid running the TS code (would require jest + a
react-native mock harness that doesn't exist in this project) and
instead lock the contract so a future refactor can't silently
re-introduce the clobber.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_STORE = REPO_ROOT / "frontend" / "store" / "scriptStore.ts"
SCRIPT_DETAIL = REPO_ROOT / "frontend" / "app" / "script" / "[id].tsx"
USE_RC_HOOK = REPO_ROOT / "frontend" / "hooks" / "useRevenueCat.ts"
REVENUECAT_SVC = REPO_ROOT / "frontend" / "services" / "revenuecat.ts"


def _read(path: Path) -> str:
    assert path.exists(), f"missing expected source file: {path}"
    return path.read_text(encoding="utf-8")


# ─── fetchUserLimits isolation ─────────────────────────────────────────────
def _extract_fetch_user_limits(src: str) -> str:
    """Pull just the fetchUserLimits function body from scriptStore.ts."""
    m = re.search(
        r"fetchUserLimits:\s*async\s*\(\s*\)\s*=>\s*\{(.*?)\n  \},",
        src,
        re.DOTALL,
    )
    assert m, "could not locate fetchUserLimits in scriptStore.ts"
    return m.group(1)


def test_fetch_user_limits_does_not_unconditionally_clobber_is_premium() -> None:
    """The old pattern `isPremium: response.data.is_premium` must not
    appear bare in fetchUserLimits — that pattern was the clobber bug.
    """
    body = _extract_fetch_user_limits(_read(SCRIPT_STORE))
    offenders = re.findall(
        r"isPremium:\s*response\.data\.is_premium\b",
        body,
    )
    assert offenders == [], (
        "fetchUserLimits must not unconditionally set "
        "`isPremium: response.data.is_premium`. "
        "That reintroduces the Feb-2026 downgrade race where a user with "
        "an active RevenueCat ScriptMate Pro entitlement but a stale "
        "backend `subscription_tier='free'` row would see Performance / "
        "Loop locked. If the backend lags, consult checkPremiumAccess() "
        "and isDevTestMode() before demoting. "
        f"Offending occurrences: {offenders}"
    )


def test_fetch_user_limits_rechecks_revenuecat_before_demoting() -> None:
    """When the backend says free, fetchUserLimits must re-check the
    local RC SDK (checkPremiumAccess) AND the dev-test flag before
    writing isPremium=false.
    """
    body = _extract_fetch_user_limits(_read(SCRIPT_STORE))
    assert "checkPremiumAccess" in body, (
        "fetchUserLimits must call checkPremiumAccess() as the fallback "
        "when the backend reports is_premium=false."
    )
    assert "isDevTestMode" in body, (
        "fetchUserLimits must also honour isDevTestMode() alongside "
        "checkPremiumAccess() so QA dev-test mode works post-fix."
    )
    # Confirm the function actually uses the fallback in the computed
    # value, not just imports it for show.
    assert re.search(
        r"effectiveIsPremium\s*=\s*devMode\s*\|\|\s*rcPremium",
        body,
    ) or re.search(
        r"effectiveIsPremium\s*=\s*rcPremium\s*\|\|\s*devMode",
        body,
    ), (
        "fetchUserLimits must OR devMode and rcPremium when the backend "
        "reports is_premium=false — otherwise the fallback is dead code."
    )


def test_fetch_user_limits_still_updates_limits_from_backend() -> None:
    """The fix must not break the primary job of fetchUserLimits
    (updating `limits` from the backend response).
    """
    body = _extract_fetch_user_limits(_read(SCRIPT_STORE))
    assert re.search(r"limits:\s*response\.data\.limits", body), (
        "fetchUserLimits must still write `limits: response.data.limits` "
        "— the fix is only about preserving `isPremium`, not disabling "
        "the limits update."
    )


def test_fetch_user_limits_still_writes_is_premium() -> None:
    """When the backend reports is_premium=true we must trust and
    propagate it (so an upgrade immediately unlocks premium even if the
    SDK cache hasn't refreshed). The fix only guards the downgrade
    path.
    """
    body = _extract_fetch_user_limits(_read(SCRIPT_STORE))
    assert re.search(r"isPremium:\s*effectiveIsPremium", body) or re.search(
        r"isPremium:\s*backendIsPremium\s*\|\|",
        body,
    ), (
        "fetchUserLimits must still assign `isPremium` from the computed "
        "effective value. Removing the assignment entirely would break "
        "subscription-lapse downgrades."
    )


# ─── gating site — the symptom surface ─────────────────────────────────────
def test_rehearsal_mode_picker_still_uses_both_premium_sources() -> None:
    """The Script Detail mode picker (where Performance / Loop live)
    must still OR the store-level `isPremium` with the useRevenueCat
    hook's `isPremium`. Dropping either half re-exposes the bug.
    """
    src = _read(SCRIPT_DETAIL)
    assert "isPremium: isPremiumFromStore" in src, (
        "script/[id].tsx must still destructure isPremiumFromStore from "
        "useScriptStore()."
    )
    assert "isPremium: isPremiumFromRevenueCat" in src, (
        "script/[id].tsx must still destructure isPremiumFromRevenueCat "
        "from useRevenueCat()."
    )
    assert re.search(
        r"const\s+isPremium\s*=\s*isPremiumFromStore\s*\|\|\s*"
        r"isPremiumFromRevenueCat",
        src,
    ), (
        "script/[id].tsx must still OR the two sources. Collapsing to a "
        "single source would make the UI depend on backend lag alone and "
        "re-introduce the physical-QA symptom."
    )


def test_performance_and_loop_are_still_premium_gated() -> None:
    """Behavioural guarantee: once ScriptMate Pro is active (via either
    the backend row OR the RevenueCat entitlement), Performance and
    Loop must unlock. This test locks the structural shape that makes
    that guarantee hold.
    """
    src = _read(SCRIPT_DETAIL)
    # Each line reads: `premium: true` for performance and loop modes.
    perf = re.search(
        r"id:\s*'performance'[^}]*premium:\s*(true|false)",
        src,
    )
    loop = re.search(
        r"id:\s*'loop'[^}]*premium:\s*(true|false)",
        src,
    )
    assert perf and perf.group(1) == "true", (
        "Performance mode must stay flagged `premium: true` in "
        "MODE_OPTIONS."
    )
    assert loop and loop.group(1) == "true", (
        "Loop mode must stay flagged `premium: true` in MODE_OPTIONS."
    )

    # The gating expression must still be `mode.premium && !isPremium`.
    assert re.search(
        r"mode\.premium\s*&&\s*!isPremium",
        src,
    ), (
        "The isLocked predicate `mode.premium && !isPremium` must stay "
        "intact — any other expression could re-lock Performance/Loop "
        "even when the user is premium."
    )


def test_recall_remains_non_premium() -> None:
    """Observed on the physical device: Recall was still accessible
    while Performance/Loop were locked. That worked because Recall is
    flagged `premium: false`. Lock it so a future refactor can't
    accidentally gate Recall and widen the regression.
    """
    src = _read(SCRIPT_DETAIL)
    recall = re.search(
        r"id:\s*'recall'[^}]*premium:\s*(true|false)",
        src,
    )
    assert recall and recall.group(1) == "false", (
        "Recall mode must stay `premium: false` so free users keep "
        "access."
    )


# ─── useRevenueCat side — hook's OR must stay intact ───────────────────────
def test_use_revenuecat_still_or_customerinfo_and_store() -> None:
    """The hook combines three signals into `isPremium`:
    (storeIsPremium) OR (devTestModeActive) OR
    (customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]).

    This OR must stay intact so a backend-lagging user still sees the
    UI as premium.
    """
    src = _read(USE_RC_HOOK)
    assert re.search(
        r"const\s+isPremium\s*=\s*storeIsPremium\s*\|\|\s*"
        r"devTestModeActive\s*\|\|\s*"
        r"customerInfo\?\.entitlements\.active\[PREMIUM_ENTITLEMENT_ID\]"
        r"\s*!==\s*undefined",
        src,
    ), (
        "useRevenueCat.ts must still compute `isPremium` as the OR of "
        "storeIsPremium, devTestModeActive, and the RC entitlement "
        "lookup. Any tightening (e.g. && / only one source) would "
        "re-expose the Feb-2026 Performance/Loop regression."
    )


def test_entitlement_identifier_is_scriptmate_pro() -> None:
    """Belt-and-braces: the identifier must stay `ScriptMate Pro` in
    the frontend. If this drifts, every entitlement check breaks and
    the downgrade race becomes universal.
    """
    src = _read(REVENUECAT_SVC)
    assert "PREMIUM_ENTITLEMENT_ID = 'ScriptMate Pro'" in src, (
        "frontend/services/revenuecat.ts must keep PREMIUM_ENTITLEMENT_ID"
        " = 'ScriptMate Pro' so the hook's customerInfo lookup actually "
        "matches the RevenueCat dashboard entitlement."
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
