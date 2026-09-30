"""LOCKED contract file for the Feb-2026 Voice / Reader Controls audit.

Originally created as an INVESTIGATION-only file with 6 strict xfail
markers documenting the broken paths (A + B). The fix has since
landed (see `test_voice_controls_fix_feb2026.py`) so every xfail has
been flipped to a normal passing assertion — each test now asserts
the FIXED contract, so any future regression that re-breaks the wiring
will fail loudly.

The Scene Partner (C) tests remained PASSing throughout — Reader Style
and Cue Timing there were already correctly wired.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
BACKEND = Path(__file__).resolve().parents[1]

SCRIPT_SCREEN = FRONTEND / "app" / "script" / "[id].tsx"
SCRIPT_STORE = FRONTEND / "store" / "scriptStore.ts"
REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"
VOICE_ASSIGN = FRONTEND / "components" / "VoiceAssignment.tsx"
ELEVENLABS = FRONTEND / "services" / "elevenLabsService.ts"
SCENE_PARTNER = FRONTEND / "app" / "scene-partner.tsx"
SERVER = BACKEND / "server.py"


# ═══════════════════════════════════════════════════════════════════════
# A) AI READER STYLE — Neutral / Emotional / Intense in Script Settings
# ═══════════════════════════════════════════════════════════════════════


def test_A_reader_style_state_variable_exists_in_script_screen():
    src = SCRIPT_SCREEN.read_text()
    assert "selectedReaderStyle" in src
    assert "setSelectedReaderStyle" in src
    for name in ("Neutral", "Emotional", "Intense"):
        assert f"name: '{name}'" in src


def test_A2_reader_style_is_sent_to_createRehearsal_call():
    """After the fix: `selectedReaderStyle` and `voiceSpeed` are
    forwarded into createRehearsal()."""
    src = SCRIPT_SCREEN.read_text()
    m = re.search(
        r"createRehearsal\s*\(\s*"
        r"id!\s*,\s*"
        r"selectedCharacter\s*,\s*"
        r"selectedMode\s*,\s*"
        r"selectedVoice\s*,\s*"
        r"(?:[^)]*//[^\n]*\n\s*)?"
        r"selectedReaderStyle\s*,\s*"
        r"voiceSpeed",
        src, re.DOTALL,
    )
    assert m, "reader style + voice speed must be forwarded to createRehearsal"


def test_A3_scriptStore_createRehearsal_sends_reader_style():
    src = SCRIPT_STORE.read_text()
    assert "reader_style: readerStyle" in src
    assert "voice_speed: voiceSpeed" in src


def test_A4_backend_rehearsal_create_model_accepts_reader_style():
    src = SERVER.read_text()
    m = re.search(
        r"class\s+RehearsalCreate\s*\(BaseModel\)\s*:\s*(.*?)\n\nclass",
        src, re.DOTALL,
    )
    assert m, "RehearsalCreate class not found"
    body = m.group(1)
    assert "reader_style" in body
    assert "voice_speed" in body


def test_A5_rehearsal_playback_consumes_reader_style():
    """After the fix: currentRehearsal's reader_style / voice_speed
    are read and passed into the composed getVoiceSettings()."""
    src = REHEARSAL.read_text()
    assert "currentRehearsal?.reader_style" in src
    assert "currentRehearsal?.voice_speed" in src
    assert re.search(
        r"getVoiceSettings\s*\(\s*voiceType\s*,\s*readerVoiceSpeed", src
    )


# ═══════════════════════════════════════════════════════════════════════
# B) MULTI-VOICE — per-character voice assignment
# ═══════════════════════════════════════════════════════════════════════


def test_B_multiVoice_persists_assignments_to_async_storage():
    src = ELEVENLABS.read_text()
    assert "VOICE_STORAGE_KEY = 'script_voice_settings'" in src
    assert re.search(
        r"export\s+const\s+saveVoiceAssignments\s*=\s*async", src
    )
    assert re.search(
        r"export\s+const\s+loadVoiceAssignments\s*=\s*async", src
    )
    va = VOICE_ASSIGN.read_text()
    assert "saveVoiceAssignments(scriptId" in va
    assert "loadVoiceAssignments(scriptId" in va


def test_B2_multiVoice_UI_offers_voice_id_and_voice_key_mapping():
    src = ELEVENLABS.read_text()
    assert "PRESET_VOICES" in src and "voiceId" in src
    va = VOICE_ASSIGN.read_text()
    assert "voiceKey" in va and "voiceId" in va


def test_B3_rehearsal_playback_loads_per_character_voice_assignments():
    """After the fix: rehearsal/[id].tsx calls loadVoiceAssignments on
    mount and consults the map from inside speakLine."""
    src = REHEARSAL.read_text()
    assert "loadVoiceAssignments(scriptId)" in src
    assert "voiceAssignmentsRef" in src


def test_B4_rehearsal_imports_elevenlabs_playSpeech():
    src = REHEARSAL.read_text()
    assert "playSpeech" in src
    assert "elevenLabsService" in src


def test_B5_rehearsal_now_uses_elevenLabs_when_configured_with_assignment():
    """Post-fix contract inversion of the original test: rehearsal
    now DOES route through playSpeech when the character has an
    assignment and ElevenLabs is configured. The pre-fix version of
    this test asserted the opposite state; both would be a regression
    warning now."""
    src = REHEARSAL.read_text()
    assert re.search(
        r"playSpeech\s*\(\s*text\s*,\s*assignment\.voiceId\s*[,)]", src
    ), "rehearsal must call playSpeech(text, assignment.voiceId, ...)"


# ═══════════════════════════════════════════════════════════════════════
# C) SCENE PARTNER — Reader Style + Cue Timing  (UNTOUCHED BY THE FIX)
# ═══════════════════════════════════════════════════════════════════════


def test_C1_scene_partner_reader_style_is_wired_into_Speech_speak():
    src = SCENE_PARTNER.read_text()
    for name in ("Neutral", "Calm", "Serious", "Aggressive"):
        assert f"name: '{name}'" in src
    assert re.search(
        r"Speech\.speak\s*\([^)]*rate:\s*style\.rate[^)]*pitch:\s*style\.pitch",
        src, re.DOTALL,
    )


def test_C2_scene_partner_cue_timing_reaches_setTimeout_delay():
    src = SCENE_PARTNER.read_text()
    assert "CUE_TIMINGS" in src
    for delay_ms in (0, 1000, 2000, 3000):
        assert f"delay: {delay_ms}" in src
    assert re.search(
        r"const\s+getDelay\s*=\s*\(\)\s*=>\s*CUE_TIMINGS\.find", src
    )
    assert re.search(
        r"setTimeout\(\s*\(\s*\)\s*=>\s*advanceTo\([^)]+\)\s*,\s*delay\s*\)",
        src,
    )


def test_C3_scene_partner_state_is_session_only_by_design():
    src = SCENE_PARTNER.read_text()
    assert "AsyncStorage" not in src
