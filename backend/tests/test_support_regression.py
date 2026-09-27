"""Support screen regression tests - iter29
Covers: scripts CRUD (list/get/save) + rehearsal creation with free-tier defaults.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://save-script-verify.preview.emergentagent.com").rstrip("/")
DEVICE_ID = "test-support-iter29"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created_script(api):
    payload = {
        "user_id": DEVICE_ID,
        "title": "TEST_iter29_support",
        "raw_text": "INT. ROOM - DAY\n\nJOHN\nHello world.",
    }
    r = api.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"POST /api/scripts failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, dict)
    sid = data.get("id") or data.get("_id") or data.get("script_id")
    assert sid, f"No script id in response: {data}"
    return sid


# REGRESSION 2 — POST /api/scripts
def test_post_script(created_script):
    assert created_script


# REGRESSION 3 — GET /api/scripts?user_id
def test_list_scripts(api, created_script):
    r = api.get(f"{BASE_URL}/api/scripts", params={"user_id": DEVICE_ID}, timeout=30)
    assert r.status_code == 200, f"GET list failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, (list, dict))
    items = data if isinstance(data, list) else (data.get("scripts") or data.get("items") or [])
    assert any((s.get("id") or s.get("_id") or s.get("script_id")) == created_script for s in items), \
        f"Created script {created_script} not in list"


# REGRESSION 4 — GET /api/scripts/{id}
def test_get_script(api, created_script):
    r = api.get(f"{BASE_URL}/api/scripts/{created_script}", timeout=30)
    assert r.status_code == 200, f"GET by id failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("title") == "TEST_iter29_support"
    assert "content" in data or "raw_text" in data or "parsed_lines" in data


# REGRESSION 5 — POST /api/rehearsals with free-tier defaults
def test_create_rehearsal_free_tier(api, created_script):
    payload = {
        "user_id": DEVICE_ID,
        "script_id": created_script,
        "mode": "full_read",
        "voice_type": "alloy",
        "user_character": "JOHN",
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"POST rehearsal failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("mode") == "full_read" or "id" in data or "_id" in data
