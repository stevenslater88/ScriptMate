"""Phase 3 Self-Tape regression suite.

Locks two independent physical Samsung SM-S918B failures on build 1110-QA:

FAILURE 1 — recording save
  root cause: `expo-file-system` v19 (SDK 54) turned the top-level legacy
  API into a deprecation shim that THROWS AT RUNTIME. Every legacy call
  (`getInfoAsync`, `copyAsync`, `makeDirectoryAsync`, `deleteAsync`,
  `documentDirectory`, `getFreeDiskStorageAsync`) must be imported from
  `expo-file-system/legacy` instead of the top-level `expo-file-system`.
  Evidence: `node_modules/expo-file-system/build/legacyWarnings.d.ts`
  every exported symbol carries the JSDoc "This method will throw in runtime."
  Fix: change the import in `services/selfTapeStorage.ts`.

FAILURE 2 — teleprompter crash while recording
  root cause: `<Animated.ScrollView>` on Android 16 / Fabric received an
  `Animated.multiply(...)` interpolation node inside its
  `contentContainerStyle.transform`. `contentContainerStyle` targets a
  non-animated internal content wrapper; passing an AnimatedInterpolation
  object into a raw style prop crashes Fabric's shadow-tree layout resolver.
  Fix: keep the ScrollView but move the animated transform onto an inner
  `<Animated.View>`, whose `style` prop IS reactive to Animated updates.

These are two independent SDK-54 / new-arch defects that share no state.
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
    # Guard: nobody must sneak the broken top-level import back in.
    forbidden = re.search(
        r"^\s*import\s+\*\s+as\s+FileSystem\s+from\s+['\"]expo-file-system['\"]\s*;",
        src, re.MULTILINE,
    )
    assert forbidden is None, (
        "Do NOT use `import * as FileSystem from 'expo-file-system'` in "
        "selfTapeStorage.ts on SDK 54 — those methods throw at runtime."
    )


def test_expo_file_system_legacy_submodule_is_available() -> None:
    """Guard the installed expo-file-system package exposes the /legacy path.
    If the package upgrades and drops /legacy in the future, this test fires
    before a build reaches devices."""
    legacy_entry = FRONTEND / "node_modules" / "expo-file-system" / "legacy.ts"
    legacy_dir = FRONTEND / "node_modules" / "expo-file-system" / "src" / "legacy"
    assert legacy_entry.exists() or legacy_dir.exists(), (
        "expo-file-system/legacy submodule is missing — the selfTapeStorage "
        "import will fail to resolve at bundle time."
    )


def test_selftape_storage_still_calls_the_expected_legacy_helpers() -> None:
    """The storage service must still call the legacy helpers we depend on —
    if someone accidentally migrates to the new File/Directory API without
    verifying our contract, this test flags it."""
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
    """The saveRecording flow ordering must be: verify src exists -> ensure
    dir -> copy -> verify dest exists -> update AsyncStorage index."""
    src = _read("services/selfTapeStorage.ts")
    # Find the saveRecording function body.
    m = re.search(
        r"export\s+const\s+saveRecording\s*=\s*async[^{]+\{(.*?)\n\};",
        src, re.DOTALL,
    )
    assert m, "saveRecording function not found — refactor detected"
    body = m.group(1)

    # Order-preserving checks: find indices of key operations.
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
# FAILURE 2 — Teleprompter crash
# ─────────────────────────────────────────────────────────────────────────────

def test_teleprompter_animated_transform_not_on_contentContainerStyle() -> None:
    """The animated transform MUST NOT live on the ScrollView's
    contentContainerStyle — that path crashed on Samsung / Android 16 / Fabric."""
    src = _read("app/selftape/record.tsx")

    # Locate the Animated.ScrollView block driving the script text.
    m = re.search(
        r"<Animated\.ScrollView[^>]*ref=\{scrollViewRef\}[^>]*>",
        src, re.DOTALL,
    )
    assert m, "Animated.ScrollView with ref=scrollViewRef not found — refactor detected"
    tag = m.group(0)

    # The contentContainerStyle prop on this specific tag must not include a
    # `transform:` key that references teleprompterAnim.
    assert "teleprompterAnim" not in tag, (
        "The teleprompter animated transform must NOT be placed on the "
        "outer Animated.ScrollView's contentContainerStyle. This caused a "
        "hard native crash on Android 16 (Fabric) when the teleprompter was "
        "toggled on during recording."
    )


def test_teleprompter_transform_lives_on_an_inner_animated_view() -> None:
    """The animated transform MUST be applied to an Animated.View whose
    `style` prop can proxy the animated node natively AND the animated
    interpolation MUST be created once at mount (via useMemo) and kept
    UNCONDITIONALLY in the transform — never conditionally inserted at
    runtime, which crashes Fabric on Android 16 during Start Recording."""
    src = _read("app/selftape/record.tsx")

    # 1. Memoized interpolation MUST exist and be created once (empty deps).
    memo_pattern = re.compile(
        r"teleprompterTranslateY\s*=\s*useMemo\(\s*"
        r"\(\)\s*=>\s*Animated\.multiply\(teleprompterAnim,\s*-1\)",
        re.DOTALL,
    )
    assert memo_pattern.search(src), (
        "record.tsx must create the teleprompter translateY interpolation "
        "ONCE via useMemo(() => Animated.multiply(teleprompterAnim, -1), []) "
        "— otherwise a fresh AnimatedInterpolation is bound every render, "
        "which triggers native re-registration and (on Fabric/Android 16) "
        "an immediate crash at Start Recording."
    )

    # 2. Inner Animated.View must reference the memoized value in transform.
    view_pattern = re.compile(
        r"<Animated\.View[^>]*style=\{\{[^}]*"
        r"transform:\s*\[\{\s*translateY:\s*teleprompterTranslateY\s*\}\]",
        re.DOTALL,
    )
    assert view_pattern.search(src), (
        "The inner <Animated.View> must reference the memoized "
        "teleprompterTranslateY unconditionally in its transform array. "
        "Do NOT re-introduce a `teleprompterActive && teleprompterPlaying "
        "? [...] : []` conditional — that crashes Fabric at Start Recording."
    )

    # 3. Guard: no conditional insertion of Animated.multiply in JSX transform.
    # The old bug pattern (conditional transform ternary containing
    # Animated.multiply) must not reappear.
    forbidden_ternary = re.compile(
        r"transform:\s*teleprompterActive\s*&&\s*teleprompterPlaying"
    )
    assert not forbidden_ternary.search(src), (
        "record.tsx contains the forbidden conditional transform pattern "
        "`transform: teleprompterActive && teleprompterPlaying ? [...] : []`. "
        "This causes an immediate native crash on Fabric/Android 16 at Start "
        "Recording because a natively-driven AnimatedInterpolation cannot be "
        "safely injected into a component's style AFTER mount."
    )


def test_teleprompter_toggle_still_pauses_on_off() -> None:
    """The play/pause semantics must still be wired: toggling teleprompter
    off must call pauseTeleprompter(), and toggling play state must swap."""
    src = _read("app/selftape/record.tsx")
    # Very light contract check — do not overspecify the internals.
    assert "pauseTeleprompter()" in src
    assert "startTeleprompter()" in src


def test_start_recording_path_intact_and_fabric_safe() -> None:
    """Guard the exact Start Recording flow that crashed on Samsung SM-S918B
    Android 16 in QA build after the initial Phase 3 teleprompter fix.

    Contract:
      * startRecording() still calls recordAsync + starts the duration timer.
      * When teleprompterActive is true, startTeleprompter() is invoked (this
        flips teleprompterPlaying → true, which previously triggered the
        conditional-transform crash).
      * The Fabric-safe pattern (memoized interpolation + unconditional
        transform) MUST be in place so setTeleprompterPlaying(true) does not
        mutate the JSX transform structure.
    """
    src = _read("app/selftape/record.tsx")

    # 1. startRecording still calls recordAsync + wires the timer.
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

    # 2. startRecording still triggers startTeleprompter when active — this
    #    is the exact path that crashed pre-fix.
    assert "if (teleprompterActive)" in body
    assert "startTeleprompter()" in body

    # 3. The Fabric-safe guard-rails must be present (mirror of test above).
    assert "teleprompterTranslateY" in src, (
        "The memoized teleprompterTranslateY interpolation is missing — "
        "Start Recording will crash on Fabric/Android 16 when it flips "
        "teleprompterPlaying → true."
    )


def test_useMemo_dependency_array_is_empty_for_teleprompter_translateY() -> None:
    """The memoized interpolation must be stable across renders. If someone
    later adds `teleprompterAnim` to the useMemo deps, the interpolation
    would be recreated on every render (since teleprompterAnim is a stable
    ref, deps would evaluate as unchanged) — but a lint-fix could add
    `teleprompterActive` or similar, breaking the invariant. Lock the
    empty-deps contract."""
    src = _read("app/selftape/record.tsx")
    # Match the specific useMemo block for teleprompterTranslateY.
    pattern = re.compile(
        r"teleprompterTranslateY\s*=\s*useMemo\(\s*"
        r"\(\)\s*=>\s*Animated\.multiply\(teleprompterAnim,\s*-1\)\s*,\s*"
        r"(?://[^\n]*\n\s*)*"          # allow eslint-disable comments
        r"\[\s*\]",                     # empty dependency array
        re.DOTALL,
    )
    assert pattern.search(src), (
        "teleprompterTranslateY useMemo MUST have an EMPTY dependency array. "
        "Anything else would recreate the AnimatedInterpolation on renders "
        "and re-introduce the Fabric registration crash."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Shared: neither fix touched the working camera / recording path
# ─────────────────────────────────────────────────────────────────────────────

def test_camera_and_recording_flow_unchanged() -> None:
    """Guard the working recording contract: recordAsync usage, stopRecording,
    action-sheet trigger, and retake reset must remain intact."""
    src = _read("app/selftape/record.tsx")
    assert "cameraRef.current.recordAsync({" in src
    assert "cameraRef.current.stopRecording()" in src
    assert "setShowActionSheet(true)" in src
    # Retake resets state
    assert "setRecordedVideoUri(null)" in src
    assert "setRecordingDuration(0)" in src


def test_selftape_hub_premium_gate_unchanged() -> None:
    """Phase 2/3 QA_PREMIUM propagation must still be wired: the hub must
    still consume useRevenueCat and the paywall redirect must remain."""
    src = _read("app/selftape/index.tsx")
    assert "useRevenueCat()" in src
    assert "router.push('/premium')" in src


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
