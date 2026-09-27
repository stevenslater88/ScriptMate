"""Iteration 26: Verify free-tier rehearsal creation gate (voice/mode)."""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://save-script-verify.preview.emergentagent.com"),
).rstrip("/")

DEVICE_ID = "test-free-user-voice-fix"

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
def script_id(api):
    payload = {"title": "TEST_FreeVoiceGate", "raw_text": SAMPLE_SCRIPT, "user_id": DEVICE_ID}
    r = api.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"Create script failed: {r.status_code} {r.text}"
    return r.json()["id"]


# Free-tier user: full_read + alloy -> 200
def test_free_full_read_alloy_ok(api, script_id):
    payload = {
        "script_id": script_id,
        "user_character": "JOHN",
        "mode": "full_read",
        "voice_type": "alloy",
        "user_id": DEVICE_ID,
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"Expected 200, got {r.status_code}: {r.text}"
    assert "id" in r.json()


# Free-tier user: cue_only + alloy -> 200
def test_free_cue_only_alloy_ok(api, script_id):
    payload = {
        "script_id": script_id,
        "user_character": "JOHN",
        "mode": "cue_only",
        "voice_type": "alloy",
        "user_id": DEVICE_ID,
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"Expected 200, got {r.status_code}: {r.text}"
    assert "id" in r.json()


# Free-tier user: performance mode -> 403
def test_free_performance_mode_forbidden(api, script_id):
    payload = {
        "script_id": script_id,
        "user_character": "JOHN",
        "mode": "performance",
        "voice_type": "alloy",
        "user_id": DEVICE_ID,
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


# Free-tier user: premium voice (nova) -> 403
def test_free_nova_voice_forbidden(api, script_id):
    payload = {
        "script_id": script_id,
        "user_character": "JOHN",
        "mode": "full_read",
        "voice_type": "nova",
        "user_id": DEVICE_ID,
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
