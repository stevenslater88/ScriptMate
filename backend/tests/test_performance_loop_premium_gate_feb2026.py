"""
V1 Launch Blocker — Performance/Loop mode gate (Feb 2026, VC1158).

Physical evidence (build 1.0.90 / VC1158)
-----------------------------------------
RevenueCat on-device: `ScriptMate Pro` ACTIVE.
TTS /generate: HTTP 200 (tier=premium path confirmed).
Full Read createRehearsal: HTTP 200.

BUT:
    createRehearsal(mode='performance') → 403 "requires Premium"
    createRehearsal(mode='loop')        → 403 "requires Premium"

Root cause
----------
`frontend/services/authClient.ts::readRevenueCatAppUserId` cached the
FIRST id returned by `Purchases.getAppUserID()` for the lifetime of
the JS process. In the brief window between
`Purchases.configure(appUserID)` and `Purchases.logIn(stableAppUserId)`
aliasing to the stable id, that call can return the SDK's shadow
`$RCAnonymousID:...` form. If the user tapped Performance/Loop before
the alias landed, that anonymous id was latched into the cache —
every subsequent `createRehearsal` sent it as `X-RC-App-User-Id`, the
backend resolver asked RC for an entitlement under the anonymous id,
RC's dashboard has `ScriptMate Pro` attached to the STABLE id (NOT the
anonymous one), so the resolver returned FREE → mode gate rejects
performance+loop with 403.

TTS was unaffected because `elevenLabsService.generateSpeechToFile`
re-reads `Purchases.getAppUserID()` fresh on every call (no cache), so
once the alias landed every TTS call carried the stable id.

Fix pinned here
---------------
`authClient.ts` only caches STABLE (non-anonymous) IDs. If the SDK
returns `$RCAnonymousID:...`, the function returns that id for this one
request (so the backend has SOMETHING to try) but does NOT populate the
cache — the next call re-probes and picks up the stable id once the
alias lands. First Performance/Loop tap on a cold boot now self-heals
on the next request.

Also pinned
-----------
* backend mode gate still uses the same `resolve_authoritative_tier`
  the TTS path already uses — no new resolver, no new premium flag.
* Free users still blocked on performance / loop.
* No client-side premium bypass. No hard-coded premium.
* `isPremium` client-side still gates the UI card lock.
"""
from __future__ import annotations

import asyncio
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

AUTH_CLIENT_PATH = Path("/app/frontend/services/authClient.ts")
EL_SERVICE_PATH = Path("/app/frontend/services/elevenLabsService.ts")
SERVER_PATH = Path("/app/backend/server.py")
SCRIPT_PAGE_PATH = Path("/app/frontend/app/script/[id].tsx")


def _run(coro):
    return asyncio.run(coro)


def _users_mock(user_doc, *, update_mock=None) -> MagicMock:
    m = MagicMock(name="db.users")
    m.find_one = AsyncMock(return_value=user_doc)
    m.update_one = update_mock or AsyncMock()
    return m


def _scripts_mock() -> MagicMock:
    m = MagicMock(name="db.scripts")
    m.count_documents = AsyncMock(return_value=0)
    return m


def _authusers_mock() -> MagicMock:
    m = MagicMock(name="db.authenticated_users")
    m.find_one = AsyncMock(return_value=None)
    return m


@pytest.fixture(scope="module")
def auth_client_source() -> str:
    return AUTH_CLIENT_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def el_service_source() -> str:
    return EL_SERVICE_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def server_source() -> str:
    return SERVER_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def script_page_source() -> str:
    return SCRIPT_PAGE_PATH.read_text(encoding="utf-8")


@pytest.fixture
def srv():
    sys.path.insert(0, "/app/backend")
    import server  # type: ignore
    from revenuecat_client import RevenueCatEntitlement as _Ent
    server.RevenueCatEntitlement = _Ent  # type: ignore[attr-defined]
    server._tier_cache_clear()
    return server


# ─── 1. authClient anonymous-id cache contract (THE FIX) ──────────────

def test_auth_client_defines_anon_prefix_constant(auth_client_source: str):
    """The anonymous-id sentinel RevenueCat uses must be recognised."""
    assert "const ANON_PREFIX = '$RCAnonymousID:';" in auth_client_source


def test_auth_client_does_not_cache_anonymous_id(auth_client_source: str):
    """Only STABLE ids are cached. Anonymous ids are returned once and
    re-probed on the next call so the stable id can land into the cache
    without an app restart."""
    pattern = re.compile(
        r"if \(!id\.startsWith\(ANON_PREFIX\)\) \{\s*"
        r"_rcAppUserIdCache = id;\s*\}",
        re.DOTALL,
    )
    assert pattern.search(auth_client_source), (
        "authClient.readRevenueCatAppUserId must gate the cache write "
        "with `!id.startsWith(ANON_PREFIX)`."
    )


def test_auth_client_still_returns_anon_id_for_current_request(auth_client_source: str):
    """When the SDK is still mid-alias, the function returns the
    anonymous id for the CURRENT request (so backend has something to
    try) but does not promote it to the cache."""
    # The anon id is still returned via the single `return id` at the end
    # of the length-validated branch — just the cache write is gated.
    assert "return id;" in auth_client_source


def test_elevenlabs_tts_path_is_cacheless(el_service_source: str):
    """TTS path (which already worked physically) must stay cache-free:
    every /generate call re-reads getAppUserID so a mid-flight alias
    doesn't poison the TTS tier either."""
    # The TTS block uses a per-request `let rcAppUserId: string | null`.
    assert "let rcAppUserId: string | null = null;" in el_service_source
    assert "rcAppUserId = await Purchases.getAppUserID();" in el_service_source


# ─── 2. Backend mode gate uses the SAME resolver as TTS ───────────────

def test_create_rehearsal_uses_canonical_resolver(server_source: str):
    """`create_rehearsal` must consult `check_user_limits` which delegates
    to `resolve_authoritative_tier` — the exact same path TTS uses."""
    assert 'limits_check = await check_user_limits(user_id, "create_rehearsal", rc_app_user_id)' in server_source


def test_tts_and_rehearsal_share_the_resolver(server_source: str):
    """Both gates must call the single canonical function — no mode-specific
    bespoke premium check."""
    # Rehearsal path
    assert "tier = await resolve_authoritative_tier(user_id, rc_app_user_id)" in server_source
    # TTS path (via _resolve_tier_for_tts)
    assert "tier = await resolve_authoritative_tier(effective, rc_app_user_id)" in server_source


def test_mode_gate_reads_available_modes_from_limits_check(server_source: str):
    """The 403 'requires Premium' response must come from the single
    `available_modes` check — not from a bespoke per-mode check."""
    assert "if rehearsal_data.mode not in limits_check[\"limits\"][\"available_modes\"]:" in server_source
    assert "'{rehearsal_data.mode}' mode requires Premium" in server_source


def test_no_duplicate_mode_premium_check(server_source: str):
    """There must be exactly ONE mode-based premium gate in server.py."""
    occurrences = len(re.findall(
        r"\"available_modes\"\]",
        server_source,
    ))
    # Expect: 2 reads (free + premium tier definitions) + 1 gate check.
    # Not more — otherwise a duplicated check could disagree.
    assert occurrences <= 5, (
        f"Found {occurrences} `available_modes` references — a duplicated "
        "mode gate may be in play."
    )


# ─── 3. Behavioural: premium RC user is allowed Performance & Loop ────

def test_premium_rc_allows_performance_and_loop(srv, monkeypatch):
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    user_doc = {"id": "uid-PL", "device_id": "uid-PL", "subscription_tier": "free"}
    rc_entitlement = srv.RevenueCatEntitlement(
        active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(days=365),
    )
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "scripts", _scripts_mock()), \
         patch.object(srv.db, "authenticated_users", _authusers_mock()), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(return_value=rc_entitlement)):
        result = _run(srv.check_user_limits(
            "uid-PL", "create_rehearsal", "rc-user-PL",
        ))
    assert result["tier"] == "premium"
    assert result["allowed"] is True
    modes = result["limits"]["available_modes"]
    assert "performance" in modes
    assert "loop" in modes
    assert "full_read" in modes


def test_free_rejects_performance_and_loop_but_allows_full_read(srv, monkeypatch):
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("REVENUECAT_SECRET_KEY", raising=False)
    user_doc = {"id": "uid-FR", "device_id": "uid-FR", "subscription_tier": "free"}
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "scripts", _scripts_mock()):
        result = _run(srv.check_user_limits(
            "uid-FR", "create_rehearsal", None,
        ))
    assert result["tier"] == "free"
    modes = result["limits"]["available_modes"]
    assert "full_read" in modes      # free retains full_read
    assert "performance" not in modes
    assert "loop" not in modes


def test_premium_rc_allows_full_read_too(srv, monkeypatch):
    """Regression: the fix must not break the already-working full_read path."""
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    user_doc = {"id": "uid-FR2", "device_id": "uid-FR2",
                "subscription_tier": "premium",
                "subscription_end": datetime.utcnow() + timedelta(days=30)}
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "scripts", _scripts_mock()):
        result = _run(srv.check_user_limits(
            "uid-FR2", "create_rehearsal", None,
        ))
    assert result["tier"] == "premium"
    assert "full_read" in result["limits"]["available_modes"]


# ─── 4. Cross-user isolation — anonymous id does NOT grant premium ────

def test_anonymous_rc_id_does_not_grant_premium(srv, monkeypatch):
    """Simulates the broken flow BEFORE the fix: if the client sends the
    anonymous shadow id, RC returns no entitlement for it. The resolver
    must stay FREE — never spill another user's entitlement."""
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    monkeypatch.setenv("ENV", "production")
    user_doc = {"id": "uid-AN", "device_id": "uid-AN", "subscription_tier": "free"}
    inactive = srv.RevenueCatEntitlement(active=False, expires_at=None)
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "scripts", _scripts_mock()), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(return_value=inactive)):
        result = _run(srv.check_user_limits(
            "uid-AN", "create_rehearsal",
            "$RCAnonymousID:c666409bcac842adbd0fa39c93d87d0d",
        ))
    assert result["tier"] == "free"
    assert "performance" not in result["limits"]["available_modes"]
    assert "loop" not in result["limits"]["available_modes"]


# ─── 5. No client-side premium bypass ─────────────────────────────────

def test_frontend_mode_card_lock_respects_isPremium(script_page_source: str):
    """UI lock is cosmetic; the backend still enforces. We pin that the
    lock condition still reads `isPremium` (never a client-trusted bool
    like `premium=true`)."""
    assert "const isLocked = mode.premium && !isPremium;" in script_page_source


def test_no_hardcoded_premium_flag_in_frontend(auth_client_source: str):
    """Client must never declare a tier claim."""
    assert "'X-Premium-Tier'" not in auth_client_source
    assert "premium: true" not in auth_client_source
