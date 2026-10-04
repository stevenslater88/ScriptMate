"""
V1 Release Blocker — ElevenLabs voice pipeline hardening (Feb 2026).

Context
-------
Physical test reports: "Only some ElevenLabs voices work. Others fail."
Deep trace revealed:

  * Frontend PRESET_VOICES (26 entries) and backend PRESET_VOICES (29 entries)
    have identical IDs for every voice the frontend presents — so the
    frontend→backend ID mapping is NOT the fault.
  * Many of the catalogued voice IDs (Rachel/Drew/Clyde/Paul/Antoni/Fin/
    Dave/etc.) are LEGACY preset voices that are no longer in the default
    library for new ElevenLabs accounts. For those IDs ElevenLabs returns
    `voice_not_found` (HTTP 400/404).
  * The backend `/api/tts/elevenlabs/generate` previously squashed every
    SDK exception into a generic HTTP 500, so the client could not tell
    "this voice is unavailable in your account" from "transient infra
    error" and silently fell back to expo-speech — producing the "some
    work / some fail" symptom.

Fix contract (this ticket)
--------------------------
1. New endpoint `GET /api/tts/elevenlabs/available-voices` returns the
   preset catalogue annotated with per-voice `available: bool` by
   intersecting PRESET_VOICES with the account's `/v1/voices` set. Zero
   vendor cost. Fail-open: `probe_ok=false` ⇒ every entry `available=true`.
2. `/api/tts/elevenlabs/generate` differentiates `voice_not_found` from
   infra errors and returns a structured 422 `{code: 'voice_unavailable',
   voice_id, message}`.
3. Frontend `VoiceAssignment` fetches the catalogue once, filters picker
   + auto-assign pools by availability, fails open while the probe is
   in flight.
4. Zero secret leakage anywhere.

Tests
-----
Structural (file-level) assertions on the two source files plus live
HTTP checks against the running backend for the new endpoint shape and
the no-secret-leak contract.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import httpx
import pytest

SERVER_PATH = Path("/app/backend/server.py")
EL_SERVICE_PATH = Path("/app/frontend/services/elevenLabsService.ts")
VA_COMPONENT_PATH = Path("/app/frontend/components/VoiceAssignment.tsx")

BACKEND_URL = os.environ.get("BACKEND_URL_LOCAL", "http://localhost:8001")


@pytest.fixture(scope="module")
def server_source() -> str:
    assert SERVER_PATH.exists()
    return SERVER_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def el_service_source() -> str:
    assert EL_SERVICE_PATH.exists()
    return EL_SERVICE_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def va_component_source() -> str:
    assert VA_COMPONENT_PATH.exists()
    return VA_COMPONENT_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. authoritative voice catalogue — backend endpoint exists + shape
# ---------------------------------------------------------------------------

def test_backend_defines_available_voices_endpoint(server_source: str):
    assert '@api_router.get("/tts/elevenlabs/available-voices")' in server_source
    assert "async def elevenlabs_available_voices()" in server_source


def test_backend_endpoint_live_shape_and_frontend_id_parity():
    """Live-call the new endpoint and assert:
    - Returns 200.
    - Returns a `voices` list with `key`, `id`, `name`, `available` for every entry.
    - Every ID the frontend hard-codes resolves to a backend entry (parity).
    """
    r = httpx.get(f"{BACKEND_URL}/api/tts/elevenlabs/available-voices", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "probe_ok" in body and "voices" in body
    voices = body["voices"]
    assert isinstance(voices, list)
    assert len(voices) >= 26, f"Expected ≥26 preset voices, got {len(voices)}"
    # Shape
    for v in voices:
        assert set(v.keys()) >= {"key", "id", "name", "accent", "gender", "description", "available"}
        assert isinstance(v["available"], bool)
    # Frontend ↔ backend ID parity for every voice the frontend presents
    frontend_ids = {
        "rachel": "21m00Tcm4TlvDq8ikWAM", "domi": "AZnzlk1XvdvUeBnXmlld",
        "sarah": "EXAVITQu4vr4xnSDxMaL", "emily": "LcfcDJNUP1GQjkzn1xUU",
        "elli": "MF3mGyEYCl7XYWbV9V6O", "dorothy": "ThT5KcBeYPX3keUQqHPh",
        "charlotte": "XB0fDUnXU5powFXDhCwa", "matilda": "XrExE9yKIg1WjnnlVkGX",
        "freya": "jsCqWAovK2LkecY7zXl4", "gigi": "jBpfuIE2acCO8z3wKNLl",
        "drew": "29vD33N1CtxCmqQRPOHJ", "clyde": "2EiwWnXFnvU5JabPnv8n",
        "paul": "5Q0t7uMcjvnagumLfvZi", "dave": "CYw3kZ02Hs0563khs1Fj",
        "fin": "D38z5RcWu1voky8WS1ja", "antoni": "ErXwobaYiN019PkySvjV",
        "thomas": "GBv7mTt0atIp3Br8iCZE", "charlie": "IKne3meq5aSn9XLyUdCD",
        "callum": "N2lVS1w4EtoT3dr4eOWO", "liam": "TX3LPaxmHKxFdv7VOQHJ",
        "josh": "TxGEqnHWrfWFTfGW9XjX", "arnold": "VR6AewLTigWG4xSOukaG",
        "james": "ZQe5CZNOzWyzPSCn5a3c", "joseph": "Zlb1dXrM653N07WRdFW3",
        "george": "JBFqnCBsd6RMkjVDRZzb", "ethan": "g5CIjZEefAph4nQFvHAz",
    }
    backend_by_key = {v["key"]: v for v in voices}
    for k, expected_id in frontend_ids.items():
        assert k in backend_by_key, f"frontend voice '{k}' missing from backend catalogue"
        assert backend_by_key[k]["id"] == expected_id, (
            f"ID mismatch for '{k}': frontend={expected_id} backend={backend_by_key[k]['id']}"
        )


def test_backend_endpoint_fail_open_when_probe_fails():
    """When the vendor /v1/voices probe fails (e.g. stale key, offline),
    `probe_ok=false` and every entry must still report `available=true` so
    the UX never falsely blocks a user on a vendor outage."""
    r = httpx.get(f"{BACKEND_URL}/api/tts/elevenlabs/available-voices", timeout=15)
    body = r.json()
    if body["probe_ok"] is False:
        for v in body["voices"]:
            assert v["available"] is True, (
                f"probe_ok=false but '{v['key']}' reported available=false — "
                "fail-open contract broken."
            )


def test_backend_endpoint_never_leaks_api_key(server_source: str):
    """The endpoint and surrounding helpers must never place the key in a
    response body, response header, or log line. We verify by checking
    the HTTP payload has no `sk_` prefix and that no header echoes a
    credential-shaped token."""
    r = httpx.get(f"{BACKEND_URL}/api/tts/elevenlabs/available-voices", timeout=15)
    text = r.text
    assert "sk_" not in text, "Body must not contain an sk_* key prefix."
    assert "xi-api-key" not in text.lower(), "Body must not echo xi-api-key header."
    for hv in r.headers.values():
        assert "sk_" not in str(hv), f"Header echoes sk_ prefix: {hv}"
    # Source-level sanity: the key is only read from the environment and
    # only sent as the vendor `xi-api-key` header, nowhere else.
    assert "ELEVENLABS_API_KEY" in server_source
    assert 'headers={"xi-api-key": ELEVENLABS_API_KEY}' in server_source


# ---------------------------------------------------------------------------
# 2. /generate error differentiation — structured 422 for voice_unavailable
# ---------------------------------------------------------------------------

def test_backend_generate_differentiates_voice_unavailable(server_source: str):
    """The /generate handler must detect vendor voice_not_found / 404 /
    'voice does not exist' and raise HTTPException(422, {code:
    'voice_unavailable', ...}) instead of the generic 500."""
    # The differentiation branch must be inside the generic exception handler.
    assert "voice_not_found" in server_source
    assert '"code": "voice_unavailable"' in server_source
    # Must still redact the API key before any error-text inspection.
    assert "***REDACTED***" in server_source
    pattern = re.compile(
        r'if\s+is_voice_unavailable:\s+raise\s+HTTPException\(\s*'
        r'status_code=422,\s+detail=\{\s*'
        r'"code":\s*"voice_unavailable"',
        re.DOTALL,
    )
    assert pattern.search(server_source), (
        "Expected a `if is_voice_unavailable: raise HTTPException(422, "
        '{"code": "voice_unavailable", ...})` branch.'
    )


# ---------------------------------------------------------------------------
# 3. Frontend fetches catalogue + filters picker + auto-assign pools
# ---------------------------------------------------------------------------

def test_frontend_exposes_fetchAvailableVoices(el_service_source: str):
    assert "export const fetchAvailableVoices" in el_service_source
    assert "/api/tts/elevenlabs/available-voices" in el_service_source
    # In-flight dedupe to prevent spamming the backend on first paint.
    assert "_availableInFlight" in el_service_source
    # Memoised result cache.
    assert "_availableCache" in el_service_source


def test_voiceassignment_imports_fetchAvailableVoices(va_component_source: str):
    assert "fetchAvailableVoices," in va_component_source
    assert "AvailableVoiceCatalogue" in va_component_source


def test_voiceassignment_filters_picker_by_availability(va_component_source: str):
    """Both picker gender lists must be filtered with `isVoiceAvailable(v.key)`."""
    female_pattern = re.compile(
        r"voicesByGender\.female\.filter\(v\s*=>\s*isVoiceAvailable\(v\.key\)\)\.map",
    )
    male_pattern = re.compile(
        r"voicesByGender\.male\.filter\(v\s*=>\s*isVoiceAvailable\(v\.key\)\)\.map",
    )
    assert female_pattern.search(va_component_source), "Female picker must filter by availability."
    assert male_pattern.search(va_component_source), "Male picker must filter by availability."


def test_voiceassignment_filters_autoassign_pools(va_component_source: str):
    """Auto-assign pools must be filtered BEFORE round-robin selection so a
    dead voice can never be assigned on mount."""
    assert "voicesByGender.male.filter(v => isVoiceAvailable(v.key))" in va_component_source
    assert "voicesByGender.female.filter(v => isVoiceAvailable(v.key))" in va_component_source


def test_voiceassignment_fails_open_before_probe_resolves(va_component_source: str):
    """`availableVoiceKeys === null` ⇒ every voice treated as available so
    the UI never flickers while the probe is in flight."""
    assert "if (availableVoiceKeys === null) return true;" in va_component_source
    # Default state is null (probe not yet landed).
    assert "useState<Set<string> | null>(null)" in va_component_source


def test_voiceassignment_assigns_stable_voiceId_not_display_name(va_component_source: str):
    """Storage must use the stable voiceId (ElevenLabs voice_id), never the
    display name. Regression guard for the "display-name instead of ID"
    class of bugs."""
    # saveVoiceAssignments is called with voiceId sourced from the preset.
    assert "voiceId: v?.id || ''," in va_component_source
    # Diagnostic emits BOTH key and ID — never the display name as an identifier.
    assert "voiceKey: voice.key," in va_component_source
    assert "voiceId: voice.id," in va_component_source


# ---------------------------------------------------------------------------
# 4. ID parity source-of-truth: frontend preset list ⊆ backend preset list
# ---------------------------------------------------------------------------

def test_frontend_preset_voices_ids_match_backend_file(el_service_source: str, server_source: str):
    """Static parity check — every ID in the frontend PRESET_VOICES array
    must appear in the backend PRESET_VOICES dict."""
    # Pull all 20-24 char ElevenLabs IDs out of each file's PRESET_VOICES block.
    id_pattern = re.compile(r"id:\s*['\"]([A-Za-z0-9]{18,24})['\"]")
    frontend_ids = set(id_pattern.findall(el_service_source))
    # Backend uses a dict with `"id": "..."` form.
    backend_id_pattern = re.compile(r'"id":\s*"([A-Za-z0-9]{18,24})"')
    backend_ids = set(backend_id_pattern.findall(server_source))
    missing = frontend_ids - backend_ids
    assert not missing, (
        f"Frontend preset IDs missing from backend PRESET_VOICES: {missing}. "
        "Catalogue parity broken."
    )


# ---------------------------------------------------------------------------
# 5. No vendor audio was generated during these tests
# ---------------------------------------------------------------------------

def test_no_vendor_audio_generation_in_this_test_module():
    """Guard: these tests MUST only call list/health endpoints — never
    /generate. If a future contributor adds /generate to this file by
    accident, this probe catches it before CI bills the vendor."""
    this_file = Path(__file__).read_text(encoding="utf-8")
    # Allow the string in the pattern/explanation above but not in a real call.
    live_call_pattern = re.compile(
        r"httpx\.(get|post)\([^)]*/api/tts/elevenlabs/generate",
    )
    assert not live_call_pattern.search(this_file), (
        "This module must not perform live /generate calls — vendor cost guard."
    )
