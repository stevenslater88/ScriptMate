"""
Backend contract tests for the SCRIPT M8 voice pipeline fix (Feb 2026).

Validates:
  1. POST /api/scripts returns characters[].name uppercased (JACK, DET. HARRIS, SARAH).
  2. POST /api/rehearsals persists reader_style + voice_speed.
  3. POST /api/rehearsals defaults to reader_style='neutral' / voice_speed=1.0.
  4. GET /api/rehearsals/{id} returns the persisted reader_style + voice_speed.
  5. GET /api/health returns 200.
  6. Parser DialogueLine.character equals Script.characters[].name (case-sensitive).
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

SAMPLE_SCRIPT = """INT. WAREHOUSE - NIGHT

JACK enters, gun drawn.

JACK
Hands where I can see them!

DET. HARRIS
Easy, kid. We're on the same side.

SARAH
(from behind a crate)
Don't listen to him, Jack.

JACK
Sarah? What are you doing here?
"""


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def script(api):
    r = api.post(f"{BASE_URL}/api/scripts", json={
        "title": "TEST_M8_voice_pipeline",
        "raw_text": SAMPLE_SCRIPT,
        "user_id": "default",
    }, timeout=30)
    assert r.status_code == 200, f"POST /api/scripts failed: {r.status_code} {r.text}"
    return r.json()


# ---------------- Test 5: health baseline ----------------
def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=10)
    assert r.status_code == 200


# ---------------- Test 1: character names uppercased ----------------
def test_scripts_characters_uppercase(script):
    chars = script.get("characters") or []
    names = {c.get("name") for c in chars}
    assert "JACK" in names, f"JACK missing from {names}"
    assert "DET. HARRIS" in names, f"DET. HARRIS missing from {names}"
    assert "SARAH" in names, f"SARAH missing from {names}"
    # All character names must be uppercase (frontend uses as assignment map key)
    for n in names:
        assert n == n.upper(), f"character name not uppercased: {n!r}"


# ---------------- Test 6: DialogueLine.character matches characters[].name ----------------
def test_dialogue_lines_character_matches_characters(script):
    chars = {c["name"] for c in (script.get("characters") or [])}
    lines = script.get("lines") or script.get("dialogue_lines") or []
    assert lines, f"no dialogue lines in script: keys={list(script.keys())}"
    line_chars = {ln.get("character") for ln in lines if ln.get("character")}
    # every dialogue-line character must appear (case-sensitive) in characters[].name
    unmatched = line_chars - chars
    assert not unmatched, (
        f"DialogueLine.character values not present in Script.characters[].name: "
        f"{unmatched}; script chars={chars}"
    )
    # explicit sanity: JACK/DET. HARRIS/SARAH all appear as line speakers
    for expected in ("JACK", "DET. HARRIS", "SARAH"):
        assert expected in line_chars, f"{expected!r} missing from line speakers {line_chars}"


# ---------------- Test 2: rehearsal persists reader_style + voice_speed ----------------
def test_rehearsal_persists_reader_style_and_speed(api, script):
    r = api.post(f"{BASE_URL}/api/rehearsals", json={
        "script_id": script["id"],
        "user_character": "JACK",
        "mode": "full_read",
        "voice_type": "alloy",
        "reader_style": "emotional",
        "voice_speed": 0.9,
    }, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data["reader_style"] == "emotional", data
    assert abs(float(data["voice_speed"]) - 0.9) < 1e-6, data


# ---------------- Test 3: defaults when fields omitted ----------------
def test_rehearsal_defaults_when_omitted(api, script):
    r = api.post(f"{BASE_URL}/api/rehearsals", json={
        "script_id": script["id"],
        "user_character": "JACK",
        "mode": "full_read",
        "voice_type": "alloy",
    }, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    data = r.json()
    assert data["reader_style"] == "neutral", data
    assert abs(float(data["voice_speed"]) - 1.0) < 1e-6, data


# ---------------- Test 4: GET returns persisted values ----------------
def test_rehearsal_get_returns_persisted_values(api, script):
    create = api.post(f"{BASE_URL}/api/rehearsals", json={
        "script_id": script["id"],
        "user_character": "DET. HARRIS",
        "mode": "full_read",
        "voice_type": "alloy",
        "reader_style": "emotional",
        "voice_speed": 0.9,
    }, timeout=15)
    assert create.status_code == 200, create.text
    rid = create.json()["id"]

    got = api.get(f"{BASE_URL}/api/rehearsals/{rid}", timeout=15)
    assert got.status_code == 200, got.text
    data = got.json()
    assert data["reader_style"] == "emotional", data
    assert abs(float(data["voice_speed"]) - 0.9) < 1e-6, data
    assert data["user_character"] == "DET. HARRIS"
