"""Regression lock — RevenueCat sync endpoint + end-to-end Premium path.

2026-02 Physical QA Blocker 2 — Samsung S23 Ultra, build 1.0.69 / VC1115:
a user with an active `ScriptMate Pro` RevenueCat entitlement but whose
backend `subscription_tier` was still `free` (because the past
server-side `/subscribe` step had failed under the mis-named
`ScriptM8 Pro` entitlement) was 403-rejected by `POST /api/rehearsals`
for `mode='performance'` or `mode='loop'`.

A client-only UI OR of `isPremium` is NOT sufficient — backend feature
gates read `user.subscription_tier` directly. The real root-cause fix is
to let the backend heal the stale row via a dedicated, authoritative
RC-REST verified sync endpoint.

This test suite locks:
    1. POST /users/{device}/revenuecat/sync verifies server-side via
       `fetch_premium_entitlement` (SEC-003 pattern).
    2. Active entitlement → user row is upserted to premium with the
       correct expiry.
    3. Inactive entitlement → user row stays free (no demotion either).
    4. RC unavailable → 503, row untouched.
    5. End-to-end: after sync, POST /api/rehearsals with
       `mode='performance'` and `mode='loop'` is NO LONGER 403'd.
    6. Before sync (control): the same request IS 403'd — proves the
       endpoint is doing real work.
    7. SEC-002: path device_id must match the authenticated bearer.
    8. SEC-003: missing `revenuecat_app_user_id` → 400.
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


@pytest.fixture
def client():
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[os.environ.get("DB_NAME", "scriptmate")]
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def device_bearer(client):
    device_id = f"rcsync-{uuid.uuid4().hex[:12]}"
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
    _sync_db.scripts.delete_many({"user_id": {"$regex": device_id}})


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _stub_fetch(result=None, *, raises=None):
    async def _stub(app_user_id, **kwargs):  # noqa: ARG001
        if raises is not None:
            raise raises
        return result
    return _stub


# ─── 1. missing field + SEC-002 identity match ──────────────────────────

def test_sync_without_rc_app_user_id_returns_400(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={},
        headers=_auth(device_bearer["token"]),
    )
    # Pydantic rejects the missing required field → 422; the explicit
    # 400 branch triggers when the field is present but empty.
    assert r.status_code in (400, 422), r.text


def test_sync_with_empty_rc_app_user_id_returns_400(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": ""},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 400, r.text
    assert "revenuecat_app_user_id" in r.text


def test_sync_rejects_mismatched_device_id(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    other_device = f"rcsync-attacker-{uuid.uuid4().hex[:8]}"
    r = client.post(
        f"/api/users/{other_device}/revenuecat/sync",
        json={"revenuecat_app_user_id": "attacker"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code in (401, 403, 404), r.text


# ─── 2. active entitlement → row upserted to premium ────────────────────

def test_sync_active_entitlement_lifts_backend_row(client, device_bearer, monkeypatch):
    expiry = datetime.now(timezone.utc) + timedelta(days=365)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=expiry)),
    )
    # Pre-condition: user row is free.
    pre = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert pre.get("subscription_tier", "free") == "free"

    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:test-active"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["synced"] is True
    assert body["is_premium"] is True
    assert body["subscription_end"] is not None

    # Post-condition: user row is premium.
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row["subscription_tier"] == "premium"
    assert row["revenuecat_app_user_id"] == "$RCAnonymousID:test-active"
    assert row["subscription_end"] is not None


def test_sync_lifetime_entitlement_uses_far_future_sentinel(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:lifetime"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_premium"] is True
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    # Lifetime sentinel is now + 100 years. Must be well past "soon".
    assert row["subscription_end"] > datetime.utcnow() + timedelta(days=365 * 50)


# ─── 3. inactive entitlement → row stays free, NO demotion ──────────────

def test_sync_inactive_entitlement_does_not_mutate_row(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=False, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:inactive"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["synced"] is True
    assert body["is_premium"] is False
    assert body["subscription_end"] is None

    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row.get("subscription_tier", "free") == "free"


def test_sync_inactive_does_not_demote_already_premium_row(client, device_bearer, monkeypatch):
    """Guardrail: if a user is legitimately premium (via /subscribe) and
    their RC cache happens to miss the entitlement on sync, we must NOT
    silently demote them. The endpoint is for lifts, not for demotions.
    """
    far_future = datetime.utcnow().replace(microsecond=0) + timedelta(days=180)
    _sync_db.users.update_one(
        {"device_id": device_bearer["device_id"]},
        {"$set": {
            "subscription_tier": "premium",
            "subscription_end": far_future,
            "revenuecat_app_user_id": "$RCAnonymousID:legit",
        }},
    )
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=False, expires_at=None)),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:legit"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 200, r.text
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    # Still premium. Still has the correct expiry (Mongo stores datetimes
    # at ms precision, so compare at second granularity).
    assert row["subscription_tier"] == "premium"
    assert row["subscription_end"].replace(microsecond=0) == far_future


# ─── 4. RC unavailable → 503, row untouched ─────────────────────────────

def test_sync_rc_unavailable_returns_503(client, device_bearer, monkeypatch):
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(raises=RevenueCatUnavailable("rc down")),
    )
    r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:any"},
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 503, r.text
    row = _sync_db.users.find_one({"device_id": device_bearer["device_id"]})
    assert row.get("subscription_tier", "free") == "free"


# ─── 5. End-to-end: after sync, Performance / Loop rehearsals succeed ───

def _create_script(client, token, device_id):
    """Create a script via the real endpoint and return (script_id, user_character)."""
    raw = (
        "INT. KITCHEN - DAY\n\n"
        "ALEX\nI'm ready.\n\n"
        "BLAKE\nSo am I.\n\n"
    )
    r = client.post(
        "/api/scripts",
        json={"title": f"rcsync-{device_id[-6:]}", "raw_text": raw},
        headers=_auth(token),
    )
    assert r.status_code in (200, 201), r.text
    data = r.json()
    return data["id"], (data.get("characters") or [{"name": "ALEX"}])[0]["name"]


def test_before_sync_performance_rehearsal_is_rejected(client, device_bearer, monkeypatch):
    """Control: free-tier backend row 403s Performance mode. This is
    the baseline the sync endpoint must flip.

    QA_PREMIUM is enabled in the preview .env so we patch
    `_qa_premium_enabled` off for this test — we want to exercise the
    real free-tier gating path, which is what production users hit.
    """
    monkeypatch.setattr(server, "_qa_premium_enabled", lambda: False)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    script_id, user_char = _create_script(
        client, device_bearer["token"], device_bearer["device_id"],
    )
    r = client.post(
        "/api/rehearsals",
        json={
            "script_id": script_id,
            "user_character": user_char,
            "mode": "performance",
            "voice_type": "alloy",
        },
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code == 403, r.text
    assert "performance" in r.text.lower() or "premium" in r.text.lower()


def test_after_sync_performance_rehearsal_succeeds(client, device_bearer, monkeypatch):
    """E2E proof: sync lifts the row → /rehearsals mode=performance now 200s.

    Disables QA_PREMIUM so the test can't accidentally rely on the dev
    bypass — the lift must come from the real sync write.
    """
    monkeypatch.setattr(server, "_qa_premium_enabled", lambda: False)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    script_id, user_char = _create_script(
        client, device_bearer["token"], device_bearer["device_id"],
    )

    sync_r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:e2e"},
        headers=_auth(device_bearer["token"]),
    )
    assert sync_r.status_code == 200, sync_r.text
    assert sync_r.json()["is_premium"] is True

    r = client.post(
        "/api/rehearsals",
        json={
            "script_id": script_id,
            "user_character": user_char,
            "mode": "performance",
            "voice_type": "alloy",
        },
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code in (200, 201), r.text


def test_after_sync_loop_rehearsal_succeeds(client, device_bearer, monkeypatch):
    """E2E proof for the second premium-only mode called out in the QA
    report (Loop). QA_PREMIUM disabled so the lift must come from sync.
    """
    monkeypatch.setattr(server, "_qa_premium_enabled", lambda: False)
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    script_id, user_char = _create_script(
        client, device_bearer["token"], device_bearer["device_id"],
    )
    sync_r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:e2e-loop"},
        headers=_auth(device_bearer["token"]),
    )
    assert sync_r.status_code == 200, sync_r.text

    r = client.post(
        "/api/rehearsals",
        json={
            "script_id": script_id,
            "user_character": user_char,
            "mode": "loop",
            "voice_type": "alloy",
        },
        headers=_auth(device_bearer["token"]),
    )
    assert r.status_code in (200, 201), r.text


# ─── 6. /users/{id}/limits reports is_premium=true after sync ───────────

def test_after_sync_limits_endpoint_reports_premium(client, device_bearer, monkeypatch):
    """The limits endpoint feeds the client store. After sync it must
    report `is_premium: True` and PREMIUM_TIER_LIMITS."""
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    sync_r = client.post(
        f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:limits"},
        headers=_auth(device_bearer["token"]),
    )
    assert sync_r.status_code == 200, sync_r.text

    lim = client.get(
        f"/api/users/{device_bearer['device_id']}/limits",
        headers=_auth(device_bearer["token"]),
    )
    assert lim.status_code == 200, lim.text
    body = lim.json()
    assert body["is_premium"] is True
    assert body["tier"] == "premium"
    assert "performance" in body["limits"]["available_modes"]
    assert "loop" in body["limits"]["available_modes"]


# ─── 7. idempotency ─────────────────────────────────────────────────────

def test_sync_is_idempotent(client, device_bearer, monkeypatch):
    """Calling sync N times with the same active entitlement must leave
    the row in the same shape (safe to call on every launch).
    """
    monkeypatch.setattr(
        server, "fetch_premium_entitlement",
        _stub_fetch(RevenueCatEntitlement(active=True, expires_at=None)),
    )
    for _ in range(3):
        r = client.post(
            f"/api/users/{device_bearer['device_id']}/revenuecat/sync",
            json={"revenuecat_app_user_id": "$RCAnonymousID:idemp"},
            headers=_auth(device_bearer["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_premium"] is True

    rows = list(_sync_db.users.find({"device_id": device_bearer["device_id"]}))
    assert len(rows) == 1
    assert rows[0]["subscription_tier"] == "premium"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
