"""SEC-002 — RevenueCat App User ID must be bound to the authenticated session.

Every RevenueCat entitlement lookup is rejected (403) BEFORE
`fetch_premium_entitlement` runs when the client-supplied RC id differs
from `effective_user_id(authenticated_user_id)`. The RC stub below always
answers "active" so any leaked lookup would visibly grant Premium.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pymongo import MongoClient as _PyMongoClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

import server  # noqa: E402
from revenuecat_client import RevenueCatEntitlement  # noqa: E402

_sync_db = _PyMongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture
def client(monkeypatch):
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = fresh
    server.db = fresh[os.environ["DB_NAME"]]
    monkeypatch.setattr(server, "_qa_premium_enabled", lambda: False)
    monkeypatch.setenv("REVENUECAT_SECRET_KEY", "sk_test_dummy")
    server._tier_cache_clear()
    with TestClient(server.app) as c:
        yield c
    server._tier_cache_clear()


@pytest.fixture
def rc_spy(monkeypatch):
    calls: list[str] = []
    state = {"active": True}

    async def _stub(app_user_id, **kwargs):  # noqa: ARG001
        calls.append(app_user_id)
        return RevenueCatEntitlement(
            active=state["active"],
            expires_at=None,
        )

    monkeypatch.setattr(server, "fetch_premium_entitlement", _stub)
    return {"calls": calls, "state": state}


def _make_user(client, prefix: str) -> dict:
    device_id = f"{prefix}-{uuid.uuid4().hex[:12]}"
    r = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    cr = client.post(
        "/api/users", json={"device_id": device_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert cr.status_code in (200, 201), cr.text
    return {"device_id": device_id, "token": token}


@pytest.fixture
def user_a(client):
    u = _make_user(client, "sec002a")
    yield u
    _sync_db.users.delete_many({"device_id": u["device_id"]})
    _sync_db.auth_tokens.delete_many({"user_id": f"device:{u['device_id']}"})
    _sync_db.scripts.delete_many({"user_id": u["device_id"]})


@pytest.fixture
def user_b(client):
    u = _make_user(client, "sec002b")
    yield u
    _sync_db.users.delete_many({"device_id": u["device_id"]})
    _sync_db.auth_tokens.delete_many({"user_id": f"device:{u['device_id']}"})


def _hdr(user: dict, rc_id: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {user['token']}"}
    if rc_id is not None:
        h["X-RC-App-User-Id"] = rc_id
    return h


def _row(user: dict) -> dict:
    return _sync_db.users.find_one({"device_id": user["device_id"]})


def _limits(client, user, rc_id=None):
    return client.get(f"/api/users/{user['device_id']}/limits", headers=_hdr(user, rc_id))


# ─── TEST 1 — legitimate user: RC verification proceeds normally ───────

def test_1_legit_header_matches_session_rc_verification_proceeds(client, user_a, rc_spy):
    r = _limits(client, user_a, user_a["device_id"])
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "premium"
    assert rc_spy["calls"] == [user_a["device_id"]]
    assert _row(user_a)["subscription_tier"] == "premium"


# ─── TEST 2 — attack: A presents B's RC id → rejected, no RC lookup ───

def test_2_attack_cross_user_rc_id_rejected_before_rc_lookup(client, user_a, user_b, rc_spy):
    r = _limits(client, user_a, user_b["device_id"])
    assert r.status_code == 403, r.text
    assert "does not match authenticated session" in r.text
    assert rc_spy["calls"] == []
    row = _row(user_a)
    assert row.get("subscription_tier", "free") == "free"
    assert row.get("revenuecat_app_user_id") in (None, "")


def test_2b_attack_on_rehearsal_create_rejected(client, user_a, user_b, rc_spy):
    r = client.post(
        "/api/rehearsals",
        json={"script_id": "x", "user_character": "ALEX", "mode": "performance"},
        headers=_hdr(user_a, user_b["device_id"]),
    )
    assert r.status_code == 403, r.text
    assert "does not match authenticated session" in r.text
    assert rc_spy["calls"] == []


def test_2c_attack_on_tts_tier_resolution_rejected(client, user_a, user_b, rc_spy):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server._resolve_tier_for_tts(
            f"device:{user_a['device_id']}", user_b["device_id"],
        ))
    assert exc.value.status_code == 403
    assert rc_spy["calls"] == []


def test_2d_poisoned_stored_rc_id_never_used(client, user_a, user_b, rc_spy):
    _sync_db.users.update_one(
        {"device_id": user_a["device_id"]},
        {"$set": {"revenuecat_app_user_id": user_b["device_id"]}},
    )
    r = _limits(client, user_a)
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "free"
    assert rc_spy["calls"] == []


# ─── TEST 3 — unknown / missing / anonymous RC id ─────────────────────

def test_3_missing_header_keeps_existing_behaviour(client, user_a, rc_spy):
    r = _limits(client, user_a)
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "free"
    assert rc_spy["calls"] == []


def test_3b_anonymous_header_ignored_no_lookup_no_403(client, user_a, rc_spy):
    r = _limits(client, user_a, "$RCAnonymousID:abc123")
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "free"
    assert rc_spy["calls"] == []


def test_3c_missing_header_uses_bound_stored_rc_id(client, user_a, rc_spy):
    _sync_db.users.update_one(
        {"device_id": user_a["device_id"]},
        {"$set": {"revenuecat_app_user_id": user_a["device_id"]}},
    )
    r = _limits(client, user_a)
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "premium"
    assert rc_spy["calls"] == [user_a["device_id"]]


# ─── TEST 4 — Premium legitimate user stays Premium ───────────────────

def test_4_premium_user_with_own_rc_id_remains_premium(client, user_a, rc_spy):
    _sync_db.users.update_one(
        {"device_id": user_a["device_id"]},
        {"$set": {
            "subscription_tier": "premium",
            "subscription_end": datetime.utcnow() + timedelta(days=30),
        }},
    )
    r = _limits(client, user_a, user_a["device_id"])
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "premium"
    assert r.json()["is_premium"] is True


# ─── TEST 5 — Free legitimate user stays Free ─────────────────────────

def test_5_free_user_with_own_rc_id_remains_free(client, user_a, rc_spy):
    rc_spy["state"]["active"] = False
    r = _limits(client, user_a, user_a["device_id"])
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "free"
    assert rc_spy["calls"] == [user_a["device_id"]]
    assert _row(user_a).get("subscription_tier", "free") == "free"


# ─── TEST 6 — /revenuecat/sync body mismatch ──────────────────────────

def test_6_sync_body_mismatch_rejected_before_rc_lookup(client, user_a, user_b, rc_spy):
    r = client.post(
        f"/api/users/{user_a['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": user_b["device_id"]},
        headers=_hdr(user_a),
    )
    assert r.status_code == 403, r.text
    assert rc_spy["calls"] == []
    row = _row(user_a)
    assert row.get("subscription_tier", "free") == "free"
    assert row.get("revenuecat_app_user_id") in (None, "")


def test_6b_sync_anonymous_body_rejected(client, user_a, rc_spy):
    r = client.post(
        f"/api/users/{user_a['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": "$RCAnonymousID:abc123"},
        headers=_hdr(user_a),
    )
    assert r.status_code == 403, r.text
    assert rc_spy["calls"] == []


def test_6c_sync_legit_body_still_works(client, user_a, rc_spy):
    r = client.post(
        f"/api/users/{user_a['device_id']}/revenuecat/sync",
        json={"revenuecat_app_user_id": user_a["device_id"]},
        headers=_hdr(user_a),
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_premium"] is True
    assert rc_spy["calls"] == [user_a["device_id"]]


def test_6d_subscribe_and_start_trial_body_mismatch_rejected(client, user_a, user_b, rc_spy):
    r1 = client.post(
        f"/api/users/{user_a['device_id']}/subscribe",
        json={"plan": "monthly", "revenuecat_app_user_id": user_b["device_id"]},
        headers=_hdr(user_a),
    )
    r2 = client.post(
        f"/api/users/{user_a['device_id']}/start-trial",
        json={"revenuecat_app_user_id": user_b["device_id"]},
        headers=_hdr(user_a),
    )
    assert r1.status_code == 403, r1.text
    assert r2.status_code == 403, r2.text
    assert rc_spy["calls"] == []
    assert _row(user_a).get("subscription_tier", "free") == "free"


# ─── TEST 7 — X-RC-App-User-Id header mismatch ────────────────────────

def test_7_header_mismatch_rejected_even_for_premium_session(client, user_a, user_b, rc_spy):
    _sync_db.users.update_one(
        {"device_id": user_a["device_id"]},
        {"$set": {
            "subscription_tier": "premium",
            "subscription_end": datetime.utcnow() + timedelta(days=30),
        }},
    )
    r = _limits(client, user_a, user_b["device_id"])
    assert r.status_code == 403, r.text
    assert rc_spy["calls"] == []
