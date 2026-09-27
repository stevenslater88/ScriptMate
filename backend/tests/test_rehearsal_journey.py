"""Tests for the main rehearsal journey (steps 3-8)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://save-script-verify.preview.emergentagent.com").rstrip("/")
DEVICE_ID = "test-device-rehearsal-journey"

SAMPLE_SCRIPT = """JOHN
Hello there, how are you today?

MARY
I'm doing well, thank you for asking.

JOHN
That's great to hear. Shall we go?
"""


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created_script(api):
    payload = {"title": "TEST_Rehearsal_Script", "raw_text": SAMPLE_SCRIPT, "user_id": DEVICE_ID}
    r = api.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"Create script failed: {r.status_code} {r.text}"
    data = r.json()
    assert "id" in data, f"No id in response: {data}"
    return data


# Step 3 & 4: create script persists via backend
def test_create_script(created_script):
    assert created_script["title"] == "TEST_Rehearsal_Script"
    assert "id" in created_script


# Step 5: list scripts
def test_list_scripts_contains_created(api, created_script):
    r = api.get(f"{BASE_URL}/api/scripts", params={"user_id": DEVICE_ID}, timeout=30)
    assert r.status_code == 200
    scripts = r.json()
    assert isinstance(scripts, list)
    ids = [s.get("id") for s in scripts]
    assert created_script["id"] in ids


# Step 7: get script by id returns parsed content
def test_get_script_by_id(api, created_script):
    sid = created_script["id"]
    r = api.get(f"{BASE_URL}/api/scripts/{sid}", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == sid
    # Should have parsed characters and/or lines
    assert "lines" in data or "parsed_lines" in data or "characters" in data, f"Missing parsed fields: {list(data.keys())}"


# Step 8: create rehearsal
def test_create_rehearsal(api, created_script):
    payload = {
        "script_id": created_script["id"],
        "user_character": "JOHN",
        "mode": "full_read",
        "voice_type": "alloy",
        "user_id": DEVICE_ID,
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"Create rehearsal failed: {r.status_code} {r.text}"
    data = r.json()
    assert "id" in data
    # Get it back
    rid = data["id"]
    r2 = api.get(f"{BASE_URL}/api/rehearsals/{rid}", timeout=30)
    assert r2.status_code == 200
    assert r2.json()["id"] == rid


# Additional: user init + limits
def test_user_init(api):
    r = api.post(f"{BASE_URL}/api/users", json={"device_id": DEVICE_ID}, timeout=30)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text}"


def test_user_limits(api):
    r = api.get(f"{BASE_URL}/api/users/{DEVICE_ID}/limits", timeout=30)
    assert r.status_code == 200
