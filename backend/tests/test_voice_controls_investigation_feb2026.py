"""Investigation-only regression PROOFS for the Voice / Reader Controls
audit (Feb 2026).

These tests LOCK the current — as-of-audit — state of each control so
that any subsequent fix (or accidental change) will register in the
diff. They are static-source-inspection tests only; nothing here calls
the network or a running app.

Each test's docstring explains what it proves. A test that is expected
to FAIL when the control is later fixed is marked `xfail(strict=True)`
so the fix flip is automatic.

CONTROLS AUDITED:
A) AI Reader Style (script/[id].tsx: Neutral / Emotional / Intense)
   - state variable exists                                      → PASS
   - value is never sent to backend or persisted                → xfail
   - rehearsal playback uses voice_type only (no reader style)  → xfail
B) Multi-Voice (VoiceAssignment.tsx + elevenLabsService.ts)
   - persists per-character assignments to AsyncStorage         → PASS
   - rehearsal/[id].tsx does NOT load them                      → xfail
   - rehearsal/[id].tsx uses a single global voice_type         → xfail
C) Scene Partner Reader Style + Cue Timing (scene-partner.tsx)
   - reader style values reach Speech.speak() (pitch / rate)    → PASS
   - cue timing reaches setTimeout delay                         → PASS
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

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
    """PROVES the UI is wired. The `selectedReaderStyle` state and the
    three READER_STYLES options exist in ScriptScreen."""
    src = SCRIPT_SCREEN.read_text()
    assert "selectedReaderStyle" in src
    assert "setSelectedReaderStyle" in src
    for name in ("Neutral", "Emotional", "Intense"):
        assert f"name: '{name}'" in src, (
            f"Reader style '{name}' option must exist in the UI"
        )


@pytest.mark.xfail(
    reason=(
        "AUDIT FINDING A.1: `selectedReaderStyle` is component-local and "
        "is never sent to createRehearsal(). Backend `RehearsalCreate` "
        "has no `reader_style` field. When the fix lands (persist + "
        "propagate), this xfail will flip to XPASS and the marker "
        "must be removed."
    ),
    strict=True,
)
def test_A2_reader_style_is_sent_to_createRehearsal_call():
    """Would-be true when fixed: the ScriptScreen's `handleStartRehearsal`
    passes `selectedReaderStyle` (or `voiceSpeed`) into `createRehearsal`.
    Currently it does not — only `selectedVoice` is forwarded."""
    src = SCRIPT_SCREEN.read_text()
    m = re.search(
        r"createRehearsal\s*\(\s*id!\s*,\s*selectedCharacter\s*,\s*"
        r"selectedMode\s*,\s*selectedVoice\s*,\s*"
        r"(selectedReaderStyle|voiceSpeed)",
        src,
    )
    assert m, "reader style / voice speed must be forwarded to createRehearsal()"


@pytest.mark.xfail(
    reason=(
        "AUDIT FINDING A.2: `store/scriptStore.ts::createRehearsal` "
        "posts only {script_id, user_character, mode, voice_type, "
        "user_id}. No `reader_style` / `voice_speed` fields on the "
        "wire. Fix will add them here + on the backend model."
    ),
    strict=True,
)
def test_A3_scriptStore_createRehearsal_sends_reader_style():
    src = SCRIPT_STORE.read_text()
    assert "reader_style" in src or "voice_speed" in src


@pytest.mark.xfail(
    reason=(
        "AUDIT FINDING A.3: Backend `RehearsalCreate` Pydantic model "
        "has no reader_style / voice_speed field, so even if the "
        "client sent it, FastAPI would drop it. Fix must extend the "
        "model + persist it on RehearsalSession."
    ),
    strict=True,
)
def test_A4_backend_rehearsal_create_model_accepts_reader_style():
    src = SERVER.read_text()
    m = re.search(
        r"class\s+RehearsalCreate\s*\(BaseModel\)\s*:\s*(.*?)\n\nclass",
        src, re.DOTALL,
    )
    assert m, "RehearsalCreate model not found"
    body = m.group(1)
    assert "reader_style" in body or "voice_speed" in body, (
        "RehearsalCreate must accept reader_style / voice_speed"
    )


@pytest.mark.xfail(
    reason=(
        "AUDIT FINDING A.4: rehearsal/[id].tsx::speakLine consumes only "
        "voice_type (via getVoiceSettings()). It never reads a "
        "reader_style / voice_speed from currentRehearsal, so the "
        "setting has no effect at playback time."
    ),
    strict=True,
)
def test_A5_rehearsal_playback_consumes_reader_style():
    src = REHEARSAL.read_text()
    assert "reader_style" in src or "readerStyle" in src, (
        "rehearsal playback must consume the reader style setting"
    )


# ═══════════════════════════════════════════════════════════════════════
# B) MULTI-VOICE — per-character voice assignment
# ═══════════════════════════════════════════════════════════════════════


def test_B_multiVoice_persists_assignments_to_async_storage():
    """PROVES the persistence half of the flow works: `saveVoiceAssignments`
    / `loadVoiceAssignments` read+write the `script_voice_settings`
    AsyncStorage key keyed by scriptId."""
    src = ELEVENLABS.read_text()
    assert "VOICE_STORAGE_KEY = 'script_voice_settings'" in src
    assert re.search(
        r"export\s+const\s+saveVoiceAssignments\s*=\s*async", src
    )
    assert re.search(
        r"export\s+const\s+loadVoiceAssignments\s*=\s*async", src
    )
    # Component invokes save on change (line ~118) and load on mount.
    va = VOICE_ASSIGN.read_text()
    assert "saveVoiceAssignments(scriptId" in va
    assert "loadVoiceAssignments(scriptId" in va


def test_B2_multiVoice_UI_offers_voice_id_and_voice_key_mapping():
    """Voice keys map to real ElevenLabs voiceIds inside PRESET_VOICES."""
    src = ELEVENLABS.read_text()
    assert "PRESET_VOICES" in src and "voiceId" in src
    va = VOICE_ASSIGN.read_text()
    # UI stores voiceKey → voiceId in the persisted list.
    assert "voiceKey" in va and "voiceId" in va


@pytest.mark.xfail(
    reason=(
        "AUDIT FINDING B.1: rehearsal/[id].tsx uses expo-speech "
        "(Speech.speak) with a SINGLE voice_type for all non-user "
        "lines. It never calls loadVoiceAssignments / "
        "getCharacterVoiceId, so per-character voice assignments "
        "saved in AsyncStorage are ignored at playback time. Fix: "
        "load the map on mount and, for each non-user line, resolve "
        "the character's voiceId and (if ElevenLabs configured) call "
        "playSpeech(text, voiceId) instead of Speech.speak."
    ),
    strict=True,
)
def test_B3_rehearsal_playback_loads_per_character_voice_assignments():
    src = REHEARSAL.read_text()
    assert (
        "loadVoiceAssignments" in src
        or "getCharacterVoiceId" in src
    ), (
        "rehearsal playback must consult loaded voice assignments so "
        "each character speaks with its selected voice"
    )


@pytest.mark.xfail(
    reason=(
        "AUDIT FINDING B.2: rehearsal/[id].tsx only imports "
        "expo-speech; it does not import playSpeech from "
        "elevenLabsService. Fix will add an ElevenLabs code path "
        "gated on isElevenLabsConfigured()."
    ),
    strict=True,
)
def test_B4_rehearsal_imports_elevenlabs_playSpeech():
    src = REHEARSAL.read_text()
    assert (
        "playSpeech" in src
        or "from '../../services/elevenLabsService'" in src
        or 'from "../../services/elevenLabsService"' in src
    )


def test_B5_only_voice_preview_currently_uses_elevenLabs_playSpeech():
    """PROVES the current bounded scope: playSpeech is used only for
    the in-picker preview, not at rehearsal time. Locks in the current
    (broken) state so a future fix's diff shows the widening scope."""
    va = VOICE_ASSIGN.read_text()
    assert "playSpeech" in va, (
        "VoiceAssignment.tsx uses playSpeech for its preview button"
    )
    rehearsal = REHEARSAL.read_text()
    assert "playSpeech" not in rehearsal, (
        "current audit state: rehearsal does NOT use playSpeech "
        "(this locks the state; the xfail above will flip when fixed)"
    )


# ═══════════════════════════════════════════════════════════════════════
# C) SCENE PARTNER — Reader Style + Cue Timing (audit says these WORK)
# ═══════════════════════════════════════════════════════════════════════


def test_C1_scene_partner_reader_style_is_wired_into_Speech_speak():
    """PROVES the reader style DOES reach Speech.speak in scene-partner.
    Neutral/Calm/Serious/Aggressive/Fast Pace each have (rate, pitch)
    values and `speakLine` passes them through."""
    src = SCENE_PARTNER.read_text()
    # All 4 named styles requested by QA plus Fast Pace exist.
    for name in ("Neutral", "Calm", "Serious", "Aggressive"):
        assert f"name: '{name}'" in src, (
            f"scene-partner reader style '{name}' must be defined"
        )
    # style.rate / style.pitch are passed into Speech.speak
    m = re.search(
        r"Speech\.speak\s*\([^)]*rate:\s*style\.rate[^)]*pitch:\s*style\.pitch",
        src,
        re.DOTALL,
    )
    assert m, (
        "scene-partner speakLine() must pass style.rate + style.pitch "
        "into Speech.speak (this is what makes the reader style actually work)"
    )


def test_C2_scene_partner_cue_timing_reaches_setTimeout_delay():
    """PROVES cue timing controls the inter-line delay. CUE_TIMINGS list
    has (0, 1000, 2000, 3000) ms; getDelay() returns the selected
    entry; setTimeout(advanceTo, delay) fires between lines."""
    src = SCENE_PARTNER.read_text()
    assert "CUE_TIMINGS" in src
    # All the requested delays exist.
    for delay_ms in (0, 1000, 2000, 3000):
        assert f"delay: {delay_ms}" in src, (
            f"cue timing value {delay_ms}ms must be in CUE_TIMINGS"
        )
    # getDelay() feeds setTimeout for the advance step.
    assert re.search(
        r"const\s+getDelay\s*=\s*\(\)\s*=>\s*CUE_TIMINGS\.find", src
    )
    assert re.search(
        r"setTimeout\(\s*\(\s*\)\s*=>\s*advanceTo\([^)]+\)\s*,\s*delay\s*\)",
        src,
    ), (
        "scene-partner advanceTo() must delay by getDelay() ms — "
        "otherwise cue timing has no effect"
    )


def test_C3_scene_partner_state_is_session_only_by_design():
    """PROVES the intentional session-only persistence — no AsyncStorage
    write for `selectedStyle` / `selectedTiming` in scene-partner. The
    fact that they're not persisted is by design (session tool) and
    NOT a defect; this test locks that in."""
    src = SCENE_PARTNER.read_text()
    assert "AsyncStorage" not in src, (
        "scene-partner is intentionally session-only; introducing "
        "persistence needs a product-level decision, not a stealth diff"
    )
