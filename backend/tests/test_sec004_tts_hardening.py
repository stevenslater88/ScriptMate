"""
SEC-004 TTS proxy hardening regression suite (Feb-2026)
========================================================

Hardens POST /api/tts/elevenlabs/generate against the audit's
cost-abuse scenario. Locks:
  * Auth via REAL bearer token (not client-supplied user_id/device_id)
  * text 1..2000 chars; extra fields forbidden; speed bounded
  * Per-authenticated-user sliding-window rate limit
  * Health route returns only {configured, classification}
  * Frontend bundle contains no ElevenLabs credential patterns
  * SDK errors never leak the API key to the client

Depends on SEC-002 being fixed broadly for the rest of the API —
flagged in the report, not in this ticket.
"""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

sys.path.insert(0, str(BACKEND))
# Load backend's own .env so MONGO_URL + DB_NAME match the live app.
from dotenv import load_dotenv

load_dotenv(BACKEND / ".env")

# Use a synchronous pymongo client pointing at the SAME MongoDB
# instance and database the live app uses — so TestClient routes
# that read via Motor see the test's seeded tokens.
from pymongo import MongoClient as _PyMongoClient

import server
from server import app, generate_access_token

_sync_client = _PyMongoClient(os.environ["MONGO_URL"])
_sync_db = _sync_client[server.db.name]


def _run(coro):
    """Deprecated — use `_sync_db` for direct test writes. Kept for
    convenience in case a test wants to call a Motor coroutine."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# Use a synchronous pymongo client for test seeding. Motor binds to a
# specific event loop at first await, so creating a fresh loop per
# test raises "future belongs to a different loop". pymongo has no
# such constraint. The actual client is initialised above against the
# same database the live app uses.
def _seed_token(user_id: str, token: str, expires_at: datetime) -> None:
    _sync_db.auth_tokens.update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id": user_id,
            "token": token,
            "created_at": datetime.now(timezone.utc),
            "expires_at": expires_at,
        }},
        upsert=True,
    )


def _delete_token(user_id) -> None:
    if isinstance(user_id, dict):
        _sync_db.auth_tokens.delete_many(user_id)
    else:
        _sync_db.auth_tokens.delete_many({"user_id": user_id})


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Rate limiter is a module-level dict; wipe it between tests so
    one test's requests do not affect another."""
    with server._tts_rl_lock:
        server._tts_rl_state.clear()
    yield
    with server._tts_rl_lock:
        server._tts_rl_state.clear()


@pytest.fixture()
def seeded_user():
    """Seed a real auth_tokens row — exactly what the sign-in path
    does. Returns (user_id, token). Cleans up after."""
    user_id = f"sec004-user-{uuid.uuid4()}"
    token = generate_access_token(user_id)
    _seed_token(user_id, token, datetime.now(timezone.utc) + timedelta(days=30))
    yield user_id, token
    _delete_token(user_id)


VALID_BODY = {
    "text": "Hello, world.",
    "voice_id": "21m00Tcm4TlvDq8ikWAM",
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": True,
    "speed": 1.0,
}


# ─── A. HEALTH ENDPOINT ────────────────────────────────────────────

def test_health_endpoint_returns_only_configured_and_classification(client):
    r = client.get("/api/tts/elevenlabs/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"configured", "classification"}, (
        f"health response must contain ONLY 'configured' and "
        f"'classification' — got {sorted(body.keys())}"
    )
    assert "key_length" not in body


# ─── B. AUTHENTICATION ────────────────────────────────────────────

def test_tts_anonymous_request_rejected_401(client):
    r = client.post("/api/tts/elevenlabs/generate", json=VALID_BODY)
    assert r.status_code == 401


def test_tts_client_supplied_user_id_in_body_is_not_authentication(client):
    body = {**VALID_BODY, "user_id": "fictional-victim-uuid"}
    r = client.post("/api/tts/elevenlabs/generate", json=body)
    # 401 (missing bearer) or 422 (extra forbidden field) — both block.
    assert r.status_code in (401, 422)


def test_tts_client_supplied_device_id_header_is_not_authentication(client):
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json=VALID_BODY,
        headers={"X-Device-Id": "spoofed-device-id"},
    )
    assert r.status_code == 401


def test_tts_bogus_bearer_token_rejected_401(client):
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json=VALID_BODY,
        headers={"Authorization": "Bearer " + "f" * 64},
    )
    assert r.status_code == 401


def test_tts_short_bearer_rejected_401(client):
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json=VALID_BODY,
        headers={"Authorization": "Bearer short"},
    )
    assert r.status_code == 401


def test_tts_malformed_authorization_scheme_rejected(client):
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json=VALID_BODY,
        headers={"Authorization": "Basic " + "f" * 64},
    )
    assert r.status_code == 401


def test_tts_expired_bearer_token_rejected_401(client):
    user_id = f"sec004-expired-{uuid.uuid4()}"
    token = generate_access_token(user_id)
    _seed_token(user_id, token, datetime.now(timezone.utc) - timedelta(days=10))
    try:
        r = client.post(
            "/api/tts/elevenlabs/generate",
            json=VALID_BODY,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 401
    finally:
        _delete_token(user_id)


def test_tts_valid_bearer_passes_auth_gate(client, seeded_user):
    """With a real seeded token the auth gate passes. In this test
    env ELEVENLABS_API_KEY is unset so expect 503 (not 401)."""
    _user_id, token = seeded_user
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json=VALID_BODY,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code != 401
    assert r.status_code in (200, 503)


# ─── C. REQUEST VALIDATION ────────────────────────────────────────

def test_tts_text_over_2000_chars_rejected_422(client, seeded_user):
    _uid, token = seeded_user
    body = {**VALID_BODY, "text": "a" * 2001}
    r = client.post(
        "/api/tts/elevenlabs/generate", json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_tts_text_at_exactly_2000_chars_passes_validation(client, seeded_user):
    _uid, token = seeded_user
    body = {**VALID_BODY, "text": "a" * 2000}
    r = client.post(
        "/api/tts/elevenlabs/generate", json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code != 422
    assert r.status_code in (200, 503)


def test_tts_empty_text_rejected_422(client, seeded_user):
    _uid, token = seeded_user
    r = client.post(
        "/api/tts/elevenlabs/generate", json={**VALID_BODY, "text": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_tts_extra_fields_rejected(client, seeded_user):
    _uid, token = seeded_user
    body = {**VALID_BODY, "model_id_override": "eleven_megabucks_v99"}
    r = client.post(
        "/api/tts/elevenlabs/generate", json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_tts_speed_out_of_range_rejected(client, seeded_user):
    _uid, token = seeded_user
    for bad_speed in (-1.0, 10.0, 1000.0):
        body = {**VALID_BODY, "speed": bad_speed}
        r = client.post(
            "/api/tts/elevenlabs/generate", json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 422, f"speed={bad_speed} must be rejected"


def test_tts_voice_id_required_and_non_empty(client, seeded_user):
    _uid, token = seeded_user
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json={**VALID_BODY, "voice_id": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


# ─── D. RATE LIMIT ────────────────────────────────────────────────

def test_tts_rate_limit_enforced_after_threshold(client, seeded_user):
    """Fire exactly MAX requests; MAX+1-th gets 429."""
    _uid, token = seeded_user
    for i in range(server.TTS_RATE_LIMIT_MAX):
        r = client.post(
            "/api/tts/elevenlabs/generate", json=VALID_BODY,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code != 429, f"request #{i} must not be rate-limited"
    r = client.post(
        "/api/tts/elevenlabs/generate", json=VALID_BODY,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    assert r.headers.get("X-RateLimit-Limit") == str(server.TTS_RATE_LIMIT_MAX)


def test_tts_rate_limit_is_per_authenticated_user_not_device_id(client, seeded_user):
    """Rotating X-Device-Id must not reset the per-user window."""
    _uid, token = seeded_user
    for i in range(server.TTS_RATE_LIMIT_MAX):
        client.post(
            "/api/tts/elevenlabs/generate", json=VALID_BODY,
            headers={
                "Authorization": f"Bearer {token}",
                "X-Device-Id": f"rotated-device-{i}",
            },
        )
    r = client.post(
        "/api/tts/elevenlabs/generate", json=VALID_BODY,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Device-Id": "yet-another-device-id",
        },
    )
    assert r.status_code == 429, "device_id rotation must not bypass per-user limit"


def test_tts_rate_limit_two_users_have_independent_windows(client):
    """Two separate seeded users must each get their own full quota."""
    uid_a = f"sec004-a-{uuid.uuid4()}"
    tok_a = generate_access_token(uid_a)
    uid_b = f"sec004-b-{uuid.uuid4()}"
    tok_b = generate_access_token(uid_b)
    for uid, tok in ((uid_a, tok_a), (uid_b, tok_b)):
        _seed_token(uid, tok, datetime.now(timezone.utc) + timedelta(days=1))
    try:
        # Burn user A to the limit.
        for _ in range(server.TTS_RATE_LIMIT_MAX):
            client.post(
                "/api/tts/elevenlabs/generate", json=VALID_BODY,
                headers={"Authorization": f"Bearer {tok_a}"},
            )
        # A's next request → 429.
        r_a = client.post(
            "/api/tts/elevenlabs/generate", json=VALID_BODY,
            headers={"Authorization": f"Bearer {tok_a}"},
        )
        assert r_a.status_code == 429
        # B must still be within its own window.
        r_b = client.post(
            "/api/tts/elevenlabs/generate", json=VALID_BODY,
            headers={"Authorization": f"Bearer {tok_b}"},
        )
        assert r_b.status_code != 429
    finally:
        _delete_token({"user_id": {"$in": [uid_a, uid_b]}})


# ─── E. CLIENT BUNDLE / NO SECRET LEAK ────────────────────────────

def test_frontend_bundle_contains_no_elevenlabs_secret_patterns():
    """Scan frontend/ (excluding node_modules) for credential-shaped
    strings or the removed EXPO_PUBLIC_ELEVENLABS_API_KEY key."""
    for pattern in (
        r"EXPO_PUBLIC_ELEVENLABS_API_KEY",
        r"xi-api-key",
        r"api\.elevenlabs\.io",
        r"sk_[A-Za-z0-9]{20,}",
    ):
        rg = subprocess.run(
            ["grep", "-rE", "--exclude-dir=node_modules",
             pattern, str(FRONTEND)],
            capture_output=True, text=True, check=False,
        )
        hits = [ln for ln in rg.stdout.splitlines() if ln.strip()
                and "xxxxx" not in ln
                and "YOUR_" not in ln
                and not re.search(r"sk_a{20,}", ln)]
        assert not hits, (
            f"frontend tree contains forbidden pattern /{pattern}/:\n"
            f"{hits[:3]}"
        )


# ─── F. SECRET SCRUBBING FROM ERRORS ──────────────────────────────

def test_elevenlabs_key_scrubbed_from_server_errors(monkeypatch, client):
    """Even if the SDK raises an exception that embeds the API key,
    the server must not propagate the key to the client body."""
    fake_key = "sk_leaky_test_" + "x" * 30
    monkeypatch.setattr(server, "ELEVENLABS_API_KEY", fake_key)

    class LeakySDK:
        class _TTS:
            @staticmethod
            def convert(*a, **k):
                raise RuntimeError(f"ElevenLabs rejected key {fake_key}")
        text_to_speech = _TTS()

    monkeypatch.setattr(server, "eleven_client", LeakySDK())

    user_id = f"sec004-leak-{uuid.uuid4()}"
    token = generate_access_token(user_id)
    _seed_token(user_id, token, datetime.now(timezone.utc) + timedelta(days=1))
    try:
        r = client.post(
            "/api/tts/elevenlabs/generate", json=VALID_BODY,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 500
        assert fake_key not in r.text
        assert "sk_leaky_test" not in r.text
        assert "Voice generation failed" in r.text
    finally:
        _delete_token(user_id)
