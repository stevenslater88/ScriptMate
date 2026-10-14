"""VC1143 recovery part 2 — Android mic prompt + ElevenLabs background audio focus.

ElevenLabs tests run the real `services/elevenLabsService.ts` in Node with native
modules stubbed (fixtures/elevenlabs_foreground_harness.js). Mic tests lock the
order of the permission flow inside the rehearsal screen component.
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "fixtures/elevenlabs_foreground_harness.js"
FRONTEND = Path("/app/frontend")
REHEARSAL = (FRONTEND / "app/rehearsal/[id].tsx").read_text()
SERVICE = (FRONTEND / "services/elevenLabsService.ts").read_text()


def _run(scenario: str) -> dict:
    out = subprocess.run(["node", str(HARNESS), scenario], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def _fn_body(src: str, name: str, length: int = 2600) -> str:
    i = src.index(f"const {name} = async")
    return src[i:i + length]


# ─── ElevenLabs: AudioFocusNotAcquiredException (background) ─────────

def test_wait_for_foreground_resolves_only_when_active():
    assert _run("wait_resolves_on_active") == {"before": False, "after": True, "listenersLeft": 0}


def test_wait_for_foreground_is_immediate_when_active():
    assert _run("wait_immediate_when_active") == {"done": True}


def test_background_focus_error_classification():
    assert _run("classifies_errors") == {"bg": True, "other": False, "nullish": False}


def test_background_rejection_is_retried_once_and_succeeds():
    r = _run("retries_once_after_background_rejection")
    assert r == {"calls": 2, "resolved": True, "error": None, "retryLogged": True}


def test_retry_waits_until_app_returns_to_foreground():
    r = _run("waits_for_foreground_before_retry")
    assert r["whileBackground"] == {"calls": 1, "resolved": False}
    assert r["final"] == {"calls": 2, "resolved": True}


def test_other_playback_errors_are_not_retried():
    assert _run("non_background_error_not_retried") == {"calls": 1, "error": "Player error"}


def test_play_speech_waits_for_foreground_before_play():
    i = SERVICE.index("export const playSpeech = async")
    body = SERVICE[i:i + 6000]
    assert "AppState.currentState !== 'active'" in body
    assert body.index("await waitForForeground();") < body.index("await playWhenForeground(sound, voiceId);")
    assert "await sound.playAsync();" not in body  # only via playWhenForeground
    assert "import { AppState } from 'react-native';" in SERVICE


# ─── Android microphone permission prompt ─────────────────────────────

def test_speech_permission_requests_before_consulting_can_ask_again():
    body = _fn_body(REHEARSAL, "ensureSpeechPermission")
    req = body.index("ExpoSpeechRecognitionModule.requestPermissionsAsync()")
    assert "current.canAskAgain" not in body
    assert body.index("result.canAskAgain === false") > req
    assert body.index("Microphone Access Needed") > req


def test_record_permission_requests_before_consulting_can_ask_again():
    body = _fn_body(REHEARSAL, "ensureAudioPermission")
    req = body.index("Audio.requestPermissionsAsync()")
    assert "current.canAskAgain" not in body
    assert body.index("result.canAskAgain === false") > req


def test_granted_permission_is_not_re_requested():
    body = _fn_body(REHEARSAL, "ensureSpeechPermission")
    assert body.index("if (current.granted)") < body.index("requestPermissionsAsync()")
    assert "if (speechPermissionGrantedRef.current) return true;" in body


def test_no_repeated_prompt_after_denial():
    body = _fn_body(REHEARSAL, "ensureSpeechPermission")
    assert "speechPermissionDeniedRef.current = true;" in body
    i = REHEARSAL.index("// Auto-start listening when it's the user's turn")
    assert "!speechPermissionDeniedRef.current" in REHEARSAL[i:i + 900]


def test_android_manifest_config_keeps_record_audio():
    cfg = json.loads((FRONTEND / "app.json").read_text())["expo"]["android"]
    assert "android.permission.RECORD_AUDIO" in cfg["permissions"]
    assert "android.permission.RECORD_AUDIO" not in cfg.get("blockedPermissions", [])
