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

def test_patch_package_is_a_dev_dependency() -> None:
    """patch-package must be a devDependency so EAS installs it."""
    d = _read_pkg()
    dev = d.get("devDependencies", {})
    assert "patch-package" in dev, (
        "patch-package must be listed under devDependencies of "
        "frontend/package.json so the postinstall step can apply our "
        "expo-camera patches during EAS Android builds."
    )


def test_postinstall_postinstall_is_a_dev_dependency() -> None:
    """postinstall-postinstall guarantees the hook runs after every
    `yarn install`, including in transitive dev flows."""
    d = _read_pkg()
    dev = d.get("devDependencies", {})
    assert "postinstall-postinstall" in dev, (
        "postinstall-postinstall must be listed under devDependencies "
        "so patch-package always re-applies after any subsequent "
        "yarn install, not just the first."
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


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
