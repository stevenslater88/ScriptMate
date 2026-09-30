"""Regression suite for the Feb-2026 fix that wired:
  A) AI Reader Style (Neutral / Emotional / Intense) end-to-end
  B) Multi-Voice (per-character ElevenLabs assignments) into the
     rehearsal playback path.

This test file REPLACES the 6 xfail contract lockers from
`test_voice_controls_investigation_feb2026.py`. Those xfails should
have been removed in the same commit as this test file — this file
asserts the FIX contract with normal PASSing assertions.

Scope:
- Reader style reaches rehearsal creation (frontend + wire + backend model).
- Reader style + voice speed persist on RehearsalSession.
- Rehearsal playback consumes reader style (voice-speed multiplier
  composes with the per-voice rate — it does NOT replace it).
- Per-character voice assignments are loaded on rehearsal mount.
- The assigned ElevenLabs voice is used for the correct character
  when configured; otherwise the pre-fix expo-speech path is preserved
  bit-for-bit as the fallback.
- Scene Partner file is not touched by this fix.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
BACKEND = Path(__file__).resolve().parents[1]

SCRIPT_SCREEN = FRONTEND / "app" / "script" / "[id].tsx"
SCRIPT_STORE = FRONTEND / "store" / "scriptStore.ts"
REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"
SCENE_PARTNER = FRONTEND / "app" / "scene-partner.tsx"
ELEVENLABS = FRONTEND / "services" / "elevenLabsService.ts"
SERVER = BACKEND / "server.py"


# ═══════════════════════════════════════════════════════════════════════
# A — READER STYLE WIRED END-TO-END
# ═══════════════════════════════════════════════════════════════════════


def test_A_script_screen_forwards_reader_style_and_speed_to_createRehearsal():
    """`handleStartRehearsal` must pass BOTH the selected reader style
    AND the derived voice speed as the 5th and 6th positional args of
    the createRehearsal() call."""
    src = SCRIPT_SCREEN.read_text()
    # Match multi-line call site.
    m = re.search(
        r"createRehearsal\s*\(\s*"
        r"id!\s*,\s*"
        r"selectedCharacter\s*,\s*"
        r"selectedMode\s*,\s*"
        r"selectedVoice\s*,\s*"
        r"(?:[^)]*//[^\n]*\n\s*)?"  # allow a comment line between args
        r"selectedReaderStyle\s*,\s*"
        r"voiceSpeed",
        src, re.DOTALL,
    )
    assert m, (
        "handleStartRehearsal must forward selectedReaderStyle and "
        "voiceSpeed to createRehearsal()"
    )


def test_A_scriptStore_signature_accepts_reader_style_and_voice_speed():
    src = SCRIPT_STORE.read_text()
    # Interface signature has the two optional args.
    assert re.search(
        r"createRehearsal:\s*\("
        r"[\s\S]*?readerStyle\?:\s*string\s*,"
        r"[\s\S]*?voiceSpeed\?:\s*number",
        src,
    ), "createRehearsal interface must add readerStyle? + voiceSpeed?"
    # Implementation sends them.
    assert "reader_style: readerStyle" in src
    assert "voice_speed: voiceSpeed" in src


def test_A_scriptStore_defaults_preserve_pre_fix_behaviour():
    """Legacy callers (or tests) that call createRehearsal with only
    4 args must still work — defaults are 'neutral' / 1.0."""
    src = SCRIPT_STORE.read_text()
    assert re.search(
        r"readerStyle:\s*string\s*=\s*['\"]neutral['\"]", src
    ), "readerStyle must default to 'neutral'"
    assert re.search(
        r"voiceSpeed:\s*number\s*=\s*1\.0", src
    ), "voiceSpeed must default to 1.0"


def test_A_scriptStore_RehearsalSession_type_carries_new_fields():
    src = SCRIPT_STORE.read_text()
    assert re.search(r"reader_style\?:\s*string", src)
    assert re.search(r"voice_speed\?:\s*number", src)


def test_A_backend_RehearsalCreate_model_accepts_reader_style_and_speed():
    src = SERVER.read_text()
    m = re.search(
        r"class\s+RehearsalCreate\s*\(BaseModel\)\s*:\s*(.*?)\n\nclass",
        src, re.DOTALL,
    )
    assert m, "RehearsalCreate class body not found"
    body = m.group(1)
    assert re.search(r'reader_style:\s*str\s*=\s*"neutral"', body)
    assert re.search(r"voice_speed:\s*float\s*=\s*1\.0", body)


def test_A_backend_RehearsalSession_model_persists_reader_style_and_speed():
    src = SERVER.read_text()
    m = re.search(
        r"class\s+RehearsalSession\s*\(BaseModel\)\s*:\s*(.*?)\n\nclass",
        src, re.DOTALL,
    )
    assert m, "RehearsalSession class body not found"
    body = m.group(1)
    assert re.search(r'reader_style:\s*str\s*=\s*"neutral"', body), (
        "RehearsalSession must persist reader_style so deep-link resume "
        "keeps the setting"
    )
    assert re.search(r"voice_speed:\s*float\s*=\s*1\.0", body)


def test_A_backend_create_rehearsal_route_wires_fields_into_session():
    src = SERVER.read_text()
    # The rehearsal insert must forward the new fields from rehearsal_data.
    m = re.search(
        r"rehearsal\s*=\s*RehearsalSession\s*\((.*?)\)\s*\n",
        src, re.DOTALL,
    )
    assert m, "RehearsalSession construction not found"
    body = m.group(1)
    assert "reader_style=rehearsal_data.reader_style" in body
    assert "voice_speed=rehearsal_data.voice_speed" in body


def test_A_rehearsal_playback_consumes_reader_style():
    src = REHEARSAL.read_text()
    # Reads persisted setting off currentRehearsal
    assert "currentRehearsal?.reader_style" in src
    assert "currentRehearsal?.voice_speed" in src


def test_A_rehearsal_getVoiceSettings_composes_speed_with_rate():
    """The speed multiplier must be MULTIPLIED into the per-voice base
    rate, not replace it — Neutral (1.0) is a no-op, Emotional (0.9)
    slower, Intense (1.1) faster. Anything else regresses the
    established per-voice character."""
    src = REHEARSAL.read_text()
    # The getVoiceSettings signature now accepts the multiplier.
    m = re.search(
        r"const\s+getVoiceSettings\s*=\s*useCallback\s*\(\s*"
        r"\(\s*voice:\s*string\s*,\s*voiceSpeedMultiplier",
        src,
    )
    assert m, (
        "getVoiceSettings must accept a voiceSpeedMultiplier parameter"
    )
    # And it composes rate * multiplier.
    assert re.search(
        r"rate:\s*base\.rate\s*\*\s*voiceSpeedMultiplier", src
    ), "voice-speed multiplier must be MULTIPLIED into the base rate"


def test_A_rehearsal_speakLine_passes_readerVoiceSpeed_into_settings():
    src = REHEARSAL.read_text()
    assert re.search(
        r"getVoiceSettings\s*\(\s*voiceType\s*,\s*readerVoiceSpeed\s*\)",
        src,
    ), (
        "speakLine must call getVoiceSettings(voiceType, readerVoiceSpeed)"
    )


# ═══════════════════════════════════════════════════════════════════════
# B — MULTI-VOICE WIRED INTO REHEARSAL
# ═══════════════════════════════════════════════════════════════════════


def test_B_rehearsal_imports_elevenLabs_helpers():
    src = REHEARSAL.read_text()
    for symbol in (
        "loadVoiceAssignments",
        "playSpeech",
        "isElevenLabsConfigured",
        "CharacterVoiceAssignment",
    ):
        assert symbol in src, (
            f"rehearsal/[id].tsx must import '{symbol}' from "
            f"services/elevenLabsService"
        )


def test_B_rehearsal_loads_voice_assignments_on_mount():
    """Assignments must be loaded once per script (keyed by scriptId)
    and stashed in a ref so speakLine can read them synchronously."""
    src = REHEARSAL.read_text()
    assert "loadVoiceAssignments(scriptId)" in src
    assert "voiceAssignmentsRef" in src
    # useEffect keyed by scriptId (from either currentScript or currentRehearsal).
    assert re.search(
        r"useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?loadVoiceAssignments"
        r"[\s\S]*?\},\s*\[[^\]]*script[^\]]*\]",
        src,
    ), (
        "voice assignments must load inside a mount-time useEffect "
        "keyed by scriptId"
    )


def test_B_rehearsal_checks_isElevenLabsConfigured_and_uses_elevenLabs_when_available():
    src = REHEARSAL.read_text()
    assert "isElevenLabsConfigured()" in src
    # The branch condition must require BOTH: the module is configured
    # AND the specific character has an assignment with a voiceId.
    assert re.search(
        r"const\s+useElevenLabs\s*=\s*"
        r"[\s\S]*?elevenLabsAvailable\.current"
        r"[\s\S]*?assignment"
        r"[\s\S]*?voiceId",
        src,
    ), (
        "useElevenLabs branch must require the module configured AND "
        "an explicit per-character voiceId"
    )


def test_B_rehearsal_calls_playSpeech_with_the_character_voiceId():
    src = REHEARSAL.read_text()
    assert re.search(
        r"playSpeech\s*\(\s*text\s*,\s*assignment\.voiceId\s*[,)]",
        src,
    ), (
        "speakLine must call playSpeech(text, assignment.voiceId, ...) for "
        "the character's assigned voice"
    )


def test_B_rehearsal_wires_onPlaybackStatusUpdate_for_line_advance():
    """The ElevenLabs Audio.Sound must fire the same safeAdvance()
    callback the existing expo-speech path uses — so line advancement
    stays consistent across both engines."""
    src = REHEARSAL.read_text()
    assert "setOnPlaybackStatusUpdate" in src
    assert "didJustFinish" in src
    # And the ElevenLabs finish path calls safeAdvance().
    m = re.search(
        r"didJustFinish[\s\S]{0,300}?safeAdvance\(\)",
        src,
    )
    assert m, (
        "on ElevenLabs playback finish the shared safeAdvance() must "
        "run to advance the line"
    )


def test_B_rehearsal_fallback_to_expo_speech_still_present():
    """When ElevenLabs is unavailable OR a character has no
    assignment, the pre-fix Speech.speak(...) path must still exist
    unchanged."""
    src = REHEARSAL.read_text()
    assert "Speech.speak(text" in src
    assert "language: 'en-US'" in src
    # The fallback must live in the SAME speakLine function.
    m = re.search(
        r"const\s+speakLine\s*=\s*useCallback[\s\S]*?Speech\.speak\(",
        src,
    )
    assert m, "the shared Speech.speak fallback must remain in speakLine"


def test_B_rehearsal_elevenLabs_failure_falls_back_to_expo_speech():
    """A generation failure inside the ElevenLabs branch must not
    strand the rehearsal — it must fall through to the shared
    Speech.speak fallback."""
    src = REHEARSAL.read_text()
    assert "playSpeech returned null" in src
    # The catch(e) inside the ElevenLabs branch does NOT re-throw or
    # call safeAdvance directly — it lets execution fall through.
    m = re.search(
        r"catch\s*\(\s*e:[\s\S]*?fall(-|\s)?through[\s\S]*?Speech\.speak\(",
        src,
    )
    assert m, (
        "ElevenLabs branch must fall through to Speech.speak on failure"
    )


def test_B_rehearsal_stops_elevenLabs_sound_on_pause_and_unmount():
    src = REHEARSAL.read_text()
    # togglePause tears down the ElevenLabs sound.
    m_pause = re.search(
        r"setIsPaused\(true\);\s*Speech\.stop\(\);\s*"
        r"[\s\S]*?stopElevenLabsSound\(\)",
        src,
    )
    assert m_pause, "togglePause must also stop the ElevenLabs sound"
    # Unmount cleanup tears it down too.
    m_unmount = re.search(
        r"activeElevenLabsSoundRef\.current\s*=\s*null",
        src,
    )
    assert m_unmount, "unmount cleanup must clear activeElevenLabsSoundRef"


# ═══════════════════════════════════════════════════════════════════════
# GUARD — SCENE PARTNER MUST BE UNTOUCHED
# ═══════════════════════════════════════════════════════════════════════


def test_scene_partner_still_uses_only_expo_speech():
    """Scene Partner is proven working (Reader Style + Cue Timing) and
    must not be touched by this fix. If a diff sneaks in that imports
    ElevenLabs into scene-partner, this test fails."""
    src = SCENE_PARTNER.read_text()
    assert "playSpeech" not in src, (
        "scene-partner.tsx must not import playSpeech — its style "
        "wiring is already correct via Speech.speak"
    )
    assert "loadVoiceAssignments" not in src
    assert "elevenLabsService" not in src


def test_scene_partner_reader_style_and_cue_timing_still_wired():
    """Sanity re-affirm — the working parts stay working."""
    src = SCENE_PARTNER.read_text()
    assert re.search(
        r"Speech\.speak\s*\([^)]*rate:\s*style\.rate[^)]*pitch:\s*style\.pitch",
        src, re.DOTALL,
    )
    assert re.search(
        r"setTimeout\(\s*\(\s*\)\s*=>\s*advanceTo\([^)]+\)\s*,\s*delay\s*\)",
        src,
    )


# ═══════════════════════════════════════════════════════════════════════
# CONTRACT — voice-controls-investigation xfails were removed
# ═══════════════════════════════════════════════════════════════════════


def test_investigation_xfails_have_been_flipped():
    """The 6 xfail contract lockers from the investigation file MUST
    have been removed (either the whole test rewritten to a normal
    PASS, or the xfail marker deleted). This test proves the flip
    happened."""
    inv = BACKEND / "tests" / "test_voice_controls_investigation_feb2026.py"
    src = inv.read_text()
    # Zero xfail *pytest markers* remain (mentions inside docstrings /
    # comments are allowed for historical context).
    assert "pytest.mark.xfail" not in src, (
        "voice-controls-investigation must no longer contain any "
        "@pytest.mark.xfail marker — the fix has landed, contract must "
        "be enforced as normal passing assertions"
    )
