"""
Phase P1 — Persistent TTS usage ledger (visibility only)
========================================================

Covers:
  * Successful ElevenLabs synthesis increments the ledger atomically.
  * Pre-synthesis and upstream failures do NOT increment.
  * Character + audio-byte counts are recorded exactly.
  * Repeat / duplicate requests increment on each successful call
    (Phase P1 does not de-duplicate — idempotency is Phase P3).
  * Monthly aggregation returns correct totals across multiple dates.
  * Admin endpoint rejects unauthenticated / missing-token callers
    and returns 503 fail-closed when ADMIN_TOKEN is not configured.
  * Ledger stores NO script text / dialogue / PII payload beyond
    user_id + voice_id + model_id + numeric counters.
  * All existing security surface — 2000-char Pydantic cap, 60/10min
    sliding rate limit, backend-proxy-only, bearer-auth required —
    remains intact.

Every ElevenLabs call in this suite is MONKEYPATCHED. No live vendor
synthesis. No credits consumed.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(ROOT / "backend" / ".env")

import server

# ─── Shared fixtures ────────────────────────────────────────────────

_sync = MongoClient(os.environ["MONGO_URL"])
_sync_db = _sync[os.environ["DB_NAME"]]


@pytest.fixture
def client() -> TestClient:
    # Rebind server.db to a fresh Motor client each test — the
    # previous test's event loop closes and leaves `server.db`
    # pointing at a dead loop. Also rebind our module-level sync
    # client's view consistently.
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[os.environ["DB_NAME"]]
    # Reset in-memory rate-limit state so tests don't bleed into
    # one another.
    with server._tts_rl_lock:
        server._tts_rl_state.clear()
    with server._device_session_rl_lock:
        server._device_session_rl_state.clear()
    # Reset the lazy-index flag so each test re-asserts indexes.
    server._TTS_USAGE_INDEXES_CREATED = False
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def clean_usage():
    """Wipe the ledger before + after each test (sync pymongo)."""
    _sync_db.tts_usage.delete_many({})
    _sync_db.auth_tokens.delete_many({})
    yield
    _sync_db.tts_usage.delete_many({})
    _sync_db.auth_tokens.delete_many({})


@pytest.fixture
def mock_elevenlabs_success(monkeypatch):
    FAKE_MP3 = b"ID3\x04" + b"\x00" * 100 + b"\xff\xfb" + b"\x00" * 500

    class _TTS:
        def convert(self, **kwargs):
            yield FAKE_MP3

    class _Client:
        text_to_speech = _TTS()

    monkeypatch.setattr(server, "eleven_client", _Client())


@pytest.fixture
def mock_elevenlabs_failure(monkeypatch):
    class _TTS:
        def convert(self, **kwargs):
            raise RuntimeError("simulated upstream failure")

    class _Client:
        text_to_speech = _TTS()

    monkeypatch.setattr(server, "eleven_client", _Client())


@pytest.fixture
def mock_elevenlabs_empty(monkeypatch):
    class _TTS:
        def convert(self, **kwargs):
            if False:
                yield b""

    class _Client:
        text_to_speech = _TTS()

    monkeypatch.setattr(server, "eleven_client", _Client())


def _mint_token(client: TestClient, device_id: str) -> str:
    r = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _wait_for_ledger(user_id: str, timeout: float = 2.0) -> dict:
    """TestClient runs the async handler in a loop; wait briefly for
    the awaited Mongo write to appear in the sync view."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        doc = _sync_db.tts_usage.find_one({"user_id": user_id})
        if doc is not None:
            return doc
        time.sleep(0.05)
    return None


# ─── 1. Successful usage increments atomically ────────────────────


def test_successful_generation_increments_usage(
    client, clean_usage, mock_elevenlabs_success
):
    token = _mint_token(client, "p1-success-1")
    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "Hello world", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("audio/mpeg")

    doc = _wait_for_ledger("device:p1-success-1")
    assert doc is not None, "ledger entry must exist after success"
    assert doc["characters"] == 11, (
        f"should record exactly len(text)=11, got {doc['characters']}"
    )
    assert doc["requests"] == 1
    assert doc["audio_bytes"] > 0
    assert doc["voices"]["21m00Tcm4TlvDq8ikWAM"] == 1
    assert doc["models"]["eleven_multilingual_v2"] == 1
    assert doc["date"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert doc["billing_month"] == datetime.now(timezone.utc).strftime("%Y-%m")


# ─── 2. Pre-synthesis failures do NOT increment ───────────────────


def test_missing_bearer_does_not_increment(client, clean_usage):
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json={"text": "x", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 401
    assert _sync_db.tts_usage.count_documents({}) == 0


def test_pydantic_validation_failure_does_not_increment(client, clean_usage):
    token = _mint_token(client, "p1-pydantic")
    # Text at 2001 chars — exceeds the Pydantic max_length=2000 cap.
    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "x" * 2001, "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 422
    assert _sync_db.tts_usage.count_documents({}) == 0


def test_upstream_sdk_error_does_not_increment(
    client, clean_usage, mock_elevenlabs_failure
):
    token = _mint_token(client, "p1-upstream-fail")
    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "test", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 500
    # Give any (incorrectly-queued) async write a chance to land
    time.sleep(0.1)
    assert _sync_db.tts_usage.count_documents({}) == 0, (
        "upstream failures must never be billed to the ledger"
    )


def test_empty_audio_response_does_not_increment(
    client, clean_usage, mock_elevenlabs_empty
):
    token = _mint_token(client, "p1-empty")
    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "test", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 502
    time.sleep(0.1)
    assert _sync_db.tts_usage.count_documents({}) == 0


# ─── 3. Exact character accounting across repeated calls ──────────


def test_exact_character_accounting(client, clean_usage, mock_elevenlabs_success):
    token = _mint_token(client, "p1-exact")
    totals = 0
    for text in ("abc", "hello world", "x" * 50):
        r = client.post(
            "/api/tts/elevenlabs/generate",
            headers={"Authorization": f"Bearer {token}"},
            json={"text": text, "voice_id": "21m00Tcm4TlvDq8ikWAM"},
        )
        assert r.status_code == 200
        totals += len(text)
    doc = _wait_for_ledger("device:p1-exact")
    # Wait longer for final-sum writes to settle
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        doc = _sync_db.tts_usage.find_one({"user_id": "device:p1-exact"})
        if doc and doc.get("requests") == 3:
            break
        time.sleep(0.05)
    assert doc["characters"] == totals, (
        f"expected total {totals}, got {doc['characters']}"
    )
    assert doc["requests"] == 3


# ─── 4. Repeat / duplicate requests increment each time ───────────


def test_duplicate_requests_increment_each_time(
    client, clean_usage, mock_elevenlabs_success
):
    """Phase P1 is intentionally NOT idempotent — the same payload
    hitting the backend twice bills twice. Idempotency is Phase P3.
    This test locks in the Phase P1 contract so a future Phase P3
    change is caught as an explicit edit, not a silent regression."""
    token = _mint_token(client, "p1-dup")
    for _ in range(4):
        r = client.post(
            "/api/tts/elevenlabs/generate",
            headers={"Authorization": f"Bearer {token}"},
            json={"text": "same", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
        )
        assert r.status_code == 200
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        doc = _sync_db.tts_usage.find_one({"user_id": "device:p1-dup"})
        if doc and doc.get("requests") == 4:
            break
        time.sleep(0.05)
    assert doc["characters"] == 16
    assert doc["requests"] == 4


# ─── 5. Monthly aggregation across multiple days ──────────────────


def test_monthly_aggregation(clean_usage):
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")
    docs = [
        {"user_id": "device:a", "date": f"{month}-01",
         "billing_month": month, "characters": 100, "requests": 2,
         "audio_bytes": 1000, "voices": {"v1": 2}, "models": {"m1": 2},
         "first_request_at": "x", "last_request_at": "x"},
        {"user_id": "device:a", "date": f"{month}-02",
         "billing_month": month, "characters": 50, "requests": 1,
         "audio_bytes": 500, "voices": {"v1": 1}, "models": {"m1": 1},
         "first_request_at": "x", "last_request_at": "x"},
        {"user_id": "device:b", "date": f"{month}-01",
         "billing_month": month, "characters": 200, "requests": 3,
         "audio_bytes": 2000, "voices": {"v2": 3}, "models": {"m1": 3},
         "first_request_at": "x", "last_request_at": "x"},
    ]
    _sync_db.tts_usage.insert_many(docs)

    agg = list(_sync_db.tts_usage.aggregate([
        {"$match": {"billing_month": month}},
        {"$group": {"_id": None, "chars": {"$sum": "$characters"},
                    "req": {"$sum": "$requests"},
                    "users": {"$addToSet": "$user_id"}}},
    ]))
    assert agg[0]["chars"] == 350
    assert agg[0]["req"] == 6
    assert set(agg[0]["users"]) == {"device:a", "device:b"}


# ─── 6. Admin endpoint — auth gate ────────────────────────────────


def test_admin_usage_unconfigured_returns_503(client, monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    r = client.get("/api/admin/tts/usage")
    assert r.status_code == 503
    assert "ADMIN_TOKEN not configured" in r.json()["detail"]


def test_admin_usage_wrong_token_returns_401(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "correct-token-xyz")
    r = client.get(
        "/api/admin/tts/usage",
        headers={"X-Admin-Token": "wrong"},
    )
    assert r.status_code == 401


def test_admin_usage_missing_header_returns_401(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "correct-token-xyz")
    r = client.get("/api/admin/tts/usage")
    assert r.status_code == 401


def test_admin_usage_valid_token_returns_shape(client, clean_usage, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "correct-token-xyz")
    r = client.get(
        "/api/admin/tts/usage",
        headers={"X-Admin-Token": "correct-token-xyz"},
    )
    assert r.status_code == 200
    data = r.json()
    for k in ("generated_at", "daily", "monthly", "top_consumers_day", "phase"):
        assert k in data
    assert data["phase"] == "P1-visibility"
    for k in ("characters", "requests", "audio_bytes", "distinct_users"):
        assert k in data["daily"]
        assert k in data["monthly"]
    assert data["daily"]["characters"] == 0
    assert isinstance(data["top_consumers_day"], list)


# ─── 7. No script text / PII content stored ───────────────────────


def test_ledger_stores_no_script_text(
    client, clean_usage, mock_elevenlabs_success
):
    token = _mint_token(client, "p1-no-text")
    secret = "SECRETLINE_canary_42_banana_cucumber"
    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": secret, "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 200
    doc = _wait_for_ledger("device:p1-no-text")
    import json as _json
    serialised = _json.dumps(doc, default=str)
    assert secret not in serialised, "ledger must not store the raw request text"
    assert "canary" not in serialised.lower()


# ─── 8. Existing security surface remains intact ──────────────────


def test_pydantic_2000_char_cap_unchanged():
    """Phase P1 must NOT loosen the per-request character cap."""
    model = server.ElevenLabsTTSRequest.model_fields["text"]
    maxes = [m.max_length for m in model.metadata if hasattr(m, "max_length")]
    assert 2000 in maxes, f"max_length=2000 must be enforced, got {maxes}"


def test_rate_limit_constants_unchanged():
    assert server.TTS_RATE_LIMIT_MAX == 60
    assert server.TTS_RATE_LIMIT_WINDOW_SECONDS == 600


def test_tts_endpoint_still_requires_bearer(client):
    r = client.post(
        "/api/tts/elevenlabs/generate",
        json={"text": "x", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 401


def test_health_endpoint_still_binary_only(client):
    r = client.get("/api/tts/elevenlabs/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"configured", "classification"}, (
        f"health must only emit configured+classification, got {set(body.keys())}"
    )


# ─── 9. Vendor-cost reconciliation signal captured ────────────────


def test_audio_bytes_captured_for_reconciliation(
    client, clean_usage, mock_elevenlabs_success
):
    """`audio_bytes` is the vendor-side signal we store so future
    audits can detect grossly disproportionate ElevenLabs billing
    (e.g. billed credits far exceed the audio actually synthesised).
    Must be present and non-zero on every successful ledger entry."""
    token = _mint_token(client, "p1-recon")
    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={"text": "hello", "voice_id": "21m00Tcm4TlvDq8ikWAM"},
    )
    assert r.status_code == 200
    doc = _wait_for_ledger("device:p1-recon")
    assert doc["audio_bytes"] > 0
    assert "x-elevenlabs-byte-length" in {k.lower() for k in r.headers}


# ─── 10. Backend-proxy-only architecture unchanged ────────────────


def test_no_mobile_direct_elevenlabs_call_reintroduced():
    """Delegate to the whole-tree hardening check — ensure Phase P1
    did NOT leak any `api.elevenlabs.io` or `xi-api-key` into mobile."""
    service_src = (ROOT / "frontend" / "services" / "elevenLabsService.ts").read_text()
    assert "api.elevenlabs.io" not in service_src
    assert "xi-api-key" not in service_src.lower()
    assert "/api/tts/elevenlabs/generate" in service_src
