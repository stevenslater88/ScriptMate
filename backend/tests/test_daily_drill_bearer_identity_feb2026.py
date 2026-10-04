"""P0 regression — Daily Drill 403 "user_id does not match authenticated
session" (Feb 2026, physical blocker).

Root cause
----------
Daily Drill and Streak endpoints used the legacy SEC-002 pattern
`enforce_user_id_match(path_user_id, authenticated_user_id)`, requiring
the client to send a path `user_id` equal to either the bearer's raw
or `effective_user_id`. The frontend mints TWO independent AsyncStorage
keys:

  * `@scriptmate_device_id`  — owned by `elevenLabsService._readOrCreateDeviceId`,
    used to mint the bearer via POST /api/auth/device-session. Bearer
    `user_id = "device:<@scriptmate_device_id value>"`.
  * `device_id` (plain key)  — owned by `_layout.getStableRevenueCatAppUserId`,
    `scriptStore.getDeviceId`, `daily-drill.getDeviceId`, used as the
    path parameter in `/daily-drill/{user_id}` and `/streak/{user_id}`.

Those two keys are minted independently on first access and almost
always differ in value → every authenticated Daily Drill request from
the real device returned HTTP 403.

Fix
----
Remove the redundant `enforce_user_id_match` from the five Daily
Drill / Streak endpoints. Derive user identity from the bearer only,
exactly like `/api/scripts` has done since the original SEC-002
remediation. The URL shape `{user_id}` is preserved for compatibility
but the path value is ignored.

This test file locks:
  * authenticated user CAN load Daily Drill / streak with ANY path
    value (bearer is authoritative);
  * missing / malformed / unknown bearer → 401 (no weakening);
  * one user cannot read another user's drill or streak data
    (the Mongo filter still keys on the bearer-derived identity).
"""

from __future__ import annotations

import os
import time
import uuid

import pytest
import requests


BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "http://localhost:8001",
).rstrip("/")
API = f"{BASE_URL}/api"


def _mint_device_session(device_id: str) -> str:
    # Explicitly bypass conftest auto-auth so the device_id we mint is
    # the one bound to the returned bearer (not the shared test one).
    r = requests.post(
        f"{API}/auth/device-session",
        json={"device_id": device_id},
        headers={"Authorization": ""},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _unique_device(label: str) -> str:
    return f"dd-test-{label}-{uuid.uuid4().hex[:12]}"


# ─── 1. The physical 403 scenario reproduced + proven fixed ──────────
def test_authenticated_user_can_load_drill_when_path_user_id_is_stale_other_key() -> None:
    """Physical repro: the bearer is minted against `@scriptmate_device_id`
    but the frontend sends the plain `device_id` AsyncStorage key.
    Before the fix this returned 403."""
    bearer_device = _unique_device("A")
    sent_path = _unique_device("OTHER-A")
    token = _mint_device_session(bearer_device)

    r = requests.get(
        f"{API}/daily-drill/{sent_path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Row is keyed on bearer-derived identity, NOT the stale path value.
    assert body["user_id"] == bearer_device


def test_authenticated_user_can_load_streak_when_path_user_id_is_stale() -> None:
    bearer_device = _unique_device("B")
    sent_path = _unique_device("OTHER-B")
    token = _mint_device_session(bearer_device)

    r = requests.get(
        f"{API}/streak/{sent_path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text


# ─── 2. Baseline: path matches bearer still works ────────────────────
def test_authenticated_user_can_load_drill_when_path_matches_bearer() -> None:
    device = _unique_device("C")
    token = _mint_device_session(device)

    r = requests.get(
        f"{API}/daily-drill/{device}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] == device


# ─── 3. Authentication is still mandatory (no weakening) ─────────────
def test_missing_bearer_still_returns_401() -> None:
    r = requests.get(
        f"{API}/daily-drill/anything",
        headers={"Authorization": ""},
        timeout=10,
    )
    assert r.status_code == 401, r.text


def test_malformed_bearer_still_returns_401() -> None:
    r = requests.get(
        f"{API}/daily-drill/anything",
        headers={"Authorization": "Bearer short"},
        timeout=10,
    )
    assert r.status_code == 401, r.text


def test_unknown_bearer_still_returns_401() -> None:
    r = requests.get(
        f"{API}/daily-drill/anything",
        headers={"Authorization": "Bearer " + "z" * 48},
        timeout=10,
    )
    assert r.status_code == 401, r.text


# ─── 4. Cross-user data isolation — the real security contract ───────
def test_user_A_cannot_see_user_B_drill_data() -> None:
    """Even if user A spoofs B's identity in the path, the drill
    returned is still A's (bearer-derived). B's data stays private."""
    user_a = _unique_device("ALICE")
    user_b = _unique_device("BOB")
    token_a = _mint_device_session(user_a)
    token_b = _mint_device_session(user_b)

    # B generates their own drill as themselves.
    r_b = requests.get(
        f"{API}/daily-drill/{user_b}",
        headers={"Authorization": f"Bearer {token_b}"},
        timeout=15,
    )
    assert r_b.status_code == 200, r_b.text
    bob_drill_id = r_b.json()["id"]
    assert r_b.json()["user_id"] == user_b

    # A tries to fetch WITH B's path value, using A's bearer.
    r_a_spoof = requests.get(
        f"{API}/daily-drill/{user_b}",
        headers={"Authorization": f"Bearer {token_a}"},
        timeout=15,
    )
    assert r_a_spoof.status_code == 200
    assert r_a_spoof.json()["id"] != bob_drill_id
    assert r_a_spoof.json()["user_id"] == user_a


def test_user_A_cannot_see_user_B_streak_data() -> None:
    user_a = _unique_device("ALICE2")
    user_b = _unique_device("BOB2")
    token_a = _mint_device_session(user_a)
    token_b = _mint_device_session(user_b)

    # Have B record a streak activity under their own bearer.
    requests.post(
        f"{API}/streak/{user_b}/record?activity_type=daily_drill",
        headers={"Authorization": f"Bearer {token_b}"},
        timeout=15,
    )

    # A reads with B's path value — must see A's (empty) streak.
    r = requests.get(
        f"{API}/streak/{user_b}",
        headers={"Authorization": f"Bearer {token_a}"},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["current_streak"] == 0
    assert r.json()["total_xp"] == 0


# ─── 5. POST endpoints also fixed ────────────────────────────────────
def test_authenticated_user_can_complete_drill_with_stale_path() -> None:
    bearer_device = _unique_device("E")
    stale_path = _unique_device("OTHER-E")
    token = _mint_device_session(bearer_device)
    headers = {"Authorization": f"Bearer {token}"}

    # Generate the drill first.
    r_get = requests.get(f"{API}/daily-drill/{stale_path}", headers=headers, timeout=15)
    assert r_get.status_code == 200

    # Complete it with a stale path value.
    r = requests.post(f"{API}/daily-drill/{stale_path}/complete", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["xp_awarded"] == 25


def test_authenticated_user_can_record_streak_with_stale_path() -> None:
    bearer_device = _unique_device("F")
    stale_path = _unique_device("OTHER-F")
    token = _mint_device_session(bearer_device)
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.post(
        f"{API}/streak/{stale_path}/record?activity_type=daily_drill",
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    assert r.json()["today_completed"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
