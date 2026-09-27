"""
Iteration 28 — Sentry auto-instrumentation fix verification.

Server-side sanity check that POST /api/scripts, /api/users, /api/rehearsals
still work after the frontend Sentry.init changes (tracesSampleRate: 0,
enableAutoPerformanceTracing: false). Backend code path is unchanged;
these tests confirm no regressions.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://save-script-verify.preview.emergentagent.com"),
).rstrip("/")

DEVICE_ID = "TEST_iter28_sentry_fix_user"

SAMPLE_SCRIPT = """JOHN
Hello there, how are you today?

MARY
I'm doing well, thank you for asking.

JOHN
That's great to hear.
"""


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# STEP 3 — POST /api/scripts must work (this was the failing path in the Android APK bug)
def test_post_scripts_ok(api):
    payload = {"title": "TEST_iter28_sentry", "raw_text": SAMPLE_SCRIPT, "user_id": DEVICE_ID}
    r = api.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"POST /api/scripts failed: {r.status_code} {r.text}"
    data = r.json()
    assert "id" in data
    assert isinstance(data["id"], str) and len(data["id"]) > 0
    pytest.script_id = data["id"]

    # GET to verify persistence
    g = api.get(f"{BASE_URL}/api/scripts/{data['id']}", timeout=15)
    assert g.status_code == 200, f"GET /api/scripts/{{id}} failed: {g.status_code}"
    assert g.json()["id"] == data["id"]


# STEP 4 — POST /api/users must work
def test_post_users_ok(api):
    r = api.post(f"{BASE_URL}/api/users", json={"device_id": DEVICE_ID}, timeout=15)
    assert r.status_code in (200, 201), f"POST /api/users failed: {r.status_code} {r.text}"
    data = r.json()
    assert "id" in data
    assert data.get("device_id") == DEVICE_ID


# STEP 5 — POST /api/rehearsals with free-tier defaults (mode=full_read, voice=alloy) must work
def test_post_rehearsals_free_defaults_ok(api):
    script_id = getattr(pytest, "script_id", None)
    if not script_id:
        # Create one inline if module-order issue
        cr = api.post(
            f"{BASE_URL}/api/scripts",
            json={"title": "TEST_iter28_rehearsal", "raw_text": SAMPLE_SCRIPT, "user_id": DEVICE_ID},
            timeout=30,
        )
        assert cr.status_code in (200, 201)
        script_id = cr.json()["id"]

    payload = {
        "script_id": script_id,
        "user_character": "JOHN",
        "mode": "full_read",
        "voice_type": "alloy",
        "user_id": DEVICE_ID,
    }
    r = api.post(f"{BASE_URL}/api/rehearsals", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"POST /api/rehearsals failed: {r.status_code} {r.text}"
    data = r.json()
    assert "id" in data
