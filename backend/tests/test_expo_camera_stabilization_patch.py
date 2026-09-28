"""Regression: expo-camera 17.0.10 patch for the Android 16 / Samsung
SM-S918B video-stabilization native crash.

Background:
    Build 1110-QA physical test on Samsung S23 Ultra / Android 16:
    Self Tape → recording screen → press Record → Android closes
    ScriptMate. No JS error, no JS stack, no unhandled promise, no
    captured error.

    Root cause proven from installed source:
    node_modules/expo-camera/android/src/main/java/expo/modules/
    camera/ExpoCameraView.kt:569 (in `createVideoCapture()`)
    unconditionally called `setVideoStabilizationEnabled(true)` on
    every VideoCapture. On devices whose active camera does not
    advertise the requested CameraX stabilization capability, the HAL
    raises an unhandled native exception → process SIGSEGV → Android
    kills the app. This is the exact bug tracked by upstream
    expo/expo#45896.

    Fix: gate `setVideoStabilizationEnabled` on the active camera's
    advertised `isStabilizationSupported` flag, shipped as a
    `patch-package` patch applied at yarn install time (postinstall
    script) so EAS builds and local yarn installs receive the fix.

These guards ensure the patch pipeline stays wired up.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

FRONTEND = Path("/app/frontend")


def _read_pkg() -> dict:
    return json.loads((FRONTEND / "package.json").read_text())


def _read(rel: str) -> str:
    return (FRONTEND / rel).read_text()


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline wiring
# ─────────────────────────────────────────────────────────────────────────────

def test_patch_package_is_in_dependencies() -> None:
    """patch-package must be a top-level `dependencies` entry so the
    EAS OTA production install (which runs `yarn install` with
    `NODE_ENV=production` and therefore skips devDependencies) can
    still resolve the binary during the `postinstall` hook.
    Moved from devDependencies → dependencies in 2026-02 as a fix for
    the `build_image` failure in the EAS OTA lane (exit 127:
    `patch-package: not found`)."""
    d = _read_pkg()
    deps = d.get("dependencies", {})
    assert "patch-package" in deps, (
        "patch-package must be listed under `dependencies` of "
        "frontend/package.json so the postinstall step can apply our "
        "expo-camera patches during EAS Android builds under "
        "NODE_ENV=production."
    )


def test_postinstall_postinstall_is_in_dependencies() -> None:
    """postinstall-postinstall guarantees the hook runs after every
    `yarn install`, including in transitive dev flows. Moved to
    `dependencies` alongside patch-package for the same
    NODE_ENV=production reason (see above)."""
    d = _read_pkg()
    deps = d.get("dependencies", {})
    assert "postinstall-postinstall" in deps, (
        "postinstall-postinstall must be listed under `dependencies` "
        "so patch-package always re-applies after any subsequent "
        "yarn install (including EAS OTA production installs)."
    )


def test_postinstall_script_runs_patch_package() -> None:
    """package.json scripts.postinstall must invoke patch-package so
    EAS/yarn applies patches before native compilation."""
    d = _read_pkg()
    scripts = d.get("scripts", {})
    assert scripts.get("postinstall") == "patch-package", (
        "package.json scripts.postinstall must be exactly "
        "'patch-package' — this is what runs on every `yarn install` "
        "(including EAS builds) to apply patches/*.patch to node_modules "
        "before Gradle compiles the Android bundle."
    )


# ─────────────────────────────────────────────────────────────────────────────
# The expo-camera patch itself
# ─────────────────────────────────────────────────────────────────────────────

PATCH_FILE = FRONTEND / "patches" / "expo-camera+17.0.10.patch"


def test_expo_camera_patch_file_exists() -> None:
    """The patch file must exist at patches/expo-camera+17.0.10.patch."""
    assert PATCH_FILE.exists(), (
        f"Expected patch file at {PATCH_FILE.relative_to(FRONTEND)}. "
        "Without this file the postinstall step has nothing to apply "
        "and the Samsung SM-S918B recording crash will regress."
    )


def test_expo_camera_patch_targets_the_correct_native_file() -> None:
    """The patch must modify ExpoCameraView.kt, not some other file."""
    src = PATCH_FILE.read_text()
    assert (
        "node_modules/expo-camera/android/src/main/java/expo/modules/camera/"
        "ExpoCameraView.kt" in src
    ), (
        "patches/expo-camera+17.0.10.patch must target "
        "node_modules/expo-camera/android/.../ExpoCameraView.kt — the "
        "file that contains the offending setVideoStabilizationEnabled(true)."
    )


def test_expo_camera_patch_removes_unconditional_stabilization_call() -> None:
    """The patch must REMOVE `setVideoStabilizationEnabled(true)`."""
    src = PATCH_FILE.read_text()
    # Diff line starting with '-' followed by the bad call.
    assert re.search(
        r"^-\s+setVideoStabilizationEnabled\(true\)\s*$",
        src, re.MULTILINE,
    ), (
        "patches/expo-camera+17.0.10.patch must REMOVE the "
        "unconditional `setVideoStabilizationEnabled(true)` call — that "
        "is the exact line responsible for the native HAL crash on "
        "Samsung SM-S918B / Android 16."
    )


def test_expo_camera_patch_adds_capability_gated_call() -> None:
    """The patch must ADD a capability-gated stabilization call."""
    src = PATCH_FILE.read_text()
    # Must query CameraX capabilities before enabling stabilization.
    assert re.search(
        r"^\+.*Recorder\.getVideoCapabilities\(cameraInfo\)\."
        r"isStabilizationSupported",
        src, re.MULTILINE,
    ), (
        "patches/expo-camera+17.0.10.patch must ADD a "
        "Recorder.getVideoCapabilities(cameraInfo).isStabilizationSupported "
        "check before enabling stabilization (upstream expo/expo#45896)."
    )
    assert re.search(
        r"^\+\s+setVideoStabilizationEnabled\(isStabilizationSupported\)",
        src, re.MULTILINE,
    ), (
        "The patch must call setVideoStabilizationEnabled with the "
        "computed isStabilizationSupported flag, not with `true`."
    )


def test_expo_camera_patch_is_defensive_around_capability_query() -> None:
    """The capability query itself must be wrapped in try/catch so a
    misbehaving CameraX version cannot re-introduce the crash via the
    capability probe."""
    src = PATCH_FILE.read_text()
    assert "try {" in src and "catch" in src, (
        "The patch must wrap the getVideoCapabilities call in a "
        "try/catch so that if the capability probe itself throws on a "
        "future Android version, we fall back to disabled stabilization "
        "instead of crashing the app."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Verify the patch is actually applied in node_modules right now
# ─────────────────────────────────────────────────────────────────────────────

KOTLIN_FILE = (
    FRONTEND
    / "node_modules/expo-camera/android/src/main/java/expo/modules/camera/"
      "ExpoCameraView.kt"
)


def test_installed_expo_camera_has_patch_applied() -> None:
    """Sanity check that the postinstall step (or manual patch-package
    invocation) actually applied the patch to the installed module."""
    if not KOTLIN_FILE.exists():
        # If expo-camera itself is missing, that's a bigger problem than
        # this test can catch — skip cleanly.
        import pytest
        pytest.skip("expo-camera node_modules copy not present")

    src = KOTLIN_FILE.read_text()
    assert "SCRIPTmate patch" in src, (
        "The installed expo-camera copy at "
        f"{KOTLIN_FILE.relative_to(FRONTEND)} does not contain the "
        "SCRIPTmate stabilization patch. Run `npx patch-package` in "
        "frontend/, or delete node_modules and run `yarn install` so "
        "the postinstall hook re-applies patches/*.patch."
    )
    assert "isStabilizationSupported" in src, (
        "Installed copy is missing the isStabilizationSupported gate."
    )
    # And the exact unconditional call must not remain.
    assert not re.search(
        r"^\s+setVideoStabilizationEnabled\(true\)\s*$",
        src, re.MULTILINE,
    ), (
        "Installed ExpoCameraView.kt still contains an unconditional "
        "`setVideoStabilizationEnabled(true)` — the patch is not "
        "applied, and the Samsung SM-S918B crash will regress."
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2026-02: extended patch also guards ProcessCameraProvider.awaitInstance
# (upstream expo/expo#47696). Intermittent Samsung SM-S918B / Android 16
# first-record process crashes now route through onMountError instead of
# terminating the app.
# ─────────────────────────────────────────────────────────────────────────────


def test_installed_expo_camera_has_await_instance_guard() -> None:
    """The installed ExpoCameraView.kt must include the try/catch around
    ProcessCameraProvider.awaitInstance and a routing through
    onMountError → CameraMountErrorEvent."""
    if not KOTLIN_FILE.exists():
        import pytest
        pytest.skip("expo-camera node_modules copy not present")
    src = KOTLIN_FILE.read_text()
    # awaitInstance must now sit inside a try/catch and be preceded by
    # `val cameraProvider = try {` (with any whitespace).
    assert re.search(
        r"val\s+cameraProvider\s*=\s*try\s*\{\s*\n\s*"
        r"ProcessCameraProvider\.awaitInstance\(context\)",
        src,
    ), (
        "Installed ExpoCameraView.kt must wrap "
        "`ProcessCameraProvider.awaitInstance(context)` in a try/catch. "
        "Without this guard, an InitializationException (root cause: "
        "CameraUnavailableException) on Samsung SM-S918B / Android 16 "
        "propagates unhandled and terminates the process — the exact "
        "'Something went wrong with ScriptMate Pro' native dialog "
        "reported by physical QA."
    )
    # Failure path must route through onMountError with a useful message.
    assert "Camera provider unavailable" in src, (
        "The awaitInstance catch block must surface a "
        "'Camera provider unavailable' CameraMountErrorEvent so JS sees a "
        "controlled mount error instead of a process crash."
    )
    assert re.search(
        r"catch\s*\(\s*e:\s*Throwable\s*\)\s*\{[^}]*onMountError",
        src,
        re.DOTALL,
    ), (
        "The awaitInstance catch block must call onMountError(...) so the "
        "failure travels through the same event surface Route B now wires "
        "in teleprompter.tsx (onMountError handler)."
    )


def test_await_instance_upstream_reference_in_patch() -> None:
    """The patch must reference the upstream Expo issue so future readers
    can trace the fix back to expo/expo#47696."""
    src = PATCH_FILE.read_text()
    assert "expo/expo#47696" in src, (
        "Patch must reference upstream expo/expo#47696 for the "
        "awaitInstance guard."
    )


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
