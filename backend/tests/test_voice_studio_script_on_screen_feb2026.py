"""Regression guard for Voice Studio (Feb 2026).

Physical QA on build 1.0.57 reported Voice Studio failing on the S23
Ultra. Root cause: SDK 54 moved `documentDirectory` / `EncodingType`
from the top-level `expo-file-system` export to
`expo-file-system/legacy`. The bare import in
`services/voiceStudioStorage.ts` and `app/voice-studio.tsx` returned
`undefined` for those constants, so every recording save threw
"documentDirectory is not available" in `ensureDir()`.

This file locks in:
1. The fixed legacy import — parity of both files.
2. The new "script-on-screen recording" UX contract — script picker,
   character chips, on-screen script panel with active-line highlight,
   Prev/Next navigation, script metadata wired into saved takes,
   graceful empty state, script picker modal.
3. The unchanged pre-existing behaviour: record / stop / retake /
   save controls, entitlement (voice-studio is a premium feature —
   handled elsewhere in the app; this file does not touch it).

All tests are static — read the source files and assert invariants.
No HTTP, no mocking, no runtime.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
STORAGE = FRONTEND / "services" / "voiceStudioStorage.ts"
SCREEN = FRONTEND / "app" / "voice-studio.tsx"


def _storage() -> str:
    return STORAGE.read_text()


def _screen() -> str:
    return SCREEN.read_text()


# ─── 1. ROOT-CAUSE FIX — SDK 54 legacy import in BOTH files ─────────────


def test_voice_studio_storage_uses_legacy_filesystem_import():
    """`voiceStudioStorage.ts` MUST import from
    `expo-file-system/legacy` so `documentDirectory` / `EncodingType`
    are defined. This is the exact regression that broke Voice Studio
    on the physical device."""
    src = _storage()
    assert (
        "from 'expo-file-system/legacy'" in src
        or 'from "expo-file-system/legacy"' in src
    ), (
        "voiceStudioStorage.ts must import from 'expo-file-system/legacy'; "
        "the bare 'expo-file-system' import returns undefined for "
        "documentDirectory in SDK 54 and broke recording saves."
    )
    # And it must NOT still have the broken bare import.
    assert (
        "from 'expo-file-system';" not in src
        and 'from "expo-file-system";' not in src
    ), "the broken bare 'expo-file-system' import must be removed"


def test_voice_studio_screen_uses_legacy_filesystem_import():
    """Same requirement for `app/voice-studio.tsx` — it also references
    `FileSystem.documentDirectory` and `FileSystem.EncodingType`."""
    src = _screen()
    assert (
        "from 'expo-file-system/legacy'" in src
        or 'from "expo-file-system/legacy"' in src
    )
    assert (
        "from 'expo-file-system';" not in src
        and 'from "expo-file-system";' not in src
    ), "the broken bare 'expo-file-system' import must be removed"


def test_ensuredir_still_guards_against_null_document_directory():
    """The existing guard rail — throw if `documentDirectory` is still
    null even after the legacy import — must remain. This gives a
    clean error message rather than silently writing to
    `'undefined/voice-studio/'`."""
    src = _storage()
    assert "documentDirectory is not available" in src, (
        "ensureDir() must retain the explicit guard so any future SDK "
        "regression fails loudly."
    )


# ─── 2. ROUTE / MOUNT / LOAD STATE ──────────────────────────────────────


def test_voice_studio_route_is_registered():
    layout = (FRONTEND / "app" / "_layout.tsx").read_text()
    assert '"voice-studio"' in layout, (
        "voice-studio Stack.Screen must be registered in the router layout"
    )


def test_voice_studio_load_data_and_fetch_scripts_are_called_on_mount():
    """On mount, both the takes/reels loader AND the script list must
    be fetched. Empty scripts is handled gracefully via the picker."""
    src = _screen()
    # loadData() runs on mount.
    assert re.search(r"useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*loadData\(\)", src, re.DOTALL), (
        "loadData() must be invoked from a mount-time useEffect"
    )
    # fetchScripts() runs on mount too (non-blocking).
    assert "fetchScripts()" in src, (
        "fetchScripts() must be invoked on mount so the picker has data"
    )


def test_voice_studio_load_error_banner_and_retry_present():
    src = _screen()
    # Error surface with a retry
    assert 'data-testid="voice-studio-error-banner"' in src
    assert 'data-testid="voice-studio-retry-btn"' in src


# ─── 3. SCRIPT MATERIAL SELECTION ───────────────────────────────────────


def test_script_picker_ui_exists():
    src = _screen()
    assert 'data-testid="script-picker-row"' in src, (
        "record tab must expose a script-picker-row"
    )
    assert 'data-testid="choose-script-btn"' in src, (
        "record tab must expose the 'Choose Script' button"
    )
    assert 'data-testid="script-picker-modal"' in src, (
        "the picker itself must be a Modal with testid script-picker-modal"
    )


def test_script_picker_shows_empty_state_and_deep_links_to_library():
    src = _screen()
    assert 'data-testid="script-picker-empty"' in src, (
        "empty-scripts state must be rendered inside the picker modal"
    )
    assert 'data-testid="script-picker-goto-library"' in src, (
        "empty state must give the user a CTA to the Scripts Library"
    )
    assert "router.push('/scripts')" in src, (
        "empty-state CTA must navigate to /scripts (the Library route)"
    )


def test_script_picker_populates_from_scriptStore():
    src = _screen()
    assert "useScriptStore" in src, (
        "voice-studio.tsx must consume useScriptStore — the same source "
        "of truth used by the Library / Rehearsal screens"
    )
    assert re.search(r"\{\s*scripts\s*,\s*fetchScripts\s*\}\s*=\s*useScriptStore", src), (
        "scripts and fetchScripts must be destructured from useScriptStore"
    )


def test_selected_script_state_exists():
    src = _screen()
    assert "setSelectedScript" in src and "selectedScript" in src
    assert "setSelectedCharacter" in src and "selectedCharacter" in src


def test_character_chips_include_all_and_per_character():
    src = _screen()
    assert 'data-testid="voice-studio-character-chips"' in src
    assert 'data-testid="char-chip-all"' in src, (
        "an 'All lines' chip must exist alongside per-character chips"
    )
    # Per-character chips are keyed by name; check the template is present.
    assert 'data-testid={`char-chip-${c.name}`}' in src


# ─── 4. ON-SCREEN SCRIPT WHILE RECORDING ────────────────────────────────


def test_script_panel_renders_and_highlights_active_line():
    src = _screen()
    assert 'data-testid="voice-studio-script-panel"' in src, (
        "the on-screen script panel must be present"
    )
    # The active line's testid is applied conditionally (only when
    # isActive). Accept either the literal double-quoted form or the
    # JSX-expression form using single quotes.
    assert (
        'data-testid="active-script-line"' in src
        or "'active-script-line'" in src
    ), (
        "the currently active line must be tagged for highlight/testing"
    )
    # Two navigation buttons for stepping through lines
    assert 'data-testid="prev-line-btn"' in src
    assert 'data-testid="next-line-btn"' in src
    # activeLineIndex state present
    assert "setActiveLineIndex" in src and "activeLineIndex" in src


def test_script_panel_does_not_block_recording_controls():
    """The waveform/record controls must still render AFTER the script
    panel — the script panel is additive, not a replacement."""
    src = _screen()
    # Script panel appears before the waveform in the Record tab flow
    panel_pos = src.find('data-testid="voice-studio-script-panel"')
    wave_pos = src.find("styles.waveformContainer")
    record_btn = src.find('data-testid="start-record-btn"')
    stop_btn = src.find('data-testid="stop-record-btn"')
    assert panel_pos != -1
    assert wave_pos > panel_pos, (
        "waveform must render below the script panel, not be replaced"
    )
    assert record_btn > wave_pos, "start-record-btn must remain in Record tab"
    assert stop_btn > record_btn, "stop-record-btn must follow start-record-btn"


def test_script_panel_filters_by_selected_character():
    src = _screen()
    # When a character is chosen, only their non-direction lines show.
    assert re.search(
        r"selectedCharacter\s*\?\s*selectedScript\.lines\.filter\(",
        src,
    ), (
        "when a character is selected, the display list must filter to "
        "that character's dialogue lines only"
    )
    assert "is_stage_direction" in src, (
        "the filter must exclude stage directions for the selected character"
    )


# ─── 5. RECORD / STOP / SAVE / RETAKE / PLAYBACK STATE TRANSITIONS ──────


def test_existing_recording_controls_intact():
    src = _screen()
    for tid in (
        "start-record-btn",
        "stop-record-btn",
        "pause-resume-btn",
    ):
        assert f'data-testid="{tid}"' in src, (
            f"pre-existing recording control '{tid}' must remain"
        )


def test_playback_control_intact():
    """Existing per-take play control (used for retake/review) still there."""
    src = _screen()
    assert 'data-testid={`play-take-${take.id}`}' in src


def test_saveTake_now_includes_script_metadata_when_selected():
    src = _screen()
    # The saveTake call must pass through selectedScript.id + title
    m = re.search(
        r"saveTake\s*\(\s*\n?\s*uri\s*,\s*\n?\s*name\s*,\s*\n?\s*recDuration\s*,\s*"
        r"\n?\s*selectedScript\?\.id\s*,\s*\n?\s*selectedScript\?\.title",
        src,
    )
    assert m, (
        "saveTake must be invoked with selectedScript?.id and "
        "selectedScript?.title so the take is linked to its material"
    )


def test_take_name_appends_script_and_character_when_present():
    src = _screen()
    # The name mangling must include the selected script/character.
    assert "scriptSuffix" in src
    assert re.search(r"selectedScript\.title\.slice\(0,\s*30\)", src), (
        "the take name must be augmented with the script title when a "
        "script is selected (truncated to 30 chars for tidiness)"
    )


# ─── 6. ENTITLEMENT / PREMIUM BEHAVIOUR UNCHANGED ───────────────────────


def test_voice_studio_screen_does_not_bypass_existing_entitlement_flow():
    """The Voice Studio entitlement gate lives at the entry point in
    `services/entitlements*.ts` / `services/revenuecat.ts` — not in the
    screen itself. This test proves we did NOT introduce a new premium
    check or bypass in the screen (which would silently affect free vs
    Pro behaviour)."""
    src = _screen()
    # We should not have added new isPremium / entitlement gates here.
    banned = ["isPremium", "entitlement", "checkEntitlement", "revenuecat"]
    for token in banned:
        assert token.lower() not in src.lower(), (
            f"voice-studio.tsx must not introduce '{token}' — the "
            f"existing entitlement flow already handles premium access"
        )


# ─── 7. SAVETAKE STORAGE CONTRACT UNCHANGED ─────────────────────────────


def test_savetake_signature_supports_script_metadata():
    src = _storage()
    m = re.search(
        r"export\s+const\s+saveTake\s*=\s*async\s*\(\s*"
        r"tempUri:\s*string,\s*"
        r"name:\s*string,\s*"
        r"duration:\s*number,\s*"
        r"scriptId\?:\s*string,\s*"
        r"scriptTitle\?:\s*string,?\s*"
        r"\)",
        src,
    )
    assert m, (
        "saveTake's signature must still accept the optional "
        "scriptId + scriptTitle metadata (existing contract)"
    )


def test_voice_take_interface_carries_script_metadata_fields():
    src = _storage()
    assert re.search(r"scriptId\?:\s*string;", src)
    assert re.search(r"scriptTitle\?:\s*string;", src)


# ─── 8. NO NEW AUDIO / RECORDING DEPENDENCY INTRODUCED ──────────────────


def test_no_new_audio_dependencies_added_to_voice_studio():
    src = _screen()
    imports = re.findall(r"^import [^;]+;", src, re.MULTILINE)
    banned_new = [
        "react-native-audio-recorder",
        "react-native-audio",
        "expo-audio-recorder",
        "@react-native-community/voice",
        "react-native-sound",
    ]
    for imp in imports:
        for pkg in banned_new:
            assert pkg not in imp, (
                f"forbidden new audio dependency introduced: {pkg} — "
                f"reuse the existing expo-av Audio.Recording pipeline"
            )
    # We must still use expo-av Audio for recording — nothing swapped.
    assert "from 'expo-av'" in src or 'from "expo-av"' in src, (
        "voice-studio.tsx must continue using expo-av for recording"
    )


# ─── 9. UI CONSISTENCY WITH REHEARSAL / SELF-TAPE ───────────────────────


def test_voice_studio_uses_safeareaview_and_ionicons_like_other_screens():
    """Consistency check — the screen should still follow the pattern
    used by Rehearsal / Self-Tape (SafeAreaView + Ionicons)."""
    src = _screen()
    assert "SafeAreaView" in src
    assert "from '@expo/vector-icons'" in src
