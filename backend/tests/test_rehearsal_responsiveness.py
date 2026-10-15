"""Rehearsal responsiveness pass: ElevenLabs prefetch/dedupe (real service in Node),
fixed-delay reductions, duplicate-turn guards, mic start guard, turn timing
diagnostics, and Scene Partner cue-timing fixes (source-locked)."""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "fixtures/elevenlabs_prefetch_harness.js"
FRONTEND = Path("/app/frontend")
REHEARSAL = (FRONTEND / "app/rehearsal/[id].tsx").read_text()
SCENE = (FRONTEND / "app/scene-partner.tsx").read_text()
SERVICE = (FRONTEND / "services/elevenLabsService.ts").read_text()


def _run(scenario: str) -> dict:
    out = subprocess.run(["node", str(HARNESS), scenario], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def _between(src: str, start: str, length: int) -> str:
    i = src.index(start)
    return src[i:i + length]


# ─── ElevenLabs prefetch + dedupe ─────────────────────────────────────

def test_prefetch_and_play_share_one_generation():
    assert _run("prefetch_and_immediate_play_share_one_request") == {"generateCalls": 1, "played": True, "joined": True}


def test_completed_prefetch_is_cache_hit():
    assert _run("completed_prefetch_is_a_cache_hit") == {"generateCalls": 1, "played": True, "cacheHit": True}


def test_voice_and_style_are_part_of_the_key():
    assert _run("different_voice_or_style_is_not_shared") == {"generateCalls": 3}


def test_failed_prefetch_does_not_poison_play():
    assert _run("failed_prefetch_is_retried_by_play") == {"generateCalls": 2, "played": True}


def test_prefetch_skipped_when_backend_unconfigured():
    assert _run("prefetch_noop_when_backend_not_configured") == {"generateCalls": 0}


def test_generation_timing_logged():
    assert _run("generation_timing_is_logged") == {"started": True, "ready": True}


def test_rehearsal_prefetches_with_same_voice_and_options_as_playback():
    body = _between(REHEARSAL, "const prefetchNextPartnerLine = useCallback", 1100)
    assert "selectProvider(elevenLabsAvailable.current, resolution) !== 'elevenlabs'" in body
    assert "l.character === userCharacter" in body and "l.is_stage_direction" in body
    assert "prefetchSpeech(l.text, a.voiceId, { readerStyle, voiceSpeed: readerVoiceSpeed })" in body
    assert "playSpeech(text, assignment.voiceId, {\n              readerStyle,\n              voiceSpeed: readerVoiceSpeed," in REHEARSAL
    assert REHEARSAL.count("prefetchNextPartnerLine(") == 3  # speakLine + user turn + first user line


# ─── Fixed waits in the turn pipeline ─────────────────────────────────

def test_partner_line_start_delay_reduced():
    adv = _between(REHEARSAL, "const advanceToNextLine = useCallback", 3800)
    assert "}, 150);" in adv and "}, 500);" not in adv


def test_post_playback_advance_delay_reduced():
    body = _between(REHEARSAL, "const safeAdvance = () =>", 900)
    assert "}, 50);" in body and "}, 300);" not in body


def test_stop_settle_delay_only_when_audio_was_playing():
    body = _between(REHEARSAL, "// Stop any existing speech first", 500)
    assert "Speech.isSpeakingAsync()" in body
    assert "if (hadActiveAudio) await new Promise(resolve => setTimeout(resolve, 100));" in body


def test_auto_start_mic_delay_reduced_and_permission_policy_kept():
    body = _between(REHEARSAL, "// Auto-start listening when it's the user's turn", 900)
    assert "}, 250);" in body
    assert "!speechPermissionDeniedRef.current" in body


# ─── Duplicate turns / mic responsiveness ─────────────────────────────

def test_user_line_completes_once_per_line():
    body = _between(REHEARSAL, "const onUserLineDone = (", 700)
    assert "if (userLineDoneRef.current === currentLineIndexRef.current) return;" in body
    assert "userLineDoneRef.current = currentLineIndexRef.current;" in body
    assert "userLineDoneRef.current = -1;" in _between(REHEARSAL, "const startRehearsal = () =>", 900)
    res = _between(REHEARSAL, "useSpeechRecognitionEvent('result'", 1400)
    assert "userLineDoneRef.current !== currentLineIndexRef.current" in res


def test_mic_start_is_guarded_without_optimistic_listening_state():
    body = _between(REHEARSAL, "const startListening = async () =>", 1600)
    assert "if (micStartingRef.current || isMicStartPending()) return;" in body
    assert body.index("ensureSpeechPermission()") < body.index("micPendingRef.current = true;") < body.index("ExpoSpeechRecognitionModule.start(")
    # isListening stays event-driven: an optimistic true->false flip on a failed
    # start would re-trigger the auto-start effect in a loop.
    assert "setIsListening(true)" not in body
    assert "micStartingRef.current = false;" in body[body.index("finally"):]
    assert "micPendingRef.current = false;" in body[body.index("catch"):]
    pending = _between(REHEARSAL, "const isMicStartPending = () =>", 200)
    assert "< 3000" in pending  # a lost native event cannot block the mic forever
    assert "micPendingRef.current = false;" in _between(REHEARSAL, "useSpeechRecognitionEvent('start'", 300)
    assert "micPendingRef.current = false;" in _between(REHEARSAL, "useSpeechRecognitionEvent('error'", 700)


def test_stale_end_event_ignored_while_start_pending():
    body = _between(REHEARSAL, "useSpeechRecognitionEvent('end'", 600)
    assert "if (isMicStartPending())" in body
    assert body.index("SPEECH_STALE_END_IGNORED") < body.index("setIsListening(false);")


# ─── Diagnostics ──────────────────────────────────────────────────────

def test_turn_timing_events_present():
    for ev in ["REHEARSAL_TURN_STARTED", "MICROPHONE_READY", "MICROPHONE_REARMED", "SPEECH_FINALIZED",
               "RESPONSE_SELECTED", "AUDIO_PLAYBACK_STARTED", "AUDIO_PLAYBACK_FINISHED", "REHEARSAL_TURN_ERROR"]:
        assert ev in REHEARSAL, ev
    assert "TTS_REQUEST_STARTED" in SERVICE and "generateMs" in SERVICE


def test_timing_logs_never_include_transcripts_or_line_text():
    for m in re.finditer(r"logTiming\('([A-Z_]+)', \{(.*?)\}\)", REHEARSAL, re.S):
        payload = m.group(2)
        for banned in ["transcript", "safeTranscript", "text", "recognizedText"]:
            assert not re.search(rf"\b{banned}\b", payload), (m.group(1), banned)


# ─── Scene Partner ────────────────────────────────────────────────────

def test_scene_partner_immediate_timing_is_zero():
    assert "?.delay ?? 1000" in SCENE and "?.delay || 1000" not in SCENE
    assert "{ id: 'immediate', label: 'Immediate', delay: 0 }" in SCENE


def test_scene_partner_continue_double_tap_does_not_queue_two_advances():
    body = _between(SCENE, "const handleContinue = () =>", 600)
    assert body.index("if (continuePendingRef.current) return;") < body.index("advanceTo(")
    assert body.index("if (timerRef.current) clearTimeout(timerRef.current);") < body.index("setTimeout(")
    assert "continuePendingRef.current = false;" in _between(SCENE, "const advanceTo = useCallback", 120)
    for fn in ["const handlePause = () =>", "const handleBackToSetup = () =>"]:
        assert "continuePendingRef.current = false;" in _between(SCENE, fn, 200), fn


# ─── Release isolation ────────────────────────────────────────────────

def test_test_branch_version_code_above_pending_release():
    cfg = json.loads((FRONTEND / "app.json").read_text())["expo"]
    assert cfg["version"] == "1.1.1"
    assert cfg["android"]["versionCode"] == 1150  # EAS local auto-increment -> 1151


# ─── 2026-10-15 stability pass ────────────────────────────────────────

def test_user_line_done_ignored_while_paused():
    # advanceToNextLine returns early when paused; completing would strand the turn in 'waiting'.
    body = _between(REHEARSAL, "const onUserLineDone = (", 500)
    assert body.index("if (isPaused) return;") < body.index("userLineDoneRef.current = currentLineIndexRef.current;")
    auto = _between(REHEARSAL, "// Auto-start listening when it's the user's turn", 1200)
    assert "[state, speechRecognitionAvailable, autoAdvanceEnabled, isListening, isPaused]" in auto


def test_scene_partner_advance_reads_latest_queue():
    # handleStart schedules advanceTo(1) before setQueue re-renders; it must not see the old queue.
    adv = _between(SCENE, "const advanceTo = useCallback", 1000)
    assert "const queue = queueRef.current;" in adv
    assert "}, [speakLine, selectedTiming]);" in adv
    start = _between(SCENE, "const handleStart = () =>", 300)
    assert start.index("queueRef.current = q;") < start.index("setQueue(q);")
