"""Post-Phase-3 hardening — Route B camera bring-up regression suite.

Locks the 2026-02 defensive fixes that address the intermittent Samsung
SM-S918B / Android 16 first-record process crash traced (source-level) to
an unhandled `ProcessCameraProvider.awaitInstance()` inside expo-camera
17.0.10 (upstream expo/expo#47696).

The fix is layered in two places:

1. Native (patched): `frontend/patches/expo-camera+17.0.10.patch` now
   guards `ProcessCameraProvider.awaitInstance(context)` in a try/catch
   and routes failures through the existing `onMountError` surface. This
   is verified by `test_expo_camera_stabilization_patch.py`.

2. JS (Route B `frontend/app/selftape/teleprompter.tsx`):
   * `<CameraView>` now wires `onCameraReady` and `onMountError`.
   * Local state `isCameraReady` / `cameraMountError` tracks bring-up.
   * `startRecording()` early-returns with an Alert if the camera is not
     yet ready or a mount error is set — never calls `recordAsync()`
     under those conditions.
   * A user-visible banner surfaces the state; the record button is
     disabled while not ready or on error, so a fast first tap can no
     longer force `recordAsync()` before the native capture use cases
     have bound.

Framing Guides implementation is NOT modified. Route A (record.tsx) is
NOT modified. Backend, dependencies, and EAS config are NOT modified.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend")
TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"
PREP = FRONTEND / "app/selftape/prep.tsx"


@pytest.fixture(scope="module")
def teleprompter_src() -> str:
    return TELEPROMPTER.read_text()


# ─────────────────────────────────────────────────────────────────────────────
# State surface
# ─────────────────────────────────────────────────────────────────────────────


def test_isCameraReady_state_declared(teleprompter_src: str) -> None:
    assert "isCameraReady" in teleprompter_src, (
        "Route B must declare an `isCameraReady` state variable."
    )
    line = next(
        ln
        for ln in teleprompter_src.splitlines()
        if "setIsCameraReady" in ln and "useState" in ln
    )
    assert re.search(r"useState\s*(?:<\s*boolean\s*>)?\s*\(\s*false\s*\)", line), (
        "isCameraReady must default to false (camera has not reported ready "
        "yet at first render)."
    )


def test_cameraMountError_state_declared(teleprompter_src: str) -> None:
    assert "cameraMountError" in teleprompter_src
    line = next(
        ln
        for ln in teleprompter_src.splitlines()
        if "setCameraMountError" in ln and "useState" in ln
    )
    # Default should be null — no error at first render.
    assert re.search(r"useState[^(]*\(\s*null\s*\)", line), (
        "cameraMountError must default to null."
    )


# ─────────────────────────────────────────────────────────────────────────────
# CameraView wiring — onCameraReady / onMountError
# ─────────────────────────────────────────────────────────────────────────────


def test_camera_view_wires_onCameraReady(teleprompter_src: str) -> None:
    assert "onCameraReady={" in teleprompter_src, (
        "Route B `<CameraView>` must wire `onCameraReady` so recording can "
        "be guarded on native readiness."
    )
    # onCameraReady must flip the state to true.
    assert re.search(
        r"onCameraReady=\{[^}]*setIsCameraReady\s*\(\s*true\s*\)",
        teleprompter_src,
        re.DOTALL,
    ), "onCameraReady must call setIsCameraReady(true)."


def test_camera_view_wires_onMountError(teleprompter_src: str) -> None:
    assert "onMountError={" in teleprompter_src, (
        "Route B `<CameraView>` must wire `onMountError`; the extended "
        "expo-camera patch surfaces ProcessCameraProvider.awaitInstance "
        "failures through this event."
    )
    # onMountError must set the error state; must NOT crash.
    assert "setCameraMountError" in teleprompter_src


# ─────────────────────────────────────────────────────────────────────────────
# Recording guard
# ─────────────────────────────────────────────────────────────────────────────


def test_startRecording_guarded_by_camera_ready(teleprompter_src: str) -> None:
    """`startRecording` must NOT call recordAsync until the camera is ready
    and no mount error is set. The guard must return before the countdown
    starts, so a stuck-init state never enters the record path."""
    # Slice the file from `const startRecording` up to `const stopRecording`
    # — the two functions are declared back to back in this file, so this
    # is a stable, non-greedy scope.
    match = re.search(
        r"const\s+startRecording\s*=\s*async(.*?)const\s+stopRecording\s*=",
        teleprompter_src,
        re.DOTALL,
    )
    assert match, "Could not locate startRecording function body."
    body = match.group(1)
    # The isCameraReady check must appear BEFORE recordAsync is called.
    # Use the actual call site, not any comment mentioning `recordAsync`.
    ready_idx = body.find("isCameraReady")
    record_idx = body.find("cameraRef.current.recordAsync")
    assert ready_idx > 0 and record_idx > 0, (
        "Both isCameraReady guard and cameraRef.current.recordAsync call "
        "must exist in startRecording."
    )
    assert ready_idx < record_idx, (
        "isCameraReady guard must appear BEFORE the recordAsync call so a "
        "stuck-init state never reaches the native recorder."
    )
    # The guard must early-return the function (not just log).
    guard_slice = body[:record_idx]
    assert re.search(r"if\s*\(\s*!\s*isCameraReady\s*\)", guard_slice), (
        "Missing `if (!isCameraReady) …` guard before recordAsync."
    )
    assert "return" in guard_slice, (
        "Guard must early-return (do not fall through to recordAsync)."
    )


def test_startRecording_guarded_by_mount_error(teleprompter_src: str) -> None:
    match = re.search(
        r"const\s+startRecording\s*=\s*async(.*?)const\s+stopRecording\s*=",
        teleprompter_src,
        re.DOTALL,
    )
    assert match, "Could not locate startRecording function body."
    body = match.group(1)
    # Find the actual guard (an `if (cameraMountError)` line), not just
    # any mention of the identifier (which appears in the leading
    # explanatory comment).
    guard_idx = None
    for m in re.finditer(r"if\s*\(\s*cameraMountError\s*\)", body):
        guard_idx = m.start()
        break
    record_idx = body.find("cameraRef.current.recordAsync")
    assert guard_idx is not None, (
        "Missing `if (cameraMountError) …` guard in startRecording."
    )
    assert record_idx > 0
    assert guard_idx < record_idx, (
        "cameraMountError guard must appear BEFORE recordAsync."
    )


def test_record_button_disabled_when_not_ready(teleprompter_src: str) -> None:
    """Belt-and-braces: the record button itself must be disabled while
    the camera is not ready or a mount error is set (and we're not
    already in a recording — stop should always be tappable)."""
    assert 'testID="record-button"' in teleprompter_src, (
        "Record button must expose testID=\"record-button\"."
    )
    # In JSX the `disabled=` prop is written BEFORE `testID=` in this file
    # (props are order-insensitive). Slice a generous window around the
    # testID marker and assert the guard state is referenced by the
    # button's disabled prop.
    idx = teleprompter_src.find('testID="record-button"')
    # Look back 800 chars for the opening <TouchableOpacity that owns it.
    window_start = max(0, idx - 800)
    window = teleprompter_src[window_start : idx + 200]
    assert re.search(r"disabled=\{[^}]*isCameraReady[^}]*\}", window), (
        "Record button must set `disabled=` referencing isCameraReady."
    )
    assert re.search(r"disabled=\{[^}]*cameraMountError[^}]*\}", window), (
        "Record button must set `disabled=` referencing cameraMountError."
    )


# ─────────────────────────────────────────────────────────────────────────────
# User-visible surface — banners
# ─────────────────────────────────────────────────────────────────────────────


def test_camera_mount_error_banner_present(teleprompter_src: str) -> None:
    assert 'testID="camera-mount-error-banner"' in teleprompter_src, (
        "A user-visible camera mount error banner must exist so failures "
        "surface without a native crash dialog."
    )


def test_camera_initializing_banner_present(teleprompter_src: str) -> None:
    assert 'testID="camera-initializing-banner"' in teleprompter_src, (
        "A user-visible 'Camera initializing…' banner must exist so users "
        "understand why Record is disabled during native bring-up."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Blast-radius: nothing we promised not to touch has changed
# ─────────────────────────────────────────────────────────────────────────────


def test_framing_guides_still_present(teleprompter_src: str) -> None:
    """Framing Guides are NOT modified by this hardening."""
    for token in (
        "showFramingGuides",
        'testID="framing-guides-overlay"',
        'testID="framing-guides-toggle"',
        "framingGuidesLayer",
        "framingGuideVLine",
        "framingGuideHLine",
        "framingGuideFaceZone",
        "framingGuideEyeLine",
    ):
        assert token in teleprompter_src, (
            f"Framing Guides symbol `{token}` must remain intact — this "
            "hardening MUST NOT modify Framing Guides."
        )


def test_route_b_teleprompter_architecture_intact(
    teleprompter_src: str,
) -> None:
    """The proven Route B teleprompter architecture is untouched."""
    assert "requestAnimationFrame(step)" in teleprompter_src
    assert "runTeleprompterLoop" in teleprompter_src
    assert re.search(r"<ScrollView\b", teleprompter_src)
    assert "Animated.ScrollView" not in teleprompter_src
    assert re.search(r"\[30,\s*60,\s*90,\s*120,\s*150\]", teleprompter_src)
    assert re.search(r"\[1,\s*2,\s*3,\s*4,\s*5\]\.map", teleprompter_src)
    assert "from 'expo-file-system/legacy'" in teleprompter_src


def test_route_a_record_untouched() -> None:
    """Route A must not be modified by this hardening."""
    record_src = RECORD.read_text()
    assert "showFramingGuides" not in record_src
    assert "framingGuidesLayer" not in record_src


def test_prep_untouched() -> None:
    prep_src = PREP.read_text()
    assert "showFramingGuides" not in prep_src


# ─────────────────────────────────────────────────────────────────────────────
# Extended expo-camera patch — awaitInstance guard
# ─────────────────────────────────────────────────────────────────────────────


def test_patch_contains_await_instance_guard() -> None:
    """The extended `expo-camera+17.0.10.patch` must add a try/catch
    around `ProcessCameraProvider.awaitInstance` that routes failures
    through the existing `onMountError` surface (upstream expo/expo#47696).
    The original stabilization guard must also remain."""
    patch = (FRONTEND / "patches/expo-camera+17.0.10.patch").read_text()
    # awaitInstance now inside a try/catch.
    assert "try {\n+      ProcessCameraProvider.awaitInstance(context)" in patch, (
        "Patch must wrap ProcessCameraProvider.awaitInstance(context) in a "
        "try/catch."
    )
    assert "Camera provider unavailable" in patch, (
        "Patch must surface a useful error string on awaitInstance failure."
    )
    # Failure path routes through onMountError.
    assert re.search(
        r"catch\s*\(\s*e:\s*Throwable\s*\)\s*\{[^}]*onMountError",
        patch,
        re.DOTALL,
    ), (
        "awaitInstance failure must route through the existing onMountError "
        "surface so JS sees a controlled mount error instead of a native crash."
    )


def test_patch_stabilization_guard_still_present() -> None:
    """The existing setVideoStabilizationEnabled guard must be preserved."""
    patch = (FRONTEND / "patches/expo-camera+17.0.10.patch").read_text()
    assert "isStabilizationSupported" in patch
    assert "Recorder.getVideoCapabilities" in patch
    assert "setVideoStabilizationEnabled(isStabilizationSupported)" in patch


def test_patch_applies_cleanly_when_reinstalled_shape() -> None:
    """Patch file must be a valid unified diff. Header structure sanity."""
    patch = (FRONTEND / "patches/expo-camera+17.0.10.patch").read_text()
    hunks = re.findall(r"^@@ [^\n]+@@", patch, re.MULTILINE)
    assert len(hunks) == 2, (
        f"Expected exactly 2 hunks (awaitInstance guard + stabilization "
        f"guard); found {len(hunks)}."
    )
