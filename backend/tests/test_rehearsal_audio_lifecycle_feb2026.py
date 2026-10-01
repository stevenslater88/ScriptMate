"""
Regression — Rehearsal audio-race on async playSpeech() (Feb-2026)
===================================================================

Locks the 1.0.65 physical bug repair: `playSpeech()` can resolve
AFTER the screen has unmounted or `rehearsalFinish()` has run,
leaving an orphaned Audio.Sound playing after navigation.

The fix uses:
  * `isMountedRef` — set `false` only on unmount
  * `playbackGenerationRef` — monotonic counter bumped by unmount,
    `rehearsalFinish`, and pause. Each `speakLine` captures its
    `generationAtStart` before awaiting `playSpeech`, and discards
    the resolved sound if the generation has advanced.

Pause→Resume continues to work: pause bumps the generation (so the
in-flight sound is dropped), resume calls `speakLine` fresh which
captures a NEW generationAtStart.

These tests assert the SOURCE still contains the required guards.
Behaviour-level tests require a React Native host and are covered
by the physical build QA pass that reported the fix green.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REHEARSAL = ROOT / "frontend" / "app" / "rehearsal" / "[id].tsx"


def _src() -> str:
    return REHEARSAL.read_text()


# ─── Guard 1: lifecycle refs are declared ─────────────────────────────


def test_isMountedRef_is_declared():
    src = _src()
    assert re.search(
        r"const\s+isMountedRef\s*=\s*useRef\s*\(\s*true\s*\)", src
    ), "Rehearsal must declare `isMountedRef = useRef(true)` for lifecycle guard"


def test_playbackGenerationRef_is_declared():
    src = _src()
    assert re.search(
        r"const\s+playbackGenerationRef\s*=\s*useRef\s*\(\s*0\s*\)", src
    ), "Rehearsal must declare `playbackGenerationRef = useRef(0)`"


# ─── Guard 2: speakLine captures generation BEFORE awaiting playSpeech ─


def test_speakLine_captures_generation_before_playSpeech():
    src = _src()
    # Isolate the elevenlabs branch in speakLine.
    start = src.find("await playSpeech(text, assignment.voiceId")
    assert start > 0, "cannot locate playSpeech call site"
    # The `generationAtStart` capture must appear in the ~400 chars
    # preceding the await.
    window = src[max(0, start - 1000):start]
    assert "generationAtStart" in window, (
        "speakLine must capture `generationAtStart = "
        "playbackGenerationRef.current` BEFORE awaiting playSpeech"
    )


def test_speakLine_discards_stale_sound_after_await():
    src = _src()
    start = src.find("await playSpeech(text, assignment.voiceId")
    end = src.find("activeElevenLabsSoundRef.current = sound", start)
    assert start > 0 and end > start
    guard_region = src[start:end]
    # Must check both unmount AND generation advancement.
    assert "!isMountedRef.current" in guard_region
    assert "playbackGenerationRef.current !== generationAtStart" in guard_region
    # Must stop + unload the sound before returning.
    assert "stopAsync" in guard_region
    assert "unloadAsync" in guard_region
    # Must emit a diagnostic so physical QA can see the discard.
    assert "ELEVENLABS_STALE_SOUND_DISCARDED" in guard_region


# ─── Guard 3: unmount cleanup invalidates the pending playback ────────


def test_unmount_cleanup_sets_isMountedRef_false_and_bumps_generation():
    src = _src()
    # Find the FIRST useEffect cleanup return that references
    # activeElevenLabsSoundRef — this is the unmount cleanup.
    marker = "activeElevenLabsSoundRef.current = null"
    idx = src.find(marker)
    assert idx > 0
    # Look at the 500 chars BEFORE this marker — the cleanup body.
    region = src[max(0, idx - 500):idx + 300]
    assert "isMountedRef.current = false" in region, (
        "unmount cleanup must set isMountedRef.current = false"
    )
    assert "playbackGenerationRef.current" in region, (
        "unmount cleanup must bump playbackGenerationRef so in-flight "
        "playSpeech is invalidated"
    )


# ─── Guard 4: rehearsalFinish bumps the generation ────────────────────


def test_rehearsalFinish_bumps_generation_at_start():
    src = _src()
    start = src.find("finalizeRehearsal = useCallback")
    assert start > 0
    # Within the first ~1500 chars of finalize body, the bump must occur
    # BEFORE the audio cleanup logs.
    bump_idx = src.find("playbackGenerationRef.current += 1", start)
    audio_cleanup_idx = src.find("audio-cleanup-start", start)
    assert bump_idx > 0 and audio_cleanup_idx > 0
    assert bump_idx < audio_cleanup_idx, (
        "finalizeRehearsal must bump playbackGenerationRef BEFORE the "
        "'audio-cleanup-start' log so a sound resolving after that log "
        "is discarded by the stale-check in speakLine"
    )


# ─── Guard 5: Pause bumps generation; Resume does NOT disable playback ─


def test_pause_bumps_generation_but_does_not_permanently_disable():
    src = _src()
    toggle_start = src.find("const togglePause")
    assert toggle_start > 0
    toggle_end = src.find("\n  };", toggle_start)
    body = src[toggle_start:toggle_end]
    # The pause branch (setIsPaused(true)) must bump the generation.
    paused_branch = body[body.find("setIsPaused(true)"):]
    assert "playbackGenerationRef.current += 1" in paused_branch, (
        "pause branch of togglePause must bump playbackGenerationRef"
    )
    # The resume branch must NOT bump; it just calls speakLine, which
    # captures its own fresh generationAtStart.
    resume_branch = body[body.find("setIsPaused(false)"):body.find("} else {")]
    assert "playbackGenerationRef.current += 1" not in resume_branch, (
        "resume branch must NOT bump generation — it only re-triggers "
        "speakLine which captures its own fresh generationAtStart"
    )
    # No permanent cancel-flag reference anywhere.
    assert "cancelledRef" not in src, (
        "must NOT use a permanent cancelledRef — Pause→Resume must stay "
        "functional; use the generation counter instead"
    )


# ─── Guard 6: Existing cleanup still stops/unloads a registered sound ─


def test_cleanup_still_stops_registered_sound():
    """The existing paths that read `activeElevenLabsSoundRef.current`
    and call `stopAsync`+`unloadAsync` must remain intact — the new
    generation guard addresses the in-flight race, not the
    already-registered sound."""
    src = _src()
    # Count the number of distinct call sites that stop+unload the
    # active sound. There should be at least 3 (unmount, finalize,
    # stopElevenLabsSound helper used by pause and speakLine).
    sound_null_count = src.count("activeElevenLabsSoundRef.current = null")
    assert sound_null_count >= 3, (
        f"expected at least 3 cleanup sites, found {sound_null_count}"
    )


# ─── Guard 7: Expo Speech cleanup still fires ─────────────────────────


def test_expo_speech_cleanup_intact():
    src = _src()
    assert "Speech.stop()" in src
    # finalizeRehearsal still awaits Speech.stop
    f_idx = src.find("finalizeRehearsal = useCallback")
    region = src[f_idx:f_idx + 2000]
    assert "Speech.stop()" in region


# ─── Guard 8: Stale playback cannot overwrite activeElevenLabsSoundRef ─


def test_stale_check_is_before_ref_assignment():
    src = _src()
    await_idx = src.find("await playSpeech(text, assignment.voiceId")
    guard_idx = src.find("playbackGenerationRef.current !== generationAtStart", await_idx)
    ref_assign_idx = src.find("activeElevenLabsSoundRef.current = sound", await_idx)
    assert await_idx > 0 and guard_idx > 0 and ref_assign_idx > 0
    assert await_idx < guard_idx < ref_assign_idx, (
        "stale-generation guard must sit BETWEEN the await and the "
        "activeElevenLabsSoundRef.current assignment, so a stale sound "
        "never gets registered"
    )


# ─── Guard 9: elevenLabsService.ts was NOT modified by this ticket ────


def test_elevenLabsService_still_has_proxy_and_bearer_contract_unchanged():
    """Issue 2 is a Rehearsal-local fix; the TTS service and its
    bearer flow must remain untouched."""
    svc = (ROOT / "frontend" / "services" / "elevenLabsService.ts").read_text()
    assert "ensureTtsBearerToken" in svc
    assert "/api/tts/elevenlabs/generate" in svc
    assert "Authorization" in svc  # bearer still attached
