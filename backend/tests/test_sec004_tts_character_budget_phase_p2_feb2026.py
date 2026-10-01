"""SEC-004 / Phase P2 — TTS character-budget regression suite (Feb 2026).

Scope
=====
Validates the four env-driven levers added by Phase P2:

  TTS_FREE_DAILY_CHARS
  TTS_PREMIUM_DAILY_CHARS
  TTS_PREMIUM_MONTHLY_CHARS
  TTS_GLOBAL_DAILY_CEILING_CHARS

Enforcement order (helper `_tts_check_character_budget`):
  (1) global ceiling   → 503 (operator signal)
  (2) premium monthly  → 402 (user signal)
  (3) per-tier daily   → 402 (user signal)

Order WITHIN the TTS route:
  bearer auth → Pydantic 2000-char cap → rate limit (60/10min) →
  P2 budget check → ElevenLabs convert() → P1 ledger write.

Tests DO NOT hit real ElevenLabs. The SDK's `convert()` is monkeypatched
to return deterministic audio bytes so we exercise the full post-budget
pipeline including the P1 ledger write.

Baseline notes
--------------
* conftest.py auto-attaches a shared bearer to REAL-NETWORK requests
  only; TestClient-driven tests here manage their own Authorization
  headers explicitly.
* DB assertions use the sync pymongo client against the same Mongo
  the live app uses (mirrors the SEC-004 / SEC-003 pattern).
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient as _PyMongoClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"

sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv

load_dotenv(BACKEND / ".env")

import server

_sync_client = _PyMongoClient(os.environ["MONGO_URL"])
_sync_db = _sync_client[os.environ.get("DB_NAME", server.db.name)]


# ─── Fixtures ────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """Rebind server.db to a fresh Motor client each test — previous
    test's event loop closes and leaves `server.db` pointing at a dead
    loop."""
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[os.environ.get("DB_NAME", "scriptmate")]
    with server._tts_rl_lock:
        server._tts_rl_state.clear()
    server._TTS_USAGE_INDEXES_CREATED = False
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def clean_env(monkeypatch):
    """Clear all four P2 env vars before each test; individual tests
    set only what they need, then teardown restores pre-test state."""
    for var in (
        "TTS_FREE_DAILY_CHARS",
        "TTS_PREMIUM_DAILY_CHARS",
        "TTS_PREMIUM_MONTHLY_CHARS",
        "TTS_GLOBAL_DAILY_CEILING_CHARS",
    ):
        monkeypatch.delenv(var, raising=False)
    # SEC-003: ensure QA_PREMIUM is disabled by default (tests opt in).
    monkeypatch.setenv("ENV", "development")
    monkeypatch.delenv("QA_PREMIUM", raising=False)
    yield


@pytest.fixture
def clean_tts_state():
    """Wipe the ledger + rate-limit state + any seeded users before +
    after each test."""
    _sync_db.tts_usage.delete_many({})
    _sync_db.auth_tokens.delete_many({})
    _sync_db.users.delete_many({"device_id": {"$regex": "^p2-"}})
    yield
    _sync_db.tts_usage.delete_many({})
    _sync_db.auth_tokens.delete_many({})
    _sync_db.users.delete_many({"device_id": {"$regex": "^p2-"}})


@pytest.fixture
def mock_eleven(monkeypatch):
    """Stub ElevenLabs so the vendor is never called and successful
    requests return deterministic bytes."""
    class _StubAudio:
        def convert(self, *, text, voice_id, model_id, voice_settings):
            # Return a single-chunk generator so the real route code
            # path (chunk-concat loop) is exercised.
            return iter([b"\x00" * (len(text) * 2)])

    class _StubClient:
        text_to_speech = _StubAudio()

    monkeypatch.setattr(server, "eleven_client", _StubClient())
    monkeypatch.setattr(server, "ELEVENLABS_API_KEY", "sk_stub_for_tests")


def _mint_bearer(client, device_id: str, *, tier: str = "free") -> str:
    """Mint a bearer and seed the matching users row with the requested
    tier. Caller owns cleanup via the clean_tts_state fixture."""
    r = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    # Seed the subscription tier directly so the budget check sees it.
    _sync_db.users.update_one(
        {"device_id": device_id},
        {"$set": {
            "device_id": device_id,
            "id": device_id,
            "subscription_tier": tier,
        }},
        upsert=True,
    )
    return token


def _seed_ledger(user_id: str, date_key: str, characters: int,
                 *, billing_month: str | None = None) -> None:
    """Pre-populate the ledger as if the user had already used N chars."""
    if billing_month is None:
        billing_month = date_key[:7]
    _sync_db.tts_usage.update_one(
        {"user_id": user_id, "date": date_key},
        {"$set": {
            "user_id": user_id,
            "date": date_key,
            "billing_month": billing_month,
            "characters": int(characters),
            "requests": 1,
            "audio_bytes": int(characters) * 2,
            "voices": {"21m00Tcm4TlvDq8ikWAM": 1},
            "models": {"eleven_multilingual_v2": 1},
            "first_request_at": "2026-10-01T00:00:00Z",
            "last_request_at": "2026-10-01T00:00:00Z",
        }},
        upsert=True,
    )


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _tts_body(text: str) -> dict:
    return {"text": text, "voice_id": "21m00Tcm4TlvDq8ikWAM"}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── 1. Defaults disabled → P1 behaviour preserved ──────────────────────

def test_defaults_disabled_preserves_p1_behaviour(
    client, clean_env, clean_tts_state, mock_eleven,
):
    # All four env vars unset → helper short-circuits; a Free user
    # should be able to call TTS as before P2 and see a ledger write.
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="free")

    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("hello world"), headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("audio/mpeg")

    row = _sync_db.tts_usage.find_one(
        {"user_id": f"device:{device}", "date": _today()})
    assert row is not None
    assert row["characters"] == len("hello world")


# ─── 2. Free user under daily cap → 200 ─────────────────────────────────

def test_free_under_daily_cap(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    monkeypatch.setenv("TTS_FREE_DAILY_CHARS", "500")
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="free")

    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 400), headers=_auth(token))
    assert r.status_code == 200, r.text


# ─── 3. Free user over daily cap → 402, ledger unchanged ────────────────

def test_free_over_daily_cap(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    monkeypatch.setenv("TTS_FREE_DAILY_CHARS", "500")
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="free")
    _seed_ledger(f"device:{device}", _today(), 400)

    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 200), headers=_auth(token))
    assert r.status_code == 402, r.text
    body = r.json()
    assert body["detail"]["tier"] == "free"
    assert body["detail"]["scope"] == "daily"
    assert body["detail"]["used"] == 400
    assert body["detail"]["limit"] == 500

    row = _sync_db.tts_usage.find_one(
        {"user_id": f"device:{device}", "date": _today()})
    assert row["characters"] == 400  # unchanged


# ─── 4. Premium under daily cap → 200 ───────────────────────────────────

def test_premium_under_daily_cap(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    monkeypatch.setenv("TTS_FREE_DAILY_CHARS", "500")
    monkeypatch.setenv("TTS_PREMIUM_DAILY_CHARS", "10000")
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="premium")
    _seed_ledger(f"device:{device}", _today(), 500)  # above Free cap

    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 500), headers=_auth(token))
    assert r.status_code == 200, r.text  # premium quota lets this pass


# ─── 5. Premium over daily cap → 402 ────────────────────────────────────

def test_premium_over_daily_cap(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    monkeypatch.setenv("TTS_PREMIUM_DAILY_CHARS", "10000")
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="premium")
    _seed_ledger(f"device:{device}", _today(), 9800)

    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 500), headers=_auth(token))
    assert r.status_code == 402, r.text
    assert r.json()["detail"]["tier"] == "premium"
    assert r.json()["detail"]["scope"] == "daily"

    row = _sync_db.tts_usage.find_one(
        {"user_id": f"device:{device}", "date": _today()})
    assert row["characters"] == 9800  # unchanged


# ─── 6. Premium over MONTHLY cap → 402 (monthly scope) ──────────────────

def test_premium_over_monthly_cap(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    monkeypatch.setenv("TTS_PREMIUM_DAILY_CHARS", "10000")
    monkeypatch.setenv("TTS_PREMIUM_MONTHLY_CHARS", "300000")
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="premium")

    today = _today()
    month = today[:7]
    user_id = f"device:{device}"
    _sync_db.tts_usage.delete_many({"user_id": user_id})

    # Build a monthly total of 299,900 chars while keeping today's doc
    # well under the 10,000 daily cap so the monthly path fires first.
    # Seed 29 synthetic past-day docs for the SAME billing_month (dates
    # just need to be distinct for the (user_id, date) unique index;
    # the aggregate groups by billing_month).
    for i in range(1, 30):  # 29 past days
        date_key = f"{month}-{i:02d}" if int(today[8:]) != i else f"{month}-30"
        if date_key == today:
            date_key = f"{month}-31"  # avoid colliding with "today"
        _sync_db.tts_usage.insert_one({
            "user_id": user_id, "date": date_key, "billing_month": month,
            "characters": 10000, "requests": 1, "audio_bytes": 20000,
            "voices": {}, "models": {},
            "first_request_at": f"{date_key}T00:00:00Z",
            "last_request_at": f"{date_key}T00:00:00Z",
        })
    # 29 × 10,000 = 290,000.  Today's doc = 9,900 → monthly total 299,900.
    _sync_db.tts_usage.update_one(
        {"user_id": user_id, "date": today},
        {"$set": {
            "user_id": user_id, "date": today, "billing_month": month,
            "characters": 9900, "requests": 1, "audio_bytes": 19800,
            "voices": {}, "models": {},
            "first_request_at": f"{today}T00:00:00Z",
            "last_request_at": f"{today}T00:00:00Z",
        }},
        upsert=True,
    )
    total = next(_sync_db.tts_usage.aggregate([
        {"$match": {"user_id": user_id, "billing_month": month}},
        {"$group": {"_id": None, "s": {"$sum": "$characters"}}},
    ]))["s"]
    assert total == 299900, f"seed arithmetic bug: total={total}"

    # Request 200 chars:
    #   monthly: 299,900 + 200 = 300,100 > 300,000 → should 402 (monthly)
    #   daily:   9,900   + 200 =  10,100 >  10,000 → would also 402 (daily)
    # Enforcement order mandates monthly fires first.
    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 200), headers=_auth(token))
    assert r.status_code == 402, r.text
    assert r.json()["detail"]["scope"] == "monthly"
    assert r.json()["detail"]["limit"] == 300000


# ─── 7. Global emergency ceiling → 503 ──────────────────────────────────

def test_global_ceiling_returns_503(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    monkeypatch.setenv("TTS_GLOBAL_DAILY_CEILING_CHARS", "100000")
    today = _today()
    # Spread 99,900 chars across 3 different users
    for i in range(3):
        _seed_ledger(f"device:bulk-user-{i}", today, 33300)
    assert _sync_db.tts_usage.aggregate([
        {"$match": {"date": today}},
        {"$group": {"_id": None, "s": {"$sum": "$characters"}}},
    ]).next()["s"] == 99900

    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="free")
    # Request 500 chars → global would be 100,400 > 100,000
    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 500), headers=_auth(token))
    assert r.status_code == 503, r.text
    assert "Retry-After" in r.headers
    # And ledger must be unchanged for the new user.
    assert _sync_db.tts_usage.find_one(
        {"user_id": f"device:{device}", "date": today}) is None


# ─── 8. Global ceiling priority over tier 402; rate limit priority 429 ─

def test_priority_ordering(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    # Part A — Global 503 outranks tier 402 when both would fire.
    monkeypatch.setenv("TTS_FREE_DAILY_CHARS", "500")
    monkeypatch.setenv("TTS_GLOBAL_DAILY_CEILING_CHARS", "100000")
    today = _today()
    for i in range(3):
        _seed_ledger(f"device:bulk-{i}", today, 33300)  # global 99,900
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="free")
    _seed_ledger(f"device:{device}", today, 400)  # over Free cap

    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 200), headers=_auth(token))
    assert r.status_code == 503, r.text  # 503 wins, not 402

    # Part B — Rate limit 429 outranks budget 402.
    _sync_db.tts_usage.delete_many({})
    monkeypatch.delenv("TTS_GLOBAL_DAILY_CEILING_CHARS", raising=False)
    _seed_ledger(f"device:{device}", today, 400)
    # Pre-fill the sliding-window state so the next call is RL-blocked.
    import time as _t
    now = _t.time()
    with server._tts_rl_lock:
        server._tts_rl_state[f"device:{device}"] = [
            now for _ in range(server.TTS_RATE_LIMIT_MAX)
        ]
    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 10), headers=_auth(token))
    assert r.status_code == 429, r.text  # 429 wins, not 402


# ─── 9. QA_PREMIUM: dev lifts free → premium; prod fails closed ─────────

def test_qa_premium_dev_lifts_free_but_prod_fails_closed(
    client, clean_env, clean_tts_state, mock_eleven, monkeypatch,
):
    # Shared setup: a free user at exactly the Free cap.
    monkeypatch.setenv("TTS_FREE_DAILY_CHARS", "500")
    monkeypatch.setenv("TTS_PREMIUM_DAILY_CHARS", "10000")
    device = f"p2-{uuid.uuid4().hex[:8]}"
    token = _mint_bearer(client, device, tier="free")
    _seed_ledger(f"device:{device}", _today(), 500)

    # Part A — QA_PREMIUM=true + ENV=development → treated as premium.
    monkeypatch.setenv("QA_PREMIUM", "true")
    monkeypatch.setenv("ENV", "development")
    r = client.post("/api/tts/elevenlabs/generate",
                    json=_tts_body("x" * 500), headers=_auth(token))
    assert r.status_code == 200, r.text  # premium cap allows it

    # Part B — QA_PREMIUM=true + ENV=production → SEC-003 fails closed.
    #   Reset today's ledger to 500 for a clean assertion.
    _sync_db.tts_usage.delete_many({"user_id": f"device:{device}"})
    _seed_ledger(f"device:{device}", _today(), 500)
    monkeypatch.setenv("ENV", "production")
    r2 = client.post("/api/tts/elevenlabs/generate",
                     json=_tts_body("x" * 500), headers=_auth(token))
    assert r2.status_code == 402, r2.text
    assert r2.json()["detail"]["tier"] == "free"
    assert r2.json()["detail"]["limit"] == 500
