"""Regression lock — RevenueCat stable App User ID + already-owned auto-restore.

2026-02 Physical QA Blocker (Samsung S23 Ultra, build 1.0.70 / VC1117):
Google Play reported the subscription as "already owned" but ScriptMate
Restore returned "No Purchases Found". Investigation (read-only) showed:

  * `Purchases.configure({ apiKey })` was called with NO appUserID, so
    RevenueCat generated a fresh `$RCAnonymousID:<uuid>` on every
    install. Reinstalling the app orphaned the subscription on the
    old anonymous id.
  * There were no callers of `Purchases.logIn()` anywhere, so there
    was no path to re-link an anonymous subscriber to a stable id.
  * `purchasePackage()` surfaced the "already owned" error straight
    through to the user, with no automatic restore attempt.

Fix (production):
  * `_layout.tsx` reads `device_id` from AsyncStorage (the same key the
    rest of the app already uses as the backend user id) and passes
    it to `Purchases.configure({ apiKey, appUserID })`.
  * On subsequent launches, `Purchases.logIn(device_id)` is called
    only if the current RC app user id drifted from the stable id —
    making the init idempotent.
  * `services/revenuecat.ts::purchasePackage` catches
    `PRODUCT_ALREADY_PURCHASED_ERROR` / `RECEIPT_ALREADY_IN_USE_ERROR`
    and automatically invokes `restorePurchases()` ONCE. The retry is
    guarded with a `_isAutoRestoreRetry` parameter so it can never
    loop.

This file is a static-source audit that locks the fix. Running the
TS code requires a React-Native mock harness that doesn't exist in
this project, so we pin the source contract instead — breaking it
re-exposes the Feb-2026 QA regression.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LAYOUT = ROOT / "frontend" / "app" / "_layout.tsx"
REVENUECAT = ROOT / "frontend" / "services" / "revenuecat.ts"
USE_RC = ROOT / "frontend" / "hooks" / "useRevenueCat.ts"
STORE = ROOT / "frontend" / "store" / "scriptStore.ts"


def _read(p: Path) -> str:
    assert p.exists(), f"missing expected source file: {p}"
    return p.read_text(encoding="utf-8")


# ─── A, B, C, D: initialization uses a stable identity ──────────────────

def test_configure_passes_stable_app_user_id() -> None:
    """Purchases.configure() MUST be called with an appUserID — not
    the old `configure({ apiKey })` without-identity shape that
    produced a fresh `$RCAnonymousID` on every install."""
    raw = _read(LAYOUT)
    # Strip comments so we only inspect runtime code — our own
    # docstring describes the OLD bad shape and would false-match.
    src = re.sub(r"//.*$", "", raw, flags=re.MULTILINE)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    bare = re.search(r"Purchases\.configure\(\s*\{\s*apiKey\s*\}\s*\)", src)
    assert bare is None, (
        "`Purchases.configure({ apiKey })` must NOT be called without "
        "an explicit appUserID. That form regenerates a fresh "
        "`$RCAnonymousID` per install and orphans subscriptions on "
        "reinstall — the exact Feb-2026 physical-QA failure. Use "
        "`Purchases.configure({ apiKey, appUserID })` instead."
    )
    stable = re.search(
        r"Purchases\.configure\(\s*\{\s*apiKey\s*,\s*appUserID:\s*\w+\s*\}\s*\)",
        src,
    )
    assert stable is not None, (
        "Expected `Purchases.configure({ apiKey, appUserID: <stableId> })`"
        " in app/_layout.tsx."
    )


def test_stable_id_source_is_asyncstorage_device_id() -> None:
    """The identity must come from the SAME `device_id` key the rest
    of the app already treats as the user id (scriptStore,
    elevenLabsService, upload.tsx, support.tsx). Any other key would
    create a divergent identifier and defeat the whole fix."""
    src = _read(LAYOUT)
    assert re.search(r"AsyncStorage\.getItem\(\s*['\"]device_id['\"]\s*\)", src), (
        "The stable RC app user id must be read from "
        "`AsyncStorage.getItem('device_id')` — the single key the "
        "rest of the app (and the backend /revenuecat/sync endpoint) "
        "already uses as the user identifier."
    )
    assert re.search(r"AsyncStorage\.setItem\(\s*['\"]device_id['\"]", src), (
        "On first launch the stable id must be persisted via "
        "`AsyncStorage.setItem('device_id', ...)` so subsequent "
        "launches read the SAME id."
    )


def test_configure_is_idempotent_via_login_fallback() -> None:
    """A previous build may have left the RC customer in anonymous
    state; the init must detect that and alias via `Purchases.logIn`
    once — never on every launch."""
    src = _read(LAYOUT)
    assert "Purchases.getAppUserID()" in src, (
        "After configure, the current RC app user id must be checked "
        "against the stable id so logIn is only called when they "
        "differ (idempotency)."
    )
    assert "Purchases.logIn(stableAppUserId)" in src or re.search(
        r"Purchases\.logIn\(\s*stableAppUserId\s*\)", src,
    ), (
        "A `Purchases.logIn(stableAppUserId)` fallback must exist to "
        "alias an existing anonymous subscriber to the stable id."
    )
    # The logIn fallback must be gated by a mismatch check so it is
    # NOT fired on every launch.
    assert re.search(
        r"currentId\s*&&\s*currentId\s*!==\s*stableAppUserId",
        src,
    ), (
        "The logIn fallback must be gated by "
        "`currentId !== stableAppUserId` so it only fires when the "
        "RC customer actually drifted — otherwise it churns identity "
        "on every single launch."
    )


def test_no_random_appuserid_generated_per_launch() -> None:
    """The id-minting function must only generate a NEW id when the
    AsyncStorage row is missing. Any launch where the row exists must
    return the SAME stored value."""
    src = _read(LAYOUT)
    # The helper must early-return the existing value.
    m = re.search(
        r"async\s+function\s+getStableRevenueCatAppUserId\s*\([^)]*\)\s*:\s*Promise<string>\s*\{(.*?)\n\}",
        src,
        re.DOTALL,
    )
    assert m, (
        "Expected a `getStableRevenueCatAppUserId` helper in "
        "_layout.tsx."
    )
    body = m.group(1)
    assert "if (existing) return existing" in body or re.search(
        r"if\s*\(\s*existing\s*\)\s*return\s+existing",
        body,
    ), (
        "The helper must short-circuit with the existing device_id "
        "when AsyncStorage already has one. Otherwise every launch "
        "would mint a new id and break stability."
    )


# ─── E: entitlement name stays "ScriptMate Pro" ─────────────────────────

def test_premium_entitlement_identifier_unchanged() -> None:
    """The identifier must stay literal `ScriptMate Pro` — this patch
    is identity-only and MUST NOT change the entitlement contract."""
    src = _read(REVENUECAT)
    assert "PREMIUM_ENTITLEMENT_ID = 'ScriptMate Pro'" in src


# ─── F, G: successful purchase + restore use the stable id ──────────────

def test_restore_reads_single_premium_entitlement() -> None:
    """Restore flow must check `entitlements.active[PREMIUM_ENTITLEMENT_ID]`
    — not a different identifier, and not a flag we invented."""
    src = _read(REVENUECAT)
    assert re.search(
        r"restorePurchases.*?entitlements\.active\[PREMIUM_ENTITLEMENT_ID\]",
        src,
        re.DOTALL,
    ), "restorePurchases must read customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID]."


def test_purchase_flow_uses_same_entitlement_lookup() -> None:
    """Purchase flow uses the exact same entitlement key as restore,
    so there is one source of truth."""
    src = _read(REVENUECAT)
    purchase_lookups = re.findall(
        r"entitlements\.active\[PREMIUM_ENTITLEMENT_ID\]",
        src,
    )
    assert len(purchase_lookups) >= 2, (
        "Expected at least two lookups of "
        "entitlements.active[PREMIUM_ENTITLEMENT_ID] (purchase + "
        "restore) in services/revenuecat.ts."
    )


# ─── H, I, J, K: already-owned → one restore, no loops ──────────────────

def test_purchase_package_auto_restores_on_already_owned() -> None:
    """purchasePackage() must call restorePurchases() exactly once
    when Google Play / RC reports `PRODUCT_ALREADY_PURCHASED_ERROR`
    or `RECEIPT_ALREADY_IN_USE_ERROR`."""
    src = _read(REVENUECAT)
    assert "_isAutoRestoreRetry" in src, (
        "purchasePackage must take an `_isAutoRestoreRetry` guard "
        "parameter so the retry can never recurse into itself."
    )
    assert re.search(
        r"PRODUCT_ALREADY_PURCHASED_ERROR",
        src,
    ), "Must detect PRODUCT_ALREADY_PURCHASED_ERROR."
    assert re.search(
        r"RECEIPT_ALREADY_IN_USE_ERROR",
        src,
    ), "Must detect RECEIPT_ALREADY_IN_USE_ERROR."
    # The retry must call `restorePurchases()` and gate on the flag.
    assert re.search(
        r"!\s*_isAutoRestoreRetry.*?restorePurchases\s*\(\s*\)",
        src,
        re.DOTALL,
    ), (
        "The auto-restore branch must call `restorePurchases()` "
        "guarded by `!_isAutoRestoreRetry` so repeat calls short-circuit."
    )


def test_auto_restore_only_fires_on_already_owned_codes() -> None:
    """Make sure the auto-restore does NOT fire on arbitrary errors
    like `NETWORK_ERROR` or `PURCHASE_INVALID_ERROR` — that would be
    a UX bug (and a loop risk)."""
    src = _read(REVENUECAT)
    # The isAlreadyOwned predicate must OR exactly the two codes.
    m = re.search(
        r"isAlreadyOwned\s*=\s*(.*?);",
        src,
        re.DOTALL,
    )
    assert m, "isAlreadyOwned predicate missing."
    body = m.group(1)
    assert "PRODUCT_ALREADY_PURCHASED_ERROR" in body
    assert "RECEIPT_ALREADY_IN_USE_ERROR" in body
    forbidden = [
        "NETWORK_ERROR", "PURCHASE_INVALID_ERROR",
        "STORE_PROBLEM_ERROR", "PURCHASE_NOT_ALLOWED_ERROR",
    ]
    for code in forbidden:
        assert code not in body, (
            f"isAlreadyOwned must NOT include `{code}` — would mis-fire "
            "auto-restore on unrelated errors."
        )


def test_restore_empty_result_does_not_falsely_unlock_premium() -> None:
    """When restore runs but returns no active entitlement, the
    function must return `success:true, restored:false` (so the UI
    stays locked). Any truthy premium flag would be a critical bug."""
    src = _read(REVENUECAT)
    # Find the restorePurchases function.
    m = re.search(
        r"restorePurchases\s*=\s*async\s*\([^)]*\)\s*:[^{]*\{(.*?)\n\};",
        src,
        re.DOTALL,
    )
    assert m, "restorePurchases function not found."
    body = m.group(1)
    assert re.search(
        r"restored:\s*false",
        body,
    ), (
        "restorePurchases must explicitly set `restored: false` when "
        "no active ScriptMate Pro entitlement is found. Otherwise a "
        "failed restore could falsely unlock premium."
    )


# ─── L: backend sync uses the stable RC app user id ─────────────────────

def test_backend_sync_uses_getAppUserID_from_rc() -> None:
    """syncRevenueCatEntitlement must send the live
    `Purchases.getAppUserID()` to the backend — which, after this
    patch, IS the stable device_id (because configure() sets it)."""
    src = _read(STORE)
    m = re.search(
        r"syncRevenueCatEntitlement:\s*async\s*\(\s*\)\s*=>\s*\{(.*?)\n  \},",
        src,
        re.DOTALL,
    )
    assert m, "syncRevenueCatEntitlement action not found in scriptStore.ts"
    body = m.group(1)
    assert "Purchases.getAppUserID()" in body, (
        "The backend sync must read the current RC app user id via "
        "`Purchases.getAppUserID()` so it posts the same identity "
        "the SDK is using. After this patch that id is the stable "
        "device_id."
    )
    assert "revenuecat/sync" in body, (
        "The sync must POST to /users/{deviceId}/revenuecat/sync."
    )


def test_hook_refreshes_premium_after_restore() -> None:
    """The hook's restore wrapper must trigger `refreshPremiumStatus`
    on scriptStore so the UI state propagates after restore (and
    therefore after an auto-restore from the already-owned branch
    too, which returns via the purchase flow)."""
    src = _read(USE_RC)
    assert re.search(
        r"restore.*?useScriptStore\.getState\(\)\.refreshPremiumStatus\(\)",
        src,
        re.DOTALL,
    ), (
        "useRevenueCat.restore must call "
        "`useScriptStore.getState().refreshPremiumStatus()` so the "
        "store-level isPremium reflects the restored entitlement."
    )


# ─── 6. Static verification: no regressions ─────────────────────────────

def test_no_runtime_scriptm8_pro_references() -> None:
    """Any remaining `ScriptM8 Pro` occurrences must be comments, not
    runtime entitlement references."""
    runtime_files = [REVENUECAT, USE_RC, STORE, LAYOUT]
    for f in runtime_files:
        src = _read(f)
        # Strip single-line comments and docblock lines before scanning.
        stripped = re.sub(r"//.*$", "", src, flags=re.MULTILINE)
        stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
        assert "ScriptM8 Pro" not in stripped, (
            f"{f.name}: a runtime (non-comment) `ScriptM8 Pro` "
            "reference survives. The entitlement is `ScriptMate Pro`."
        )


def test_android_api_key_unchanged() -> None:
    """The Android public RC SDK key must stay the exact production
    key confirmed on the dashboard."""
    src = _read(LAYOUT)
    assert "goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT" in src, (
        "Android RC public key must stay goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT"
        " (production key verified on dashboard)."
    )


def test_only_one_rc_configure_call_site() -> None:
    """Duplicate configure sites would race the identity. There must
    be exactly one `Purchases.configure(` runtime call in the
    frontend (comments / docstrings are allowed to reference it)."""
    import subprocess
    frontend = ROOT / "frontend"
    out = subprocess.run(
        ["grep", "-rn", "--include=*.ts", "--include=*.tsx",
         "Purchases.configure(", str(frontend)],
        capture_output=True, text=True,
    )
    # Filter out node_modules AND comment-only hits (lines where the
    # match is after `//` or inside a `*`-prefixed docblock line).
    runtime_hits: list[str] = []
    for line in out.stdout.splitlines():
        if "node_modules" in line or not line.strip():
            continue
        # Strip the `path:lineno:` prefix.
        code = line.split(":", 2)[-1]
        # Reject if the code is a single-line comment, a docblock
        # continuation, or has the match AFTER a `//`.
        stripped = code.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        if "//" in code and code.index("//") < code.index("Purchases.configure("):
            continue
        runtime_hits.append(line)

    assert len(runtime_hits) == 1, (
        f"Expected exactly 1 runtime Purchases.configure() call site; "
        f"found {len(runtime_hits)}:\n" + "\n".join(runtime_hits)
    )
    assert "_layout.tsx" in runtime_hits[0], (
        "The single configure() call must live in app/_layout.tsx."
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
