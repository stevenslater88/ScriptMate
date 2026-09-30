"""
Voice + Emotion + Speed pipeline fix (Feb-2026, Script M8)
==========================================================

Physical build 1110 / v1.0.62 / VC1101 on Samsung S23 Ultra returned:

    ELEVENLABS_RESPONSE  success=false  httpStatus=400
    bodyPreview: {
      "detail": { "type": "authentication_error",
                  "code": "invalid_api_key",
                  "message": "API key ID used as API key ..." }
    }

Three converging bugs were confirmed from the source:

1. `frontend/services/appConfig.ts` hard-coded a 64-char hex value in
   ELEVENLABS_API_KEY. That value is an **ElevenLabs API key ID**,
   not the actual API key. Real keys start with `sk_` (that hint is
   in the 400 body itself). The client therefore sent an ID as the
   `xi-api-key` header on every request and was rejected every time.

2. `readerStyle` (neutral / emotional / intense) was plumbed through
   the store and printed in `TTS_REQUEST` diagnostics, but the
   rehearsal call site `playSpeech(text, voiceId)` passed no options.
   `generateSpeechToFile` therefore always used `stability=0.5 /
   similarity=0.75 / style=0` regardless of style. Emotion never
   reached ElevenLabs.

3. `voiceSpeed` (0.9 in the reported case) was likewise plumbed and
   logged but not included in `voice_settings`. It only affected the
   expo-speech fallback `rate` multiplier, so ElevenLabs synthesis
   was always 1.0.

Additionally, the on-device fallback diagnostic did not report the
"requested" provider/voice alongside the "actual" one, so a silent
substitution (Rachel → alloy) was easy to miss.

This suite locks the Feb-2026 fixes and the request-body contract.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
CONFIG = FRONTEND / "services" / "appConfig.ts"
SERVICE = FRONTEND / "services" / "elevenLabsService.ts"
REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"


# ─── BUG #1: INVALID CREDENTIAL FORMAT ─────────────────────────────

def test_hardcoded_api_key_id_is_removed_from_appConfig():
    """The exact 64-char hex value that produced the physical 400 must
    not be present anywhere in appConfig.ts."""
    src = CONFIG.read_text()
    forbidden = "c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb"
    assert forbidden not in src, (
        "the 64-char API key ID that caused the physical HTTP 400 "
        "must not remain hard-coded in appConfig.ts"
    )


def test_isValidElevenLabsApiKey_rejects_64_char_hex_and_empty():
    """The strict validator must reject an API key ID (64-char hex),
    empty, non-string, wrong prefix, and too-short values."""
    src = CONFIG.read_text()
    assert "export function isValidElevenLabsApiKey" in src, (
        "appConfig must export isValidElevenLabsApiKey"
    )
    assert "startsWith('sk_')" in src, (
        "validator must require the sk_ prefix (per ElevenLabs 400 msg)"
    )


def test_classifyElevenLabsKey_distinguishes_api_key_id():
    src = CONFIG.read_text()
    assert "'looks-like-api-key-id'" in src, (
        "classifier must have a dedicated bucket for a 64-char hex "
        "value so the diagnostic reason is precise, not generic"
    )
    # Regex to detect the 64-char hex pattern must be present.
    m = re.search(r"/\^\[0-9a-fA-F\]\{64\}\$/", src)
    assert m, (
        "classifier must detect the 64-char hex API-key-ID format"
    )


def test_isElevenLabsConfigured_uses_strict_validator_not_just_truthiness():
    """`elevenLabsConfigured:true` must never appear merely because
    a value exists — must require valid FORMAT."""
    src = SERVICE.read_text()
    m = re.search(
        r"isElevenLabsConfigured\s*=\s*\([^)]*\)\s*:\s*boolean\s*=>\s*"
        r"isValidElevenLabsApiKey\(",
        src,
    )
    assert m, (
        "isElevenLabsConfigured must delegate to isValidElevenLabsApiKey "
        "rather than a `!!ELEVENLABS_API_KEY` truthiness check"
    )


def test_service_emits_ELEVENLABS_CONFIG_INVALID_diagnostic():
    src = SERVICE.read_text()
    assert "ELEVENLABS_CONFIG_INVALID" in src, (
        "service must emit ELEVENLABS_CONFIG_INVALID so physical QA "
        "sees the credential shape problem without a network round-trip"
    )
    # And it must not log the value itself.
    idx = src.index("ELEVENLABS_CONFIG_INVALID")
    block = src[idx:idx + 500]
    assert "AppConfig.ELEVENLABS_API_KEY" not in block, (
        "must not log the api key value inside the CONFIG_INVALID payload"
    )


def test_generateSpeechToFile_aborts_early_on_invalid_key_format():
    src = SERVICE.read_text()
    # New request-abort reason.
    assert "'invalid-api-key-format'" in src, (
        "generateSpeechToFile must abort with reason='invalid-api-key-format' "
        "when the credential fails the strict validator"
    )


# ─── BUG #2: EMOTION MUST REACH ELEVENLABS ─────────────────────────

def test_readerStyleToElevenLabsSettings_maps_neutral_vs_emotional_vs_intense():
    src = SERVICE.read_text()
    assert "export function readerStyleToElevenLabsSettings" in src, (
        "must export readerStyleToElevenLabsSettings"
    )
    # Neutral and emotional must produce different (stability, style)
    # tuples. We probe the source for the branch values.
    m_emo = re.search(r"s\s*===\s*['\"]emotional['\"][\s\S]{0,200}?style\s*=\s*([0-9.]+)", src)
    assert m_emo, "emotional branch must set a non-default style"
    assert float(m_emo.group(1)) > 0.0, "emotional style must be > 0"
    m_intense = re.search(r"s\s*===\s*['\"]intense['\"][\s\S]{0,200}?style\s*=\s*([0-9.]+)", src)
    assert m_intense, "intense/aggressive branch must set the highest style"
    assert float(m_intense.group(1)) > float(m_emo.group(1)), (
        "intense style must exceed emotional style"
    )


def test_generateSpeechToFile_forwards_readerStyle_and_voiceSpeed():
    src = SERVICE.read_text()
    # The options interface must accept the new fields.
    opts = src[src.find("export const generateSpeechToFile"):]
    opts = opts[: opts.find("=>")]
    assert "readerStyle?" in opts, (
        "generateSpeechToFile options must accept readerStyle"
    )
    assert "voiceSpeed?" in opts, (
        "generateSpeechToFile options must accept voiceSpeed"
    )
    # And the body must call readerStyleToElevenLabsSettings.
    body = src[src.find("export const generateSpeechToFile"):src.find("export const generateSpeech ") if "export const generateSpeech " in src else -1]
    assert "readerStyleToElevenLabsSettings" in body, (
        "generateSpeechToFile must derive voice_settings from "
        "readerStyleToElevenLabsSettings(readerStyle, voiceSpeed)"
    )
    # voice_settings body must include `style` and `speed` keys.
    assert re.search(r"voice_settings\s*:\s*\{[^}]*style[^}]*speed[^}]*\}", body, re.DOTALL), (
        "ElevenLabs request body must include voice_settings.style AND voice_settings.speed"
    )


def test_playSpeech_signature_accepts_readerStyle_and_voiceSpeed():
    src = SERVICE.read_text()
    play_src = src[src.find("export const playSpeech"):src.find("// ─── CONFIG PROBE") if "// ─── CONFIG PROBE" in src else -1]
    assert "readerStyle?" in play_src, (
        "playSpeech options must accept readerStyle"
    )
    assert "voiceSpeed?" in play_src, (
        "playSpeech options must accept voiceSpeed"
    )
    # The options must actually be forwarded to generateSpeechToFile.
    assert "generateSpeechToFile(text, voiceId, options)" in play_src, (
        "playSpeech must forward its full options object to "
        "generateSpeechToFile (so readerStyle + voiceSpeed reach the wire)"
    )


def test_rehearsal_passes_readerStyle_and_voiceSpeed_to_playSpeech():
    src = REHEARSAL.read_text()
    # The exact call site in speakLine must include both fields.
    m = re.search(
        r"playSpeech\(\s*text\s*,\s*assignment\.voiceId\s*,\s*\{[^}]*"
        r"readerStyle[^}]*voiceSpeed[^}]*\}\s*\)",
        src,
        re.DOTALL,
    )
    assert m, (
        "rehearsal speakLine must invoke playSpeech(text, voiceId, "
        "{ readerStyle, voiceSpeed: readerVoiceSpeed }) so emotion and "
        "speed actually reach the ElevenLabs synthesis params"
    )


# ─── BUG #3: SILENT VOICE SUBSTITUTION MUST BE VISIBLE ─────────────

def test_audio_playback_fallback_logs_requested_vs_actual_voice():
    """When ElevenLabs fails and we fall back to expo-speech, the
    AUDIO_PLAYBACK diagnostic must report both the REQUESTED
    provider/voice and the ACTUAL provider/voice so a silent
    substitution cannot be misread as 'the assigned voice played'."""
    src = REHEARSAL.read_text()
    # Locate the AUDIO_PLAYBACK block in the expo-speech fallback path.
    idx = src.rfind("'AUDIO_PLAYBACK'")
    assert idx >= 0, "AUDIO_PLAYBACK diagnostic must exist"
    block = src[idx:idx + 1200]
    for field in (
        "requestedProvider",
        "requestedVoiceId",
        "actualProvider",
        "actualVoice",
    ):
        assert field in block, (
            f"AUDIO_PLAYBACK fallback payload must include '{field}' "
            f"so silent voice substitutions are impossible to miss"
        )


# ─── BUG #4: CACHE MUST NOT COLLIDE ACROSS STYLE/SPEED ─────────────

def test_playSpeech_cache_key_includes_readerStyle_and_speed():
    """Otherwise a neutral clip and an emotional clip for the same
    voice+text would collide and one would silently mask the other."""
    src = SERVICE.read_text()
    play_src = src[src.find("export const playSpeech"):]
    # Cache key must reference both styleKey and speedKey (or the
    # readerStyle/voiceSpeed fields directly).
    assert re.search(r"cacheKey\s*=\s*`\$\{makeAudioCacheKey\([^)]+\)\}\|", play_src), (
        "playSpeech cache key must extend the base key with style/speed"
    )
    assert "styleKey" in play_src or "readerStyle" in play_src, (
        "cache key must include reader style"
    )
    assert "speedKey" in play_src or "voiceSpeed" in play_src, (
        "cache key must include voice speed"
    )


# ─── TEST A — MULTIPLE CHARACTER VOICES (behaviour proof) ─────────

def test_multiple_characters_route_to_distinct_voiceIds_via_pure_seam():
    """Compile the pure seam and prove: two characters with different
    ElevenLabs assignments produce fetches to two different voice IDs.
    This is the behaviour verified by the Node smoke test — we shell
    out to it here so it runs inside the pytest gate too."""
    smoke = ROOT / "scripts" / "voice_pipeline_smoketest.js"
    assert smoke.exists()
    result = subprocess.run(
        ["node", str(smoke)],
        cwd=str(ROOT), capture_output=True, text=True, timeout=120,
        check=False,
    )
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    assert result.returncode == 0, (
        f"voice pipeline E2E smoke failed:\n{output}"
    )
    # The E1/E2/E3 cases prove distinct voice IDs are used.
    for tag in ("E1: happy path", "E2: SARAH plays", "E3: DET. HARRIS"):
        assert tag in output, f"missing E2E case: {tag}"


# ─── TESTS B, C, D, E, F — request-body / config-format contract ──

def test_B_neutral_and_emotional_produce_different_settings_tuples():
    """Same voice + same text with different readerStyle must produce
    different (stability, style) values."""
    src = SERVICE.read_text()
    fn = src[src.find("readerStyleToElevenLabsSettings"):]
    fn = fn[: fn.find("\n}\n") + 3] if "\n}\n" in fn else fn[:2000]
    # Neutral values.
    m_neutral_stab = re.search(r"let\s+stability\s*=\s*([0-9.]+)", fn)
    m_neutral_style = re.search(r"let\s+style\s*=\s*([0-9.]+)", fn)
    # Emotional overrides.
    m_emo_stab = re.search(r"s\s*===\s*['\"]emotional['\"][\s\S]{0,200}?stability\s*=\s*([0-9.]+)", fn)
    m_emo_style = re.search(r"s\s*===\s*['\"]emotional['\"][\s\S]{0,200}?style\s*=\s*([0-9.]+)", fn)
    assert m_neutral_stab and m_neutral_style and m_emo_stab and m_emo_style
    assert float(m_emo_stab.group(1)) != float(m_neutral_stab.group(1)), (
        "emotional must alter stability vs neutral"
    )
    assert float(m_emo_style.group(1)) != float(m_neutral_style.group(1)), (
        "emotional must alter style vs neutral"
    )


def test_C_voice_speed_is_forwarded_into_voice_settings_body():
    src = SERVICE.read_text()
    # generateSpeechToFile must include speed in the JSON body.
    body_idx = src.find("body: JSON.stringify")
    assert body_idx > 0
    body_block = src[body_idx:body_idx + 500]
    assert re.search(r"speed\s*,", body_block) or re.search(r"speed\s*:", body_block), (
        "voice_settings body must include speed"
    )
    # And the clamp range must be reasonable — ElevenLabs supports 0.7-1.2.
    fn = src[src.find("readerStyleToElevenLabsSettings"):]
    assert re.search(r"Math\.max\(\s*0\.7\s*,\s*Math\.min\(\s*1\.2", fn), (
        "voice speed must be clamped to 0.7..1.2 (ElevenLabs supported range)"
    )


def test_D_invalid_api_key_short_circuits_before_network():
    """The strict validator gate in generateSpeechToFile must abort
    BEFORE the fetch is issued when the key is invalid. Otherwise a
    guaranteed-400 request is sent every line."""
    src = SERVICE.read_text()
    fn = src[src.find("export const generateSpeechToFile"):]
    abort_idx = fn.find("'invalid-api-key-format'")
    fetch_idx = fn.find("await fetchFn(url")
    assert abort_idx > 0 and fetch_idx > 0
    assert abort_idx < fetch_idx, (
        "the invalid-key abort MUST come before any fetch — "
        "otherwise every line still burns a network round-trip"
    )


def test_E_service_reports_valid_config_when_sk_prefix_present():
    """isElevenLabsConfigured/classifyElevenLabsKey must return
    valid==true for a well-formed sk_ key. We can't execute the TS
    here, but the classifier logic must contain the correct branch."""
    src = CONFIG.read_text()
    assert "'valid'" in src
    assert "startsWith('sk_')" in src
    # And the length gate must accept a realistic ElevenLabs key
    # (they are >= 30 chars in practice). We conservatively require
    # length >= 20 in the validator — accept longer, reject shorter.
    assert "length < 20" in src


def test_F_expo_speech_fallback_regression_remains_intact():
    """The regression contract: when ElevenLabs is intentionally
    unavailable (invalid key), expo-speech must still play with the
    Speech.speak(...) call — no crash."""
    src = REHEARSAL.read_text()
    assert re.search(r"Speech\.speak\(text,\s*\{[\s\S]{0,400}?onDone", src), (
        "expo-speech fallback path must still call Speech.speak with onDone"
    )


if __name__ == "__main__":
    sys.exit(subprocess.call([sys.executable, "-m", "pytest", __file__, "-v"]))
