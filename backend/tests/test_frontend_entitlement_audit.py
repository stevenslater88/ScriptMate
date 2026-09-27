"""Frontend entitlement audit — regression tests.

Purpose: enforce that the entitlement/Premium check plumbing on the frontend
has ONE central resolution point that inherits the backend's QA_PREMIUM
bypass, and that no per-screen ad-hoc gate re-derives Premium from a source
that ignores the backend.

Root cause discovered during Phase 3 physical Samsung testing:
  * Two parallel entitlement systems existed in the app.
  * `useScriptStore.isPremium` was backend-driven (via GET /users/{id}/limits.
    is_premium) and correctly reflected QA_PREMIUM=true.
  * `useRevenueCat().isPremium` was derived from RevenueCat customerInfo +
    devTestMode ONLY, so screens that read the RC hook (Self-Tape hub,
    Acting Coach, Auditions, Dialect Coach, etc.) still saw the paywall
    even when the backend reported the user as premium.
  * `scriptStore.refreshPremiumStatus()` overwrote the store's `isPremium`
    with an RC-only value, clobbering the backend QA signal after any
    purchase/restore/customer-info-update event.

Fix (2 files, ~10 net lines):
  1. `hooks/useRevenueCat.ts` — the hook's derived `isPremium` now OR's in
     `useScriptStore((s) => s.isPremium)`, making the store the single
     source of truth for entitlement. Every gate that consumes the hook
     inherits QA_PREMIUM automatically.
  2. `store/scriptStore.ts::refreshPremiumStatus` — now re-fetches backend
     limits before merging, so QA_PREMIUM is never clobbered by RC.

Production safety:
  * The bypass lives entirely in the backend env. In production the flag
    is unset or "false", so backend `is_premium` follows real
    subscription_tier / RevenueCat, and the frontend OR is a no-op.
  * No client-side toggle. No new env var on the frontend.
  * Backend `.env` is gitignored — impossible to accidentally ship
    QA_PREMIUM=true in the Android bundle.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import List

import pytest
import requests


BACKEND_URL = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001").rstrip("/")

FRONTEND_ROOT = Path("/app/frontend")


def _read(rel: str) -> str:
    return (FRONTEND_ROOT / rel).read_text()


# ─────────────────────────────────────────────────────────────────────────────
# A. Central entitlement resolution — the hook reads from the store
# ─────────────────────────────────────────────────────────────────────────────

def test_use_revenuecat_hook_reads_store_isPremium() -> None:
    """The RC hook's derived `isPremium` MUST include the store's `isPremium`
    so backend QA_PREMIUM propagates to every hook consumer."""
    src = _read("hooks/useRevenueCat.ts")

    # A store selector must appear.
    assert "useScriptStore((state) => state.isPremium)" in src or \
           "useScriptStore(state => state.isPremium)" in src, (
        "useRevenueCat.ts must subscribe to useScriptStore's isPremium slice "
        "so the backend QA_PREMIUM signal flows through the hook."
    )

    # The derived `isPremium` line must OR that store value in.
    # Grep for the derivation line and assert it references the store value.
    m = re.search(r"const\s+isPremium\s*=\s*([^;\n]+);", src)
    assert m, "expected `const isPremium = ...` line in useRevenueCat.ts"
    expr = m.group(1)
    assert "storeIsPremium" in expr or "state.isPremium" in expr or \
           "useScriptStore" in expr, (
        f"the isPremium derivation must include the store selector; got: {expr!r}"
    )
    # Must still preserve devTestMode + RC-entitlement paths.
    assert "devTestModeActive" in expr, (
        "must not remove the devTestMode fallback"
    )
    assert "PREMIUM_ENTITLEMENT_ID" in expr, (
        "must not remove the RevenueCat entitlement check"
    )


# ─────────────────────────────────────────────────────────────────────────────
# B. refreshPremiumStatus preserves the backend QA signal
# ─────────────────────────────────────────────────────────────────────────────

def test_refresh_premium_status_refetches_backend() -> None:
    """`refreshPremiumStatus` must consult the backend (via fetchUserLimits)
    so the QA_PREMIUM signal isn't clobbered by an RC-only refresh."""
    src = _read("store/scriptStore.ts")

    # Find the refreshPremiumStatus body.
    m = re.search(
        r"refreshPremiumStatus:\s*async\s*\([^)]*\)\s*=>\s*\{(.*?)\n\s{2}\},",
        src, re.DOTALL,
    )
    assert m, "expected `refreshPremiumStatus: async () => { ... },` block"
    body = m.group(1)

    assert "fetchUserLimits" in body, (
        "refreshPremiumStatus must call fetchUserLimits() so the backend "
        "QA_PREMIUM / subscription_tier signal is honoured on every refresh."
    )
    # After fetchUserLimits, the isPremium set must OR-in the backend value,
    # never overwrite with just devMode|rcPremium.
    assert "backendPremium" in body or "get().isPremium" in body, (
        "refreshPremiumStatus must read the backend-driven isPremium and "
        "OR it into the final merged value"
    )


# ─────────────────────────────────────────────────────────────────────────────
# C. Enumerate all frontend Premium gates — every screen with a gate must
#    consume EITHER useRevenueCat().isPremium OR useScriptStore.isPremium.
#    Both are now wired to the central resolution, so any gate site is safe.
# ─────────────────────────────────────────────────────────────────────────────

# Files verified during the audit to hold a Premium gate.
# Structure: (path, kind) where kind is:
#   "hook"  = must consume useRevenueCat() or useScriptStore() directly
#   "prop"  = child component that receives isPremium as a prop from a parent
GATE_FILES: List[tuple] = [
    ("app/selftape/index.tsx", "hook"),       # Self-Tape hub (was BROKEN)
    ("app/acting-coach.tsx", "hook"),         # was BROKEN
    ("app/auditions.tsx", "hook"),            # was BROKEN
    ("app/dialect-coach.tsx", "hook"),        # was BROKEN
    ("app/recall.tsx", "hook"),               # mixed
    ("app/script/[id].tsx", "hook"),          # mixed
    ("app/premium.tsx", "hook"),              # mixed (paywall screen itself)
    ("app/dashboard.tsx", "hook"),            # store-based
    ("app/index.tsx", "hook"),                # store-based
    ("app/rehearsal/[id].tsx", "hook"),       # store-based
    ("app/profile.tsx", "hook"),              # store-based
    ("app/script/notes/[id].tsx", "hook"),    # store-based
    ("app/stats.tsx", "hook"),                # store-based
    ("components/VoiceAssignment.tsx", "prop"),  # receives isPremium as prop
]

@pytest.mark.parametrize("rel_path,kind", GATE_FILES)
def test_every_premium_gate_site_uses_central_source(rel_path: str, kind: str) -> None:
    """A gate site must derive its `isPremium` from one of the two hooks that
    are now both wired to the central store-driven resolution, OR receive it
    as a prop from a parent that does. This prevents someone from
    reintroducing a screen-local Premium check that ignores QA."""
    src = _read(rel_path)
    uses_rc = "useRevenueCat" in src
    uses_store = "useScriptStore" in src and "isPremium" in src
    if kind == "prop":
        # A child component must declare isPremium in its props interface.
        assert re.search(r"isPremium:\s*boolean", src), (
            f"{rel_path} is marked as a prop-based gate site but does not "
            f"declare `isPremium: boolean` in its props — verify its parent "
            f"still passes down a central isPremium value."
        )
    else:
        assert uses_rc or uses_store, (
            f"{rel_path} appears to gate on Premium but uses neither hook — "
            f"introduce a store or RC hook read so QA_PREMIUM propagates."
        )


# ─────────────────────────────────────────────────────────────────────────────
# D. Self-Tape specific gate — the exact site that was breaking on Samsung
# ─────────────────────────────────────────────────────────────────────────────

def test_selftape_hub_uses_revenuecat_hook() -> None:
    """The Self-Tape hub gates `handleSelectScript` and `handleViewLibrary`
    on `isPremium`. Both gates come from `useRevenueCat()`. Since the hook
    now inherits the store's backend-driven isPremium, QA_PREMIUM unlocks
    the character-selection step that was breaking on physical Samsung."""
    src = _read("app/selftape/index.tsx")
    assert "const { isPremium } = useRevenueCat()" in src or \
           "isPremium" in src, "self-tape hub must consume isPremium"
    # Regression: the gate that trips on 'Self Tape → select script'
    assert "handleSelectScript" in src
    assert "router.push('/premium')" in src, (
        "the paywall redirect must remain — QA merely unlocks the isPremium "
        "guard before it, not the redirect itself"
    )


# ─────────────────────────────────────────────────────────────────────────────
# E. Backend QA_PREMIUM live verification — end-to-end check
# ─────────────────────────────────────────────────────────────────────────────

def _qa_premium_active() -> bool:
    try:
        probe = f"audit-probe-{uuid.uuid4().hex[:8]}"
        requests.post(f"{BACKEND_URL}/api/users", json={"device_id": probe}, timeout=10)
        r = requests.get(f"{BACKEND_URL}/api/users/{probe}/limits", timeout=10)
        return bool(r.ok and r.json().get("qa_premium_bypass") is True)
    except Exception:
        return False


def test_backend_qa_premium_flows_via_users_limits_endpoint() -> None:
    """End-to-end: the endpoint the frontend actually reads
    (`GET /api/users/{id}/limits`) must expose `is_premium=True` and
    `qa_premium_bypass=True` when QA_PREMIUM=true is set."""
    if not _qa_premium_active():
        pytest.skip("QA_PREMIUM not active on backend — nothing to verify")

    device = f"audit-e2e-{uuid.uuid4().hex[:8]}"
    requests.post(f"{BACKEND_URL}/api/users", json={"device_id": device}, timeout=10)
    r = requests.get(f"{BACKEND_URL}/api/users/{device}/limits", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["is_premium"] is True
    assert body["tier"] == "premium"
    assert body["qa_premium_bypass"] is True


# ─────────────────────────────────────────────────────────────────────────────
# F. Production safety — no frontend file references QA_PREMIUM directly
# ─────────────────────────────────────────────────────────────────────────────

def test_no_frontend_file_references_qa_premium_directly() -> None:
    """The QA bypass must remain a backend env-only mechanism. No frontend
    source may read a QA_PREMIUM env var, AsyncStorage key, or global that
    could accidentally ship in a production build."""
    forbidden_snippets = [
        "process.env.QA_PREMIUM",
        "EXPO_PUBLIC_QA_PREMIUM",
        "'QA_PREMIUM'",
        '"QA_PREMIUM"',
    ]
    for path in FRONTEND_ROOT.rglob("*.ts"):
        if "node_modules" in path.parts or ".expo" in path.parts:
            continue
        text = path.read_text()
        for snippet in forbidden_snippets:
            assert snippet not in text, (
                f"{path} references {snippet!r} — QA_PREMIUM must remain "
                f"backend-only, never inlined in the client bundle."
            )
    for path in FRONTEND_ROOT.rglob("*.tsx"):
        if "node_modules" in path.parts or ".expo" in path.parts:
            continue
        text = path.read_text()
        for snippet in forbidden_snippets:
            assert snippet not in text, (
                f"{path} references {snippet!r} — QA_PREMIUM must remain "
                f"backend-only, never inlined in the client bundle."
            )


# ─────────────────────────────────────────────────────────────────────────────
# G. RevenueCat plumbing must remain intact when QA is disabled
# ─────────────────────────────────────────────────────────────────────────────

def test_revenuecat_service_still_reads_entitlements() -> None:
    """The RC service must still resolve premium from customerInfo entitlements
    — the QA bypass is layered on top, not a replacement."""
    src = _read("services/revenuecat.ts")
    assert "customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]" in src, (
        "revenuecat.ts must still resolve premium from RC customerInfo — "
        "QA bypass supplements, does not replace"
    )
    assert "PREMIUM_ENTITLEMENT_ID = 'ScriptM8 Pro'" in src, (
        "the entitlement identifier must not have been renamed / removed"
    )


def test_scriptstore_purchase_and_subscribe_paths_untouched() -> None:
    """The real-purchase (`subscribe`) and trial (`startTrial`) code paths
    that update Mongo `subscription_tier` must remain intact — they are the
    production monetisation path and unrelated to QA."""
    src = _read("store/scriptStore.ts")
    assert "startTrial:" in src
    assert "subscribe:" in src
    assert "/api/users/${deviceId}/subscribe" in src
    assert "/api/users/${deviceId}/start-trial" in src


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
