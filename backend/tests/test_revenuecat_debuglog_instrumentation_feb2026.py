"""Regression lock — RevenueCat chain emits DebugLog events into the
exported diagnostic report.

2026-02 Overnight investigation of the Samsung S23 Ultra
"Restore Purchases → No Purchases Found" blocker:

The physical diagnostic report that the user pasted back contained
*zero* RevenueCat events — only ElevenLabs / audio activity. Static
audit of the frontend proved why:

* The RC chain logged exclusively via `console.log` (visible only
  through `adb logcat`) and `Sentry.addBreadcrumb` (visible only in
  the Sentry dashboard).
* `services/diagnosticsService.ts::formatChatGPTDiagnosticReport`
  builds its `RECENT LOG` section from `DebugLog.getLogs()`.
* The RC chain NEVER wrote to `DebugLog` — so the exported report
  could not possibly contain any RC events, even though RC was in
  fact executing on the device.

Fix: purely additive `DebugLog.log('PURCHASE_EVENT', 'RevenueCat', ...)`
calls were added across the RC chain:

* `app/_layout.tsx` — INIT_START, CONFIGURE_START, CONFIGURE_SUCCESS,
  APPUSERID_AFTER_CONFIGURE, LOGIN_ALIAS_START / RESULT / ERROR,
  OFFERINGS_LOADED / ERROR / PRODUCTS_MISSING, CUSTOMERINFO_LOADED /
  ERROR, INIT_ERROR.
* `services/revenuecat.ts::restorePurchases` — RESTORE_START,
  RESTORE_RESULT (with entitlement ids, active subs, non-sub txns,
  originalAppUserId), RESTORE_ERROR, RESTORE_ABORTED.
* `services/revenuecat.ts::purchasePackage` —
  PURCHASE_ALREADY_OWNED_AUTO_RESTORE_TRIGGERED on the already-owned
  branch.
* `app/premium.tsx::handleRestore` — USER_RESTORE_TAPPED and
  USER_RESTORE_ALERT_SHOWN button-press anchors.

Behavioural guarantee: these calls are wrapped so a failure in
`DebugLog` can never destabilise RC init / restore. `DebugLog`
already masks `apiKey` / `token` / `purchase_token` / `receipt` /
`secret` fields at write time.

This file locks the instrumentation — if any of the required events
drops out of the RC chain in the future, the next diagnostic report
will again be silent for RC, and this test will fail loudly in CI.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAYOUT = ROOT / "frontend" / "app" / "_layout.tsx"
RC_SERVICE = ROOT / "frontend" / "services" / "revenuecat.ts"
PREMIUM = ROOT / "frontend" / "app" / "premium.tsx"


def _read(p: Path) -> str:
    assert p.exists(), f"missing expected source file: {p}"
    return p.read_text(encoding="utf-8")


# ─── A: _layout.tsx RC init chain ───────────────────────────────────────

REQUIRED_LAYOUT_EVENTS = [
    "INIT_START",
    "CONFIGURE_START",
    "CONFIGURE_SUCCESS",
    "APPUSERID_AFTER_CONFIGURE",
    "LOGIN_ALIAS_START",
    "LOGIN_ALIAS_RESULT",
    "LOGIN_ALIAS_ERROR",
    "OFFERINGS_LOADED",
    "OFFERINGS_ERROR",
    "CUSTOMERINFO_LOADED",
    "CUSTOMERINFO_ERROR",
    "INIT_ERROR",
]


def test_layout_imports_debuglog() -> None:
    src = _read(LAYOUT)
    assert re.search(
        r"import\s*\{\s*DebugLog\s*\}\s*from\s*['\"]\.\./services/debugLogService['\"]",
        src,
    ), "_layout.tsx must import `DebugLog` from `../services/debugLogService`."


def test_layout_rc_init_emits_all_required_events() -> None:
    src = _read(LAYOUT)
    assert "PURCHASE_EVENT" in src, (
        "_layout.tsx must emit `PURCHASE_EVENT` DebugLog entries so the "
        "exported diagnostic report includes RC activity in its RECENT "
        "LOG section."
    )
    for event in REQUIRED_LAYOUT_EVENTS:
        # The event name must appear as a string literal in a
        # DebugLog / rcDebugLog call. We accept both quoting styles.
        pattern = rf"['\"]{event}['\"]"
        assert re.search(pattern, src), (
            f"_layout.tsx RC init must emit the `{event}` DebugLog "
            "event. Missing this breaks the diagnostic chain the "
            "Feb-2026 overnight investigation depends on."
        )


def test_layout_rc_debug_log_helper_is_crash_safe() -> None:
    """The `rcDebugLog` wrapper must swallow its own errors so a
    DebugLog bug can never crash RC init on a physical device."""
    src = _read(LAYOUT)
    m = re.search(
        r"rcDebugLog\s*=\s*\([^)]*\)\s*:\s*void\s*=>\s*\{(.*?)\n\s*\};",
        src,
        re.DOTALL,
    )
    assert m, (
        "`rcDebugLog` helper must be defined as "
        "`const rcDebugLog = (event, metadata): void => { ... }` in "
        "_layout.tsx."
    )
    body = m.group(1)
    assert "try" in body and "catch" in body, (
        "`rcDebugLog` must wrap `DebugLog.log(...)` in try/catch so a "
        "DebugLog failure never destabilises RC init."
    )


# ─── B: services/revenuecat.ts restore chain ────────────────────────────

REQUIRED_RC_SERVICE_EVENTS = [
    "RESTORE_START",
    "RESTORE_RESULT",
    "RESTORE_ERROR",
    "RESTORE_ABORTED",
    "PURCHASE_ALREADY_OWNED_AUTO_RESTORE_TRIGGERED",
]


def test_rc_service_imports_debuglog() -> None:
    src = _read(RC_SERVICE)
    assert re.search(
        r"import\s*\{\s*DebugLog\s*\}\s*from\s*['\"]\./debugLogService['\"]",
        src,
    ), "services/revenuecat.ts must import `DebugLog` from `./debugLogService`."


def test_rc_service_emits_restore_chain_events() -> None:
    src = _read(RC_SERVICE)
    for event in REQUIRED_RC_SERVICE_EVENTS:
        pattern = rf"['\"]{event}['\"]"
        assert re.search(pattern, src), (
            f"services/revenuecat.ts must emit the `{event}` DebugLog "
            "event so the diagnostic report shows the restore chain."
        )


def test_rc_service_restore_result_includes_entitlement_ids() -> None:
    """The RESTORE_RESULT payload must include the active entitlement
    ids and the lookup key so the exported log makes it immediately
    obvious whether RC returned nothing OR returned entitlements under
    a different identifier than `ScriptMate Pro`."""
    src = _read(RC_SERVICE)
    m = re.search(r"RESTORE_RESULT['\"],\s*\{(.*?)\}\);", src, re.DOTALL)
    assert m, "RESTORE_RESULT metadata object not found."
    body = m.group(1)
    for required in [
        "activeEntitlementIds",
        "lookupKey",
        "originalAppUserId",
        "activeSubscriptions",
        "nonSubscriptionTransactions",
    ]:
        assert required in body, (
            "RESTORE_RESULT metadata must include "
            f"`{required}` so the diagnostic report pinpoints the "
            "exact chain break."
        )


def test_rc_service_debug_helper_is_crash_safe() -> None:
    src = _read(RC_SERVICE)
    m = re.search(
        r"_rcLog\s*=\s*\([^)]*\)\s*:\s*void\s*=>\s*\{(.*?)\n\};",
        src,
        re.DOTALL,
    )
    assert m, (
        "services/revenuecat.ts must define a `_rcLog` helper "
        "wrapping DebugLog.log()."
    )
    body = m.group(1)
    assert "try" in body and "catch" in body, (
        "`_rcLog` must wrap `DebugLog.log(...)` in try/catch so a "
        "DebugLog failure never destabilises the RC restore chain."
    )


# ─── C: premium.tsx anchors the user-initiated restore ─────────────────

def test_premium_imports_debuglog() -> None:
    src = _read(PREMIUM)
    assert re.search(
        r"import\s*\{\s*DebugLog\s*\}\s*from\s*['\"]\.\./services/debugLogService['\"]",
        src,
    ), "app/premium.tsx must import `DebugLog`."


def test_premium_restore_handler_emits_user_anchor_events() -> None:
    src = _read(PREMIUM)
    assert "USER_RESTORE_TAPPED" in src, (
        "app/premium.tsx::handleRestore must emit `USER_RESTORE_TAPPED` "
        "so the diagnostic report proves the user actually pressed "
        "Restore."
    )
    assert "USER_RESTORE_ALERT_SHOWN" in src, (
        "app/premium.tsx::handleRestore must emit "
        "`USER_RESTORE_ALERT_SHOWN` so the diagnostic report shows "
        "which of the three alerts (Restored / No Purchases Found / "
        "Error) was shown to the user."
    )
    assert re.search(
        r"DebugLog\.buttonPress\(\s*['\"]restore-purchases-btn['\"]",
        src,
    ), (
        "app/premium.tsx::handleRestore must call "
        "`DebugLog.buttonPress('restore-purchases-btn', ...)` to "
        "anchor the chain at the UI boundary."
    )


# ─── D: No new runtime surface was added accidentally ──────────────────

def test_debuglog_event_type_covers_purchase_event() -> None:
    """`PURCHASE_EVENT` must remain a valid `DebugEventType` so the
    DebugLog TS compiler accepts every new call site."""
    svc = ROOT / "frontend" / "services" / "debugLogService.ts"
    src = svc.read_text(encoding="utf-8")
    assert "'PURCHASE_EVENT'" in src, (
        "DebugEventType union in debugLogService.ts must include "
        "`'PURCHASE_EVENT'` so RC call sites type-check."
    )


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
