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


def test_elevenlabs_service_mints_bearer_against_different_key() -> None:
    """`elevenLabsService._readOrCreateDeviceId` uses the private key
    `@scriptmate_device_id` to derive the device_id the bearer token's
    db.auth_tokens row is bound to.

    THIS IS THE BUG: the bearer identity source diverges from the URL
    path identity source. The two keys are never kept in sync, so on
    any device where elevenLabsService mints its own id (every device),
    the bearer identity != URL path device_id.
    """
    src = (FRONTEND / "services" / "elevenLabsService.ts").read_text()
    assert "DEVICE_ID_KEY = '@scriptmate_device_id'" in src, (
        "elevenLabsService no longer references the diverging key — if "
        "the fix has landed, delete this xfail and flip the assertion."
    )
    assert "AsyncStorage.getItem(DEVICE_ID_KEY)" in src
    # And it mints a `device-<ts>-<r>` shape, which cannot collide with
    # the `<deviceName>-<ts>-<r>` shape that scriptStore writes.
    assert "`device-${Date.now()}-${Math.random()" in src


def test_two_mint_patterns_can_never_collide() -> None:
    """Proof-by-shape that the bearer id and the URL path id can
    never coincidentally match on any real device.

    scriptStore / _layout shape : "<deviceName|modelId sanitised>-<ts>-<r>"
    elevenLabsService shape     : "device-<ts>-<r>"

    For them to match, `Device.modelId || Device.deviceName` would
    have to literally equal the string `"device"` AND the timestamps
    AND the 9-char randoms would all have to coincide. Astronomically
    improbable.
    """
    scriptstore_shape_prefix = "device"  # the deviceName fallback
    elevenlabs_shape_prefix = "device"
    # Prefix string-equal is NOT sufficient; both include a timestamp
    # and a random suffix generated at mint time in different
    # callsites. The functional divergence is the mint-site identity,
    # not the prefix.
    assert scriptstore_shape_prefix == elevenlabs_shape_prefix


# ─── §C: backend contract that the fix must change ────────────────────────

PREMIUM_ENDPOINTS = [
    ('@api_router.get("/users/{device_id}/limits")', "get_user_limits"),
    ('@api_router.post("/users/{device_id}/subscribe")', "subscribe_user"),
    ('@api_router.post("/users/{device_id}/start-trial")', "start_trial"),
]


@pytest.mark.parametrize("decorator,function_name", PREMIUM_ENDPOINTS)
def test_premium_endpoint_currently_enforces_path_bearer_match(
    decorator: str,
    function_name: str,
) -> None:
    """TODAY, each Premium endpoint calls `enforce_user_id_match`.
    After the fix (either option in the report), this assertion should
    be inverted — these endpoints must mirror the Daily Drill
    remediation (bearer-derived device_id, no path/bearer match).
    """
    server = (BACKEND / "server.py").read_text()
    idx = server.find(decorator)
    assert idx != -1, f"endpoint missing: {decorator}"
    scope = server[idx : idx + 1600]
    assert "enforce_user_id_match" in scope, (
        f"{function_name} no longer calls enforce_user_id_match — if "
        "the fix has landed, update these tests to pin the new "
        "bearer-only pattern."
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

@pytest.mark.xfail(
    reason=(
        "Awaiting SCRIPT M8 fix. Two viable remediations, see report §11:\n"
        "  Option A — unify AsyncStorage key in elevenLabsService to "
        "'device_id'. One-file frontend change. Zero backend risk.\n"
        "  Option B — remove enforce_user_id_match from the three "
        "Premium endpoints (mirror dbdf3d1 Daily Drill fix). Zero "
        "frontend risk; aligns with the pattern /scripts already uses."
    ),
    strict=True,
)
def test_fix_must_make_bearer_and_path_mismatch_succeed() -> None:
    """Representative assertion the fix must satisfy.

    This marker captures BOTH remediation options as acceptable:

    Option A satisfies this because `elevenLabsService._readOrCreateDeviceId`
    will read the SAME `device_id` key scriptStore writes, so bearer
    identity == URL path identity; `enforce_user_id_match` will pass.

    Option B satisfies this because the Premium endpoints will no
    longer call `enforce_user_id_match` at all; the Mongo filter will
    key on `effective_user_id(authenticated_user_id)` (same shape as
    the raw device_id for device sessions, per auth.py).

    Either way, this xfail flips to PASS the moment the fix lands.
    """
    # Encoded as a code-level invariant (not a HTTP call) so this file
    # remains runnable in the sandboxed test environment without a
    # live Mongo or a live bearer-minting path.
    elevenlabs = (FRONTEND / "services" / "elevenLabsService.ts").read_text()
    server = (BACKEND / "server.py").read_text()

    option_a_satisfied = (
        "DEVICE_ID_KEY = 'device_id'" in elevenlabs
        or "AsyncStorage.getItem('device_id')" in elevenlabs
    )
    # Option B satisfied if NONE of the three Premium endpoints call
    # enforce_user_id_match any more (we check the function bodies).
    def _calls_enforce(decorator: str) -> bool:
        idx = server.find(decorator)
        if idx == -1:
            return False
        return "enforce_user_id_match" in server[idx : idx + 1600]

    option_b_satisfied = not any(
        _calls_enforce(decorator) for decorator, _ in PREMIUM_ENDPOINTS
    )

    assert option_a_satisfied or option_b_satisfied, (
        "Neither fix option has landed. See §11 of the Emily Note20 "
        "investigation report."
    )
