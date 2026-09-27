"""
Phase 2 - Rehearsal foundation backend contract tests.

Covers:
  B. POST /api/rehearsals with different user_character values → total_lines correctness
  B. Script integrity preserved when user_character changes across two rehearsals
  Rehearsal API contract:
    - 200 with total_lines for valid script_id + user_character
    - 403 for invalid mode / non-free voice on free tier
    - QA_UNLIMITED_REHEARSALS=true bypasses 5/day limit
    - PUT /api/rehearsals/{id} increments total_lines_practiced
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://save-script-verify.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# ---- fixtures ----

@pytest.fixture
def device_id():
    return f"phase2-test-{uuid.uuid4().hex[:12]}"

@pytest.fixture
def sample_script_text():
    # 3 chars: SARAH(2), MIKE(2), ANNA(2)
    return (
        "SARAH\nHello Mike, how are you today?\n\n"
        "MIKE\nI am doing great, Sarah. Thanks for asking.\n\n"
        "ANNA\nDon't forget about me, folks.\n\n"
        "SARAH\nOf course we won't forget, Anna.\n\n"
        "MIKE\nAnna, you are the best of us.\n\n"
        "ANNA\nThank you both very much.\n"
    )

@pytest.fixture
def created_script(device_id, sample_script_text):
    payload = {
        "title": f"TEST_phase2_{uuid.uuid4().hex[:6]}",
        "raw_text": sample_script_text,
        "user_id": device_id,
    }
    r = requests.post(f"{API}/scripts", json=payload, timeout=60)
    assert r.status_code == 200, f"POST /api/scripts failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "id" in data
    assert isinstance(data.get("lines"), list) and len(data["lines"]) >= 6
    yield data
    # cleanup
    try:
        requests.delete(f"{API}/scripts/{data['id']}?user_id={device_id}", timeout=10)
    except Exception:
        pass


# ---- Tests: total_lines correctness per user_character ----

class TestRehearsalTotalLines:
    def test_total_lines_matches_user_character_count(self, created_script, device_id):
        script_id = created_script["id"]
        counts = {}
        for line in created_script["lines"]:
            c = line.get("character")
            if c:
                counts[c] = counts.get(c, 0) + 1

        # Pick a character with at least one line
        target = next(iter(counts))
        r = requests.post(f"{API}/rehearsals", json={
            "script_id": script_id,
            "user_id": device_id,
            "user_character": target,
            "mode": "full_read",
            "voice_type": "alloy",
        }, timeout=15)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["total_lines"] == counts[target], (
            f"Expected total_lines={counts[target]} for {target}, got {body['total_lines']}"
        )
        # cleanup
        requests.delete(f"{API}/rehearsals/{body['id']}", timeout=10)

    def test_switching_character_does_not_mutate_script(self, created_script, device_id):
        script_id = created_script["id"]
        chars = list({l["character"] for l in created_script["lines"] if l.get("character")})
        assert len(chars) >= 2

        # Rehearse as char A
        r1 = requests.post(f"{API}/rehearsals", json={
            "script_id": script_id, "user_id": device_id,
            "user_character": chars[0], "mode": "full_read", "voice_type": "alloy",
        }, timeout=15)
        assert r1.status_code == 200
        # Rehearse as char B
        r2 = requests.post(f"{API}/rehearsals", json={
            "script_id": script_id, "user_id": device_id,
            "user_character": chars[1], "mode": "full_read", "voice_type": "alloy",
        }, timeout=15)
        assert r2.status_code == 200

        # Script must remain identical
        r_script = requests.get(f"{API}/scripts/{script_id}?user_id={device_id}", timeout=15)
        assert r_script.status_code == 200
        s = r_script.json()
        assert len(s["lines"]) == len(created_script["lines"])
        for a, b in zip(s["lines"], created_script["lines"]):
            assert a["character"] == b["character"]
            assert a["text"] == b["text"]

        for rid in (r1.json()["id"], r2.json()["id"]):
            requests.delete(f"{API}/rehearsals/{rid}", timeout=10)


# ---- Tests: paywall gating on free tier ----

class TestRehearsalPaywall:
    def test_invalid_mode_returns_403(self, created_script, device_id):
        r = requests.post(f"{API}/rehearsals", json={
            "script_id": created_script["id"], "user_id": device_id,
            "user_character": created_script["lines"][0]["character"],
            "mode": "performance",  # premium mode
            "voice_type": "alloy",
        }, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"
        assert "Premium" in r.text or "upgrade" in r.text.lower()

    def test_premium_voice_returns_403(self, created_script, device_id):
        r = requests.post(f"{API}/rehearsals", json={
            "script_id": created_script["id"], "user_id": device_id,
            "user_character": created_script["lines"][0]["character"],
            "mode": "full_read",
            "voice_type": "onyx",  # premium voice
        }, timeout=15)
        assert r.status_code == 403
        assert "Premium" in r.text or "upgrade" in r.text.lower()


# ---- Tests: QA_UNLIMITED_REHEARSALS bypass ----

class TestQABypass:
    def test_unlimited_rehearsals_bypass(self, created_script, device_id):
        """Simulate a free-tier user hitting >5 rehearsals in a day; bypass should allow it."""
        script_id = created_script["id"]
        char = created_script["lines"][0]["character"]
        rehearsal_ids = []
        for i in range(6):
            r = requests.post(f"{API}/rehearsals", json={
                "script_id": script_id, "user_id": device_id,
                "user_character": char, "mode": "full_read", "voice_type": "alloy",
            }, timeout=15)
            assert r.status_code == 200, f"iter {i}: {r.status_code} {r.text[:200]}"
            rehearsal_ids.append(r.json()["id"])
        for rid in rehearsal_ids:
            requests.delete(f"{API}/rehearsals/{rid}", timeout=10)


# ---- Tests: PUT update rehearsal progress ----

class TestRehearsalUpdate:
    def test_put_updates_progress(self, created_script, device_id):
        script_id = created_script["id"]
        char = created_script["lines"][0]["character"]
        r = requests.post(f"{API}/rehearsals", json={
            "script_id": script_id, "user_id": device_id,
            "user_character": char, "mode": "full_read", "voice_type": "alloy",
        }, timeout=15)
        assert r.status_code == 200
        rid = r.json()["id"]

        upd = requests.put(f"{API}/rehearsals/{rid}", json={
            "completed_lines": [0, 1],
            "current_line_index": 2,
        }, timeout=15)
        assert upd.status_code == 200, upd.text[:300]
        body = upd.json()
        assert body["id"] == rid
        assert body.get("current_line_index") == 2
        assert body.get("completed_lines") == [0, 1]

        # GET verifies persistence
        g = requests.get(f"{API}/rehearsals/{rid}", timeout=10)
        assert g.status_code == 200
        assert g.json().get("completed_lines") == [0, 1]

        requests.delete(f"{API}/rehearsals/{rid}", timeout=10)

    def test_put_invalid_id_returns_404(self, device_id):
        r = requests.put(f"{API}/rehearsals/does-not-exist-{uuid.uuid4().hex[:6]}",
                         json={"status": "completed"}, timeout=10)
        assert r.status_code == 404


# ---- Tests: single scene / multi-line script full contract ----

class TestSceneRehearsalSanity:
    def test_single_line_character_total_lines_one(self, device_id):
        raw = "JOHN\nOnly one line here.\n"
        r = requests.post(f"{API}/scripts", json={
            "title": f"TEST_single_{uuid.uuid4().hex[:5]}",
            "raw_text": raw,
            "user_id": device_id,
        }, timeout=60)
        assert r.status_code == 200
        script = r.json()
        try:
            rr = requests.post(f"{API}/rehearsals", json={
                "script_id": script["id"], "user_id": device_id,
                "user_character": "JOHN", "mode": "full_read", "voice_type": "alloy",
            }, timeout=15)
            assert rr.status_code == 200
            assert rr.json()["total_lines"] == 1
            requests.delete(f"{API}/rehearsals/{rr.json()['id']}", timeout=10)
        finally:
            requests.delete(f"{API}/scripts/{script['id']}?user_id={device_id}", timeout=10)
