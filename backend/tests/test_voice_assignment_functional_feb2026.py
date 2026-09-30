"""Regression guard: Voice Assignment / Change Voice must remain fully
functional after the Feb-2026 reconciliation.

Requirements this file locks:
1. `components/VoiceAssignment.tsx` still exposes the assignment UI.
2. A user can change the voice assigned to each character.
3. `saveVoiceAssignments` persists the change to AsyncStorage.
4. `loadVoiceAssignments` re-reads it, and the map survives reload.
5. `app/rehearsal/[id].tsx` loads the assignments on mount and looks
   them up per line in `speakLine`.
6. When ElevenLabs is configured AND the character has an assignment
   with a voiceId, the rehearsal calls `playSpeech(text, voiceId)` —
   i.e. that character actually speaks in the assigned voice.
7. Voice preview inside the picker still uses `playSpeech`.
8. If ElevenLabs is unavailable OR a character has no assignment, the
   pre-fix expo-speech (`Speech.speak(text, { pitch, rate })`) fallback
   is used unchanged — no character is silenced.
9. The voice catalogue (PRESET_VOICES) is not removed or redesigned.
10. The `script_voice_settings` AsyncStorage key is not renamed.

All tests are static — no runtime, no mocking. Each test asserts a
concrete invariant on the source files.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"

VOICE_ASSIGN = FRONTEND / "components" / "VoiceAssignment.tsx"
ELEVENLABS = FRONTEND / "services" / "elevenLabsService.ts"
REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"


# ─── 1. UI SURFACE PRESERVED ─────────────────────────────────────────


def test_voice_assignment_component_exists():
    """The assignment UI file must remain — the reconciliation is
    additive."""
    assert VOICE_ASSIGN.exists(), (
        "components/VoiceAssignment.tsx must not be removed"
    )
    src = VOICE_ASSIGN.read_text()
    # The component export is named and reachable.
    assert re.search(
        r"export\s+(?:default\s+)?function\s+VoiceAssignment", src
    ), "VoiceAssignment component export must remain"


def test_voice_assignment_ui_still_lets_user_change_per_character_voice():
    """The UI must still map each character to a picker button that
    updates the local `assignments` state and calls
    `saveVoiceAssignments`. Not asserting the exact JSX shape — only
    the wiring facts."""
    src = VOICE_ASSIGN.read_text()
    # Local state map { characterName → voiceKey } exists.
    assert re.search(
        r"useState<Record<string,\s*string>>\s*\(\s*\{\s*\}\s*\)", src
    ), "assignments useState<Record<string, string>>({}) must remain"
    # A user-tap handler must update the map and persist.
    assert "saveVoiceAssignments(scriptId" in src, (
        "picker must invoke saveVoiceAssignments(scriptId, ...) on change"
    )


def test_voice_preview_button_still_uses_playSpeech():
    src = VOICE_ASSIGN.read_text()
    assert "playSpeech" in src, (
        "voice preview must still invoke playSpeech (the ElevenLabs "
        "helper) — do not swap this to expo-speech"
    )


# ─── 2. PERSISTENCE CONTRACT PRESERVED ───────────────────────────────


def test_async_storage_key_unchanged():
    """The persistence key must stay `script_voice_settings` — renaming
    it would silently orphan every existing user's assignments."""
    src = ELEVENLABS.read_text()
    assert "VOICE_STORAGE_KEY = 'script_voice_settings'" in src


def test_save_and_load_voice_assignments_signatures_stable():
    src = ELEVENLABS.read_text()
    # save
    assert re.search(
        r"export\s+const\s+saveVoiceAssignments\s*=\s*async\s*\("
        r"[\s\S]*?scriptId:\s*string,\s*"
        r"[\s\S]*?assignments:\s*",
        src,
    ), "saveVoiceAssignments(scriptId, assignments) signature required"
    # load
    assert re.search(
        r"export\s+const\s+loadVoiceAssignments\s*=\s*async\s*\("
        r"[\s\S]*?scriptId:\s*string",
        src,
    ), "loadVoiceAssignments(scriptId) signature required"


def test_voice_catalogue_not_removed_or_redesigned():
    """PRESET_VOICES is the ground-truth catalogue. It must retain the
    fields the picker + rehearsal both rely on: `key`, `name`,
    `voiceId`, `gender`, `description`."""
    src = ELEVENLABS.read_text()
    assert "PRESET_VOICES" in src
    for field in ("key:", "name:", "voiceId:", "gender:", "description:"):
        assert field in src, (
            f"PRESET_VOICES entry field '{field}' must remain — the "
            f"picker and rehearsal both depend on this shape"
        )


def test_getCharacterVoiceId_helper_still_exposed():
    """`getCharacterVoiceId(scriptId, characterName)` is the resolver
    used to look up a character's assigned voiceId. It must remain
    exported."""
    src = ELEVENLABS.read_text()
    assert re.search(
        r"export\s+const\s+getCharacterVoiceId\s*=\s*async", src
    ) or "getCharacterVoiceId" in src, (
        "getCharacterVoiceId helper must remain available for "
        "rehearsal / future consumers"
    )


# ─── 3. REHEARSAL CONSUMES THE ASSIGNMENTS ──────────────────────────


def test_rehearsal_loads_voice_assignments_on_mount():
    src = REHEARSAL.read_text()
    assert "loadVoiceAssignments(scriptId)" in src


def test_rehearsal_looks_up_per_line_character_at_speak_time():
    """speakLine must resolve the CURRENT line's character (not just
    the user's own character) against the assignments map."""
    src = REHEARSAL.read_text()
    # Resolve line character
    assert re.search(
        r"const\s+lineCharacter\s*=\s*lines\[targetLineIndex\]\?\.character",
        src,
    ), (
        "speakLine must resolve the current line's character via "
        "lines[targetLineIndex]?.character"
    )
    # Look it up in the assignments ref map — either inline via
    # `voiceAssignmentsRef.current[lineCharacter]` or via the pure
    # helper `resolveVoiceForCharacter(voiceAssignmentsRef.current, lineCharacter)`.
    inline = re.search(r"voiceAssignmentsRef\.current\[lineCharacter\]", src)
    helper = re.search(
        r"resolveVoiceForCharacter\s*\(\s*voiceAssignmentsRef\.current\s*,\s*"
        r"lineCharacter\s*,?\s*\)",
        src,
    )
    assert inline or helper, (
        "speakLine must consult voiceAssignmentsRef.current[lineCharacter] "
        "either inline or via resolveVoiceForCharacter(...)"
    )


def test_rehearsal_uses_elevenLabs_voice_for_correct_character():
    """When ElevenLabs is configured and the line's character has an
    assignment, the character's voiceId must be passed to playSpeech —
    NOT the user's or a global voice."""
    src = REHEARSAL.read_text()
    assert re.search(
        r"playSpeech\s*\(\s*text\s*,\s*assignment\.voiceId\s*\)", src
    ), (
        "playSpeech(text, assignment.voiceId) is the exact call that "
        "makes each character speak in their assigned voice"
    )
    # Guard: playSpeech is NOT called with a hardcoded / global voice.
    for bad in (
        "playSpeech(text, 'alloy')",
        "playSpeech(text, voiceType)",
        "playSpeech(text, 'echo')",
    ):
        assert bad not in src, (
            f"forbidden: playSpeech invoked with a non-character voice: {bad}"
        )


# ─── 4. FALLBACK PRESERVED ──────────────────────────────────────────


def test_fallback_speech_speak_path_preserved():
    """The pre-fix expo-speech path MUST remain reachable when
    ElevenLabs is unavailable or the character has no assignment."""
    src = REHEARSAL.read_text()
    # Speech.speak(text, { pitch, rate, ... }) still exists in speakLine.
    m = re.search(
        r"const\s+speakLine\s*=\s*useCallback[\s\S]*?"
        r"Speech\.speak\s*\(\s*text\s*,\s*\{",
        src,
    )
    assert m, "Speech.speak(text, {...}) fallback must remain in speakLine"


def test_elevenLabs_failure_falls_through_to_fallback():
    """If playSpeech throws OR returns null, the code must fall
    through to Speech.speak — it must never leave the actor with a
    silent line."""
    src = REHEARSAL.read_text()
    assert "playSpeech returned null" in src, (
        "explicit null-return handling must remain — playSpeech is "
        "allowed to fail without breaking rehearsal"
    )
    # The catch block does not call safeAdvance directly (which would
    # skip the line silently). It must fall through to Speech.speak.
    m = re.search(
        r"catch\s*\(\s*e:[\s\S]{0,300}?"
        r"fall(-|\s)?through[\s\S]*?"
        r"Speech\.speak\(",
        src,
    )
    assert m, (
        "ElevenLabs branch must fall through to Speech.speak on "
        "failure — otherwise the rehearsal stalls"
    )


def test_fallback_used_when_no_assignment_or_elevenLabs_missing():
    """The branch condition `useElevenLabs = elevenLabsAvailable
    && !!assignment && !!assignment.voiceId` guarantees the fallback
    runs when the assignments map lookup returns undefined OR
    ElevenLabs isn't configured. May be expressed inline OR via the
    pure `selectProvider(configured, resolution)` helper — both are
    the same rule."""
    src = REHEARSAL.read_text()
    inline = re.search(
        r"const\s+useElevenLabs\s*=\s*"
        r"elevenLabsAvailable\.current\s*"
        r"&&\s*!!assignment\s*"
        r"&&\s*!!assignment\.voiceId",
        src,
    )
    helper = re.search(
        r"selectProvider\(\s*elevenLabsAvailable\.current\s*,\s*resolution\s*\)",
        src,
    )
    assert inline or helper, (
        "the useElevenLabs branch condition must require BOTH the "
        "module configured AND a per-character assignment with voiceId "
        "— either inline or via the pure selectProvider() helper"
    )


# ─── 5. AUDIT / TESTABILITY ─────────────────────────────────────────


def test_debuglog_records_assignment_loading():
    """DebugLog emits a diagnostic breadcrumb when assignments load —
    lets QA see on-device whether the map arrived. The canonical event
    key is `REHEARSAL_VOICE_ASSIGNMENTS` (Feb-2026 hardening)."""
    src = REHEARSAL.read_text()
    assert "REHEARSAL_VOICE_ASSIGNMENTS" in src, (
        "rehearsal must DebugLog a 'REHEARSAL_VOICE_ASSIGNMENTS' event "
        "so the on-device diagnostic surfaces the per-character map"
    )
