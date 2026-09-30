"""Regression guard: V1 navigation cleanup — Home / More section no
longer renders the standalone "Upload Script" NavRow.

Contract:
- The redundant `testId="upload-row"` NavRow pointing at `/upload` is
  removed from `app/index.tsx`.
- The "New Script" tool tile (route `/script-parser`) remains — that
  is the primary entry point for PDF / DOCX / TXT imports.
- The "My Scripts" tool tile (route `/scripts`) remains — the library.
- The underlying upload/import surface is preserved:
    * `app/upload.tsx` still exists (deep-links, programmatic
      navigation).
    * The `/upload` route is still registered in `app/_layout.tsx`.
    * The backend `/api/scripts/upload` and `/api/scripts/upload-base64`
      endpoints still exist.
- No unrelated Home navigation entries changed.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
BACKEND = Path(__file__).resolve().parents[1]

INDEX = FRONTEND / "app" / "index.tsx"
LAYOUT = FRONTEND / "app" / "_layout.tsx"
UPLOAD_SCREEN = FRONTEND / "app" / "upload.tsx"
SERVER = BACKEND / "server.py"


def _index() -> str:
    return INDEX.read_text()


# ─── 1. THE STANDALONE ENTRY IS GONE ────────────────────────────────────


def test_more_section_no_longer_renders_upload_script_navrow():
    src = _index()
    assert 'testId="upload-row"' not in src, (
        "the standalone 'Upload Script' NavRow (testId='upload-row') "
        "must be removed from the More section"
    )
    # Guard against the exact rendered NavRow title attribute reappearing.
    # (An unrelated occurrence inside a code comment describing this
    # removal is intentionally allowed.)
    assert 'title="Upload Script"' not in src, (
        "the NavRow title='Upload Script' must not appear on the Home "
        "screen anymore"
    )


def test_upload_route_string_not_referenced_from_home():
    """The Home screen must no longer push users to `/upload` from a
    surfaced menu entry. Deep-links from elsewhere in the app remain
    allowed (the route itself is preserved)."""
    src = _index()
    # Neither `route="/upload"` (NavRow prop) nor `router.push('/upload')`
    # should exist in the Home screen anymore.
    assert 'route="/upload"' not in src
    assert "router.push('/upload')" not in src
    assert 'router.push("/upload")' not in src


# ─── 2. NEW SCRIPT ENTRY POINT INTACT ───────────────────────────────────


def test_new_script_tile_present_and_routes_to_script_parser():
    src = _index()
    assert 'testId="new-script-btn"' in src, (
        "'New Script' tool tile must remain on the Home screen"
    )
    # The label + route must match the primary import flow.
    assert '"New Script"' in src
    m = re.search(
        r"testId=\"new-script-btn\"|label=\"New Script\"",
        src,
    )
    assert m, "New Script tile must be rendered"
    # The route to the parser/importer must remain wired.
    assert 'route="/script-parser"' in src, (
        "'New Script' must route to /script-parser (the primary "
        "PDF/DOCX/TXT import surface)"
    )


# ─── 3. UNDERLYING UPLOAD / IMPORT SURFACE PRESERVED ────────────────────


def test_upload_screen_component_still_exists():
    """`app/upload.tsx` must still exist. Route file removal would
    break deep-links and programmatic navigation. Only the *menu
    entry* was removed by this task."""
    assert UPLOAD_SCREEN.exists(), (
        "app/upload.tsx must remain — the underlying upload/import "
        "flow is preserved, only the redundant menu entry is removed"
    )
    src = UPLOAD_SCREEN.read_text()
    assert "export default function UploadScreen" in src
    # Verify the PDF/DOCX/TXT extraction paths remain wired.
    assert "/api/scripts/upload" in src, (
        "upload screen must still POST to /api/scripts/upload"
    )
    assert "/api/scripts/upload-base64" in src, (
        "upload screen must still POST to /api/scripts/upload-base64 "
        "(binary fallback path)"
    )


def test_upload_route_still_registered_in_router_layout():
    src = LAYOUT.read_text()
    assert '"upload"' in src, (
        "the 'upload' Stack.Screen must remain registered so deep-links "
        "and programmatic pushes continue to work"
    )


def test_backend_upload_endpoints_still_exist():
    src = SERVER.read_text()
    assert '@api_router.post("/scripts/upload")' in src, (
        "backend POST /api/scripts/upload endpoint must remain — this "
        "task removed a UI entry, not the API"
    )
    assert '@api_router.post("/scripts/upload-base64")' in src, (
        "backend POST /api/scripts/upload-base64 endpoint must remain"
    )


# ─── 4. MY SCRIPTS INTACT ───────────────────────────────────────────────


def test_my_scripts_tile_present_and_routes_to_scripts():
    src = _index()
    assert 'testId="my-scripts-btn"' in src
    assert '"My Scripts"' in src
    assert 'route="/scripts"' in src


# ─── 5. NO UNRELATED NAVIGATION ENTRIES CHANGED ─────────────────────────


REQUIRED_HOME_NAV_ENTRIES = [
    # 3×2 primary actor-tool grid (2026-02 reconciliation).
    ('testId="selftape-btn"',      'route="/selftape"'),
    ('testId="voice-studio-btn"',  'route="/voice-studio"'),
    ('testId="new-script-btn"',    'route="/script-parser"'),
    ('testId="my-scripts-btn"',    'route="/scripts"'),
    ('testId="recall-btn"',        'route="/recall"'),
    ('testId="auditions-btn"',     'route="/auditions"'),
    # More section (post-reconciliation — Voice Studio + Auditions moved
    # into the primary grid; only Dashboard + Support remain here).
    ('testId="dashboard-row"',     'route="/dashboard"'),
    ('testId="support-row"',       'route="/support"'),
]


def test_all_other_home_nav_entries_still_present_and_wired():
    src = _index()
    for testid_attr, route_attr in REQUIRED_HOME_NAV_ENTRIES:
        assert testid_attr in src, (
            f"missing required home nav entry: {testid_attr}"
        )
        assert route_attr in src, (
            f"missing required home nav route: {route_attr}"
        )


def test_daily_drill_banner_and_premium_banner_still_present():
    """Sanity: these Home-screen affordances are unrelated to the
    upload cleanup and must not have moved."""
    src = _index()
    assert 'data-testid="daily-drill-banner"' in src
    assert 'data-testid="premium-banner"' in src


def test_streak_pill_still_navigates_to_daily_drill():
    src = _index()
    assert 'data-testid="streak-pill"' in src
    assert "router.push('/daily-drill')" in src


# ─── 6. STRUCTURAL GUARD — MORE SECTION HAS EXACTLY 4 ROWS ──────────────


def test_more_section_now_contains_exactly_two_navrows():
    """After the 2026-02 reconciliation, Voice Studio + Auditions were
    promoted into the primary 3×2 grid, so the More section must
    contain exactly 2 NavRow entries: Dashboard, Support. A stray 3rd
    (e.g. the accidentally re-added upload row, or a re-demoted Voice
    Studio) would fail this test."""
    src = _index()
    more_pos = src.find("─── MORE TOOLS ───")
    assert more_pos != -1, "'MORE TOOLS' section marker not found"
    after_more = src[more_pos:]
    nav_rows = re.findall(r"<NavRow\b", after_more)
    assert len(nav_rows) == 2, (
        f"expected exactly 2 NavRow entries in the More section, "
        f"found {len(nav_rows)}"
    )
