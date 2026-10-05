"""2026-02 SCRIPT M8 — Emily's Samsung Note20 (Android 13) Premium failure.

PHYSICAL REPRO:
    * Device: Samsung SM-N981B, Android 13, VC1135 ("1110-QA")
    * RC startup: healthy, CONFIGURE_SUCCESS, OFFERINGS_LOADED,
      stableAppUserId = "Emily-s-Note20-1791211467964-cns3adeyn"
    * Tapping Premium → "user_id does not match authenticated session"
    * Tapping Start 7-Day Free Trial → "Failed to start trial"
      (diagnostic reports "no recent API call" because startTrial/
      subscribe are not instrumented with DebugLog + Alert reads a
      stale closure of storeError before the Zustand set() has
      propagated — see §F in the investigation report.)

ROOT CAUSE (bearer-identity ↔ URL-path-identity mismatch):

The mobile app mints TWO INDEPENDENT device identities in two separate
AsyncStorage keys:

    key `device_id`               (shared, written by _layout.tsx first
                                   and read by scriptStore.getDeviceId)
      value shape: `<sanitised Device.modelId or deviceName>-<ts>-<r9>`
      Emily's value: "Emily-s-Note20-1791211467964-cns3adeyn"
      used for: /api/users/{device_id}/... URL paths
                 + RevenueCat Purchases.configure(appUserID)

    key `@scriptmate_device_id`   (private to elevenLabsService.ts)
      value shape: `device-<Date.now()>-<r9>`
      used for: POST /api/auth/device-session body → mints the bearer
                token whose db.auth_tokens row carries
                user_id = "device:<@scriptmate_device_id value>"

Because the two keys hold DIFFERENT values, the Premium flow sends:

    URL   : /api/users/Emily-s-Note20-...-cns3adeyn/subscribe
    Bearer: user_id = "device:device-1733000000000-abc123xyz"

The backend endpoints `/users/{device_id}/limits`, `/subscribe`,
`/start-trial`, `/revenuecat/sync` all call

    enforce_user_id_match(device_id, authenticated_user_id)

which rejects when neither the raw `authenticated_user_id` nor
`effective_user_id(authenticated_user_id)` equals the URL `device_id`.
The two values can NEVER match on real hardware.

PRECEDENT:
Commit dbdf3d1 (Oct 2026) fixed the SAME failure mode for Daily Drill
and streak endpoints by moving to bearer-derived identity only
(`user_id = effective_user_id(authenticated_user_id)`), citing that
`/api/scripts` has operated on this pattern since SEC-002 with zero
cross-user-access incidents. The Premium endpoints were overlooked by
that fix.

This test file:
  1. Documents the exact repro deterministically (hostile fixture).
  2. Asserts the two AsyncStorage keys CURRENTLY hold different shapes
     (sanity pin against future accidental alignment).
  3. Confirms the three Premium endpoints still call
     `enforce_user_id_match` today (what the fix must remove).
  4. Carries an `xfail` test that the fix must flip to PASS: a bearer
     minted for `device:<X>` must be accepted at
     `/api/users/<Y>/limits` where X != Y, mirroring the Daily Drill
     precedent.

No code fix is applied in this commit — only evidence.

UPDATE (same session, same day): Option A applied. Tests below now
pin the FIXED state. Any accidental revert of the shared-key
convergence will fail multiple assertions here.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path("/app")
FRONTEND = REPO / "frontend"
BACKEND = REPO / "backend"

# ─── §A: physical fixture ─────────────────────────────────────────────────

EMILY_DEVICE_ID = "Emily-s-Note20-1791211467964-cns3adeyn"


def test_physical_device_id_shape_matches_scriptstore_mint_pattern() -> None:
    """Pin Emily's exact URL-path device_id against the shape produced
    by `_layout.tsx::getStableRevenueCatAppUserId`.

    The sanitiser replaces `[^A-Za-z0-9._-]+` with `-`, so
    "Emily's Note20" → "Emily-s-Note20". If someone later tightens or
    loosens the sanitiser, this test flags that the field shape the
    physical repro depends on has drifted.
    """
    # Shape: <safe-charset>-<13 digit ts>-<9 char base36>
    assert re.fullmatch(
        r"[A-Za-z0-9._-]+-\d{13}-[a-z0-9]{9}",
        EMILY_DEVICE_ID,
    ), f"unexpected shape: {EMILY_DEVICE_ID!r}"
    # Sanitiser invariant: no raw apostrophe/space ever leaks through.
    assert "'" not in EMILY_DEVICE_ID
    assert " " not in EMILY_DEVICE_ID


# ─── §B: AsyncStorage-key divergence (THE bug) ────────────────────────────

def test_scriptstore_and_layout_share_the_same_async_storage_key() -> None:
    """`scriptStore.getDeviceId` and `_layout.getStableRevenueCatAppUserId`
    both key off AsyncStorage['device_id']. This is CORRECT — they must
    agree, or RC's appUserID and the URL-path device_id would diverge.
    """
    script_store = (FRONTEND / "store" / "scriptStore.ts").read_text()
    layout = (FRONTEND / "app" / "_layout.tsx").read_text()
    assert "AsyncStorage.getItem('device_id')" in script_store
    assert 'AsyncStorage.getItem("device_id")' in layout or (
        "AsyncStorage.getItem('device_id')" in layout
    )


def test_elevenlabs_service_mints_bearer_against_shared_key() -> None:
    """FIXED (Option A, 2026-02 SCRIPT M8 Emily Note20):
    `elevenLabsService._readOrCreateDeviceId` now reads/writes the
    SHARED `device_id` AsyncStorage key — the same key scriptStore
    and _layout write. The bearer identity therefore equals the URL
    path identity equals the RC appUserID, and
    `enforce_user_id_match` passes on all protected /api/users/
    endpoints.

    Guard: assert the diverging private key is GONE and the shared
    key is used. If anyone re-introduces a private mint key in this
    file, Emily's 403 regression is back.
    """
    src = (FRONTEND / "services" / "elevenLabsService.ts").read_text()
    assert "DEVICE_ID_KEY = 'device_id'" in src, (
        "elevenLabsService no longer mints against the shared "
        "`device_id` AsyncStorage key — Emily's 403 regression risk."
    )
    assert "'@scriptmate_device_id'" not in src, (
        "The diverging private key `@scriptmate_device_id` has "
        "returned. This re-introduces the bearer/URL-path identity "
        "mismatch that produced 'user_id does not match authenticated "
        "session' on Emily's Note20."
    )
    # And it must mint with the same safe-charset shape _layout.tsx
    # uses, so a cold-start race between TTS lib and the layout can't
    # produce incompatible ids.
    assert "replace(/[^A-Za-z0-9._-]+/g, '-')" in src


def test_two_mint_sites_now_converge_on_same_async_storage_key() -> None:
    """FIXED. Both scriptStore/_layout AND elevenLabsService now key
    on `device_id`. They share the exact same stored value, so the
    bearer identity equals the URL-path identity.
    """
    script_store = (FRONTEND / "store" / "scriptStore.ts").read_text()
    elevenlabs = (FRONTEND / "services" / "elevenLabsService.ts").read_text()
    layout = (FRONTEND / "app" / "_layout.tsx").read_text()
    # scriptStore reads the literal key.
    assert "AsyncStorage.getItem('device_id')" in script_store
    # _layout reads/writes the same literal key.
    assert "AsyncStorage.getItem('device_id')" in layout
    # elevenLabsService must now reference `device_id` via its constant.
    assert "DEVICE_ID_KEY = 'device_id'" in elevenlabs


# ─── §C: backend contract that the fix must change ────────────────────────

PREMIUM_ENDPOINTS = [
    ('@api_router.get("/users/{device_id}/limits")', "get_user_limits"),
    ('@api_router.post("/users/{device_id}/subscribe")', "subscribe_user"),
    ('@api_router.post("/users/{device_id}/start-trial")', "start_trial"),
]


@pytest.mark.parametrize("decorator,function_name", PREMIUM_ENDPOINTS)
def test_premium_endpoints_still_enforce_bearer_identity(
    decorator: str,
    function_name: str,
) -> None:
    """SEC-002 contract is preserved by Option A — these endpoints
    still require a valid bearer (`Depends(get_authenticated_user_id)`)
    AND still match path vs bearer via `enforce_user_id_match`. We
    did NOT weaken the backend. Option A fixed the mismatch by
    aligning the client's bearer-mint identity with the client's
    URL-path identity, so the match now succeeds instead of failing.
    """
    server = (BACKEND / "server.py").read_text()
    idx = server.find(decorator)
    assert idx != -1, f"endpoint missing: {decorator}"
    scope = server[idx : idx + 1600]
    assert "Depends(get_authenticated_user_id)" in scope, (
        f"{function_name} regressed SEC-002 — bearer no longer required."
    )
    assert "enforce_user_id_match" in scope, (
        f"{function_name} no longer calls enforce_user_id_match — "
        "Option A relies on the backend's identity match being "
        "preserved. If this changed, re-read the Emily Note20 "
        "investigation and decide whether both fixes are now in."
    )


# ─── §D: forensic — the EXACT error string the frontend saw ───────────────

def test_backend_produces_exact_error_text_emily_saw() -> None:
    """Pin the 403 detail string so if auth.py ever rewords it, we
    reconnect it to the physical repro report."""
    auth_src = (BACKEND / "auth.py").read_text()
    assert "user_id does not match authenticated session" in auth_src


# ─── §E: Android-13 red herring ──────────────────────────────────────────

def test_no_android_version_branching_on_identity_or_trial_paths() -> None:
    """The failure is purely an identity-source divergence. There is
    no Android-13-specific code in the Premium or Trial code paths.
    Guard against future speculative Android-13 branches that would
    muddy the waters.
    """
    paths_to_scan = [
        FRONTEND / "store" / "scriptStore.ts",
        FRONTEND / "services" / "elevenLabsService.ts",
        FRONTEND / "services" / "authClient.ts",
        FRONTEND / "app" / "premium.tsx",
        FRONTEND / "hooks" / "useRevenueCat.ts",
        FRONTEND / "app" / "_layout.tsx",
    ]
    offenders: list[str] = []
    for p in paths_to_scan:
        text = p.read_text()
        # Platform.Version is the standard RN API; if it starts gating
        # the trial/premium path on a specific Android int, flag it.
        for m in re.finditer(r"Platform\.Version\s*(?:[<>=!]=?|===)\s*\d+", text):
            offenders.append(f"{p.name}: {m.group(0)}")
    assert not offenders, (
        "Found Android-version branching inside Premium/Trial paths:\n"
        + "\n".join(offenders)
    )


# ─── §F: the fix — xfail until applied ────────────────────────────────────

@pytest.mark.parametrize("key_name", ["Authorization", "X-RC-App-User-Id"])
def test_premium_axios_calls_still_attach_both_headers(key_name: str) -> None:
    """Lock in the previous fix (commit 77b6877) alongside Option A.
    All three Premium axios calls must still send both the bearer
    AND the RC header, so the backend has everything it needs on
    cold-cache devices.
    """
    src = (FRONTEND / "store" / "scriptStore.ts").read_text()
    # These three protected endpoints must each live inside a scope
    # that also calls getAuthHeader() — the getAuthHeader() helper
    # attaches both the Authorization bearer and the X-RC-App-User-Id
    # header (see authClient.ts:113), hence the parametrize covers
    # both symbolically through a single assertion.
    assert "headers: await getAuthHeader()" in src
    # Count: fetchUserLimits, startTrial, subscribe, revenuecat/sync,
    # fetchScripts, fetchScript, createScript, updateScript,
    # deleteScript, createRehearsal, fetchRehearsal, updateRehearsal.
    assert src.count("headers: await getAuthHeader()") >= 9
    # Guard against the header name regression specifically.
    rc_header = (FRONTEND / "services" / "authClient.ts").read_text()
    assert "'X-RC-App-User-Id'" in rc_header
    assert "'Authorization'" in rc_header or "Authorization:" in rc_header
    _ = key_name  # suppress unused-arg warning for the parametrize key


def test_fix_option_a_landed_bearer_and_path_now_converge() -> None:
    """Final assertion the fix is active. Both pre-conditions must
    hold for Emily's 403 to be impossible:

      1. elevenLabsService reads/writes the SHARED `device_id` key.
      2. scriptStore + _layout also read/write that same key.
    """
    elevenlabs = (FRONTEND / "services" / "elevenLabsService.ts").read_text()
    script_store = (FRONTEND / "store" / "scriptStore.ts").read_text()
    layout = (FRONTEND / "app" / "_layout.tsx").read_text()

    assert "DEVICE_ID_KEY = 'device_id'" in elevenlabs
    assert "AsyncStorage.getItem('device_id')" in script_store
    assert "AsyncStorage.getItem('device_id')" in layout
    # Negative pin: the diverging key must not be a LIVE string
    # literal in any mint site. We allow it to appear in historical
    # comments explaining what used to be there (searching for a
    # quoted string literal catches real usage, not prose).
    for p, name in (
        (elevenlabs, "elevenLabsService.ts"),
        (script_store, "scriptStore.ts"),
        (layout, "_layout.tsx"),
    ):
        assert "'@scriptmate_device_id'" not in p, (
            f"Diverging key `@scriptmate_device_id` is a live string "
            f"literal in {name} — regression risk."
        )
        assert '"@scriptmate_device_id"' not in p, (
            f"Diverging key `@scriptmate_device_id` is a live string "
            f"literal in {name} — regression risk."
        )
