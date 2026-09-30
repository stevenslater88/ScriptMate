"""Regression suite for the Feb-2026 voice-pipeline diagnostic +
cache hardening.

Physical QA of build 1110 showed the picker persisted the assignment
correctly and `voice-assignments-loaded` fired, but the actor did not
hear the assigned voice. Without per-stage diagnostics we could not
tell whether the failure was:
  (a) picker → storage
  (b) storage → rehearsal-mount load
  (c) rehearsal → per-line assignment lookup (case-mismatch, etc.)
  (d) provider selection (elevenlabs vs expo-speech)
  (e) ElevenLabs API/network failure

This suite locks the six diagnostic breadcrumbs the fix emits, the
case-insensitive assignment lookup, the voiceId-scoped audio cache
key, and the guarantee that "alloy" (or any global voice_type) does
NOT override an explicit per-character assignment.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"

REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"
SCRIPT_SCREEN = FRONTEND / "app" / "script" / "[id].tsx"
VOICE_ASSIGN = FRONTEND / "components" / "VoiceAssignment.tsx"
ELEVENLABS = FRONTEND / "services" / "elevenLabsService.ts"


# ─── DIAGNOSTIC BREADCRUMBS AT EACH PIPELINE STAGE ───────────────────


def test_voice_picker_selection_diagnostic_fires_with_voiceId():
    src = VOICE_ASSIGN.read_text()
    assert "VOICE_PICKER_SELECTION" in src, (
        "VoiceAssignment must emit VOICE_PICKER_SELECTION when a voice "
        "is chosen — otherwise we can't prove which voice was picked."
    )
    # Payload must include the stable identifiers, not just displayName.
    m = re.search(
        r"VOICE_PICKER_SELECTION[\s\S]{0,600}",
        src,
    )
    assert m, "VOICE_PICKER_SELECTION emission not found"
    body = m.group(0)
    for field in ("character", "displayName", "provider", "voiceKey", "voiceId"):
        assert field in body, (
            f"VOICE_PICKER_SELECTION payload must include '{field}'"
        )


def test_rehearsal_voice_assignments_diagnostic_lists_all_characters():
    src = REHEARSAL.read_text()
    assert "REHEARSAL_VOICE_ASSIGNMENTS" in src
    m = re.search(
        r"REHEARSAL_VOICE_ASSIGNMENTS[\s\S]{0,800}",
        src,
    )
    body = m.group(0) if m else ""
    for field in ("count", "elevenLabsConfigured", "assignments"):
        assert field in body, (
            f"REHEARSAL_VOICE_ASSIGNMENTS must include '{field}'"
        )
    # Per-character breakdown (not just a count).
    assert "characterName" in body or "character" in body


def test_create_rehearsal_request_diagnostic_includes_per_character_map():
    src = SCRIPT_SCREEN.read_text()
    assert "CREATE_REHEARSAL_REQUEST" in src, (
        "ScriptScreen must emit CREATE_REHEARSAL_REQUEST — otherwise "
        "we can't tell what voice map was in play at rehearsal start."
    )
    m = re.search(
        r"CREATE_REHEARSAL_REQUEST[\s\S]{0,1500}",
        src,
    )
    body = m.group(0) if m else ""
    for field in (
        "character",
        "voiceAssignments",
        "voiceAssignmentCount",
        "globalFallbackVoice",
    ):
        assert field in body, (
            f"CREATE_REHEARSAL_REQUEST payload must include '{field}' — "
            f"required to distinguish per-character voices from the "
            f"single global fallback"
        )


def test_tts_request_diagnostic_emitted_per_line():
    src = REHEARSAL.read_text()
    assert "TTS_REQUEST" in src
    m = re.search(r"TTS_REQUEST[\s\S]{0,1200}", src)
    body = m.group(0) if m else ""
    for field in (
        "character", "provider", "voiceId",
        "assignmentPresent", "elevenLabsConfigured",
    ):
        assert field in body, (
            f"TTS_REQUEST payload must include '{field}'"
        )


def test_tts_response_diagnostic_records_success_and_failure_paths():
    src = REHEARSAL.read_text()
    # Both success and failure occurrences must be present.
    success_re = re.compile(
        r"TTS_RESPONSE[\s\S]{0,500}?success:\s*true", re.DOTALL,
    )
    failure_re = re.compile(
        r"TTS_RESPONSE[\s\S]{0,700}?success:\s*false[\s\S]{0,300}?error:", re.DOTALL,
    )
    assert success_re.search(src), (
        "TTS_RESPONSE with success:true must be emitted after a "
        "successful ElevenLabs playback"
    )
    assert failure_re.search(src), (
        "TTS_RESPONSE with success:false + error field must be emitted "
        "when ElevenLabs playback fails, so we can distinguish silent "
        "fallback from working audio"
    )


def test_audio_playback_diagnostic_fires_for_both_providers():
    src = REHEARSAL.read_text()
    # ElevenLabs branch AUDIO_PLAYBACK
    ep_re = re.compile(
        r"AUDIO_PLAYBACK[\s\S]{0,500}?provider:\s*['\"]elevenlabs['\"]",
        re.DOTALL,
    )
    # expo-speech fallback AUDIO_PLAYBACK
    xs_re = re.compile(
        r"AUDIO_PLAYBACK[\s\S]{0,600}?provider:\s*['\"]expo-speech['\"]",
        re.DOTALL,
    )
    assert ep_re.search(src), (
        "AUDIO_PLAYBACK { provider: 'elevenlabs' } must fire when "
        "ElevenLabs audio is queued for playback"
    )
    assert xs_re.search(src), (
        "AUDIO_PLAYBACK { provider: 'expo-speech' } must fire when the "
        "fallback path is used — this is the exact signal a physical "
        "tester needs to see when a character isn't using their "
        "assigned voice"
    )


# ─── CASE-INSENSITIVE CHARACTER LOOKUP ───────────────────────────────


def test_rehearsal_lookup_is_case_insensitive():
    """Screenplay parsers emit UPPER CASE ("DET. HARRIS"). Some picker
    metadata paths pass names through as parsed ("Det. Harris"). The
    lookup must survive that drift without renaming keys in storage."""
    src = REHEARSAL.read_text()
    # Loader stores BOTH the exact case and the upper-case key.
    m_loader = re.search(
        r"map\[a\.characterName\]\s*=\s*a;\s*"
        r"map\[a\.characterName\.toUpperCase\(\)\]\s*=\s*a",
        src,
    )
    assert m_loader, (
        "assignment map must be populated with both the exact and "
        "upper-cased character-name keys"
    )
    # speakLine falls back to the upper-cased key.
    m_lookup = re.search(
        r"voiceAssignmentsRef\.current\[lineCharacter\][\s\S]{0,200}?"
        r"voiceAssignmentsRef\.current\[lineCharacter\.toUpperCase\(\)\]",
        src,
    )
    assert m_lookup, (
        "speakLine must try both exact and upper-cased character-name "
        "keys against the assignment map"
    )


# ─── AUDIO CACHE IS KEYED BY voiceId ─────────────────────────────────


def test_audio_cache_key_includes_voiceId():
    """Regression against the reported cache pitfall: changing Rachel
    to Domi must not keep playing the previous voice. The cache key
    must include the ElevenLabs voice ID."""
    src = ELEVENLABS.read_text()
    assert "makeAudioCacheKey" in src, (
        "audio cache key helper must exist"
    )
    m = re.search(
        r"function\s+makeAudioCacheKey\s*\(\s*voiceId:\s*string\s*,\s*"
        r"text:\s*string\s*\)[\s\S]{0,400}?"
        r"return\s+`\$\{voiceId\}",
        src,
    )
    assert m, (
        "makeAudioCacheKey(voiceId, text) must return a string that "
        "PREFIXES the voiceId — otherwise voice changes leak cached "
        "audio from the previous voice"
    )
    # And playSpeech uses that key both for read and write.
    play_src = src[src.find("export const playSpeech"):]
    assert "makeAudioCacheKey(voiceId, text)" in play_src
    assert "cacheGet" in play_src and "cachePut" in play_src


def test_audio_cache_public_clear_helper_exists():
    """Exposed so tests / future admin flows can drop cached voices
    without a whole app reset. Also exported from the default alias."""
    src = ELEVENLABS.read_text()
    assert "export function clearElevenLabsAudioCache" in src
    # Included in the default export bag.
    m = re.search(r"export default \{[\s\S]{0,500}\};", src)
    assert m
    assert "clearElevenLabsAudioCache" in m.group(0)


# ─── "alloy" MUST NOT OVERRIDE AN EXPLICIT ELEVENLABS ASSIGNMENT ────


def test_playSpeech_is_never_called_with_a_global_or_alloy_voice_id():
    src = REHEARSAL.read_text()
    banned = [
        "playSpeech(text, 'alloy')",
        'playSpeech(text, "alloy")',
        "playSpeech(text, voiceType)",
    ]
    for bad in banned:
        assert bad not in src, (
            f"forbidden call site: {bad} — playSpeech must always take "
            f"the character's assigned voiceId, never a global or "
            f"OpenAI-style voice name"
        )
    # Explicit positive: only the assignment.voiceId form exists.
    assert "playSpeech(text, assignment.voiceId)" in src


def test_useElevenLabs_branch_requires_explicit_assignment_voiceId():
    """The condition is what protects the pipeline from falling into
    a global-voice code path when the user has explicitly assigned an
    ElevenLabs voice."""
    src = REHEARSAL.read_text()
    m = re.search(
        r"const\s+useElevenLabs\s*=\s*"
        r"elevenLabsAvailable\.current\s*"
        r"&&\s*!!assignment\s*"
        r"&&\s*!!assignment\.voiceId",
        src,
    )
    assert m, (
        "useElevenLabs branch must require all three: module "
        "configured AND assignment present AND voiceId set"
    )


# ─── EXPO-SPEECH FALLBACK PRESERVED ────────────────────────────────


def test_fallback_speech_speak_still_present_and_unchanged():
    src = REHEARSAL.read_text()
    m = re.search(
        r"Speech\.speak\s*\(\s*text\s*,\s*\{[\s\S]{0,400}?"
        r"pitch:\s*voiceSettings\.pitch[\s\S]{0,200}?"
        r"rate:\s*voiceSettings\.rate",
        src,
    )
    assert m, (
        "the expo-speech fallback with the composed pitch/rate settings "
        "must remain — this is what plays when no assignment or when "
        "ElevenLabs fails"
    )
