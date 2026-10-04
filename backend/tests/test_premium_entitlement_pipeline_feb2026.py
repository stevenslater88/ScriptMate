"""
V1 Release Blocker — Premium entitlement pipeline (Feb 2026 nuclear fix).

Context
-------
Physical device evidence (build 1110, VC1150) showed:

  * RevenueCat on-device: `activeEntitlementIds=['ScriptMate Pro']`,
    `activeSubscriptions=['scriptmate_annual:3']`.
  * Backend simultaneously: 403 "'performance' mode requires Premium"
    and ElevenLabs 402 `{tier: 'free', scope: 'daily', used: 494,
    limit: 500}` for the SAME user.

Root cause: every backend premium gate (rehearsal mode gate, TTS tier
cap) read `user.subscription_tier` from the Mongo row — never the live
RevenueCat entitlement. The one-shot startup
`POST /users/{deviceId}/revenuecat/sync` was fire-and-forget (racy with
the user's first tap) and silently 503'd when `REVENUECAT_SECRET_KEY`
was unset in prod, leaving the Mongo row stuck at `free` forever.

Fix
---
Canonical `resolve_authoritative_tier(user_id, rc_app_user_id)` is
consulted by every gate; it verifies the ScriptMate Pro entitlement
live against RevenueCat using the server's own secret when the Mongo
row is stale free, and lifts the row on confirmation.

These tests pin the structural contract AND the behavioural outcomes
(using an in-memory collection stand-in).
"""
from __future__ import annotations

import asyncio
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

SERVER_PATH = Path("/app/backend/server.py")
AUTH_CLIENT_PATH = Path("/app/frontend/services/authClient.ts")
EL_SERVICE_PATH = Path("/app/frontend/services/elevenLabsService.ts")


def _run(coro):
    return asyncio.run(coro)


def _users_mock(user_doc, *, update_mock: AsyncMock | None = None) -> MagicMock:
    """Build a stand-in for `server.db.users` with the two methods the
    resolver calls."""
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
def server_source() -> str:
    return SERVER_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def auth_client_source() -> str:
    return AUTH_CLIENT_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def el_service_source() -> str:
    return EL_SERVICE_PATH.read_text(encoding="utf-8")


@pytest.fixture
def srv():
    sys.path.insert(0, "/app/backend")
    import server  # type: ignore
    # Expose the entitlement model from the sibling module so tests can
    # construct one without importing it twice.
    from revenuecat_client import RevenueCatEntitlement as _Ent
    server.RevenueCatEntitlement = _Ent  # type: ignore[attr-defined]
    server._tier_cache_clear()
    return server


# ─── 1. Structural contract on backend ─────────────────────────────────

def test_canonical_resolver_defined(server_source: str):
    assert "async def resolve_authoritative_tier(" in server_source
    assert "rc_app_user_id: Optional[str] = None" in server_source


def test_canonical_entitlement_literal_is_scriptmate_pro():
    rc_client = Path("/app/backend/revenuecat_client.py").read_text(encoding="utf-8")
    assert 'DEFAULT_ENTITLEMENT_ID = "ScriptMate Pro"' in rc_client


def test_resolver_consulted_by_check_user_limits(server_source: str):
    assert "tier = await resolve_authoritative_tier(user_id, rc_app_user_id)" in server_source


def test_resolver_consulted_by_tts_tier(server_source: str):
    assert "tier = await resolve_authoritative_tier(effective, rc_app_user_id)" in server_source


def test_resolver_consulted_by_get_user_limits(server_source: str):
    assert "tier = await resolve_authoritative_tier(device_id, rc_app_user_id)" in server_source


def test_tts_generate_passes_rcid_through(server_source: str):
    assert "await _tts_check_character_budget(user_id, len(request.text), rc_app_user_id)" in server_source


def test_create_rehearsal_passes_rcid_through(server_source: str):
    assert 'limits_check = await check_user_limits(user_id, "create_rehearsal", rc_app_user_id)' in server_source


def test_rc_header_name_is_canonical(server_source: str):
    assert 'RC_HEADER_NAME = "X-RC-App-User-Id"' in server_source
    assert "async def extract_rc_app_user_id_header(" in server_source


# ─── 2. Behavioural tests — resolver outcomes ──────────────────────────

def test_mongo_premium_short_circuits_rc_call(srv):
    future = datetime.utcnow() + timedelta(days=30)
    user_doc = {"id": "uid-A", "device_id": "uid-A",
                "subscription_tier": "premium", "subscription_end": future}
    users = _users_mock(user_doc)
    rc = AsyncMock()
    with patch.object(srv.db, "users", users), \
         patch.object(srv, "fetch_premium_entitlement", rc):
        tier = _run(srv.resolve_authoritative_tier("uid-A", None))
    assert tier == "premium"
    assert rc.await_count == 0


def test_mongo_free_no_rcid_returns_free(srv):
    user_doc = {"id": "uid-B", "device_id": "uid-B", "subscription_tier": "free"}
    with patch.object(srv.db, "users", _users_mock(user_doc)):
        tier = _run(srv.resolve_authoritative_tier("uid-B", None))
    assert tier == "free"


def test_mongo_free_rc_active_lifts_row_and_returns_premium(srv, monkeypatch):
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    user_doc = {"id": "uid-C", "device_id": "uid-C", "subscription_tier": "free"}
    update_mock = AsyncMock()
    users = _users_mock(user_doc, update_mock=update_mock)
    rc_entitlement = srv.RevenueCatEntitlement(
        active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(days=365),
    )
    with patch.object(srv.db, "users", users), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(return_value=rc_entitlement)):
        tier = _run(srv.resolve_authoritative_tier("uid-C", "rc-user-C"))
    assert tier == "premium"
    # SCRIPT M8 LAUNCH-SAFETY: resolver eagerly persists the rcid BEFORE
    # the live RC call, then lifts the row to premium after RC confirms
    # active. Expect >=1 write; exactly one must set premium.
    assert update_mock.await_count >= 1
    premium_writes = [
        c for c in update_mock.await_args_list
        if c.args[1].get("$set", {}).get("subscription_tier") == "premium"
    ]
    assert len(premium_writes) == 1
    set_doc = premium_writes[0].args[1]["$set"]
    assert set_doc["revenuecat_app_user_id"] == "rc-user-C"
    assert "subscription_end" in set_doc


def test_mongo_free_rc_inactive_returns_free_no_write(srv, monkeypatch):
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    user_doc = {"id": "uid-D", "device_id": "uid-D", "subscription_tier": "free"}
    update_mock = AsyncMock()
    users = _users_mock(user_doc, update_mock=update_mock)
    rc_inactive = srv.RevenueCatEntitlement(active=False, expires_at=None)
    with patch.object(srv.db, "users", users), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(return_value=rc_inactive)):
        tier = _run(srv.resolve_authoritative_tier("uid-D", "rc-user-D"))
    assert tier == "free"
    # No tier promotion write. The resolver may eagerly persist the rcid
    # (so a future RC-config fix can self-heal), but it must NEVER set
    # subscription_tier=premium on an inactive RC response.
    premium_writes = [
        c for c in update_mock.await_args_list
        if c.args[1].get("$set", {}).get("subscription_tier") == "premium"
    ]
    assert premium_writes == []


def test_rc_unavailable_falls_back_safely(srv, monkeypatch):
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    user_doc = {"id": "uid-E", "device_id": "uid-E", "subscription_tier": "free"}
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(side_effect=srv.RevenueCatUnavailable("timeout"))):
        tier = _run(srv.resolve_authoritative_tier("uid-E", "rc-user-E"))
    assert tier == "free"


def test_rc_not_configured_falls_back_safely(srv, monkeypatch):
    monkeypatch.delenv("REVENUECAT_SECRET_KEY", raising=False)
    user_doc = {"id": "uid-F", "device_id": "uid-F", "subscription_tier": "free"}
    with patch.object(srv.db, "users", _users_mock(user_doc)):
        tier = _run(srv.resolve_authoritative_tier("uid-F", "rc-user-F"))
    assert tier == "free"


def test_resolver_cache_prevents_rc_hammering(srv, monkeypatch):
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    user_doc = {"id": "uid-G", "device_id": "uid-G", "subscription_tier": "free"}
    rc_mock = AsyncMock(return_value=srv.RevenueCatEntitlement(
        active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(days=365),
    ))
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv, "fetch_premium_entitlement", rc_mock):
        async def _burst():
            for _ in range(5):
                await srv.resolve_authoritative_tier("uid-G", "rc-user-G")
        _run(_burst())
    assert rc_mock.await_count == 1


def test_resolver_falls_back_to_persisted_rcid_when_header_absent(srv, monkeypatch):
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    user_doc = {"id": "uid-H", "device_id": "uid-H",
                "subscription_tier": "free",
                "revenuecat_app_user_id": "stored-rc-id-H"}
    rc_mock = AsyncMock(return_value=srv.RevenueCatEntitlement(
        active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(days=365),
    ))
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv, "fetch_premium_entitlement", rc_mock):
        tier = _run(srv.resolve_authoritative_tier("uid-H", None))
    assert tier == "premium"
    assert rc_mock.await_count == 1
    assert rc_mock.await_args.args[0] == "stored-rc-id-H"


# ─── 2.A LAUNCH-SAFETY — eager rcid persistence ──────────────────────

def test_resolver_eagerly_persists_rcid_even_when_secret_missing(srv, monkeypatch):
    """SCRIPT M8 LAUNCH-SAFETY: when `REVENUECAT_SECRET_KEY` is not yet
    configured in prod, the resolver cannot verify RC — but it MUST
    still persist the caller's rcid so a later request (once the
    operator pastes the secret) can self-heal via the persisted-rcid
    fallback WITHOUT the client needing to re-send the header."""
    monkeypatch.delenv("REVENUECAT_SECRET_KEY", raising=False)
    user_doc = {"id": "uid-EP1", "device_id": "uid-EP1",
                "subscription_tier": "free"}
    update_mock = AsyncMock()
    users = _users_mock(user_doc, update_mock=update_mock)
    with patch.object(srv.db, "users", users):
        tier = _run(srv.resolve_authoritative_tier("uid-EP1", "rc-new-id"))
    assert tier == "free"  # No premium promotion without verification.
    # Exactly one write: the eager-persist of the rcid.
    assert update_mock.await_count == 1
    set_doc = update_mock.await_args.args[1]["$set"]
    assert set_doc.get("revenuecat_app_user_id") == "rc-new-id"
    # And CRITICALLY no tier promotion.
    assert "subscription_tier" not in set_doc


def test_resolver_eager_persist_skipped_when_rcid_already_matches(srv, monkeypatch):
    """Idempotency: if the row's persisted rcid already matches the
    caller's header, the eager-persist write is NOT re-fired."""
    monkeypatch.delenv("REVENUECAT_SECRET_KEY", raising=False)
    user_doc = {"id": "uid-EP2", "device_id": "uid-EP2",
                "subscription_tier": "free",
                "revenuecat_app_user_id": "rc-stable-id"}
    update_mock = AsyncMock()
    users = _users_mock(user_doc, update_mock=update_mock)
    with patch.object(srv.db, "users", users):
        tier = _run(srv.resolve_authoritative_tier("uid-EP2", "rc-stable-id"))
    assert tier == "free"
    assert update_mock.await_count == 0


def test_resolver_eager_persist_also_fires_when_rc_unavailable(srv, monkeypatch):
    """Even when the live RC call errors (5xx/timeout), the rcid is still
    persisted so retries can self-heal once RC is back."""
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    user_doc = {"id": "uid-EP3", "device_id": "uid-EP3",
                "subscription_tier": "free"}
    update_mock = AsyncMock()
    users = _users_mock(user_doc, update_mock=update_mock)
    with patch.object(srv.db, "users", users), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(side_effect=srv.RevenueCatUnavailable("timeout"))):
        tier = _run(srv.resolve_authoritative_tier("uid-EP3", "rc-new-id"))
    assert tier == "free"
    # The eager-persist still happened.
    rcid_writes = [
        c for c in update_mock.await_args_list
        if c.args[1].get("$set", {}).get("revenuecat_app_user_id") == "rc-new-id"
    ]
    assert len(rcid_writes) == 1
    # And NO tier promotion.
    premium_writes = [
        c for c in update_mock.await_args_list
        if c.args[1].get("$set", {}).get("subscription_tier") == "premium"
    ]
    assert premium_writes == []


# ─── 2.B scriptStore sync-call bearer attachment (frontend contract) ──

def test_scriptstore_sync_endpoint_attaches_auth_bearer():
    """SCRIPT M8 LAUNCH-SAFETY: the frontend's `/revenuecat/sync` POST
    MUST attach the standard `Authorization: Bearer <token>` header
    (via `getAuthHeader`). Without this the backend's SEC-002
    enforcement 401-rejects the call and the rcid is never persisted —
    directly causing the TTS 402 free-tier physical failure."""
    source = Path("/app/frontend/store/scriptStore.ts").read_text(encoding="utf-8")
    pattern = re.compile(
        r"axios\.post\(\s*`\$\{API_BASE_URL\}/api/users/\$\{deviceId\}/revenuecat/sync`,"
        r"[^;]*?headers:\s*await\s+getAuthHeader\(\)",
        re.DOTALL,
    )
    assert pattern.search(source), (
        "frontend scriptStore.ts syncRevenueCatEntitlement must call "
        "axios.post with { headers: await getAuthHeader() }."
    )


def test_backend_sync_endpoint_persists_rcid_even_on_503(server_source: str):
    """`/revenuecat/sync` must persist the caller's rcid on BOTH the
    `RevenueCatNotConfigured` and `RevenueCatUnavailable` branches so a
    later request can self-heal via the persisted-rcid fallback."""
    start = server_source.find("async def sync_revenuecat_entitlement(")
    end = server_source.find("# ==================== SCRIPT ROUTES ====================", start)
    assert start != -1 and end != -1
    block = server_source[start:end]
    assert "except RevenueCatNotConfigured" in block
    assert "except RevenueCatUnavailable" in block
    rcid_writes = re.findall(
        r'"revenuecat_app_user_id":\s*body\.revenuecat_app_user_id',
        block,
    )
    assert len(rcid_writes) >= 3, (
        f"Expected >=3 rcid writes (NotConfigured + Unavailable + success). "
        f"Found {len(rcid_writes)}."
    )



# ─── 3. Physical scenario reproduction ─────────────────────────────────

def test_physical_scenario_performance_and_loop_pass_for_premium_rc(srv, monkeypatch):
    """Reproduces build 1110 symptom. check_user_limits must return
    premium limits (performance + loop available) when RC says active."""
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    user_doc = {"id": "uid-P", "device_id": "uid-P", "subscription_tier": "free"}
    rc_entitlement = srv.RevenueCatEntitlement(
        active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(days=365),
    )
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "scripts", _scripts_mock()), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(return_value=rc_entitlement)):
        result = _run(srv.check_user_limits("uid-P", "create_rehearsal", "rc-user-P"))
    assert result["tier"] == "premium"
    assert "performance" in result["limits"]["available_modes"]
    assert "loop" in result["limits"]["available_modes"]


def test_physical_scenario_tts_tier_matches_rehearsal_gate(srv, monkeypatch):
    """TTS tier must agree with the rehearsal gate."""
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    user_doc = {"id": "uid-Q", "device_id": "uid-Q", "subscription_tier": "free"}
    rc_entitlement = srv.RevenueCatEntitlement(
        active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(days=365),
    )
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "authenticated_users", _authusers_mock()), \
         patch.object(srv, "fetch_premium_entitlement",
                      AsyncMock(return_value=rc_entitlement)):
        tier = _run(srv._resolve_tier_for_tts("device:uid-Q", "rc-user-Q"))
    assert tier == "premium"


# ─── 4. Free user — gates still block free ─────────────────────────────

def test_free_user_cannot_use_performance_mode(srv, monkeypatch):
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    monkeypatch.setenv("ENV", "production")
    user_doc = {"id": "uid-F2", "device_id": "uid-F2", "subscription_tier": "free"}
    with patch.object(srv.db, "users", _users_mock(user_doc)), \
         patch.object(srv.db, "scripts", _scripts_mock()):
        result = _run(srv.check_user_limits("uid-F2", "create_rehearsal", None))
    assert result["tier"] == "free"
    assert "performance" not in result["limits"]["available_modes"]
    assert "loop" not in result["limits"]["available_modes"]


# ─── 5. SEC-004 budget contract preserved ──────────────────────────────

def test_sec004_budgets_env_vars_untouched(server_source: str):
    assert '_env_int("TTS_FREE_DAILY_CHARS")' in server_source
    assert '_env_int("TTS_PREMIUM_DAILY_CHARS")' in server_source
    assert '_env_int("TTS_PREMIUM_MONTHLY_CHARS")' in server_source
    assert '_env_int("TTS_GLOBAL_DAILY_CEILING_CHARS")' in server_source


def test_sec004_402_json_shape_unchanged(server_source: str):
    assert '"tier": tier,' in server_source
    assert '"scope": "daily",' in server_source
    assert '"used": user_daily_used,' in server_source
    assert '"limit": daily_cap,' in server_source


def test_sec004_global_ceiling_still_emits_503(server_source: str):
    assert "status_code=503," in server_source
    assert '"Retry-After": str(retry_after)' in server_source


# ─── 6. Frontend — header is attached everywhere it matters ────────────

def test_authclient_attaches_rc_header(auth_client_source: str):
    assert "const RC_HEADER_NAME = 'X-RC-App-User-Id'" in auth_client_source
    assert "readRevenueCatAppUserId" in auth_client_source
    assert "Purchases.getAppUserID" in auth_client_source
    assert "...rcHeader" in auth_client_source


def test_authclient_uses_dynamic_import_proven_on_metro(auth_client_source: str):
    """Launch-safety: use the same dynamic-import pattern that scriptStore
    uses successfully on Metro, not static `require(...).default` which
    is flaky when the native module ships a mixed CJS/ESM default export."""
    assert "(await import('react-native-purchases')).default" in auth_client_source
    assert "require('react-native-purchases').default" not in auth_client_source


def test_elevenlabsservice_uses_dynamic_import_proven_on_metro(el_service_source: str):
    """Same launch-safety contract on the TTS /generate path."""
    assert "(await import('react-native-purchases')).default" in el_service_source
    assert "require('react-native-purchases').default" not in el_service_source


def test_authclient_does_not_declare_a_client_tier(auth_client_source: str):
    assert "'X-Premium-Tier'" not in auth_client_source
    assert '"X-Premium-Tier"' not in auth_client_source
    assert '"premium": true' not in auth_client_source


def test_elevenlabsservice_attaches_rc_header_on_both_requests(el_service_source: str):
    assert "'X-RC-App-User-Id': rcAppUserId" in el_service_source
    assert "headers: buildHeaders(bearer)" in el_service_source
    assert "headers: buildHeaders(retryBearer)" in el_service_source


def test_launch_safety_voice_unavailable_falls_back_to_known_good(el_service_source: str):
    """Launch-safety: when backend returns 422 `voice_unavailable` for a
    character's assigned voice, the client must retry ONCE with a
    gender-matched known-good premium voice (Sarah / George) so the
    rehearsal is never silent. The retry carries `__isFallbackRetry`
    to prevent an infinite loop."""
    assert "'ELEVENLABS_FALLBACK_VOICE'" in el_service_source
    assert "errCode === 'voice_unavailable'" in el_service_source
    assert "__isFallbackRetry" in el_service_source
    # Gender-matched fallback keys.
    assert "sourceMeta?.gender === 'female' ? 'sarah' : 'george'" in el_service_source


def test_authclient_header_cache_resettable_for_tests(auth_client_source: str):
    assert "_resetRevenueCatAppUserIdCacheForTests" in auth_client_source


# ─── 7. Security contract ──────────────────────────────────────────────

def test_no_client_declared_premium_flag_trusted(server_source: str):
    assert '"X-Premium-Tier"' not in server_source
    assert "'X-Premium-Tier'" not in server_source
    assert re.search(r"body\.premium\s*==\s*True", server_source) is None
    assert re.search(r"request\.premium\s*==\s*True", server_source) is None


def test_qa_premium_bypass_still_fail_closed_in_production(server_source: str):
    assert "_qa_premium_enabled()" in server_source


def test_resolver_block_does_not_log_or_expose_rc_secret(server_source: str):
    """The resolver block must read the secret from env but never log it,
    and must never build an Authorization header inline (the vendor call
    happens inside fetch_premium_entitlement which is already audited)."""
    start = server_source.find("async def resolve_authoritative_tier(")
    end = server_source.find("async def extract_rc_app_user_id_header(")
    assert start != -1 and end != -1
    block = server_source[start:end]
    assert 'os.environ.get("REVENUECAT_SECRET_KEY")' in block
    # Never embed the secret in log formatting or build an Authorization
    # header directly here (vendor call delegated to fetch_premium_entitlement).
    assert "f\"Bearer" not in block
    assert "'Bearer " not in block


# ─── 8. Live-call sanity ───────────────────────────────────────────────

def test_live_backend_still_boots():
    import httpx
    r = httpx.get("http://localhost:8001/api/health", timeout=5)
    assert r.status_code == 200
    assert r.json().get("status") == "healthy"
