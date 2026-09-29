"""Phase 4 physical stability — Fabric-safe Slider migration.

Root cause traced in the previous investigation: on Samsung S23 Ultra
running Android 16 with `newArchEnabled: true`, the community slider
`@react-native-community/slider@4.5.5` intermittently aborts the app
during native-view attach through the Fabric interop layer. Two
symptoms observed:

  - Deterministic crash pressing the Home "Recall" tile
    (`app/recall.tsx` mounts 2 sliders immediately on the settings
    screen).
  - Intermittent cold-reopen crash on Library → ScriptScreen
    (`app/script/[id].tsx` mounts 1 slider immediately + 1 modal-
    deferred).

Fix: swap `@react-native-community/slider` for a pure-JS wrapper
(`components/FabricSafeSlider.tsx`) that renders on top of
`@miblanchard/react-native-slider` — no native module, no Fabric
interop, so the exact native surface that crashes cannot be reached.
Same visual output. Callers keep their `number` value + `(number) =>
void` callback signature unchanged; the wrapper adapts the underlying
library's `number[]` shape.

This suite locks the migration on the source so future edits cannot
accidentally reintroduce the community slider import.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"

WRAPPER = FRONTEND / "components/FabricSafeSlider.tsx"
PACKAGE_JSON = FRONTEND / "package.json"

# Files that previously imported the community slider.
CALLERS = {
    "recall": FRONTEND / "app/recall.tsx",
    "script_id": FRONTEND / "app/script/[id].tsx",
    "acting_coach": FRONTEND / "app/acting-coach.tsx",
    "prep": FRONTEND / "app/selftape/prep.tsx",
}

# Import paths each caller must use (relative to its own location).
EXPECTED_IMPORTS = {
    "recall": "'../components/FabricSafeSlider'",
    "script_id": "'../../components/FabricSafeSlider'",
    "acting_coach": "'../components/FabricSafeSlider'",
    "prep": "'../../components/FabricSafeSlider'",
}


@pytest.fixture(scope="module")
def package() -> dict:
    return json.loads(PACKAGE_JSON.read_text())


# ─── Dependency graph ────────────────────────────────────────────────────


def test_community_slider_removed_from_dependencies(package: dict) -> None:
    for section in ("dependencies", "devDependencies", "resolutions"):
        deps = package.get(section, {})
        assert "@react-native-community/slider" not in deps, (
            f"@react-native-community/slider unexpectedly present in "
            f"{section}. The Fabric-unsafe community slider must be "
            f"removed from every dependency section."
        )


def test_community_slider_expo_install_exclude_cleaned(package: dict) -> None:
    """Once the dependency is gone the expo-install exclusion entry
    must go too — leaving it as dead config could mask a re-add."""
    exclude = (
        package.get("expo", {})
        .get("install", {})
        .get("exclude", [])
    )
    assert "@react-native-community/slider" not in exclude, (
        "Stale `expo.install.exclude` entry for the community slider "
        "must be removed alongside the dependency."
    )


def test_miblanchard_slider_present_in_dependencies(package: dict) -> None:
    deps = package.get("dependencies", {})
    assert "@miblanchard/react-native-slider" in deps, (
        "@miblanchard/react-native-slider must be in dependencies — "
        "it is the underlying Fabric-safe pure-JS slider that "
        "FabricSafeSlider wraps."
    )


# ─── Wrapper contract ────────────────────────────────────────────────────


def test_wrapper_exists() -> None:
    assert WRAPPER.exists(), (
        f"Fabric-safe slider wrapper missing at {WRAPPER}"
    )


def test_wrapper_imports_miblanchard_only() -> None:
    src = WRAPPER.read_text()
    assert re.search(
        r"from\s+'@miblanchard/react-native-slider'",
        src,
    ), "Wrapper must import from @miblanchard/react-native-slider."
    # Strip comments before scanning for a real community-slider import.
    stripped = re.sub(r"/\*[\s\S]*?\*/", "", src)
    stripped = re.sub(r"//.*", "", stripped)
    assert "@react-native-community/slider" not in stripped, (
        "Wrapper must not IMPORT from the community slider "
        "(mentions in documentation comments are allowed)."
    )


def test_wrapper_preserves_community_slider_props() -> None:
    src = WRAPPER.read_text()
    for prop in (
        "value",
        "onValueChange",
        "minimumValue",
        "maximumValue",
        "step",
        "minimumTrackTintColor",
        "maximumTrackTintColor",
        "thumbTintColor",
        "style",
        "testID",
    ):
        assert prop in src, (
            f"Wrapper must expose community-slider prop `{prop}`."
        )


def test_wrapper_adapts_number_array_shape() -> None:
    """The underlying library takes/returns `number[]`. The wrapper must
    accept a `number` value and forward a `number` to `onValueChange`."""
    src = WRAPPER.read_text()
    assert "typeof value === 'number' ? [value]" in src, (
        "Wrapper must convert incoming `number` value into `[value]` "
        "for the underlying miblanchard slider."
    )
    assert "Array.isArray(v) ? v[0] : v" in src, (
        "Wrapper must unwrap `number[]` from the underlying slider "
        "back into a `number` before calling onValueChange."
    )


def test_wrapper_default_export_is_slider() -> None:
    src = WRAPPER.read_text()
    assert "export default FabricSafeSlider" in src, (
        "Wrapper must default-export FabricSafeSlider so call sites "
        "can `import Slider from '.../FabricSafeSlider'` unchanged."
    )


# ─── Caller migration ────────────────────────────────────────────────────


@pytest.mark.parametrize("caller_key", list(CALLERS))
def test_caller_no_longer_imports_community_slider(caller_key: str) -> None:
    src = CALLERS[caller_key].read_text()
    assert "@react-native-community/slider" not in src, (
        f"{CALLERS[caller_key]} still references "
        f"@react-native-community/slider. Every import must be "
        f"replaced with the FabricSafeSlider wrapper."
    )


@pytest.mark.parametrize("caller_key", list(CALLERS))
def test_caller_uses_wrapper_import(caller_key: str) -> None:
    src = CALLERS[caller_key].read_text()
    expected = EXPECTED_IMPORTS[caller_key]
    assert f"import Slider from {expected}" in src, (
        f"{CALLERS[caller_key]} must `import Slider from "
        f"{expected}`. Any deviation breaks the wrapper contract."
    )


@pytest.mark.parametrize("caller_key", list(CALLERS))
def test_caller_still_renders_a_slider(caller_key: str) -> None:
    """The migration must preserve every existing `<Slider ... />` JSX
    site — the goal is a drop-in swap, not a UX refactor."""
    src = CALLERS[caller_key].read_text()
    assert "<Slider" in src, (
        f"{CALLERS[caller_key]} lost its <Slider /> render — the "
        f"migration must not remove existing slider UI."
    )


# ─── Phase 3 protection ─────────────────────────────────────────────────


def test_selftape_record_and_teleprompter_do_not_import_slider() -> None:
    """The Phase 3 self-tape record + teleprompter files must not have
    acquired a slider import as part of this migration — they never
    had one and must remain frozen."""
    for name in ("app/selftape/record.tsx", "app/selftape/teleprompter.tsx"):
        src = (FRONTEND / name).read_text()
        assert "import Slider" not in src, (
            f"Phase 3 file {name} unexpectedly imports a Slider — "
            f"Phase 3 must stay frozen."
        )


# ─── Phase 4 protection ─────────────────────────────────────────────────


def test_phase4_learn_files_do_not_import_any_slider() -> None:
    """Learn Hub / session / summary must not have acquired a slider
    import — they use pill buttons for difficulty which is why the
    Fabric crash has never manifested there."""
    for name in ("app/learn/index.tsx", "app/learn/session.tsx", "app/learn/summary.tsx"):
        src = (FRONTEND / name).read_text()
        assert "import Slider" not in src, (
            f"Phase 4 file {name} unexpectedly imports a Slider."
        )
        assert "FabricSafeSlider" not in src, (
            f"Phase 4 file {name} unexpectedly references "
            f"FabricSafeSlider — Learn does not use sliders."
        )
