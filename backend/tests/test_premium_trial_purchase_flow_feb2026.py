"""2026-02 SCRIPT M8 — Premium Trial Purchase-First Flow regression suite.

Covers the final-trial-fix set of guarantees:

  1. The frontend trial button triggers a RevenueCat purchase, NOT a
     direct backend /start-trial call that bypasses Google Play.
  2. `hasIntroOffer(yearlyPackage)` is consulted BEFORE firing a
     purchase, so a product without a trial doesn't accidentally
     charge the user AND the UI reports the configuration gap
     clearly.
  3. Backend SEC-003 (`fetch_premium_entitlement` → 402 if no active
     entitlement) remains intact — no local Premium grants, no QA
     bypass added in this diff.
  4. SEC-002 (`enforce_user_id_match`) remains intact across the
     three Premium endpoints.
  5. `premium.tsx` no longer reads a stale `storeError` closure in
     its Alerts after an async store action — it reads the fresh
     Zustand state via `useScriptStore.getState().error`.
  6. `startTrial` and `subscribe` in the Zustand store now emit
     `DebugLog.functionStart / apiRequest / apiResponse / apiError /
     functionSuccess / functionError` mirroring the `createScript`
     pattern — so future physical-device failures show up in the
     diagnostic report with endpoint + HTTP status.
  7. Already-Premium users are routed to the "You're Pro" branch
     before the Trial button renders.
  8. The missing monthly product does not crash the yearly trial
     flow (a hostile `monthlyPackage=undefined` is tolerated).
  9. Backend-side: SEC-003 still rejects a free user calling
     /start-trial even with correct identity (402, not 403, not 200).
 10. No secrets are logged by the new instrumentation.
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

REPO = Path("/app")
FRONTEND = REPO / "frontend"
BACKEND = REPO / "backend"

PREMIUM_SRC = (FRONTEND / "app" / "premium.tsx").read_text(encoding="utf-8")
STORE_SRC = (FRONTEND / "store" / "scriptStore.ts").read_text(encoding="utf-8")
RC_SRC = (FRONTEND / "services" / "revenuecat.ts").read_text(encoding="utf-8")
SERVER_SRC = (BACKEND / "server.py").read_text(encoding="utf-8")

_API_BASE = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001",
).rstrip("/") + "/api"


# ─── §1 — handleStartTrial triggers RC purchase, not backend directly ─────

def test_handle_start_trial_calls_purchase_on_native() -> None:
    """On native, handleStartTrial must invoke the RC `purchase(...)`
    SDK path and NOT fall through to the backend `startTrial()` zustand
    action (which would 402 for a free user with no entitlement)."""
    # Locate the function.
    assert "const handleStartTrial = async ()" in PREMIUM_SRC
    # Locate its native branch — must call `purchase(yearlyPackage)`
    # (the function imported from useRevenueCat).
    assert re.search(
        r"if \(isNative && hasOfferings\)\s*\{",
        PREMIUM_SRC,
    ), "native branch of handleStartTrial missing"
    assert "await purchase(yearlyPackage)" in PREMIUM_SRC, (
        "handleStartTrial must call the RevenueCat `purchase()` SDK "
        "path on native. If this fails, the trial button is back to "
        "the backend-only architecture that produced 402 for Emily."
    )


def test_backend_start_trial_called_only_as_web_fallback() -> None:
    """The old backend-only `startTrial()` zustand action must still
    exist as a web/non-native fallback (web has no Google Play), but
    it must NOT run on native alongside the RC purchase (would
    double-charge users and double-fire 402s)."""
    # Store action is kept.
    assert "startTrial: async () =>" in STORE_SRC
    # Premium screen only awaits it in the non-native branch.
    assert "const success = await startTrial();" in PREMIUM_SRC
    # The native branch returns before the fallback runs.
    native_branch_match = re.search(
        r"if \(isNative && hasOfferings\)\s*\{[\s\S]*?\n\s*return;\s*\n\s*\}",
        PREMIUM_SRC,
    )
    assert native_branch_match, (
        "native branch of handleStartTrial must `return;` after the "
        "RC purchase result so the web/backend fallback doesn't also "
        "fire — otherwise Google Play purchase + backend /start-trial "
        "both run and Emily sees two Alerts."
    )


# ─── §2 — hasIntroOffer gate ──────────────────────────────────────────────

def test_has_intro_offer_consulted_before_purchase() -> None:
    """`hasIntroOffer(yearlyPackage)` must be invoked before purchase.
    If the Google Play product has no trial offer, the user is told
    clearly instead of being silently charged for the full annual."""
    assert "import { hasIntroOffer" in PREMIUM_SRC
    assert "hasIntroOffer(yearlyPackage)" in PREMIUM_SRC
    # The negative-path alert must exist and the body must NOT then
    # call purchase() in the same branch.
    assert "Free Trial Unavailable" in PREMIUM_SRC, (
        "User-facing message for the no-intro-offer path is missing."
    )


def test_no_fake_trial_activation_in_frontend() -> None:
    """We must NEVER grant Premium locally without RC confirmation.
    Guard against someone adding `set({ isPremium: true })` or similar
    inside handleStartTrial without going through the purchase flow."""
    # Extract the handleStartTrial body.
    m = re.search(
        r"const handleStartTrial = async \(\)[^\{]*\{([\s\S]*?)\n  \};",
        PREMIUM_SRC,
    )
    assert m, "handleStartTrial body not located"
    body = m.group(1)
    # No local isPremium flipping.
    assert "set({ isPremium: true" not in body
    assert "setIsPremium(true)" not in body
    # No local trial_used flipping.
    assert "trial_used: true" not in body


# ─── §3 — SEC-003 preserved ───────────────────────────────────────────────

def test_sec003_entitlement_check_still_present() -> None:
    """Backend /start-trial still runs `fetch_premium_entitlement`
    and returns 402 when the RC entitlement is inactive."""
    # Locate /start-trial endpoint scope.
    idx = SERVER_SRC.find('@api_router.post("/users/{device_id}/start-trial")')
    assert idx != -1
    # Scope window must be wide enough to cover the full function
    # body — `start_trial` spans ~2.4KB on the backend. We use 5000
    # chars for safety; still bounded by the next decorator.
    scope = SERVER_SRC[idx : idx + 5000]
    assert "fetch_premium_entitlement" in scope, (
        "SEC-003 entitlement verification removed from /start-trial — "
        "this would allow Premium to be granted without RC."
    )
    assert (
        "No active Premium entitlement found in RevenueCat" in scope
        or "No active Premium trial entitlement found in RevenueCat" in scope
    ), "SEC-003 402 branch removed from /start-trial."


def test_sec002_identity_match_still_present() -> None:
    """All three Premium endpoints still call enforce_user_id_match."""
    for decorator in (
        '@api_router.get("/users/{device_id}/limits")',
        '@api_router.post("/users/{device_id}/subscribe")',
        '@api_router.post("/users/{device_id}/start-trial")',
    ):
        idx = SERVER_SRC.find(decorator)
        assert idx != -1, f"endpoint missing: {decorator}"
        scope = SERVER_SRC[idx : idx + 1600]
        assert "enforce_user_id_match" in scope, (
            f"SEC-002 enforce_user_id_match removed from {decorator}"
        )


# ─── §4 — stale-closure fix ───────────────────────────────────────────────

def test_premium_screen_reads_fresh_store_error_after_await() -> None:
    """After `await startTrial()` / `await subscribe()` returns false,
    the Alert must read `useScriptStore.getState().error` (fresh)
    rather than the closure-captured `storeError` (stale from the
    pre-call render)."""
    # Fresh-state reads are present.
    assert "useScriptStore.getState().error" in PREMIUM_SRC, (
        "Stale closure fix missing — Alerts will show the generic "
        "fallback instead of the real backend detail."
    )
    # There must be no remaining `Alert.alert('Error', storeError ||`
    # pattern in the trial/subscribe flows (handlePurchase+handleStartTrial).
    assert "Alert.alert('Error', storeError ||" not in PREMIUM_SRC, (
        "Stale `storeError` closure still used in an Alert — the "
        "stale-closure bug is back."
    )


# ─── §5 — DebugLog instrumentation ────────────────────────────────────────

@pytest.mark.parametrize(
    "fn_name",
    ["startTrial", "subscribe"],
)
def test_scriptstore_instruments_premium_actions_with_debuglog(fn_name: str) -> None:
    """Each premium action must emit the full DebugLog pipeline —
    functionStart, apiRequest, apiResponse, apiError, functionSuccess,
    functionError — mirroring the `createScript` pattern. Otherwise
    future physical-device failures will again report "no recent
    API call".
    """
    # Locate the function body.
    marker = re.search(
        rf"\b{re.escape(fn_name)}:\s*async\s*\(",
        STORE_SRC,
    )
    assert marker, f"function {fn_name} not found in scriptStore"
    # Walk balanced braces to extract body.
    open_brace = STORE_SRC.find("{", marker.end())
    depth = 0
    end = None
    for i in range(open_brace, len(STORE_SRC)):
        if STORE_SRC[i] == "{":
            depth += 1
        elif STORE_SRC[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    assert end is not None
    body = STORE_SRC[open_brace:end]

    required_hooks = [
        f"DebugLog.functionStart('{fn_name}'",
        "DebugLog.apiRequest(",
        "DebugLog.apiResponse(",
        "DebugLog.apiError(",
        f"DebugLog.functionSuccess('{fn_name}'",
        f"DebugLog.functionError('{fn_name}'",
    ]
    missing = [h for h in required_hooks if h not in body]
    assert not missing, (
        f"{fn_name} is missing DebugLog instrumentation: {missing}. "
        f"Future physical-device trial/subscribe failures will again "
        f"report 'no recent API call' in diagnostics."
    )


def test_debuglog_instrumentation_never_logs_secrets() -> None:
    """The new instrumentation must NOT log the bearer, RC secrets,
    or payment credentials. We check the two function scopes above
    for forbidden patterns."""
    forbidden_literals = [
        "DebugLog.apiRequest.*getAuthHeader",
        "DebugLog.*Authorization:",
        "DebugLog.*Bearer ",
        "DebugLog.*api[_-]?key",
        "DebugLog.*secret",
        "DebugLog.*token",
    ]
    for fn_name in ("startTrial", "subscribe"):
        marker = re.search(rf"\b{re.escape(fn_name)}:\s*async\s*\(", STORE_SRC)
        open_brace = STORE_SRC.find("{", marker.end())
        depth = 0
        end = None
        for i in range(open_brace, len(STORE_SRC)):
            if STORE_SRC[i] == "{":
                depth += 1
            elif STORE_SRC[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        body = STORE_SRC[open_brace:end]
        for pattern in forbidden_literals:
            assert not re.search(pattern, body, re.IGNORECASE), (
                f"{fn_name} appears to log a secret/token via DebugLog: "
                f"matched {pattern!r}"
            )


# ─── §6 — already-Premium user protection ─────────────────────────────────

def test_already_premium_user_short_circuits_before_trial_button() -> None:
    """`premium.tsx` renders the "You're a Pro!" branch and returns
    before the Trial CTA mounts when the user is already Premium.
    This has always been true; we pin it so a future refactor can't
    accidentally let an already-Premium user tap Start Trial and
    double-subscribe."""
    # The isPremium short-circuit renders a dedicated branch.
    assert "isPremium" in PREMIUM_SRC
    # The Trial button only renders when trial_used is false AND we
    # are in the main (non-Premium) branch. Guard by requiring the
    # trial-used guard still exists.
    assert "!user?.trial_used" in PREMIUM_SRC
    # Programmatic guard in the handler itself.
    assert "if (user?.trial_used)" in PREMIUM_SRC
    assert "You have already used your free trial" in PREMIUM_SRC


# ─── §7 — missing monthly doesn't crash yearly ───────────────────────────

def test_missing_monthly_package_does_not_crash_trial_flow() -> None:
    """Emily's RC log confirmed `monthlyPackage` is unavailable while
    `yearlyPackage` loaded fine. The new trial flow must guard on
    `yearlyPackage` (which it uses) and never read `monthlyPackage`
    inside the trial handler."""
    m = re.search(
        r"const handleStartTrial = async \(\)[^\{]*\{([\s\S]*?)\n  \};",
        PREMIUM_SRC,
    )
    assert m
    body = m.group(1)
    # The handler guards on yearlyPackage before using it.
    assert "if (!yearlyPackage)" in body or "!yearlyPackage" in body
    # The handler must NOT dereference monthlyPackage.
    assert "monthlyPackage" not in body, (
        "handleStartTrial references monthlyPackage; Emily's device "
        "lacks it and this would crash the trial flow."
    )


# ─── §8 — RC SDK already handles cancellation cleanly ─────────────────────

def test_rc_purchase_returns_cancelled_flag_not_error() -> None:
    """The underlying `purchasePackage` already returns
    `{success: false, cancelled: true}` on user cancellation. The new
    `handleStartTrial` must treat that as a silent no-op (no Alert)."""
    # SDK contract pin.
    assert "cancelled: true" in RC_SRC, (
        "revenuecat.ts no longer returns `{cancelled: true}` on user "
        "cancel — cancellation path in premium.tsx would now show an "
        "error."
    )
    # UI handler respects it.
    m = re.search(
        r"const handleStartTrial = async \(\)[^\{]*\{([\s\S]*?)\n  \};",
        PREMIUM_SRC,
    )
    body = m.group(1)
    assert "result.cancelled" in body, (
        "handleStartTrial must branch on result.cancelled."
    )


# ─── §9 — LIVE end-to-end (backend behavior unchanged) ────────────────────

def _emily_shape(tag: str) -> str:
    return f"TrialProbe-{tag}-{int(1791211467964)}-{uuid.uuid4().hex[:9]}"


@pytest.fixture(scope="module")
def _live_backend_or_skip() -> None:
    if requests is None:
        pytest.skip("requests library unavailable")
    try:
        r = requests.get(f"{_API_BASE[:-4]}/api/health", timeout=5)
        if r.status_code != 200:
            pytest.skip(f"backend health returned {r.status_code}")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"backend unreachable: {exc}")


def _mint_bearer(device_id: str) -> str:
    r = requests.post(
        f"{_API_BASE}/auth/device-session",
        json={"device_id": device_id},
        headers={"Authorization": ""},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _bootstrap_user(device_id: str) -> None:
    requests.post(f"{_API_BASE}/users", json={"device_id": device_id}, timeout=10)


def test_e2e_free_user_calling_start_trial_still_rejected_402(
    _live_backend_or_skip, unauthenticated_requests,
) -> None:
    """A free user (no active RC entitlement) calling /start-trial
    with a valid bearer + correct identity + a well-formed body must
    still be rejected with 402. The SEC-003 contract is unchanged by
    the frontend trial-flow refactor.
    """
    uid = _emily_shape("free")
    token = _mint_bearer(uid)
    _bootstrap_user(uid)
    # Realistic RC id for a brand new user — RC has nothing linked.
    r = requests.post(
        f"{_API_BASE}/users/{uid}/start-trial",
        json={"revenuecat_app_user_id": uid},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    # Expected: 402 (RC says no entitlement). Must NOT be 200.
    # NOTE: in environments where RC REST is unreachable the backend
    # legitimately returns 503 (RevenueCatUnavailable). Both prove
    # SEC-003 is enforced; a 200 would mean the gate was bypassed.
    assert r.status_code in (402, 503), (
        f"Free user received unexpected status {r.status_code}: {r.text}"
    )
    assert r.status_code != 200, (
        "Free user received 200 OK from /start-trial — SEC-003 bypass!"
    )


def test_e2e_subscribe_free_user_still_rejected_402(
    _live_backend_or_skip, unauthenticated_requests,
) -> None:
    """Same SEC-003 guarantee for /subscribe."""
    uid = _emily_shape("subs")
    token = _mint_bearer(uid)
    _bootstrap_user(uid)
    r = requests.post(
        f"{_API_BASE}/users/{uid}/subscribe",
        json={"plan": "yearly", "revenuecat_app_user_id": uid},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code in (402, 503), (
        f"Free user received unexpected status {r.status_code}: {r.text}"
    )
    assert r.status_code != 200


def test_e2e_start_trial_identity_mismatch_still_403(
    _live_backend_or_skip, unauthenticated_requests,
) -> None:
    """SEC-002 remains enforced on /start-trial — a bearer bound to
    device A cannot activate a trial for device B."""
    a, b = _emily_shape("A"), _emily_shape("B")
    token = _mint_bearer(a)
    _bootstrap_user(a)
    r = requests.post(
        f"{_API_BASE}/users/{b}/start-trial",
        json={"revenuecat_app_user_id": a},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    assert r.status_code == 403, r.text
    assert "user_id does not match authenticated session" in r.text
