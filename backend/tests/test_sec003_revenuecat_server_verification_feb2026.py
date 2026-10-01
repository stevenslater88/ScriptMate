"""SEC-003 (Feb 2026) — server-side RevenueCat verification regression tests.

Scope
=====
POST /api/users/{device_id}/subscribe and /api/users/{device_id}/start-trial
MUST NOT grant Premium on client signal alone. They must call RevenueCat's
REST API with a server-only secret and reject the request when the Premium
entitlement is missing or expired.

QA_PREMIUM must additionally fail-closed when ENV=production.

These tests use the in-process FastAPI app via TestClient and monkeypatch
the module-level `fetch_premium_entitlement` symbol in `server` so no
network calls hit RevenueCat. DB assertions use pymongo (sync) against
the same database the live app uses — mirrors the SEC-004 test pattern,
avoiding Motor's "future belongs to a different loop" trap.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient as _PyMongoClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"

sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import server  # noqa: E402
from revenuecat_client import RevenueCatEntitlement, RevenueCatUnavailable  # noqa: E402

_sync_client = _PyMongoClient(os.environ["MONGO_URL"])
_sync_db = _sync_client[os.environ.get("DB_NAME", server.db.name)]


# ─── Fixtures ────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    # Rebind server.db to a fresh Motor client each test — the previous
    # test's event loop closes and leaves `server.db` pointing at a
    # dead loop (mirrors the pattern used in test_tts_usage_ledger_*).
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[os.environ.get("DB_NAME", "scriptmate")]
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def device_bearer(client):
    """Mint a device-session bearer and ensure the matching users row
    exists in Mongo. Cleanup via sync pymongo."""
    device_id = f"sec003-{uuid.uuid4().hex[:12]}"
    r = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    cr = client.post(
        "/api/users",
        json={"device_id": device_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cr.status_code in (200, 201), cr.text
    yield {"device_id": device_id, "token": token}
    _sync_db.users.delete_many({"device_id": device_id})
    _sync_db.auth_tokens.delete_many({"user_id": f"device:{device_id}"})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _stub_fetch(result=None, *, raises=None):
    """Return an async stub for `fetch_premium_entitlement`."""
    async def _stub(app_user_id, **kwargs):  # noqa: ARG001
        if raises is not None:
            raise raises
        return result
    return _stub


# ─── 1. /subscribe without revenuecat_app_user_id → 400 ─────────────────

def test_subscribe_without_rc_app_user_id_returns_400(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/subscribe",
        json={"plan": "monthly"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 400, r.text
    assert "revenuecat_app_user_id" in r.text


# ─── 2. /subscribe with no entitlement → 402, tier stays free ───────────

def test_subscribe_without_rc_entitlement_returns_402(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=False, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/subscribe",
        json={"plan": "monthly", "revenuecat_app_user_id": "rc-user-no-ent"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 402, r.text
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row is not None
    assert row.get("subscription_tier", "free") == "free"


# ─── 3. /subscribe with EXPIRED entitlement → 402 ───────────────────────

def test_subscribe_with_expired_entitlement_returns_402(client, device_bearer, monkeypatch):
    past = datetime.now(timezone.utc) - timedelta(days=1)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=False, expires_at=past)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/subscribe",
        json={"plan": "monthly", "revenuecat_app_user_id": "rc-user-expired"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 402, r.text


# ─── 4. /subscribe with active + future expiry → 200, tier=premium ──────

def test_subscribe_with_active_entitlement_grants_premium(client, device_bearer, monkeypatch):
    future = datetime.now(timezone.utc) + timedelta(days=30)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=future)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/subscribe",
        json={"plan": "monthly", "revenuecat_app_user_id": "rc-user-active"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subscription_tier"] == "premium"

    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row["subscription_tier"] == "premium"
    assert row.get("revenuecat_app_user_id") == "rc-user-active"
    sub_end = row.get("subscription_end")
    assert sub_end is not None
    expected_naive = future.astimezone(timezone.utc).replace(tzinfo=None)
    assert abs((sub_end - expected_naive).total_seconds()) < 2


# ─── 5. SEC-002 regression: path != bearer → 403 (preserved) ────────────

def test_subscribe_path_user_mismatch_returns_403(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    other_device = f"sec003-other-{uuid.uuid4().hex[:8]}"
    r2 = client.post("/api/auth/device-session", json={"device_id": other_device})
    assert r2.status_code == 200
    other_token = r2.json()["token"]
    try:
        r = client.post(
            f"/api/users/{device_bearer['device_id']}/subscribe",
            json={"plan": "monthly", "revenuecat_app_user_id": "rc-user-x"},
            headers=_auth(other_token),
        )
        assert r.status_code == 403, r.text
    finally:
        _sync_db.auth_tokens.delete_many({"user_id": f"device:{other_device}"})


# ─── 6. /start-trial without active entitlement → 402 ───────────────────

def test_start_trial_without_entitlement_returns_402(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=False, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/start-trial",
        json={"revenuecat_app_user_id": "rc-user-notrial"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 402, r.text
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert not row.get("trial_used", False)


# ─── 7. /start-trial with RC-confirmed trial → 200 ──────────────────────

def test_start_trial_with_entitlement_grants_premium(client, device_bearer, monkeypatch):
    future = datetime.now(timezone.utc) + timedelta(days=3)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=future)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/start-trial",
        json={"revenuecat_app_user_id": "rc-user-trial"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row["trial_used"] is True
    assert row["subscription_tier"] == "premium"
    expected_naive = future.astimezone(timezone.utc).replace(tzinfo=None)
    assert abs((row["subscription_end"] - expected_naive).total_seconds()) < 2


# ─── 8. QA_PREMIUM=true + ENV=production → is_premium=False ─────────────

def test_qa_premium_fails_closed_in_production(client, device_bearer, monkeypatch):
    monkeypatch.setenv("QA_PREMIUM", "true")
    monkeypatch.setenv("ENV", "production")
    r = client.get(
        f"/api/users/{device_bearer['device_id']}/limits",
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_premium"] is False
    assert body["tier"] == "free"
    assert "qa_premium_bypass" not in body


# ─── 9. QA_PREMIUM=true + ENV=development → is_premium=True (preserved)

def test_qa_premium_still_works_in_non_production(client, device_bearer, monkeypatch):
    monkeypatch.setenv("QA_PREMIUM", "true")
    monkeypatch.setenv("ENV", "development")
    r = client.get(
        f"/api/users/{device_bearer['device_id']}/limits",
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_premium"] is True
    assert body["tier"] == "premium"
    assert body.get("qa_premium_bypass") is True


# ─── 10. Static: no unverified path writes subscription_tier="premium"

def test_no_unverified_premium_writes_in_server():
    """Each async function that sets subscription_tier="premium" must
    also call fetch_premium_entitlement inside the same body."""
    src = (BACKEND / "server.py").read_text()
    import re
    func_pattern = re.compile(
        r"async def (?P<name>\w+)\([^)]*\)[^:]*:\n"
        r"(?P<body>(?:(?:    |\t)[^\n]*\n|\n)+)",
        re.MULTILINE,
    )
    offenders = []
    for m in func_pattern.finditer(src):
        body = m.group("body")
        if '"subscription_tier": "premium"' not in body:
            continue
        if "fetch_premium_entitlement" not in body:
            offenders.append(m.group("name"))
    assert not offenders, (
        f"SEC-003 regression: {offenders} write subscription_tier=premium "
        f"without calling fetch_premium_entitlement"
    )


# ─── 11. RC unavailable → 503, tier unchanged ───────────────────────────

def test_subscribe_rc_unavailable_returns_503(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(raises=RevenueCatUnavailable("boom")),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/subscribe",
        json={"plan": "monthly", "revenuecat_app_user_id": "rc-user-x"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 503, r.text
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row.get("subscription_tier", "free") == "free"


# ─── 12. Idempotent repeat /subscribe does not duplicate rows ───────────

def test_subscribe_is_idempotent(client, device_bearer, monkeypatch):
    future = datetime.now(timezone.utc) + timedelta(days=30)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=future)),
    )
    for _ in range(2):
        r = client.post(
            f"/api/users/{device_bearer['device_id']}/subscribe",
            json={"plan": "monthly", "revenuecat_app_user_id": "rc-user-idem"},
            headers=_auth(device_bearer["token"]),
        )
        assert r.status_code == 200, r.text
    cnt = _sync_db.users.count_documents({"device_id": device_bearer["device_id"]})
    assert cnt == 1
