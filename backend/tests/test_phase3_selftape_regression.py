"""Phase 3 Self-Tape regression suite.

Locks five independent physical Samsung SM-S918B failures on SDK 54 /
Fabric / Android 16:

FAILURE 1 — recording save
  root cause: `expo-file-system` v19 (SDK 54) turned the top-level legacy
  API into a deprecation shim that THROWS AT RUNTIME. Every legacy call
  (`getInfoAsync`, `copyAsync`, `makeDirectoryAsync`, `deleteAsync`,
  `documentDirectory`, `getFreeDiskStorageAsync`) must be imported from
  `expo-file-system/legacy` instead of the top-level `expo-file-system`.
  Fix: change the import in `services/selfTapeStorage.ts`.

FAILURE 4 — enable teleprompter (Slider mount)
  root cause: `@react-native-community/slider` v4.5.x supports OLD arch
  only. On SDK 54 / Fabric it silently native-crashes the moment the
  Slider component mounts. Fix: use a Fabric-safe segmented TouchableOpacity
  speed control (values 1..5).

FAILURE 5 — Start Recording with teleprompter enabled
  root cause: driving the teleprompter scroll with a native-driver
  `Animated.timing` on an `Animated.multiply` translateY transform inside
  `<Animated.ScrollView>`, started at the SAME tick CameraView begins
  MediaCodec/MediaMuxer capture, crashed Fabric on Android 16. Two native
  transactional systems (Animated native driver + camera capture pipeline)
  contended on the render thread in the same commit as a Fabric prop flip
  (scrollEnabled true→false). The mount-time interpolation guard from a
  previous fix was not sufficient — the crash was on animation START, not
  on mount.
  Fix: replace the native Animated teleprompter driver with a JS
  `requestAnimationFrame` loop calling `scrollViewRef.scrollTo({
  animated:false })`. No native Animated node is attached to the scroll
  surface anymore, so recordAsync no longer contends with a native
  animation transaction.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend")


def _read(rel: str) -> str:
    return (FRONTEND / rel).read_text()


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE 1 — Recording save
# ─────────────────────────────────────────────────────────────────────────────

def test_selftape_storage_imports_from_legacy_submodule() -> None:
    """The storage service must import from `expo-file-system/legacy` in
    SDK 54+, because the top-level legacy shim throws at runtime."""
    src = _read("services/selfTapeStorage.ts")
    assert "from 'expo-file-system/legacy'" in src, (
        "services/selfTapeStorage.ts must import from "
        "'expo-file-system/legacy' — the top-level module's legacy helpers "
        "(getInfoAsync/copyAsync/makeDirectoryAsync/deleteAsync/"
        "documentDirectory/getFreeDiskStorageAsync) THROW AT RUNTIME on "
        "SDK 54+. This caused the Samsung SM-S918B recording-save failure."
    )
    forbidden = re.search(
        r"^\s*import\s+\*\s+as\s+FileSystem\s+from\s+['\"]expo-file-system['\"]\s*;",
        src, re.MULTILINE,
    )
    assert forbidden is None, (
        "Do NOT use `import * as FileSystem from 'expo-file-system'` in "
        "selfTapeStorage.ts on SDK 54 — those methods throw at runtime."
    )


def test_expo_file_system_legacy_submodule_is_available() -> None:
    """Guard the installed expo-file-system package exposes the /legacy path."""
    legacy_entry = FRONTEND / "node_modules" / "expo-file-system" / "legacy.ts"
    legacy_dir = FRONTEND / "node_modules" / "expo-file-system" / "src" / "legacy"
    assert legacy_entry.exists() or legacy_dir.exists(), (
        "expo-file-system/legacy submodule is missing — the selfTapeStorage "
        "import will fail to resolve at bundle time."
    )


def test_selftape_storage_still_calls_the_expected_legacy_helpers() -> None:
    """The storage service must still call the legacy helpers we depend on."""
    src = _read("services/selfTapeStorage.ts")
    required = [
        "FileSystem.documentDirectory",
        "FileSystem.getInfoAsync",
        "FileSystem.makeDirectoryAsync",
        "FileSystem.copyAsync",
        "FileSystem.deleteAsync",
        "FileSystem.getFreeDiskStorageAsync",
    ]
    for symbol in required:
        assert symbol in src, (
            f"selfTapeStorage.ts must still call {symbol} — removing it "
            f"means the save/library/delete flow will break"
        )


def test_save_recording_verifies_source_then_copies_then_verifies_destination() -> None:
    """saveRecording ordering must be: verify src -> ensureDirectory ->
    copyAsync -> verify dest -> setItem."""
    src = _read("services/selfTapeStorage.ts")
    m = re.search(
        r"export\s+const\s+saveRecording\s*=\s*async[^{]+\{(.*?)\n\};",
        src, re.DOTALL,
    )
    assert m, "saveRecording function not found — refactor detected"
    body = m.group(1)

    idx_check_src = body.find("Verify source file exists")
    idx_ensure_dir = body.find("ensureDirectory()")
    idx_copy = body.find("FileSystem.copyAsync")
    idx_check_dest = body.find("File copy appeared to succeed")
    idx_setitem = body.find("AsyncStorage.setItem")

    assert 0 <= idx_check_src < idx_ensure_dir < idx_copy < idx_check_dest < idx_setitem, (
        "saveRecording ordering regression — the flow must be: "
        "verify src -> ensureDirectory -> copyAsync -> verify dest -> setItem"
    )


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE 4 — Toggling "Enable Teleprompter" crashes the app (Slider mount)
# ─────────────────────────────────────────────────────────────────────────────

def test_record_screen_does_not_import_community_slider() -> None:
    """`@react-native-community/slider` v4.5.x is OLD arch only and native-
    crashes on Fabric (SDK 54). record.tsx must NOT import from that pkg."""
    src = _read("app/selftape/record.tsx")
    forbidden = re.compile(
        r"^\s*import\s+.*Slider.*from\s+['\"]@react-native-community/slider['\"]",
        re.MULTILINE,
    )
    assert not forbidden.search(src), (
        "record.tsx must not import Slider from '@react-native-community/"
        "slider'. That package's v4.5.x is old-arch-only and crashes on the "
        "Fabric renderer used by SDK 54."
    )


def test_record_screen_uses_segmented_speed_control() -> None:
    """Fabric-safe replacement: a segmented speed control 1..5 rendered via
    TouchableOpacity."""
    src = _read("app/selftape/record.tsx")
    pattern = re.compile(
        r"\[1,\s*2,\s*3,\s*4,\s*5\]\.map\(\s*\(speed\)\s*=>\s*\(\s*"
        r"<TouchableOpacity",
        re.DOTALL,
    )
    assert pattern.search(src), (
        "Expected a segmented speed control [1,2,3,4,5].map(...) rendering "
        "<TouchableOpacity> per value. This replaces the crashing Slider."
    )


def test_toggle_teleprompter_still_toggles_state_only() -> None:
    """toggleTeleprompter must ONLY flip teleprompterActive + call
    pauseTeleprompter when disabling. It MUST NOT start scrolling as a
    side effect."""
    src = _read("app/selftape/record.tsx")
    m = re.search(
        r"const\s+toggleTeleprompter\s*=\s*\(\)\s*=>\s*\{(.*?)\n\s{2}\};",
        src, re.DOTALL,
    )
    assert m, "toggleTeleprompter function not found — refactor detected"
    body = m.group(1)
    assert "setTeleprompterActive(newState)" in body
    assert "pauseTeleprompter()" in body
    assert "startTeleprompter()" not in body, (
        "toggleTeleprompter must not auto-start scrolling on enable — "
        "only startRecording() drives the teleprompter lifecycle."
    )


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE 5 — Start Recording with teleprompter enabled crashed the app
# ─────────────────────────────────────────────────────────────────────────────
#
# The Phase 3 Failure 5 fix moved the teleprompter scroll off the native
# Animated driver entirely. These tests lock the JS-driven implementation
# and forbid the old native-driver pattern from returning.

def test_teleprompter_scroll_is_js_driven_not_animated() -> None:
    """The teleprompter scroll MUST be driven by requestAnimationFrame +
    ScrollView.scrollTo({animated:false}), not by a native Animated.timing.

    Rationale: on Android 16 / Fabric, starting a native Animated timing
    at the same tick CameraView begins MediaCodec/MediaMuxer capture
    caused an immediate app crash (Samsung SM-S918B, build 1110-QA)."""
    src = _read("app/selftape/record.tsx")

    # 1. Must use requestAnimationFrame to drive the scroll.
    assert "requestAnimationFrame(step)" in src, (
        "The teleprompter scroll must use requestAnimationFrame in a JS "
        "loop (runTeleprompterLoop). No native Animated node may drive "
        "the scroll on Fabric/Android 16."
    )
    # 2. Must call scrollTo with animated:false to advance the view.
    scrollto_pattern = re.compile(
        r"scrollViewRef\.current\?\.scrollTo\(\s*\{\s*y:\s*[^,]+,\s*"
        r"animated:\s*false\s*\}\s*\)",
        re.DOTALL,
    )
    assert scrollto_pattern.search(src), (
        "Expected scrollViewRef.current?.scrollTo({ y: ..., animated: false }) "
        "inside the teleprompter loop — this is the JS-driven advance."
    )
    # 3. RAF handle ref must exist and be cancellable.
    assert "teleprompterRafId" in src, (
        "Expected a teleprompterRafId ref to hold the requestAnimationFrame "
        "handle so pauseTeleprompter can cancelAnimationFrame it."
    )
    assert "cancelAnimationFrame(teleprompterRafId.current)" in src, (
        "pauseTeleprompter/stopTeleprompterLoop must cancelAnimationFrame "
        "the RAF handle — otherwise the loop keeps running after stop."
    )


def test_no_native_driver_animated_timing_on_teleprompter_anim() -> None:
    """The forbidden crash pattern must not return: a native-driver
    Animated.timing driving a variable named teleprompterAnim."""
    src = _read("app/selftape/record.tsx")
    forbidden_patterns = [
        # Old ref + composite animation refs
        r"new\s+Animated\.Value\(0\)\s*\)\s*\.current;\s*\n\s*const\s+teleprompterAnimation",
        # Old Animated.timing driving teleprompterAnim
        r"Animated\.timing\(\s*teleprompterAnim",
        # Old Animated.multiply used for teleprompter transform
        r"Animated\.multiply\(\s*teleprompterAnim",
    ]
    for pat in forbidden_patterns:
        assert not re.search(pat, src, re.DOTALL), (
            f"Forbidden native-driver teleprompter pattern found: /{pat}/. "
            f"This is exactly the code that crashed on Samsung SM-S918B / "
            f"Android 16 / Fabric at Start Recording."
        )


def test_scroll_container_is_plain_scrollview_not_animated() -> None:
    """The teleprompter ScrollView must NOT be an Animated.ScrollView, and
    its children must NOT be wrapped in an Animated.View with a
    translateY transform. Both patterns caused native crashes on Fabric."""
    src = _read("app/selftape/record.tsx")

    # 1. The scroll view for the script must be a plain <ScrollView>.
    m = re.search(
        r"<ScrollView[^>]*ref=\{scrollViewRef\}[^>]*>",
        src, re.DOTALL,
    )
    assert m, (
        "Expected a plain <ScrollView ref={scrollViewRef} ...> for the "
        "teleprompter script container."
    )

    # 2. There must be no <Animated.ScrollView with ref={scrollViewRef}>.
    forbidden = re.search(
        r"<Animated\.ScrollView[^>]*ref=\{scrollViewRef\}",
        src, re.DOTALL,
    )
    assert forbidden is None, (
        "The teleprompter must use a plain ScrollView, not Animated.ScrollView. "
        "Animated.ScrollView + native-driver child transform crashed Fabric."
    )

    # 3. No teleprompter translateY transform anywhere in the JSX.
    forbidden_transform = re.search(
        r"transform:\s*\[\s*\{\s*translateY:\s*teleprompter",
        src,
    )
    assert forbidden_transform is None, (
        "No `transform: [{ translateY: teleprompter... }]` should exist. "
        "The teleprompter scrolls the ScrollView itself via scrollTo now."
    )


def test_pause_stops_raf_loop_and_clears_playing_state() -> None:
    """pauseTeleprompter must cancel the RAF loop and clear the playing state."""
    src = _read("app/selftape/record.tsx")
    m = re.search(
        r"const\s+pauseTeleprompter\s*=\s*\(\)\s*=>\s*\{(.*?)\n\s{2}\};",
        src, re.DOTALL,
    )
    assert m, "pauseTeleprompter function not found — refactor detected"
    body = m.group(1)
    assert "stopTeleprompterLoop()" in body, (
        "pauseTeleprompter must call stopTeleprompterLoop() to cancel the "
        "requestAnimationFrame handle."
    )
    assert "setTeleprompterPlaying(false)" in body


def test_start_recording_path_intact_and_fabric_safe() -> None:
    """Guard the exact Start Recording flow that crashed on build 1110.

    Contract:
      * startRecording() still calls recordAsync + starts the duration timer.
      * When teleprompterActive is true, startTeleprompter() is invoked.
      * The Fabric-safe (JS RAF) driver must be in place so
        setTeleprompterPlaying(true) does not attach any native animation
        transaction to the render pipeline while camera capture starts.
    """
    src = _read("app/selftape/record.tsx")

    m = re.search(
        r"const\s+startRecording\s*=\s*async[^{]+\{(.*?)\n\s{2}\};",
        src, re.DOTALL,
    )
    assert m, "startRecording function not found — refactor detected"
    body = m.group(1)
    assert "cameraRef.current.recordAsync(" in body, (
        "startRecording must still invoke cameraRef.current.recordAsync(...)"
    )
    assert "setIsRecording(true)" in body
    assert "recordingTimer.current = setInterval" in body
    assert "if (teleprompterActive)" in body
    assert "startTeleprompter()" in body

    # Fabric-safe guard: no native Animated.timing on teleprompterAnim
    # started inside startRecording's flow.
    assert "Animated.timing(teleprompterAnim" not in src, (
        "Fabric crash pattern re-introduced — the teleprompter must not be "
        "driven by Animated.timing(teleprompterAnim, ...) anymore."
    )


def test_stop_and_error_paths_cancel_the_raf_loop() -> None:
    """When recording stops (normal completion or error), the RAF loop
    must be cancelled so no zombie scroll-driver keeps running."""
    src = _read("app/selftape/record.tsx")

    # Normal completion (video?.uri branch)
    completion = re.search(
        r"if\s*\(video\?\.uri\)\s*\{(.*?)setProcessingVideo\(true\);",
        src, re.DOTALL,
    )
    assert completion, "recordAsync completion branch not found"
    assert "stopTeleprompterLoop()" in completion.group(1), (
        "The recordAsync completion path must call stopTeleprompterLoop() "
        "to cancel the RAF handle."
    )

    # Error branch
    error = re.search(
        r"catch\s*\(error\)\s*\{(.*?)\n\s+Alert\.alert",
        src, re.DOTALL,
    )
    assert error, "startRecording catch branch not found"
    assert "stopTeleprompterLoop()" in error.group(1), (
        "The startRecording catch path must call stopTeleprompterLoop()."
    )


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE 6 — Enable Teleprompter still crashes on the c1f8a2d APK
# ─────────────────────────────────────────────────────────────────────────────
#
# Physical evidence (Samsung SM-S918B / Android 16, EAS build source
# 8f53b6d — same application code as c1f8a2d): tapping "Enable Teleprompter"
# on the recording screen crashes the app before recording starts.
#
# Hypothesis (SUPPORTED, not yet PROVEN): the crash is caused by mounting
# `<Animated.View style={{ opacity: controlsOpacity }}>` as the FIRST-EVER
# AnimatedProps consumer on this screen during a user-triggered Fabric
# commit. AnimatedProps.__attach runs from useInsertionEffect during the
# same commit that inserts the view, and #connectAnimatedView →
# findNodeHandle can throw before the Fabric shadow view is finalized on
# SDK 54 / New Architecture / Android 16.
#
# Diagnostic experiment: drive `controlsOpacity` via the JS driver
# (useNativeDriver:false) so no native NativeAnimatedNodesManager
# connection is performed for this Value. If the physical Enable test
# passes, the hypothesis is supported.

def test_controls_opacity_animations_use_js_driver_not_native() -> None:
    """Phase 3 Failure 6 diagnostic: both `controlsOpacity` animation sites
    must run on the JS driver (`useNativeDriver: false`) so that mounting
    the conditionally-rendered controls-overlay <Animated.View> does not
    trigger a native connect during the enable-transition Fabric commit."""
    src = _read("app/selftape/record.tsx")

    # 1. Both Animated.timing sites on controlsOpacity must be present and
    #    set useNativeDriver:false.
    pattern = re.compile(
        r"Animated\.timing\(\s*controlsOpacity\s*,\s*\{[^}]*"
        r"useNativeDriver:\s*false",
        re.DOTALL,
    )
    matches = pattern.findall(src)
    assert len(matches) == 2, (
        f"Expected exactly 2 Animated.timing(controlsOpacity, ...) sites "
        f"with useNativeDriver:false (hideControlsWithDelay + "
        f"showControlsAnimated). Found {len(matches)}."
    )

    # 2. No Animated.timing(controlsOpacity, ...) may use useNativeDriver:true.
    forbidden = re.compile(
        r"Animated\.timing\(\s*controlsOpacity\s*,\s*\{[^}]*"
        r"useNativeDriver:\s*true",
        re.DOTALL,
    )
    assert not forbidden.search(src), (
        "controlsOpacity must NOT use useNativeDriver:true during the "
        "Failure 6 diagnostic experiment — the whole point is to remove "
        "native NativeAnimatedNodesManager involvement for this Value."
    )


def test_no_other_useNativeDriver_true_was_introduced_by_experiment() -> None:
    """Guard: the diagnostic must NOT re-introduce useNativeDriver:true
    anywhere else in record.tsx. There should be zero uses of
    `useNativeDriver: true` in this file after the experiment."""
    src = _read("app/selftape/record.tsx")
    # Match a real code occurrence (colon + optional space + true, ignoring
    # any code inside string literals). Comments are stripped from
    # consideration by matching only lines that don't start with `//`.
    code_lines = [ln for ln in src.splitlines() if not ln.lstrip().startswith("//")]
    joined = "\n".join(code_lines)
    hits = re.findall(r"useNativeDriver:\s*true", joined)
    assert len(hits) == 0, (
        f"Found {len(hits)} `useNativeDriver: true` code occurrence(s) in "
        f"record.tsx. The Failure 6 experiment requires the ONLY Animated "
        f"values on this screen (controlsOpacity) to be JS-driven."
    )


def test_teleprompter_overlay_structure_unchanged_by_experiment() -> None:
    """The overlay conditional gate and the Animated.View driving
    `controlsOpacity` must be intact — the experiment only changes the
    animation driver, not the JSX shape."""
    src = _read("app/selftape/record.tsx")

    # Conditional gate must still be exactly this shape.
    assert "{teleprompterActive && showControls && (" in src, (
        "Failure 6 experiment must NOT alter the "
        "`{teleprompterActive && showControls && (...)}` gate."
    )
    # Animated.View consumer of controlsOpacity must still exist.
    consumer = re.search(
        r"<Animated\.View\s+style=\{\s*\[\s*styles\.teleprompterControls\s*,\s*"
        r"\{\s*opacity:\s*controlsOpacity\s*\}\s*\]\s*\}",
        src, re.DOTALL,
    )
    assert consumer, (
        "The <Animated.View> whose `opacity` prop consumes controlsOpacity "
        "must remain intact — the experiment changes ONLY the driver on "
        "the Animated.timing calls, not the JSX structure."
    )


def test_teleprompter_uses_pxPerSecond_not_broken_speedMultiplier_60() -> None:
    """The old formula (`speedMultiplier * 60`) was 2–12 minutes for
    typical scripts. The new formula must express speed as px/s."""
    src = _read("app/selftape/record.tsx")

    forbidden = re.compile(
        r"speedMultiplier\s*=\s*\[0\.2,\s*0\.4,\s*0\.6,\s*0\.8,\s*1\.0\]"
    )
    assert not forbidden.search(src), (
        "The old speedMultiplier [0.2, 0.4, 0.6, 0.8, 1.0] pattern must be "
        "removed — it produced unusably slow teleprompter durations."
    )

    px_pattern = re.compile(
        r"pxPerSecond\s*=\s*\[30,\s*60,\s*90,\s*120,\s*150\]"
    )
    matches = px_pattern.findall(src)
    assert len(matches) >= 3, (
        f"Expected pxPerSecond=[30,60,90,120,150] in all three teleprompter "
        f"sites (startTeleprompter, runTeleprompterLoop, handleSpeedChange). "
        f"Found {len(matches)}."
    )


def test_teleprompter_duration_produces_sane_wall_clock_time() -> None:
    """Pure-math sanity check on the new px/s array."""
    lines = 32
    font_size = 18
    speed = 3
    total_scroll_height = lines * (font_size + 20) * 2
    px_per_second = [30, 60, 90, 120, 150][speed - 1]
    duration_s = total_scroll_height / px_per_second
    assert duration_s < 60, (
        f"32-line 18pt scene at speed 3 = {duration_s:.1f}s — expected <60s."
    )
    slowest_s = total_scroll_height / 30
    assert slowest_s < 180, (
        f"even at speed 1, a 32-line scene must not exceed 3 minutes; "
        f"got {slowest_s:.1f}s"
    )


# ─────────────────────────────────────────────────────────────────────────────
# FAILURE 6 (Save path) — Teleprompter Mode routed users into
# app/selftape/teleprompter.tsx (the "Teleprompter Mode NEW" card at
# app/selftape/index.tsx:151), which imported the deprecated top-level
# `expo-file-system` and called FileSystem.getInfoAsync directly BEFORE
# invoking selfTapeStorage.saveRecording(). On SDK 54 this throws the
# top-level deprecation error and Save fails with the exact user-visible
# alert at teleprompter.tsx:426:
#     "Save Failed" / "Could not save: Method getInfoAsync imported
#      from 'expo-file-system' is deprecated..."
# Fix: change teleprompter.tsx's import to the /legacy submodule so the
# same helpers work without triggering the SDK 54 deprecation shim.
# ─────────────────────────────────────────────────────────────────────────────

def test_selftape_teleprompter_imports_from_legacy_submodule() -> None:
    """The active Teleprompter-Mode save path (teleprompter.tsx) MUST import
    from `expo-file-system/legacy` — the top-level shim throws at runtime
    on SDK 54+."""
    src = _read("app/selftape/teleprompter.tsx")
    assert "from 'expo-file-system/legacy'" in src, (
        "app/selftape/teleprompter.tsx must import from "
        "'expo-file-system/legacy'. On SDK 54+, the top-level helpers "
        "(getInfoAsync, copyAsync, ...) throw the deprecation error that "
        "was surfaced to users as 'Save Failed: Could not save: Method "
        "getInfoAsync imported from \"expo-file-system\" is deprecated'."
    )


def test_selftape_teleprompter_does_not_import_deprecated_top_level_fs() -> None:
    """Guard against regressing back to the deprecated top-level import."""
    src = _read("app/selftape/teleprompter.tsx")
    forbidden = re.search(
        r"^\s*import\s+\*\s+as\s+FileSystem\s+from\s+['\"]expo-file-system['\"]\s*;",
        src, re.MULTILINE,
    )
    assert forbidden is None, (
        "app/selftape/teleprompter.tsx must not import from the "
        "deprecated top-level 'expo-file-system'. Use "
        "'expo-file-system/legacy' instead."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Shared: neither fix touched the working camera / recording path
# ─────────────────────────────────────────────────────────────────────────────

def test_camera_and_recording_flow_unchanged() -> None:
    """Recording contract intact: recordAsync usage, stopRecording,
    action-sheet trigger, retake reset."""
    src = _read("app/selftape/record.tsx")
    assert "cameraRef.current.recordAsync({" in src
    assert "cameraRef.current.stopRecording()" in src
    assert "setShowActionSheet(true)" in src
    assert "setRecordedVideoUri(null)" in src
    assert "setRecordingDuration(0)" in src


def test_selftape_hub_premium_gate_unchanged() -> None:
    """Phase 2/3 QA_PREMIUM propagation must still be wired."""
    src = _read("app/selftape/index.tsx")
    assert "useRevenueCat()" in src
    assert "router.push('/premium')" in src


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
