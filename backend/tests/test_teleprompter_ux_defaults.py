"""Phase 3 UX polish — teleprompter initial position + default speed.

Locks two fresh-session defaults on Route B (`frontend/app/selftape/
teleprompter.tsx`) added 2026-02:

  * Teleprompter window position: 'top' (was 'bottom'). The script's
    first line is visible from the top of the screen on entry.
  * Selected speed: 2 (was 3). The pxPerSecond mapping
    [30, 60, 90, 120, 150] for segments [1..5] is unchanged.

The change is intentionally two single-token literals. No scrolling
architecture change, no speed-scaling change, no new dependencies, no
camera / framing-guide / patch changes.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend")
TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"


@pytest.fixture(scope="module")
def src() -> str:
    return TELEPROMPTER.read_text()


# ─────────────────────────────────────────────────────────────────────────────
# Default speed = 2
# ─────────────────────────────────────────────────────────────────────────────


def test_default_speed_is_2(src: str) -> None:
    """A fresh session must open with speed 2 selected."""
    match = re.search(
        r"const\s*\[\s*speed\s*,\s*setSpeed\s*\]\s*=\s*useState\s*\(\s*(\d+)\s*\)",
        src,
    )
    assert match, "Could not locate the `speed` useState declaration."
    default = int(match.group(1))
    assert default == 2, (
        f"Default teleprompter speed must be 2 for a fresh session; found "
        f"{default}."
    )


def test_five_speed_options_remain_available(src: str) -> None:
    """All five speed segments 1..5 remain available."""
    assert re.search(r"\[1,\s*2,\s*3,\s*4,\s*5\]\.map", src), (
        "Segmented [1..5] speed control must remain available."
    )


def test_speed_scaling_unchanged(src: str) -> None:
    """The pxPerSecond mapping [30, 60, 90, 120, 150] is unchanged."""
    assert re.search(r"\[30,\s*60,\s*90,\s*120,\s*150\]", src), (
        "pxPerSecond mapping must remain [30, 60, 90, 120, 150] for "
        "speeds 1..5 respectively."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Default window position = 'top'
# ─────────────────────────────────────────────────────────────────────────────


def test_default_position_is_top(src: str) -> None:
    """A fresh session must place the teleprompter window at 'top'."""
    match = re.search(
        r"const\s*\[\s*position\s*,\s*setPosition\s*\]\s*="
        r"\s*useState\s*<\s*[^>]+>\s*\(\s*'([^']+)'\s*\)",
        src,
    )
    assert match, "Could not locate the `position` useState declaration."
    default = match.group(1)
    assert default == "top", (
        f"Default teleprompter window position must be 'top' for a fresh "
        f"session; found {default!r}."
    )


def test_all_three_positions_remain_selectable(src: str) -> None:
    """User can still switch between 'top', 'middle', 'bottom' at runtime."""
    # The Settings modal renders a segmented row over the three literals.
    assert re.search(
        r"\[\s*'top'\s*,\s*'middle'\s*,\s*'bottom'\s*\]",
        src,
    ), "Runtime position picker must still expose 'top' | 'middle' | 'bottom'."
    # getPositionStyle must still handle all three cases.
    assert "case 'top':" in src
    assert "case 'middle':" in src
    assert "case 'bottom':" in src


# ─────────────────────────────────────────────────────────────────────────────
# Initial scroll position — y=0 / top
# ─────────────────────────────────────────────────────────────────────────────


def test_no_initial_scroll_to_bottom(src: str) -> None:
    """No code path scrolls the teleprompter ScrollView to the bottom on
    mount. The RN default is y=0; the fresh-session path must not
    override it toward the bottom."""
    # scrollToEnd would jump to the bottom of the ScrollView.
    assert "scrollToEnd" not in src, (
        "scrollToEnd() must not be called on the teleprompter ScrollView."
    )
    # No explicit contentOffset override that would set y away from 0.
    assert not re.search(
        r"contentOffset\s*=\s*\{\{\s*y\s*:\s*[1-9]",
        src,
    ), "No non-zero contentOffset override on the ScrollView."
    # The teleprompter <ScrollView> must not set contentContainerStyle
    # with flex-end anchoring. Check only the ScrollView JSX block, not
    # unrelated modal styles elsewhere in the StyleSheet.
    sv_match = re.search(
        r"<ScrollView\b(.*?)/?>",
        src,
        re.DOTALL,
    )
    assert sv_match, "<ScrollView> JSX block not found."
    sv_props = sv_match.group(1)
    assert "flex-end" not in sv_props, (
        "Teleprompter ScrollView must not use flex-end anchoring."
    )


def test_start_and_reset_teleprompter_use_y_zero(src: str) -> None:
    """Fresh RAF sessions and explicit resets both scroll to y=0."""
    matches = re.findall(
        r"scrollViewRef\.current\?\.scrollTo\(\s*\{\s*y:\s*(\w+)\s*,",
        src,
    )
    # Expect at least three scrollTo call sites; the two we care about
    # (startTeleprompter, resetTeleprompter) must target y=0.
    assert matches, "No scrollTo call sites found."
    zeros = [m for m in matches if m == "0"]
    assert len(zeros) >= 2, (
        "Fresh RAF start and reset paths must each call "
        "scrollTo({ y: 0, animated: false })."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Scrolling architecture unchanged
# ─────────────────────────────────────────────────────────────────────────────


def test_js_raf_scroll_driver_intact(src: str) -> None:
    """The proven JS requestAnimationFrame teleprompter driver is
    preserved. No native Animated driver, no Animated.multiply, no
    Animated.ScrollView, no Animated.timing on the scroll.

    Historical mentions in comments (documenting what was removed)
    are allowed and useful — assertions target imports and JSX only."""
    assert "requestAnimationFrame(step)" in src
    assert "runTeleprompterLoop" in src
    assert "teleprompterRafId" in src
    # Assert no JSX usage of Animated.ScrollView (a comment saying we
    # removed it is fine).
    assert not re.search(r"<Animated\.ScrollView\b", src), (
        "Animated.ScrollView must not be rendered in Route B."
    )
    # Assert `Animated` is not imported into the module — the driver
    # is RAF-only. This is the strongest guarantee that no native
    # animated node is created.
    rn_import = re.search(
        r"import\s*\{([^}]+)\}\s*from\s*'react-native'", src
    )
    assert rn_import, "react-native import block not found."
    names = {n.strip() for n in rn_import.group(1).split(",")}
    assert "Animated" not in names, (
        "`Animated` must not be imported into teleprompter.tsx — the "
        "proven driver is RAF-only."
    )


def test_manual_scroll_gated_on_playing(src: str) -> None:
    """Existing manual-scroll behaviour is preserved: the ScrollView
    accepts touch input when not playing, and blocks it while the RAF
    loop is driving playback."""
    assert re.search(
        r"scrollEnabled=\{\s*!\s*isPlaying\s*\}",
        src,
    ), "ScrollView must be scrollEnabled={!isPlaying}."


# ─────────────────────────────────────────────────────────────────────────────
# Nothing else changed
# ─────────────────────────────────────────────────────────────────────────────


def test_camera_hardening_intact(src: str) -> None:
    """Camera bring-up hardening (2026-02) must remain intact."""
    assert "isCameraReady" in src
    assert "cameraMountError" in src
    assert "onCameraReady={" in src
    assert "onMountError={" in src
    assert 'testID="record-button"' in src
    assert 'testID="camera-mount-error-banner"' in src
    assert 'testID="camera-initializing-banner"' in src


def test_framing_guides_intact(src: str) -> None:
    """Framing Guides (2026-02) must remain intact."""
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
        assert token in src, (
            f"Framing Guides symbol `{token}` must remain intact."
        )


def test_expo_camera_patch_untouched() -> None:
    """The expo-camera patch file is not modified by this UX polish."""
    patch = (FRONTEND / "patches/expo-camera+17.0.10.patch").read_text()
    assert "isStabilizationSupported" in patch
    assert "Camera provider unavailable" in patch
    assert "expo/expo#47696" in patch
