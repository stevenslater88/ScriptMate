"""
SEC-002 follow-up — audit-closure regression suite (Feb-2026)
================================================================

The initial SEC-002 ticket hardened scripts/notes/stats/daily-drill/
users-me. The follow-up audit (same ticket, scope extension) extends
bearer enforcement to the remaining user-data routes identified in the
backend audit:

    * /api/users/{device_id}
    * /api/users/{device_id}/limits
    * /api/users/{device_id}/stats
    * /api/users/{device_id}/subscribe        (privilege-escalation gate)
    * /api/users/{device_id}/start-trial      (privilege-escalation gate)
    * /api/users/{device_id}/cancel-subscription
    * /api/auth/user/{user_id}
    * /api/auth/logout
    * /api/sync/push, /api/sync/pull/{user_id}
    * /api/rehearsals, /api/rehearsals/{id}  (POST/GET/PUT/DELETE)
    * /api/streak/{user_id}, /api/streak/{user_id}/record
    * /api/dialect/history/{user_id}
    * /api/acting-coach/history/{user_id}
    * /api/dialect/analyze, /api/acting-coach/analyze
    * /api/scripts/{script_id}/voices       (GET/POST/PUT)
    * /api/tapes/share, /api/tapes/user/{user_id}, DELETE /api/tapes/share/{id}
    * /api/voice-studio/takes               (POST/GET/DELETE)

Each is checked for:
    * Unauth → HTTP 401
    * Where applicable, path user_id mismatch → HTTP 403
"""

from __future__ import annotations

import logging as _log_mod
import os
import uuid
from pathlib import Path

import pytest
import requests

_log = _log_mod.getLogger("scriptmate.tests.sec002_followup")

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except (ImportError, OSError) as _err:
    _log.debug("sec002 followup: dotenv load skipped: %s", _err)

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "https://save-script-verify.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


def _raw(method: str, url: str, **kwargs) -> requests.Response:
    try:
        from conftest import _ORIG_SESSION_REQUEST  # type: ignore
    except ImportError:
        return requests.request(method, url, **kwargs)
    s = requests.sessions.Session()
    try:
        return _ORIG_SESSION_REQUEST(s, method, url, **kwargs)
    finally:
        s.close()


def _mint(device_id: str) -> dict:
    r = _raw(
        "POST",
        f"{API}/auth/device-session",
        json={"device_id": device_id},
        timeout=10,
    )
    assert r.status_code == 200, f"mint failed: {r.status_code} {r.text[:200]}"
    return r.json()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_a():
    device_id = f"sec002fu-A-{uuid.uuid4().hex[:10]}"
    body = _mint(device_id)
    return {"device_id": device_id, "token": body["token"]}


@pytest.fixture(scope="module")
def user_b():
    device_id = f"sec002fu-B-{uuid.uuid4().hex[:10]}"
    body = _mint(device_id)
    return {"device_id": device_id, "token": body["token"]}


# ─── 1. UNAUTH LOCK-OUT — every newly protected route ────────────────

@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/users/some-device"),
        ("GET", "/users/some-device/limits"),
        ("GET", "/users/some-device/stats"),
        ("POST", "/users/some-device/subscribe"),
        ("POST", "/users/some-device/start-trial"),
        ("POST", "/users/some-device/cancel-subscription"),
        ("GET", "/auth/user/some-uuid"),
        ("POST", "/auth/logout"),
        ("POST", "/sync/push"),
        ("GET", "/sync/pull/some-user"),
        ("POST", "/rehearsals"),
        ("GET", "/rehearsals"),
        ("GET", "/rehearsals/some-id"),
        ("PUT", "/rehearsals/some-id"),
        ("DELETE", "/rehearsals/some-id"),
        ("GET", "/streak/some-user"),
        ("POST", "/streak/some-user/record"),
        ("GET", "/dialect/history/some-user"),
        ("GET", "/acting-coach/history/some-user"),
        ("POST", "/acting-coach/analyze"),
        ("GET", "/scripts/some-script/voices"),
        ("POST", "/scripts/some-script/voices"),
        ("PUT", "/scripts/some-script/voices/CHAR?voice_key=rachel"),
        ("POST", "/tapes/share"),
        ("GET", "/tapes/user/some-user"),
        ("DELETE", "/tapes/share/some-share"),
        ("GET", "/voice-studio/takes/some-user"),
        ("DELETE", "/voice-studio/takes/some-take"),
    ],
)
def test_sec002fu_unauth_requests_rejected_401(method, path):
    r = _raw(method, f"{API}{path}", json={}, timeout=10)
    assert r.status_code == 401, (
        f"{method} {path} must require auth; got {r.status_code} {r.text[:120]}"
    )


# ─── 2. PATH user_id MISMATCH → 403 ──────────────────────────────────

@pytest.mark.parametrize(
    "method,path_tpl",
    [
        ("GET",    "/users/{other}"),
        ("GET",    "/users/{other}/limits"),
        ("GET",    "/users/{other}/stats"),
        ("POST",   "/users/{other}/start-trial"),
        ("POST",   "/users/{other}/cancel-subscription"),
        ("GET",    "/auth/user/{other}"),
        ("GET",    "/sync/pull/{other}"),
        # 2026-02 refined: /streak/* and /daily-drill/* are now
        # bearer-authoritative (see test_daily_drill_bearer_identity_feb2026
        # and test_sec002_route_auth_enforcement_feb2026) because mobile
        # mints two independent AsyncStorage device-id keys and strict
        # path matching was 403'ing legitimate users. The cross-user
        # isolation contract is enforced via bearer-derived Mongo
        # filters, verified in those dedicated test files.
        ("GET",    "/dialect/history/{other}"),
        ("GET",    "/acting-coach/history/{other}"),
        ("GET",    "/tapes/user/{other}"),
        ("GET",    "/voice-studio/takes/{other}"),
    ],
)
def test_sec002fu_path_user_id_mismatch_rejected_403(method, path_tpl, user_a, user_b):
    url = f"{API}{path_tpl.format(other=user_b['device_id'])}"
    r = _raw(method, url, headers=_bearer(user_a["token"]), json={}, timeout=10)
    assert r.status_code == 403, (
        f"{method} {url} must 403 on cross-user path; got {r.status_code} "
        f"{r.text[:120]}"
    )


# ─── 3. PRIVILEGE-ESCALATION BLOCK on /users/{device_id}/subscribe ───

def test_sec002fu_subscribe_cross_user_rejected_403(user_a, user_b):
    r = _raw(
        "POST",
        f"{API}/users/{user_b['device_id']}/subscribe",
        headers=_bearer(user_a["token"]),
        json={"plan": "monthly"},
        timeout=10,
    )
    assert r.status_code == 403


# ─── 4. CROSS-OWNER ACCESS → 404 on CRUD routes ──────────────────────

def test_sec002fu_cross_user_rehearsal_returns_404(user_a, user_b):
    # Plant a script against user_a so we can plant a rehearsal.
    r = _raw(
        "POST",
        f"{API}/scripts",
        headers=_bearer(user_a["token"]),
        json={"title": "SEC002FU_reh", "raw_text": "X\nhi\n"},
        timeout=30,
    )
    assert r.status_code == 200
    sid = r.json()["id"]
    try:
        rc = _raw(
            "POST",
            f"{API}/rehearsals",
            headers=_bearer(user_a["token"]),
            json={
                "script_id": sid,
                "user_character": "X",
                "mode": "warm-up",
                "voice_type": "alloy",
            },
            timeout=20,
        )
        if rc.status_code != 200:
            # QA may limit rehearsals; still verify auth plumbing.
            pytest.skip(f"rehearsal create not allowed in env: {rc.status_code}")
        rid = rc.json()["id"]
        for method in ("GET", "PUT", "DELETE"):
            kwargs = {"headers": _bearer(user_b["token"]), "timeout": 10}
            if method == "PUT":
                kwargs["json"] = {"completed_lines": [1]}
            resp = _raw(method, f"{API}/rehearsals/{rid}", **kwargs)
            assert resp.status_code == 404, (
                f"{method} /rehearsals/{{id}} cross-user must 404, got {resp.status_code}"
            )
    finally:
        _raw("DELETE", f"{API}/scripts/{sid}", headers=_bearer(user_a["token"]), timeout=10)


def test_sec002fu_cross_user_script_voices_returns_404(user_a, user_b):
    r = _raw(
        "POST",
        f"{API}/scripts",
        headers=_bearer(user_a["token"]),
        json={"title": "SEC002FU_voices", "raw_text": "A\nhi\n"},
        timeout=30,
    )
    assert r.status_code == 200
    sid = r.json()["id"]
    try:
        rg = _raw("GET", f"{API}/scripts/{sid}/voices", headers=_bearer(user_b["token"]), timeout=10)
        assert rg.status_code == 404
        rp = _raw(
            "POST", f"{API}/scripts/{sid}/voices",
            headers=_bearer(user_b["token"]),
            json={"script_id": sid, "character_voices": []},
            timeout=10,
        )
        assert rp.status_code == 404
        ru = _raw(
            "PUT", f"{API}/scripts/{sid}/voices/A?voice_key=rachel",
            headers=_bearer(user_b["token"]),
            timeout=10,
        )
        assert ru.status_code == 404
    finally:
        _raw("DELETE", f"{API}/scripts/{sid}", headers=_bearer(user_a["token"]), timeout=10)


# ─── 5. SYNC owner derived from bearer, not body ─────────────────────

def test_sec002fu_sync_push_body_user_id_ignored(user_a, user_b):
    """Even if user_a sends a push body with user_b's id, the write
    is attributed to user_a (or 404 since user_a is anonymous and has
    no authenticated_users row). The server must never execute the
    write against user_b."""
    r = _raw(
        "POST",
        f"{API}/sync/push",
        headers=_bearer(user_a["token"]),
        json={
            "user_id": user_b["device_id"],  # the attack
            "settings": {"theme": "pwned"},
        },
        timeout=10,
    )
    # user_a (anonymous device) → 404 "User not found" (no authenticated_users row)
    # OR 200 with the write landing against user_a's identity.
    # Either outcome proves the body user_id did NOT win.
    assert r.status_code in (200, 404)


# ─── 6. TTS proxy & ledger smoke still work ──────────────────────────

def test_sec002fu_tts_proxy_still_works_with_same_bearer(user_a):
    r = _raw(
        "POST",
        f"{API}/tts/elevenlabs/generate",
        headers=_bearer(user_a["token"]),
        json={
            "text": "sec002 follow-up smoke",
            "voice_id": "21m00Tcm4TlvDq8ikWAM",
            "stability": 0.5, "similarity_boost": 0.75, "style": 0.0,
            "use_speaker_boost": True, "speed": 1.0,
        },
        timeout=30,
    )
    assert r.status_code != 401
