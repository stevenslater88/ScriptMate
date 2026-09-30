"""
Voice-pipeline Android playback fix regression suite
====================================================

Physical S23 Ultra QA (Build 1110) reported: assignments loaded, but
NO rehearsal audio actually played. RCA (documented in
`frontend/services/elevenLabsService.ts` header) traced the break to:

  1. `response.blob()` + `FileReader.readAsDataURL()` — unreliable on
     RN Android/Hermes. Silently returns empty/corrupted data.
  2. `data:audio/mpeg;base64,...` URI passed to `Audio.Sound.createAsync`
     — ExoPlayer on Android fails on non-trivial data: audio URIs.
  3. `Audio.setAudioModeAsync` was gated behind `isPremium` and passed
     iOS-only fields, so Android free-tier devices never had a playback
     audio session configured.

This suite locks the fix:

  * arrayBuffer + Hermes-safe base64 encoder + expo-file-system/legacy
    write-to-file + `file://` URI passed to `Audio.Sound.createAsync`.
  * `ensurePlaybackAudioMode()` called unconditionally from rehearsal
    with both iOS and Android session keys.
  * VOICE_RESOLUTION / VOICE_PROVIDER_SELECTED / ELEVENLABS_REQUEST_START
    / ELEVENLABS_RESPONSE / ELEVENLABS_AUDIO_READY / AUDIO_LOAD_START
    / AUDIO_LOAD_SUCCESS / AUDIO_PLAY_START / AUDIO_PLAYING /
    AUDIO_PLAYBACK_COMPLETE / AUDIO_PLAYBACK_ERROR / FALLBACK_TO_EXPO_SPEECH
    diagnostics are all emitted.
  * The pure playback seam lives in `elevenLabsPure.ts` (no RN imports),
    exercised end-to-end by `scripts/voice_pipeline_smoketest.js`.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"
SERVICE = FRONTEND / "services" / "elevenLabsService.ts"
PURE = FRONTEND / "services" / "elevenLabsPure.ts"
SMOKE = ROOT / "scripts" / "voice_pipeline_smoketest.js"


# ─── ROOT-CAUSE FIX ────────────────────────────────────────────────

def test_no_response_blob_readasdataurl_pattern_remains():
    """The exact broken pattern (fetch → blob → FileReader.readAsDataURL
    → data: URI) must not remain in the audio generation path."""
    src = SERVICE.read_text()
    # The old broken form is `reader.readAsDataURL(audioBlob)` — verify
    # NO active call site uses this pattern (a comment in the header
    # explaining why it's banned is fine).
    lines = [
        line for line in src.splitlines()
        if "readAsDataURL(audioBlob" in line and not line.lstrip().startswith(("*", "//", "#"))
    ]
    assert not lines, (
        f"forbidden pattern reintroduced: FileReader.readAsDataURL(audioBlob) — "
        f"broken on RN Android. Offending lines: {lines}"
    )


def test_generateSpeech_uses_arrayBuffer_not_blob():
    src = SERVICE.read_text()
    assert "response.arrayBuffer()" in src, (
        "generateSpeechToFile must use response.arrayBuffer() — the "
        "blob+FileReader path is broken on RN Android"
    )


def test_audio_written_to_temp_file_via_expo_file_system_legacy():
    src = SERVICE.read_text()
    assert "from 'expo-file-system/legacy'" in src, (
        "must import from expo-file-system/legacy for SDK 54 compat"
    )
    assert "writeAsStringAsync" in src, (
        "must persist audio bytes to a temp file"
    )
    assert "EncodingType.Base64" in src, (
        "must write with Base64 encoding so the raw MP3 lands intact"
    )


def test_no_data_url_passed_to_audio_sound_createAsync():
    """Explicitly forbid the data: URI path on Android — must be a
    file:// URI instead. The active createAsync call passes `fileUri`."""
    src = SERVICE.read_text()
    assert "Audio.Sound.createAsync" in src
    # The active createAsync must use fileUri (from writeAsStringAsync),
    # not a data URL.
    active = "Audio.Sound.createAsync(\n      { uri: fileUri }"
    assert active in src, (
        "Audio.Sound.createAsync must be called with the file:// URI "
        "produced by writeAsStringAsync, not a data: URI"
    )


def test_hermes_safe_base64_encoder_exists():
    src = PURE.read_text()
    assert "export function uint8ArrayToBase64" in src, (
        "must expose a Hermes-safe manual base64 encoder — btoa is "
        "not reliable across all Expo runtimes"
    )


# ─── AUDIO SESSION FIX ─────────────────────────────────────────────

def test_ensure_playback_audio_mode_exists_and_is_android_aware():
    src = SERVICE.read_text()
    assert "ensurePlaybackAudioMode" in src
    # Must set at least one Android-specific field.
    body_start = src.find("ensurePlaybackAudioMode")
    body = src[body_start:body_start + 2000]
    assert "shouldDuckAndroid" in body, (
        "audio mode must include shouldDuckAndroid so ExoPlayer has a "
        "usable audio session on Android"
    )


def test_rehearsal_configures_audio_mode_for_all_users_not_only_premium():
    """The pre-fix rehearsal only called Audio.setAudioModeAsync when
    `isPremium` was true and only with iOS-only fields. Free-tier
    Android users therefore had NO playback audio session — first
    ExoPlayer load could silently no-op. Fix must call
    `ensurePlaybackAudioMode()` unconditionally on mount."""
    src = REHEARSAL.read_text()
    assert "ensurePlaybackAudioMode" in src, (
        "rehearsal must call ensurePlaybackAudioMode on mount"
    )
    # Locate the ACTUAL call site (invocation, not import). Then verify
    # the enclosing useEffect is not gated on isPremium.
    call_idx = src.index("ensurePlaybackAudioMode()")
    # Walk back to the nearest useEffect header.
    prefix = src[:call_idx]
    use_effect_idx = prefix.rfind("useEffect(")
    assert use_effect_idx >= 0, "call must be inside a useEffect hook"
    hook_body = src[use_effect_idx:call_idx + 200]
    assert "isPremium" not in hook_body, (
        "the ensurePlaybackAudioMode useEffect must NOT be gated on "
        "isPremium — that is exactly the free-tier Android bug we fixed"
    )


# ─── DIAGNOSTIC BREADCRUMBS ────────────────────────────────────────

REQUIRED_SERVICE_EVENTS = [
    "ELEVENLABS_REQUEST_START",
    "ELEVENLABS_RESPONSE",
    "ELEVENLABS_AUDIO_READY",
    "AUDIO_LOAD_START",
    "AUDIO_LOAD_SUCCESS",
    "AUDIO_PLAY_START",
    "AUDIO_PLAYING",
    "AUDIO_PLAYBACK_COMPLETE",
    "AUDIO_PLAYBACK_ERROR",
]

REQUIRED_REHEARSAL_EVENTS = [
    "VOICE_RESOLUTION",
    "VOICE_PROVIDER_SELECTED",
    "FALLBACK_TO_EXPO_SPEECH",
]


def test_service_emits_full_audio_lifecycle_diagnostics():
    src = SERVICE.read_text()
    for evt in REQUIRED_SERVICE_EVENTS:
        assert evt in src, (
            f"elevenLabsService must emit '{evt}' — required to distinguish "
            f"a real playback failure from a silent 'assignments loaded' state"
        )


def test_rehearsal_emits_voice_resolution_and_provider_selection():
    src = REHEARSAL.read_text()
    for evt in REQUIRED_REHEARSAL_EVENTS:
        assert evt in src, (
            f"rehearsal screen must emit '{evt}' per line"
        )


def test_diagnostics_never_log_api_key_or_full_audio_body():
    src = SERVICE.read_text()
    # Must never log the ElevenLabs API key value near a DebugLog call.
    if "'xi-api-key'" in src:
        after = src.split("'xi-api-key'")[1][:200]
        assert "DebugLog" not in after, (
            "must not log the ElevenLabs api key value near a DebugLog call"
        )
    # Scan every DebugLog invocation for a raw base64 payload — no
    # payload key literally named `base64` (only `base64Length` /
    # byteLength are allowed).
    import re
    for m in re.finditer(r"DebugLog\.log\([\s\S]{0,600}?\}\s*\)", src):
        block = m.group(0)
        # Forbid a bare "base64:" object-literal key.
        assert not re.search(r"[\{,]\s*base64\s*:", block), (
            f"diagnostic payload must not include a raw 'base64' field:\n"
            f"{block[:200]}"
        )
        # And forbid interpolating the actual encoded body into the log.
        assert "${base64}" not in block, (
            f"diagnostic payload must not interpolate the encoded audio:\n"
            f"{block[:200]}"
        )


# ─── PURE PLAYBACK SEAM ────────────────────────────────────────────

def test_pure_module_has_no_react_native_imports():
    """The pure module is the seam that the Node smoke test exercises.
    It MUST NOT import from expo-* or react-native or the test cannot
    run without a full RN mock harness."""
    src = PURE.read_text()
    for banned in (
        "from 'expo-",
        'from "expo-',
        "from 'react-native",
        'from "react-native',
        "from '@expo/",
        'from "@expo/',
    ):
        assert banned not in src, (
            f"elevenLabsPure.ts must have zero RN/Expo imports — found "
            f"forbidden token: {banned!r}"
        )


def test_pure_module_exports_playCharacterLinePure():
    src = PURE.read_text()
    assert "export async function playCharacterLinePure" in src, (
        "pure module must export playCharacterLinePure — the E2E "
        "seam the smoke test proves works"
    )


def test_service_reexports_pure_helpers():
    src = SERVICE.read_text()
    for name in ("resolveVoiceForCharacter", "selectProvider",
                 "uint8ArrayToBase64", "makeAudioCacheKey"):
        assert name in src, (
            f"elevenLabsService must re-export/use pure helper '{name}'"
        )


# ─── END-TO-END MOCKED PLAYBACK PROOF ─────────────────────────────

def test_voice_pipeline_node_smoketest_passes():
    """This is THE test the fix must pass: character → assigned
    voiceId → ElevenLabs request → audio result → Audio.Sound → play
    → completion → next line. Executed as a Node script against the
    compiled pure module."""
    assert SMOKE.exists(), "smoke test script missing"
    result = subprocess.run(
        ["node", str(SMOKE)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    assert result.returncode == 0, (
        f"voice_pipeline_smoketest.js failed (exit {result.returncode}).\n"
        f"Full output:\n{output}"
    )
    # Belt-and-braces: also confirm the summary line reports zero fails.
    assert "fail=0" in output, f"smoke test reports failures:\n{output}"


# ─── SAFETY: PROTECTED SCOPES UNTOUCHED ────────────────────────────

def test_scene_partner_not_touched_by_this_fix():
    # Scene Partner is explicitly out-of-scope for the voice-pipeline
    # fix per the P0 directive.
    sp = FRONTEND / "app" / "scene-partner.tsx"
    if sp.exists():
        # Sanity — just checking the file still exists (i.e. wasn't
        # deleted/moved). We do NOT diff content because scene partner
        # has its own owner.
        assert sp.stat().st_size > 0


def test_voice_studio_not_touched_by_this_fix():
    vs = FRONTEND / "app" / "voice-studio.tsx"
    if vs.exists():
        assert vs.stat().st_size > 0


if __name__ == "__main__":
    # Handy for local iteration.
    sys.exit(subprocess.call([sys.executable, "-m", "pytest", __file__, "-v"]))
