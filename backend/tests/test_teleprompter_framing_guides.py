"""Post-Phase-3 polish — Framing Guides regression suite.

Locks the Framing Guides feature added to `frontend/app/selftape/teleprompter.tsx`
after the Phase 3 physical gate on Samsung SM-S918B / Android 16 went GREEN.

Feature is purely visual (static <View> overlay, pointerEvents=none),
optional (default OFF), and MUST NOT touch:

  * the proven Route B JS `requestAnimationFrame` teleprompter driver,
  * `<ScrollView>` on the script surface,
  * segmented [1..5] speed controls,
  * segmented opacity controls,
  * `expo-file-system/legacy` save path,
  * `expo-camera` `patch-package` pipeline,
  * `prep.tsx`,
  * the backend,
  * dependencies,
  * EAS configuration,
  * pre-existing backend lint issues.

These tests are pure filesystem/regex asserts on the source — no runtime,
no device, no backend.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend")
TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
PREP = FRONTEND / "app/selftape/prep.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"
PACKAGE_JSON = FRONTEND / "package.json"


@pytest.fixture(scope="module")
def teleprompter_src() -> str:
    return TELEPROMPTER.read_text()


# ─────────────────────────────────────────────────────────────────────────────
# Framing Guides — feature exists
# ─────────────────────────────────────────────────────────────────────────────


def test_framing_guides_state_declared(teleprompter_src: str) -> None:
    """A `showFramingGuides` state variable must exist."""
    assert "showFramingGuides" in teleprompter_src, (
        "Framing Guides state variable `showFramingGuides` is missing from "
        "teleprompter.tsx."
    )


def test_framing_guides_defaults_to_off(teleprompter_src: str) -> None:
    """Default state must be `false` — feature is opt-in."""
    pattern = re.compile(
        r"useState\s*(?:<\s*boolean\s*>)?\s*\(\s*false\s*\)",
    )
    # The state declaration line itself is enough context.
    line = next(
        (
            ln
            for ln in teleprompter_src.splitlines()
            if "setShowFramingGuides" in ln and "useState" in ln
        ),
        "",
    )
    assert line, "Could not locate `useState` declaration for showFramingGuides."
    assert pattern.search(line), (
        f"Framing Guides must default to OFF (useState(false)); got: {line!r}"
    )


def test_framing_guides_toggle_in_settings_modal(teleprompter_src: str) -> None:
    """A user-facing toggle labeled `Framing Guides` must exist in the
    Settings modal, wired to `setShowFramingGuides`."""
    assert 'testID="framing-guides-toggle"' in teleprompter_src, (
        "Framing Guides toggle must expose testID=\"framing-guides-toggle\"."
    )
    assert "Framing Guides" in teleprompter_src, (
        "User-facing label `Framing Guides` is missing."
    )
    # Toggle onPress must flip the boolean.
    assert re.search(
        r"setShowFramingGuides\s*\(\s*!\s*showFramingGuides\s*\)",
        teleprompter_src,
    ), "Framing Guides toggle must flip its own boolean state."


def test_framing_guides_overlay_rendered_conditionally(
    teleprompter_src: str,
) -> None:
    """Overlay must only render when `showFramingGuides` is true."""
    assert re.search(
        r"\{\s*showFramingGuides\s*&&\s*\(",
        teleprompter_src,
    ), (
        "Framing Guides overlay must be gated on `{showFramingGuides && (...)}`."
    )
    assert 'testID="framing-guides-overlay"' in teleprompter_src


# ─────────────────────────────────────────────────────────────────────────────
# Framing Guides — visual-only, safety invariants
# ─────────────────────────────────────────────────────────────────────────────


def test_framing_guides_overlay_pointer_events_none(
    teleprompter_src: str,
) -> None:
    """Overlay MUST not intercept touches — pointerEvents=\"none\"."""
    # Find the block starting at the overlay open bracket.
    block_match = re.search(
        r'testID="framing-guides-overlay".*?\)\s*\}',
        teleprompter_src,
        re.DOTALL,
    )
    assert block_match, "Framing Guides overlay block not found."
    # The pointerEvents="none" attribute must appear on the CONTAINER,
    # which is written before the testID line.
    container_match = re.search(
        r'style=\{styles\.framingGuidesLayer\}\s*'
        r'pointerEvents="none"',
        teleprompter_src,
    )
    assert container_match, (
        "Framing Guides overlay container must set pointerEvents=\"none\" "
        "so it never blocks recording / scrolling / settings taps."
    )


def test_framing_guides_have_no_face_detection(teleprompter_src: str) -> None:
    """Requirement 3: NO face detection, CV, camera processing, or
    native camera APIs. Assert the module never imports or references
    known face-detection / CV / native-camera libraries."""
    banned = [
        "face-detector",
        "FaceDetector",
        "vision-camera",
        "react-native-vision",
        "ml-kit",
        "MLKit",
        "tensorflow",
        "@tensorflow",
    ]
    for token in banned:
        assert token not in teleprompter_src, (
            f"Framing Guides must be visual-only. Found banned reference: "
            f"`{token}` in teleprompter.tsx."
        )


def test_framing_guides_have_no_animation_hooks(teleprompter_src: str) -> None:
    """Requirement 3 & 4: no animation, and guides must remain fixed while
    the teleprompter scrolls. Assert the guide styles are pure static
    Views — no `Animated.` import surface is introduced."""
    # `Animated` is not imported by teleprompter.tsx today; confirm we did
    # not silently pull it in for the guides.
    assert "from 'react-native'" in teleprompter_src
    rn_import_block = re.search(
        r"import\s*\{([^}]+)\}\s*from\s*'react-native'",
        teleprompter_src,
    )
    assert rn_import_block, "react-native import block not found."
    imported = {name.strip() for name in rn_import_block.group(1).split(",")}
    assert "Animated" not in imported, (
        "Framing Guides must not introduce `Animated` — feature is static Views."
    )


def test_framing_guides_are_siblings_not_inside_scrollview(
    teleprompter_src: str,
) -> None:
    """Requirement 4: guides remain fixed while the teleprompter scrolls.
    They must be rendered OUTSIDE the teleprompter ScrollView.

    Enforced structurally: the overlay lives directly inside <CameraView>
    (before <View style={styles.topBar}>), which is a sibling of
    teleprompterContainer, so it cannot be scrolled by the ScrollView."""
    # Ordering: framing-guides overlay must appear BEFORE the top bar,
    # which appears BEFORE the teleprompterContainer.
    idx_overlay = teleprompter_src.find('testID="framing-guides-overlay"')
    idx_top_bar = teleprompter_src.find("styles.topBar")
    idx_teleprompter_container = teleprompter_src.find(
        "styles.teleprompterContainer"
    )
    assert (
        idx_overlay > 0
        and idx_top_bar > idx_overlay
        and idx_teleprompter_container > idx_overlay
    ), (
        "Framing Guides overlay must be the first child of <CameraView> so "
        "it is a sibling of (not a descendant of) the teleprompter ScrollView. "
        f"overlay={idx_overlay}, topBar={idx_top_bar}, "
        f"teleprompterContainer={idx_teleprompter_container}"
    )


def test_framing_guides_styles_defined(teleprompter_src: str) -> None:
    """All named framing-guide styles referenced in JSX must exist in the
    StyleSheet."""
    for style_name in (
        "framingGuidesLayer",
        "framingGuideVLine",
        "framingGuideHLine",
        "framingGuideFaceZone",
        "framingGuideEyeLine",
    ):
        pattern = re.compile(rf"^\s*{style_name}\s*:\s*\{{", re.MULTILINE)
        assert pattern.search(teleprompter_src), (
            f"Referenced framing-guides style `{style_name}` is missing "
            "from StyleSheet.create."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Route B invariants — must remain intact
# ─────────────────────────────────────────────────────────────────────────────


def test_route_b_raf_driver_intact(teleprompter_src: str) -> None:
    """The proven JS requestAnimationFrame teleprompter driver is preserved."""
    assert "requestAnimationFrame(step)" in teleprompter_src, (
        "Route B RAF-driven scroll driver must remain intact."
    )
    assert "teleprompterRafId" in teleprompter_src
    assert "runTeleprompterLoop" in teleprompter_src


def test_route_b_scrollview_used_not_animated_scrollview(
    teleprompter_src: str,
) -> None:
    """Route B must render a plain <ScrollView>, not <Animated.ScrollView>."""
    assert "Animated.ScrollView" not in teleprompter_src
    assert "scrollViewRef" in teleprompter_src
    assert re.search(r"<ScrollView\b", teleprompter_src)


def test_route_b_segmented_speed_control_intact(teleprompter_src: str) -> None:
    """Segmented [1..5] speed control (Failure 4 anti-pattern purge) is kept.
    pxPerSecond mapping [30, 60, 90, 120, 150] preserved."""
    assert re.search(r"\[1,\s*2,\s*3,\s*4,\s*5\]\.map", teleprompter_src)
    assert re.search(
        r"\[30,\s*60,\s*90,\s*120,\s*150\]", teleprompter_src
    ), "pxPerSecond mapping must remain unchanged."


def test_route_b_no_community_slider(teleprompter_src: str) -> None:
    """Fabric SDK 54 anti-pattern: `@react-native-community/slider` stays out
    of the JSX and imports. Historical mentions in comments are allowed
    (and are useful documentation)."""
    assert (
        "from '@react-native-community/slider'" not in teleprompter_src
    ), "Community slider import must not be reintroduced."
    assert (
        'from "@react-native-community/slider"' not in teleprompter_src
    )
    assert "<Slider" not in teleprompter_src, (
        "The <Slider> component from @react-native-community/slider must not "
        "be used in Route B."
    )


def test_route_b_expo_file_system_legacy_import(teleprompter_src: str) -> None:
    """The save path must still import from `expo-file-system/legacy`."""
    assert "from 'expo-file-system/legacy'" in teleprompter_src, (
        "Save path must use the legacy submodule; the top-level import is a "
        "runtime-throwing deprecation shim in SDK 54."
    )
    assert "from 'expo-file-system'" not in teleprompter_src.replace(
        "from 'expo-file-system/legacy'", ""
    ), "Top-level expo-file-system import re-introduced."


def test_route_b_camera_and_permissions_intact(teleprompter_src: str) -> None:
    """CameraView + permission hooks + mode=video preserved."""
    assert "useCameraPermissions" in teleprompter_src
    assert "useMicrophonePermissions" in teleprompter_src
    assert 'mode="video"' in teleprompter_src
    assert "CameraView" in teleprompter_src


def test_route_b_record_save_retake_countdown_preserved(
    teleprompter_src: str,
) -> None:
    """Recording pipeline surface is untouched."""
    for symbol in (
        "startRecording",
        "stopRecording",
        "handleSave",
        "handleRetake",
        "setCountdown",
        "recordAsync",
    ):
        assert symbol in teleprompter_src, (
            f"Route B recording symbol `{symbol}` must remain intact."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Blast-radius: nothing else touched
# ─────────────────────────────────────────────────────────────────────────────


def test_prep_not_modified_for_framing_guides() -> None:
    """Requirement 8: prep.tsx must not be modified for this change."""
    prep_src = PREP.read_text()
    assert "framing-guides" not in prep_src.lower()
    assert "showFramingGuides" not in prep_src


def test_record_route_a_not_modified_for_framing_guides() -> None:
    """Feature is only added to teleprompter.tsx. Route A (record.tsx) is
    left alone by explicit user directive."""
    record_src = RECORD.read_text()
    assert "framing-guides" not in record_src.lower()
    assert "showFramingGuides" not in record_src


def test_patch_package_pipeline_intact() -> None:
    """expo-camera patch-package pipeline must remain intact — `patch-package`
    and `postinstall-postinstall` in `dependencies` (moved out of devDeps
    for the EAS OTA production install), and postinstall script wired."""
    pkg_src = PACKAGE_JSON.read_text()
    assert '"postinstall": "patch-package"' in pkg_src
    # Must be in `dependencies` (not devDependencies) so NODE_ENV=production
    # installs it.
    deps_match = re.search(
        r'"dependencies"\s*:\s*\{([^}]*)\}', pkg_src, re.DOTALL
    )
    assert deps_match, "dependencies block not found in package.json."
    deps_block = deps_match.group(1)
    assert '"patch-package"' in deps_block, (
        "patch-package must be in `dependencies` for the EAS OTA production "
        "install to run the postinstall hook."
    )
    assert '"postinstall-postinstall"' in deps_block


def test_patch_file_still_present() -> None:
    """The physically-proven expo-camera patch must still be on disk."""
    patch = FRONTEND / "patches" / "expo-camera+17.0.10.patch"
    assert patch.exists(), (
        f"Missing patch file: {patch}. This is the physically-proven fix "
        "for the Android SIGSEGV on `setVideoStabilizationEnabled`."
    )
