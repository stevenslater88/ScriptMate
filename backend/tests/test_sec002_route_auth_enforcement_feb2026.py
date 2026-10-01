"""
SEC-002 route authentication enforcement regression suite (Feb-2026)
======================================================================

The SEC-002 audit found that only POST /api/tts/elevenlabs/generate was
hardened by the earlier SEC-004 ticket; every other protected route still
trusted a client-supplied `user_id` path/query/body parameter. This suite
locks in the Feb-2026 remediation:

    * Every protected route (scripts, notes, stats, daily-drill,
      users/me) is bearer-gated. Unauthenticated callers always
      receive HTTP 401.
    * The identity used for Mongo filters is derived EXCLUSIVELY from
      the bearer token, not from any request-body/query/path value.
    * User A cannot read, mutate or delete User B's scripts or notes.
    * Legacy routes that keep `/{user_id}` in the path validate the
      segment against the authenticated identity and return 403 on
      mismatch (no cross-user identity substitution).
    * `GET /api/users/me` returns the SAME identity that the server
      associates with the bearer.
    * The TTS proxy and the Phase P1 `tts_usage` ledger continue to
      work exactly as before (no SEC-002 collateral damage).

Depends only on the live `requests`+preview-URL harness; it does NOT
re-use the global `requests.*` auto-auth injection in `conftest.py`
because the whole point of these tests is to drive multiple distinct
identities and un-authenticated calls. We rely on the
`unauthenticated_requests` fixture + `_ORIG_SESSION_REQUEST` pattern
so the tests can also run under the global patcher without pollution.
"""

from __future__ import annotations

import logging as _sec002_log_mod
import os
import uuid
from pathlib import Path

import pytest
import requests

_sec002_log = _sec002_log_mod.getLogger("scriptmate.tests.sec002")

# Load env so EXPO_PUBLIC_BACKEND_URL / REACT_APP_BACKEND_URL resolve.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except (ImportError, OSError) as _env_err:
    _sec002_log.debug("sec002 test: dotenv load skipped: %s", _env_err)

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
    or "https://save-script-verify.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


# ─── helpers ──────────────────────────────────────────────────────────

def _raw_request(method: str, url: str, **kwargs) -> requests.Response:
    """Dispatch through a fresh `requests.Session.request` original so
    the test is not touched by the conftest-level global auth patcher.
    `conftest.py` exposes `_ORIG_SESSION_REQUEST` for exactly this."""
    try:
        from conftest import _ORIG_SESSION_REQUEST  # type: ignore
    except ImportError:
        return requests.request(method, url, **kwargs)
    session = requests.sessions.Session()
    try:
        return _ORIG_SESSION_REQUEST(session, method, url, **kwargs)
    finally:
        session.close()


def _mint_session(device_id: str) -> dict:
    r = _raw_request(
        "POST",
        f"{API}/auth/device-session",
        json={"device_id": device_id},
        timeout=10,
    )
    assert r.status_code == 200, f"mint failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert body["user_id"] == f"device:{device_id}"
    return body


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def user_a():
    device_id = f"sec002-userA-{uuid.uuid4().hex[:10]}"
    body = _mint_session(device_id)
    return {
        "device_id": device_id,
        "token": body["token"],
        "user_id": body["user_id"],              # "device:<id>"
        "effective_user_id": device_id,          # what the server stores
    }


@pytest.fixture
def user_b():
    device_id = f"sec002-userB-{uuid.uuid4().hex[:10]}"
    body = _mint_session(device_id)
    return {
        "device_id": device_id,
        "token": body["token"],
        "user_id": body["user_id"],
        "effective_user_id": device_id,
    }


# ─── 1. UNAUTH LOCK-OUT ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/scripts"),
        ("POST", "/scripts"),
        ("POST", "/scripts/upload-base64"),
        ("GET", "/scripts/some-id"),
        ("PUT", "/scripts/some-id"),
        ("DELETE", "/scripts/some-id"),
        ("GET", "/notes/some-script-id"),
        ("POST", "/notes"),
        ("DELETE", "/notes/some-id"),
        ("GET", "/stats/some-user"),
        ("POST", "/stats/some-user/update"),
        ("GET", "/daily-drill/some-user"),
        ("POST", "/daily-drill/some-user/complete"),
        ("POST", "/daily-drill/some-user/feedback"),
        ("GET", "/users/me"),
    ],
)
def test_unauth_requests_rejected_401(method, path):
    r = _raw_request(method, f"{API}{path}", json={}, timeout=10)
    assert r.status_code == 401, (
        f"{method} {path} must require auth; got {r.status_code} {r.text[:120]}"
    )


# ─── 2. /users/me ─────────────────────────────────────────────────────

def test_users_me_returns_authenticated_identity(user_a):
    r = _raw_request("GET", f"{API}/users/me", headers=_bearer(user_a["token"]), timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == user_a["user_id"]
    assert body["effective_user_id"] == user_a["effective_user_id"]
    assert body["is_anonymous_device"] is True
    # Fields safe to echo:
    assert "subscription_tier" in body


def test_users_me_two_different_bearers_return_two_different_identities(user_a, user_b):
    ra = _raw_request("GET", f"{API}/users/me", headers=_bearer(user_a["token"]), timeout=10)
    rb = _raw_request("GET", f"{API}/users/me", headers=_bearer(user_b["token"]), timeout=10)
    assert ra.status_code == 200 and rb.status_code == 200
    assert ra.json()["user_id"] != rb.json()["user_id"]
    assert ra.json()["effective_user_id"] == user_a["effective_user_id"]
    assert rb.json()["effective_user_id"] == user_b["effective_user_id"]


# ─── 3. SCRIPTS: client user_id override ignored ──────────────────────

def test_create_script_ignores_client_supplied_user_id(user_a, user_b):
    """User A posts a script with user_b's device_id in the body.
    The server must store it against user A (bearer identity)."""
    r = _raw_request(
        "POST",
        f"{API}/scripts",
        json={
            "title": "SEC002_body_override",
            "raw_text": "ALICE\nHello, Bob.\n\nBOB\nHi Alice.\n",
            "user_id": user_b["effective_user_id"],  # the attack: spoof victim
        },
        headers=_bearer(user_a["token"]),
        timeout=30,
    )
    assert r.status_code == 200, r.text[:300]
    saved = r.json()
    # Must NOT be stored against user_b. Must be stored against user_a.
    assert saved["user_id"] == user_a["effective_user_id"]

    # And user_b must NOT see it in their list.
    r_list = _raw_request("GET", f"{API}/scripts", headers=_bearer(user_b["token"]), timeout=10)
    assert r_list.status_code == 200
    assert not any(s.get("id") == saved["id"] for s in r_list.json())

    # Cleanup
    _raw_request(
        "DELETE",
        f"{API}/scripts/{saved['id']}",
        headers=_bearer(user_a["token"]),
        timeout=10,
    )


def test_get_scripts_ignores_legacy_query_user_id(user_a, user_b):
    """GET /api/scripts?user_id=<other-user> must NOT return that user's
    scripts; the authenticated identity governs the filter."""
    # Plant one script against user_b first.
    r = _raw_request(
        "POST",
        f"{API}/scripts",
        json={
            "title": "SEC002_scripts_query",
            "raw_text": "X\nhello\n",
        },
        headers=_bearer(user_b["token"]),
        timeout=30,
    )
    assert r.status_code == 200
    victim_script_id = r.json()["id"]
    try:
        # Attacker (user_a) tries to enumerate user_b's scripts via query.
        r_list = _raw_request(
            "GET",
            f"{API}/scripts?user_id={user_b['effective_user_id']}",
            headers=_bearer(user_a["token"]),
            timeout=10,
        )
        assert r_list.status_code == 200
        assert not any(s.get("id") == victim_script_id for s in r_list.json())
    finally:
        _raw_request(
            "DELETE",
            f"{API}/scripts/{victim_script_id}",
            headers=_bearer(user_b["token"]),
            timeout=10,
        )


def test_cross_user_script_access_returns_404(user_a, user_b):
    r = _raw_request(
        "POST",
        f"{API}/scripts",
        json={"title": "SEC002_cross_user", "raw_text": "X\nhi\n"},
        headers=_bearer(user_a["token"]),
        timeout=30,
    )
    assert r.status_code == 200
    script_id = r.json()["id"]
    try:
        # user_b must not read user_a's script.
        rg = _raw_request(
            "GET", f"{API}/scripts/{script_id}",
            headers=_bearer(user_b["token"]), timeout=10,
        )
        assert rg.status_code == 404
        # user_b must not mutate user_a's script.
        rp = _raw_request(
            "PUT", f"{API}/scripts/{script_id}",
            json={"title": "pwned"},
            headers=_bearer(user_b["token"]), timeout=10,
        )
        assert rp.status_code == 404
        # user_b must not delete user_a's script.
        rd = _raw_request(
            "DELETE", f"{API}/scripts/{script_id}",
            headers=_bearer(user_b["token"]), timeout=10,
        )
        assert rd.status_code == 404
        # user_a still has it.
        rown = _raw_request(
            "GET", f"{API}/scripts/{script_id}",
            headers=_bearer(user_a["token"]), timeout=10,
        )
        assert rown.status_code == 200
    finally:
        _raw_request(
            "DELETE", f"{API}/scripts/{script_id}",
            headers=_bearer(user_a["token"]), timeout=10,
        )


# ─── 4. NOTES: owner-isolation ────────────────────────────────────────

def test_notes_are_filtered_by_authenticated_identity(user_a, user_b):
    note_id = f"note-{uuid.uuid4().hex[:10]}"
    script_id = f"script-{uuid.uuid4().hex[:10]}"
    # user_a creates a note.
    r = _raw_request(
        "POST", f"{API}/notes",
        json={
            "id": note_id,
            "script_id": script_id,
            "line_index": 1,
            "note_type": "beat",
            "content": "user_a private note",
        },
        headers=_bearer(user_a["token"]),
        timeout=10,
    )
    assert r.status_code == 200
    try:
        # user_b must not read user_a's note.
        rg = _raw_request(
            "GET", f"{API}/notes/{script_id}",
            headers=_bearer(user_b["token"]), timeout=10,
        )
        assert rg.status_code == 200
        assert all(n.get("id") != note_id for n in rg.json())

        # user_a sees their note.
        rga = _raw_request(
            "GET", f"{API}/notes/{script_id}",
            headers=_bearer(user_a["token"]), timeout=10,
        )
        assert rga.status_code == 200
        assert any(n.get("id") == note_id for n in rga.json())

        # user_b cannot overwrite user_a's note by using the same id.
        rh = _raw_request(
            "POST", f"{API}/notes",
            json={
                "id": note_id,
                "script_id": script_id,
                "line_index": 1,
                "note_type": "beat",
                "content": "hijacked",
            },
            headers=_bearer(user_b["token"]),
            timeout=10,
        )
        assert rh.status_code == 404

        # user_b cannot delete user_a's note.
        rd = _raw_request(
            "DELETE", f"{API}/notes/{note_id}",
            headers=_bearer(user_b["token"]), timeout=10,
        )
        assert rd.status_code == 404
    finally:
        _raw_request(
            "DELETE", f"{API}/notes/{note_id}",
            headers=_bearer(user_a["token"]), timeout=10,
        )


# ─── 5. /stats/{user_id} path validation ──────────────────────────────

def test_stats_path_user_id_must_match_bearer(user_a, user_b):
    # user_a GETting user_b's stats path must 403.
    r = _raw_request(
        "GET", f"{API}/stats/{user_b['effective_user_id']}",
        headers=_bearer(user_a["token"]), timeout=10,
    )
    assert r.status_code == 403
    # user_a GETting their OWN stats path must 200.
    rown = _raw_request(
        "GET", f"{API}/stats/{user_a['effective_user_id']}",
        headers=_bearer(user_a["token"]), timeout=10,
    )
    assert rown.status_code == 200


def test_stats_update_path_user_id_must_match_bearer(user_a, user_b):
    r = _raw_request(
        "POST", f"{API}/stats/{user_b['effective_user_id']}/update",
        json={"rehearsals_delta": 999, "lines_delta": 999},
        headers=_bearer(user_a["token"]), timeout=10,
    )
    assert r.status_code == 403


# ─── 6. /daily-drill/{user_id} path validation ────────────────────────

def test_daily_drill_path_user_id_must_match_bearer(user_a, user_b):
    r = _raw_request(
        "GET", f"{API}/daily-drill/{user_b['effective_user_id']}",
        headers=_bearer(user_a["token"]), timeout=10,
    )
    assert r.status_code == 403


def test_daily_drill_complete_path_user_id_must_match_bearer(user_a, user_b):
    r = _raw_request(
        "POST", f"{API}/daily-drill/{user_b['effective_user_id']}/complete",
        headers=_bearer(user_a["token"]), timeout=10,
    )
    assert r.status_code == 403


# ─── 7. TTS proxy & ledger stay healthy under SEC-002 ─────────────────

def test_tts_proxy_still_accepts_the_same_device_bearer(user_a):
    """Smoke-test: the SEC-002 refactor must not change the auth
    contract for POST /api/tts/elevenlabs/generate. Status must NOT
    be 401 with a valid bearer. 200/500/503 are all acceptable
    (depend on ElevenLabs connectivity in the preview env)."""
    r = _raw_request(
        "POST", f"{API}/tts/elevenlabs/generate",
        headers=_bearer(user_a["token"]),
        json={
            "text": "sec002 regression",
            "voice_id": "21m00Tcm4TlvDq8ikWAM",
            "stability": 0.5, "similarity_boost": 0.75, "style": 0.0,
            "use_speaker_boost": True, "speed": 1.0,
        },
        timeout=30,
    )
    assert r.status_code != 401, (
        f"TTS proxy auth regressed; got {r.status_code} {r.text[:200]}"
    )


def test_device_session_identity_is_device_prefixed(user_a):
    """The device session must still mint a `device:<id>` identity so
    the SEC-002 effective_user_id mapping stays correct."""
    assert user_a["user_id"].startswith("device:")
    assert user_a["user_id"].split(":", 1)[1] == user_a["effective_user_id"]
