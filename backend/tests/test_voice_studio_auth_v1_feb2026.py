"""V1 B-1 (Feb 2026) — Voice Studio upload-route auth + bounds regression.

Closes the final V1 release blocker identified in the read-only audit:
POST /api/voice-studio/process and POST /api/voice-studio/demo-reel
previously accepted anonymous file uploads with no size/count guard.

Four focused tests (per the approved brief):
  1. Unauthenticated /voice-studio/process  → 401
  2. Unauthenticated /voice-studio/demo-reel → 401
  3. /voice-studio/process upload > 25 MB   → 413 (BEFORE pydub runs)
  4. /voice-studio/demo-reel with 11 files  → 422 (BEFORE pydub runs)

Design: tests use the in-process FastAPI app via TestClient; the
unauthenticated cases avoid conftest.py auto-attach by overriding
the Authorization header to an empty string (opt-out signal). The
bounds tests send junk payloads — size/count must be rejected BEFORE
the handler tries to decode them with pydub, so no real audio is
needed.
"""
from __future__ import annotations

import io
import os
import sys
import uuid
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

_sync_client = _PyMongoClient(os.environ["MONGO_URL"])
_sync_db = _sync_client[os.environ.get("DB_NAME", server.db.name)]


@pytest.fixture
def client():
    """Rebind server.db to a fresh Motor client each test — previous
    test's event loop closes and leaves `server.db` on a dead loop
    (mirrors the SEC-003/P2 pattern)."""
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[os.environ.get("DB_NAME", "scriptmate")]
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def bearer(client):
    """Mint a real device-session bearer for the authenticated test
    cases (the bounds tests still need to pass auth to reach the
    413/422 branches)."""
    device_id = f"b1-{uuid.uuid4().hex[:10]}"
    r = client.post("/api/auth/device-session", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    yield {"device_id": device_id, "token": token}
    _sync_db.auth_tokens.delete_many({"user_id": f"device:{device_id}"})


def _auth_header(token: str | None) -> dict:
    # Explicit empty string = opt-out of conftest's auto-attach.
    if token is None:
        return {"Authorization": ""}
    return {"Authorization": f"Bearer {token}"}


# ─── 1. Unauthenticated /voice-studio/process → 401 ─────────────────────

def test_voice_studio_process_requires_bearer(client):
    r = client.post(
        "/api/voice-studio/process",
        files={"audio": ("x.wav", b"\x00" * 16, "audio/wav")},
        data={"operation": "normalize"},
        headers=_auth_header(None),
    )
    assert r.status_code == 401, r.text


# ─── 2. Unauthenticated /voice-studio/demo-reel → 401 ───────────────────

def test_voice_studio_demo_reel_requires_bearer(client):
    r = client.post(
        "/api/voice-studio/demo-reel",
        files=[("files", ("a.wav", b"\x00" * 16, "audio/wav"))],
        data={"gaps": "0.5"},
        headers=_auth_header(None),
    )
    assert r.status_code == 401, r.text


# ─── 3. /voice-studio/process oversize upload → 413 (pre-pydub) ─────────

def test_voice_studio_process_rejects_oversize_upload(client, bearer):
    # 25 MB + 1 byte — must be rejected before pydub ever runs. Payload
    # is junk bytes; a successful pydub decode is not required because
    # the size guard fires first.
    oversize = b"\x00" * (server._VOICE_STUDIO_MAX_UPLOAD_BYTES + 1)
    r = client.post(
        "/api/voice-studio/process",
        files={"audio": ("big.wav", oversize, "audio/wav")},
        data={"operation": "normalize"},
        headers=_auth_header(bearer["token"]),
    )
    assert r.status_code == 413, r.text
    assert "MB" in r.text


# ─── 4. /voice-studio/demo-reel with 11 files → 422 (pre-pydub) ─────────

def test_voice_studio_demo_reel_rejects_too_many_files(client, bearer):
    # 11 files — one more than _VOICE_STUDIO_MAX_DEMO_REEL_FILES (10).
    # Count guard must fire before any file is read / decoded.
    files = [
        ("files", (f"a{i}.wav", b"\x00" * 16, "audio/wav"))
        for i in range(server._VOICE_STUDIO_MAX_DEMO_REEL_FILES + 1)
    ]
    r = client.post(
        "/api/voice-studio/demo-reel",
        files=files,
        data={"gaps": "0.5"},
        headers=_auth_header(bearer["token"]),
    )
    assert r.status_code == 422, r.text
    assert "at most" in r.text
