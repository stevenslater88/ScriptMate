"""Regression guard: Feb-2026 Home layout reconciliation.

After the physical QA of APK 1110 the tester reported that Voice
Studio was still under "More" although every other Feb-2026 wiring
change (Reader Style + Voice Speed + Multi-Voice) was present. This
test file locks the reconciled contract:

- Quick Rehearse remains the full-width hero button.
- The primary actor-tool grid is a 3-col × 2-row layout of SIX tiles:
      Self Tape | Voice Studio | New Script
      My Scripts | Recall     | Auditions
  All six use the 3×2 style (`st.grid3x2`).
- The old 4-tool grid (`st.grid4`) is unreferenced (the CSS rule may
  linger for stylistic consistency, but nothing in the JSX must
  render `st.grid4`).
- The More section holds ONLY `Dashboard` and `Support`.
- The AI Coming Soon section renders and lists all five items:
      AI Rehearsal Partner
      AI Line Coach
      AI Scene Coach
      AI Script Assistant
      World-Class Dialect Coach
- Upload Script menu entry is not re-introduced.
- Underlying `/upload` deep-link route and `app/upload.tsx` remain.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
BACKEND = Path(__file__).resolve().parents[1]

INDEX = FRONTEND / "app" / "index.tsx"
LAYOUT = FRONTEND / "app" / "_layout.tsx"
COMING_SOON = FRONTEND / "components" / "AIComingSoonSection.tsx"
UPLOAD_SCREEN = FRONTEND / "app" / "upload.tsx"


def _index() -> str:
    return INDEX.read_text()


# ─── QUICK REHEARSE ──────────────────────────────────────────────────


def test_quick_rehearse_hero_remains_full_width_button():
    src = _index()
    assert "Quick Rehearse" in src
    # Uses the dedicated hero style (single line), not a grid tile.
    assert "st.heroH" in src
    assert re.search(r"style=\{st\.hero\}", src), (
        "Quick Rehearse must remain the dedicated hero button (uses st.hero)"
    )


# ─── 3×2 PRIMARY GRID ────────────────────────────────────────────────


def test_primary_grid_renders_with_grid3x2_style():
    src = _index()
    assert "st.grid3x2" in src, (
        "Home primary grid must render inside a View styled with st.grid3x2"
    )
    # The rendered grid element is a `<View style={st.grid3x2}>`.
    m = re.search(r"<View\s+style=\{st\.grid3x2\}>", src)
    assert m, "the 3×2 grid <View> is not present in JSX"


def test_primary_grid_contains_exactly_six_tiles_in_order():
    """The order matters — the reconciliation spec was:
        row 1: Self Tape · Voice Studio · New Script
        row 2: My Scripts · Recall     · Auditions
    """
    src = _index()
    m = re.search(
        r"<View\s+style=\{st\.grid3x2\}>(.*?)</View>",
        src, re.DOTALL,
    )
    assert m, "grid3x2 View block not found"
    body = m.group(1)
    # ToolCard attributes are single-line but JSX prop order is
    # route=... before testId=... in this file. Match both explicitly.
    tiles = re.findall(
        r'route="(/[a-z\-]+)"\s+testId="([a-z\-]+)"',
        body,
    )
    # Normalize to (testId, route) tuples for comparison.
    tiles = [(t, r) for (r, t) in tiles]
    expected = [
        ("selftape-btn",     "/selftape"),
        ("voice-studio-btn", "/voice-studio"),
        ("new-script-btn",   "/script-parser"),
        ("my-scripts-btn",   "/scripts"),
        ("recall-btn",       "/recall"),
        ("auditions-btn",    "/auditions"),
    ]
    assert tiles == expected, (
        f"grid tile order/content mismatch. Expected {expected}, got {tiles}"
    )


def test_old_grid4_is_not_referenced_in_jsx():
    """The 4-tool layout must no longer be rendered. The CSS rule
    itself may still exist (for parity with older diffs) but no JSX
    node may reference `st.grid4`."""
    src = _index()
    # No JSX site consumes st.grid4.
    assert "<View style={st.grid4}>" not in src


# ─── VOICE STUDIO PROMOTION ──────────────────────────────────────────


def test_voice_studio_is_now_a_primary_tile_not_a_more_navrow():
    """Voice Studio was previously a <NavRow> under More. After the
    reconciliation it must be a <ToolCard> in the primary grid, and
    it must NOT appear as a NavRow anywhere."""
    src = _index()
    # Positive: ToolCard for Voice Studio.
    assert re.search(
        r'<ToolCard\b[^>]*label="Voice Studio"[^>]*route="/voice-studio"',
        src,
    ), "Voice Studio must render as a <ToolCard> in the primary grid"
    # Negative: no NavRow for Voice Studio anywhere.
    assert not re.search(
        r'<NavRow\b[^>]*title="Voice Studio"',
        src,
    ), (
        "Voice Studio must NOT render as a <NavRow> — it was promoted "
        "into the primary grid"
    )
    # Its NavRow testId must not appear anywhere.
    assert 'testId="voice-studio-row"' not in src


def test_auditions_is_now_a_primary_tile_not_a_more_navrow():
    src = _index()
    assert re.search(
        r'<ToolCard\b[^>]*label="Auditions"[^>]*route="/auditions"',
        src,
    ), "Auditions must render as a <ToolCard> in the primary grid"
    assert not re.search(
        r'<NavRow\b[^>]*title="Auditions"',
        src,
    )
    assert 'testId="auditions-row"' not in src


# ─── MORE SECTION SHRUNK ─────────────────────────────────────────────


def test_more_section_has_only_two_entries_now():
    src = _index()
    more_pos = src.find("─── MORE TOOLS ───")
    assert more_pos != -1
    after_more = src[more_pos:]
    nav_rows = re.findall(r"<NavRow\b", after_more)
    assert len(nav_rows) == 2, (
        f"More section must have exactly 2 NavRow entries "
        f"(Dashboard, Support); found {len(nav_rows)}"
    )
    # Explicit identity check on the two survivors.
    assert 'testId="dashboard-row"' in after_more
    assert 'testId="support-row"' in after_more


def test_upload_script_entry_still_absent_after_reconciliation():
    """The previous cleanup removed 'Upload Script' from the More
    menu — this test locks that removal against the reconciliation."""
    src = _index()
    assert 'testId="upload-row"' not in src
    assert 'title="Upload Script"' not in src
    assert 'route="/upload"' not in src


def test_upload_route_and_screen_preserved_for_deeplinks():
    """The underlying upload flow must still be available for
    deep-links even though it isn't surfaced in the Home menu."""
    assert UPLOAD_SCREEN.exists(), "app/upload.tsx must remain"
    layout = LAYOUT.read_text()
    assert '"upload"' in layout, (
        "/upload Stack.Screen must remain registered in the router layout"
    )


# ─── AI COMING SOON SECTION ──────────────────────────────────────────


def test_ai_coming_soon_section_is_rendered_on_home():
    src = _index()
    assert "import AIComingSoonSection" in src
    assert "<AIComingSoonSection />" in src


def test_ai_coming_soon_section_lists_all_five_planned_features():
    src = COMING_SOON.read_text()
    required_titles = [
        "AI Rehearsal Partner",
        "AI Line Coach",
        "AI Scene Coach",
        "AI Script Assistant",
        "World-Class Dialect Coach",
    ]
    for title in required_titles:
        assert f"title: '{title}'" in src, (
            f"AIComingSoonSection must list '{title}'"
        )


# ─── RECONCILED-BUILD FEATURE PARITY: Reader Style + Multi-Voice
#     stayed intact — quick guards so this reconciliation didn't
#     regress the earlier prompt's wiring.
# ─────────────────────────────────────────────────────────────────────


def test_rehearsal_still_consumes_reader_style_and_voice_speed():
    src = (FRONTEND / "app" / "rehearsal" / "[id].tsx").read_text()
    assert "currentRehearsal?.reader_style" in src
    assert "currentRehearsal?.voice_speed" in src
    assert re.search(
        r"getVoiceSettings\s*\(\s*voiceType\s*,\s*readerVoiceSpeed", src
    )


def test_rehearsal_still_loads_multi_voice_assignments():
    import re
    src = (FRONTEND / "app" / "rehearsal" / "[id].tsx").read_text()
    assert "loadVoiceAssignments(scriptId)" in src
    # Accept either the 2-arg legacy form or the 3-arg form that also
    # forwards readerStyle + voiceSpeed (Feb-2026 emotion/speed fix).
    assert (
        "playSpeech(text, assignment.voiceId)" in src
        or re.search(
            r"playSpeech\(\s*text\s*,\s*assignment\.voiceId\s*,\s*\{",
            src,
        )
    )


def test_voice_studio_script_picker_intact_after_promotion():
    """Voice Studio being promoted to the grid must not affect its own
    internal script-picker feature — sanity check on the screen file."""
    src = (FRONTEND / "app" / "voice-studio.tsx").read_text()
    assert 'data-testid="choose-script-btn"' in src
    assert 'data-testid="script-picker-modal"' in src


def test_scene_partner_still_untouched_by_reconciliation():
    """Reconciliation must not touch Scene Partner. Its Reader Style
    and Cue Timing were proven working and must remain that way."""
    src = (FRONTEND / "app" / "scene-partner.tsx").read_text()
    assert "playSpeech" not in src
    assert "elevenLabsService" not in src
    assert re.search(
        r"Speech\.speak\s*\([^)]*rate:\s*style\.rate[^)]*pitch:\s*style\.pitch",
        src, re.DOTALL,
    )
