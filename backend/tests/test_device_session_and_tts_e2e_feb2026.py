"""
Device-session + TTS end-to-end regression (Feb-2026)
=====================================================

Fixes the on-device "no voice playback" regression caused by the
SEC-004 hardening ticket.

Chain under test (what previously silently fell back to expo-speech):

  rehearsal line
    → ElevenLabsService.generateSpeechToFile
    → POST /api/tts/elevenlabs/generate
    → SEC-004 bearer gate: Depends(get_authenticated_user_id)
    → 401 Missing bearer (sign-in is TEMPORARILY DISABLED on client)
    → playSpeech returns null
    → rehearsal falls back to expo-speech

The fix adds POST /api/auth/device-session so the client can mint
an anonymous session token bound to its device_id. This test proves:

  A. Endpoint exists, validates input, returns a 64-char token
  B. Token mint is idempotent per device (upsert, not insert)
  C. Different devices get independent tokens
  D. The minted token DOES unlock the SEC-004-hardened /generate
     endpoint — i.e. the full real-device chain now reaches
     ElevenLabs (or 503-not-configured, never 401)
  E. Mint endpoint is rate-limited per device
  F. The frontend elevenLabsService.ts actually sends the token
     as `Authorization: Bearer <token>` on the generate call
  G. The frontend has a device-session acquisition helper and
     calls it from generateSpeechToFile BEFORE the fetch
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv

load_dotenv(BACKEND / ".env")

from pymongo import MongoClient as _PyMongoClient

import server
from server import app

_sync_client = _PyMongoClient(os.environ["MONGO_URL"])
_sync_db = _sync_client[server.db.name]


def _delete_device_token(device_id: str) -> None:
    _sync_db.auth_tokens.delete_many({"user_id": f"device:{device_id}"})


@pytest.fixture(scope="module")
def client():
    # The previous test module's TestClient fired FastAPI's shutdown
    # event, which calls `client.close()` on the Motor client. After
    # that, every subsequent Motor op raises "Cannot use MongoClient
    # after close". Re-create a fresh Motor client bound to the live
    # Mongo instance so this module's /api/auth/device-session calls
    # can write. This is a TEST-ONLY recovery — production code never
    # mutates server.client at runtime.
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[server.db.name if hasattr(server.db, "name") else os.environ.get("DB_NAME", "scriptmate")]
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_device_session_rate_limit():
    with server._device_session_rl_lock:
        server._device_session_rl_state.clear()
    with server._tts_rl_lock:
        server._tts_rl_state.clear()


# ─── A. Endpoint shape ────────────────────────────────────────────────

def test_mint_requires_device_id(client):
    r = client.post("/api/auth/device-session", json={})
    assert r.status_code == 422

def test_mint_rejects_empty_device_id(client):
    r = client.post("/api/auth/device-session", json={"device_id": ""})
    assert r.status_code == 422

def test_mint_rejects_extra_fields(client):
    r = client.post(
        "/api/auth/device-session",
        json={"device_id": "ok-device-x", "injected": "hi"},
    )
    assert r.status_code == 422
    _delete_device_token("ok-device-x")

def test_mint_returns_token_shape(client):
    device_id = "shape-device-1"
    _delete_device_token(device_id)
    r = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body
    assert "user_id" in body
    assert "expires_at" in body
    # sha256 hex → 64 chars; SEC-004 min length is 32 so this covers it
    assert len(body["token"]) == 64
    assert re.fullmatch(r"[0-9a-f]{64}", body["token"]) is not None
    assert body["user_id"] == f"device:{device_id}"
    _delete_device_token(device_id)


# ─── B. Idempotency ───────────────────────────────────────────────────

def test_mint_is_idempotent_per_device_id(client):
    device_id = "idem-device-1"
    _delete_device_token(device_id)
    r1 = client.post("/api/auth/device-session", json={"device_id": device_id})
    r2 = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["user_id"] == r2.json()["user_id"]
    # Only ONE row in auth_tokens for this device (upsert, not insert).
    rows = list(_sync_db.auth_tokens.find({"user_id": f"device:{device_id}"}))
    assert len(rows) == 1
    _delete_device_token(device_id)


# ─── C. Isolation ─────────────────────────────────────────────────────

def test_two_devices_get_distinct_tokens(client):
    _delete_device_token("iso-a")
    _delete_device_token("iso-b")
    a = client.post("/api/auth/device-session", json={"device_id": "iso-a"}).json()
    b = client.post("/api/auth/device-session", json={"device_id": "iso-b"}).json()
    assert a["token"] != b["token"]
    assert a["user_id"] != b["user_id"]
    _delete_device_token("iso-a")
    _delete_device_token("iso-b")


# ─── D. End-to-end: device session UNLOCKS the SEC-004 proxy ──────────

def test_device_session_token_unlocks_tts_generate_endpoint(client):
    """
    THIS is the regression that proves on-device playback no longer
    silently falls back to expo-speech.

    Without this fix: POST /generate without a bearer → 401 → playSpeech
    returns null → fallback. With this fix: mint via device-session,
    attach bearer → request reaches the TTS handler. We assert the
    status is NOT 401 (the auth gate accepts the token). It may be 503
    'not configured' when ELEVENLABS_API_KEY is absent in the server
    env — that is the correct behaviour and proves the auth gate
    passed; the test is independent of whether the live API key is set.
    """
    device_id = "e2e-device-1"
    _delete_device_token(device_id)
    mint = client.post("/api/auth/device-session", json={"device_id": device_id}).json()
    token = mint["token"]

    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "text": "hello rehearsal",
            "voice_id": "21m00Tcm4TlvDq8ikWAM",
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True,
            "speed": 1.0,
        },
    )
    # The ONE thing we care about: the SEC-004 bearer gate must accept
    # the token. 401 means the on-device fix is broken again.
    assert r.status_code != 401, (
        f"device-session token must unlock /generate; got {r.status_code} "
        f"body={r.text[:200]}"
    )
    # Allowed outcomes: 200 (live key configured), 503 (key missing),
    # 500 (SDK transport error). All three prove auth passed.
    assert r.status_code in (200, 500, 503), (
        f"unexpected status for device-session+generate: {r.status_code}"
    )
    _delete_device_token(device_id)


def test_device_session_token_enforces_tts_body_validation(client):
    """Minted bearer passes auth; the 2000-char cap still fires."""
    device_id = "e2e-device-2"
    _delete_device_token(device_id)
    token = client.post(
        "/api/auth/device-session", json={"device_id": device_id}
    ).json()["token"]

    r = client.post(
        "/api/tts/elevenlabs/generate",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "text": "a" * 2001,
            "voice_id": "v",
            "stability": 0.5, "similarity_boost": 0.75, "style": 0.0,
            "use_speaker_boost": True, "speed": 1.0,
        },
    )
    assert r.status_code == 422
    _delete_device_token(device_id)


def test_device_session_token_is_subject_to_tts_rate_limit(client):
    """SEC-004 60-req/10-min window still applies per minted bearer."""
    device_id = "e2e-device-3"
    _delete_device_token(device_id)
    token = client.post(
        "/api/auth/device-session", json={"device_id": device_id}
    ).json()["token"]

    hit429 = False
    for _ in range(server.TTS_RATE_LIMIT_MAX + 2):
        r = client.post(
            "/api/tts/elevenlabs/generate",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "text": "x", "voice_id": "v",
                "stability": 0.5, "similarity_boost": 0.75, "style": 0.0,
                "use_speaker_boost": True, "speed": 1.0,
            },
        )
        if r.status_code == 429:
            hit429 = True
            break
    assert hit429, "per-user TTS rate limit must engage for device sessions"
    _delete_device_token(device_id)


# ─── E. Device-session mint is itself rate-limited ────────────────────

def test_device_session_mint_rate_limited_per_device(client):
    device_id = "rate-device-1"
    _delete_device_token(device_id)
    hit429 = False
    for i in range(server.DEVICE_SESSION_RL_MAX + 2):
        r = client.post("/api/auth/device-session", json={"device_id": device_id})
        if r.status_code == 429:
            hit429 = True
            break
    assert hit429, "mint endpoint must throttle a single abusive device"
    _delete_device_token(device_id)


def test_device_session_mint_rate_limit_is_per_device(client):
    """Device A hitting the limit must not block Device B."""
    _delete_device_token("rate-a")
    _delete_device_token("rate-b")
    # Burn A to limit.
    for _ in range(server.DEVICE_SESSION_RL_MAX + 2):
        client.post("/api/auth/device-session", json={"device_id": "rate-a"})
    # B must still succeed.
    r = client.post("/api/auth/device-session", json={"device_id": "rate-b"})
    assert r.status_code == 200
    _delete_device_token("rate-a")
    _delete_device_token("rate-b")


# ─── F. Frontend: service must send Authorization: Bearer <token> ─────

SERVICE = FRONTEND / "services" / "elevenLabsService.ts"


def test_service_attaches_authorization_bearer_on_generate_post():
    src = SERVICE.read_text()
    # Find the actual generate fetch call site (not the TTS_ENDPOINT
    # constant declaration — the file has intermediate helper code).
    idx = src.find("fetchFn(TTS_ENDPOINT")
    assert idx > 0, "generateSpeechToFile must POST to TTS_ENDPOINT via fetchFn"
    region = src[idx:idx + 1200]
    assert re.search(r"Authorization:\s*`?Bearer\s", region), (
        "generateSpeechToFile must attach `Authorization: Bearer <token>` "
        "when POSTing to /api/tts/elevenlabs/generate"
    )


def test_service_calls_ensureTtsBearerToken_before_fetch():
    src = SERVICE.read_text()
    assert "ensureTtsBearerToken" in src, (
        "service must expose ensureTtsBearerToken() helper"
    )
    # The helper must be awaited before the fetch call.
    fn_start = src.find("generateSpeechToFile")
    fetch_idx = src.find("fetchFn(TTS_ENDPOINT", fn_start)
    assert fn_start > 0 and fetch_idx > fn_start
    pre_fetch = src[fn_start:fetch_idx]
    assert "ensureTtsBearerToken" in pre_fetch, (
        "ensureTtsBearerToken() must be awaited BEFORE the generate "
        "fetch so a missing bearer short-circuits with a diagnostic"
    )


def test_service_targets_device_session_endpoint():
    src = SERVICE.read_text()
    assert "/api/auth/device-session" in src, (
        "service must mint anonymous sessions via /api/auth/device-session"
    )


def test_service_retries_once_on_401_after_remint():
    """Stale/expired bearer must transparently remint and retry so a
    30-day cached token doesn't lock the user out after backend data
    loss."""
    src = SERVICE.read_text()
    # Look for the retry pattern inside generateSpeechToFile.
    fn_start = src.find("generateSpeechToFile")
    assert fn_start > 0
    region = src[fn_start:fn_start + 5000]
    assert "response.status === 401" in region, (
        "service must handle 401 (stale bearer) explicitly"
    )
    # Must call ensureTtsBearerToken again inside the 401 branch.
    assert region.count("ensureTtsBearerToken") >= 2, (
        "service must remint bearer and retry once on 401"
    )


def test_service_never_logs_bearer_token_value():
    """DebugLog must only emit token metadata (length, expiry), never
    the token string itself."""
    src = SERVICE.read_text()
    # Scan every DebugLog.log call for a direct token-value interpolation.
    bad = re.findall(r"DebugLog\.log[^;]*token:\s*(bearer|token|cached\.token)[^;]*", src)
    assert not bad, (
        f"bearer token value must never appear in diagnostics: {bad[:3]}"
    )


# ─── G. In-memory + persistent bearer cache contract ──────────────────

def test_service_persists_bearer_to_async_storage():
    src = SERVICE.read_text()
    assert "@scriptmate_tts_bearer" in src, (
        "service must cache bearer under @scriptmate_tts_bearer so a "
        "fresh app launch doesn't re-mint on every rehearsal"
    )
    assert "AsyncStorage.setItem" in src


def test_service_refreshes_bearer_before_expiry():
    src = SERVICE.read_text()
    # Must consider skew before expiry — we don't want to use a token
    # that will expire mid-rehearsal.
    assert "TTS_BEARER_REFRESH_SKEW_MS" in src or "REFRESH_SKEW" in src.upper(), (
        "service must refresh bearer before expiry window"
    )


# ─── H. Smoke: rehearsal screen integration unchanged ─────────────────

REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"


def test_rehearsal_still_imports_playSpeech_and_isElevenLabsConfigured():
    src = REHEARSAL.read_text()
    # Both must still be imported — this guards against an accidental
    # refactor that bypasses the service.
    assert "playSpeech" in src
    assert "isElevenLabsConfigured" in src
    assert "resolveVoiceForCharacter" in src
    assert "selectProvider" in src


def test_rehearsal_fallback_to_expo_speech_regression_intact():
    """The expo-speech fallback must still exist so a bearer-mint
    failure doesn't stall rehearsal."""
    src = REHEARSAL.read_text()
    assert "FALLBACK_TO_EXPO_SPEECH" in src
    assert "Speech.speak" in src
