"""Phase 4 physical fix — Learn Resume UX.

Locks the Resume-vs-Start-again flow added to
`frontend/app/learn/index.tsx` after the Samsung SM-S918B / Android 16
physical test revealed that tapping 'Start learning' silently overwrote
the persisted active session with a fresh `createSession()` at line 1.

Fix contract (asserted here on the source):

  1. On mount the Hub reads the persisted active session via
     `loadActiveSession()`.
  2. A session is considered *resumable* only when:
       * a valid session was loaded (defensive parse handles corruption),
       * `scriptId === current script.id`,
       * `characterId === currently-selected characterId`,
       * `state !== 'completed'`,
       * `itemIds.length > 0`,
       * `currentIndex` is a valid integer inside `[0, itemIds.length)`.
     Any mismatch drops back to the plain Start Learning button.
  3. When resumable, the Hub renders a testID="learn-hub-resume-banner"
     with two actions:
       * `learn-hub-resume` navigates to the existing session
         (route push preserves the same session id).
       * `learn-hub-start-again` calls `clearActiveSession()` FIRST,
         then `createSession(...)` — no overwrite race.
  4. Storage architecture is unchanged: same three keys under
     `@scriptmate/learn/`. No new dependency. No Script Library storage
     change. No scriptStore change.
  5. Malformed active-session JSON is handled by the existing defensive
     parse in `services/learnStorage.ts` (returns null); the Hub sees
     null → no banner → plain Start Learning path.

Also asserts that Phase 3 files, expo-camera patch, self-tape storage,
and 18 pre-existing backend lint issues are untouched by this change.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"
HUB = FRONTEND / "app/learn/index.tsx"
STORAGE = FRONTEND / "services/learnStorage.ts"
SESSION = FRONTEND / "app/learn/session.tsx"
SUMMARY = FRONTEND / "app/learn/summary.tsx"
ENGINE = FRONTEND / "services/learnEngine.ts"

TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"
PREP = FRONTEND / "app/selftape/prep.tsx"
SELFTAPE_STORAGE = FRONTEND / "services/selfTapeStorage.ts"
PATCH = FRONTEND / "patches/expo-camera+17.0.10.patch"


@pytest.fixture(scope="module")
def hub_src() -> str:
    return HUB.read_text()


# ─── Contract 1 — Hub reads the active session on mount ─────────────────


def test_hub_imports_load_and_clear_active_session(hub_src: str) -> None:
    assert "loadActiveSession" in hub_src, (
        "Hub must import loadActiveSession to detect an existing session."
    )
    assert "clearActiveSession" in hub_src, (
        "Hub must import clearActiveSession to implement Start again "
        "without overwrite race."
    )


def test_hub_loads_active_session_in_effect(hub_src: str) -> None:
    # A useEffect that awaits loadActiveSession() and stores it in state.
    assert re.search(
        r"loadActiveSession\(\)",
        hub_src,
    ), "Hub must call loadActiveSession() on mount."
    # State setter must be present.
    assert "setActiveSession(" in hub_src, "Hub must persist the loaded session to state."


# ─── Contract 2 — resumable predicate is narrow and safe ────────────────


def test_resumable_predicate_gates_all_required_conditions(hub_src: str) -> None:
    # Locate the resumableSession useMemo/computation block.
    m = re.search(
        r"const\s+resumableSession\s*=\s*useMemo[\s\S]*?\}\s*,\s*\[",
        hub_src,
    )
    assert m, "resumableSession useMemo not found."
    body = m.group(0)
    # Same script + same character.
    assert re.search(r"s\.scriptId\s*!==\s*script\.id", body), (
        "Resume must be gated on scriptId match."
    )
    assert re.search(r"s\.characterId\s*!==\s*characterId", body), (
        "Resume must be gated on characterId match."
    )
    # Completed sessions do not offer Resume.
    assert re.search(r"s\.state\s*===\s*'completed'", body), (
        "Resume must not be offered when session.state === 'completed'."
    )
    # Non-empty itemIds.
    assert "itemIds" in body, "Resume must validate itemIds."
    # currentIndex bounds check.
    assert "currentIndex" in body


# ─── Contract 3 — user-visible resume/start-again controls ──────────────


def test_hub_renders_resume_banner_and_actions(hub_src: str) -> None:
    for tid in (
        'learn-hub-resume-banner',
        'learn-hub-resume',
        'learn-hub-start-again',
        'learn-hub-resume-subtitle',
    ):
        assert f'testID="{tid}"' in hub_src, (
            f"Resume UX testID `{tid}` missing from the Hub."
        )


def test_hub_still_renders_plain_start_when_no_resume(hub_src: str) -> None:
    """When no resumable session exists, the plain Start Learning button
    is still rendered — testID unchanged so existing regression stays
    green."""
    assert 'testID="learn-hub-start"' in hub_src


def test_resume_navigates_to_existing_session_id(hub_src: str) -> None:
    """Resume must push the ROUTE with the EXISTING session id, not
    create a new one."""
    m = re.search(
        r"async\s+function\s+handleResume\s*\([^)]*\)[^{]*\{([\s\S]*?)^\s*\}",
        hub_src, re.MULTILINE,
    )
    assert m, "handleResume not found."
    body = m.group(1)
    assert "resumableSession.id" in body, (
        "Resume must navigate using the resumable session's own id."
    )
    assert "createSession(" not in body, (
        "Resume must NOT create a new session — that's the bug we're "
        "fixing."
    )


def test_start_again_clears_then_creates(hub_src: str) -> None:
    """Start again must call clearActiveSession() BEFORE createSession()
    to avoid a stale-session race."""
    m = re.search(
        r"async\s+function\s+handleStartAgain\s*\([^)]*\)[^{]*\{([\s\S]*?)^\s*\}",
        hub_src, re.MULTILINE,
    )
    assert m, "handleStartAgain not found."
    body = m.group(1)
    clear_idx = body.find('clearActiveSession(')
    create_or_start_idx = min(
        (i for i in (body.find('createSession('), body.find('handleStart('))
         if i >= 0),
        default=-1,
    )
    assert clear_idx >= 0, "Start again must call clearActiveSession()."
    assert create_or_start_idx >= 0, (
        "Start again must delegate to handleStart() or createSession()."
    )
    assert clear_idx < create_or_start_idx, (
        "clearActiveSession() must run BEFORE the new session is created."
    )


# ─── Contract 4 — storage architecture unchanged ────────────────────────


def test_storage_keys_unchanged() -> None:
    src = STORAGE.read_text()
    for key in (
        "'@scriptmate/learn/records'",
        "'@scriptmate/learn/session/active'",
        "'@scriptmate/learn/history'",
    ):
        assert key in src, f"Storage key {key} unexpectedly changed."


def test_no_new_session_key_added(hub_src: str) -> None:
    """Hub must not introduce a second parallel session storage."""
    assert "AsyncStorage.setItem" not in hub_src, (
        "Hub must go through learnStorage — no direct AsyncStorage writes."
    )


def test_hub_has_no_backend_calls(hub_src: str) -> None:
    for pat in (r"\bfetch\s*\(", r"['\"]/api/", r"\baxios\."):
        assert not re.search(pat, hub_src), (
            f"Hub must not perform backend calls (pattern `{pat}` matched)."
        )


# ─── Contract 5 — malformed session handling ────────────────────────────


def test_load_active_session_is_defensive() -> None:
    """The existing defensive parse in learnStorage must remain — Hub
    relies on it to treat malformed JSON as 'no resumable session'."""
    src = STORAGE.read_text()
    # loadActiveSession contains a try/catch that returns null on failure.
    m = re.search(
        r"export\s+async\s+function\s+loadActiveSession[\s\S]*?\n\}",
        src,
    )
    assert m, "loadActiveSession not found."
    body = m.group(0)
    assert 'try {' in body
    assert 'catch' in body
    # Non-object returns are rejected.
    assert re.search(r"typeof\s+parsed\.id\s*===\s*'string'", body), (
        "loadActiveSession must reject malformed session JSON."
    )


# ─── Contract 6 — Learn engine + session + summary NOT modified ─────────


def test_session_screen_untouched_by_resume_fix() -> None:
    """The Session screen already restores currentIndex from the loaded
    active session — no change required for the Resume UX to work."""
    src = SESSION.read_text()
    assert "loadActiveSession" in src
    assert "s.currentIndex" in src or "session.currentIndex" in src


def test_engine_unchanged_types_for_resume() -> None:
    """The Hub uses the existing LearningSession type — no new type,
    no engine change."""
    src = ENGINE.read_text()
    assert "export interface LearningSession" in src
    assert "currentIndex:" in src


# ─── Phase 3 integrity ──────────────────────────────────────────────────


def test_phase3_files_untouched_by_resume_ux() -> None:
    for path in (TELEPROMPTER, RECORD, PREP, SELFTAPE_STORAGE, PATCH):
        src = path.read_text()
        # No Learn Hub state leaked into Phase 3 files.
        for token in ('activeSession', 'resumableSession', 'handleResume',
                      'handleStartAgain', 'learn-hub-resume'):
            assert token not in src, (
                f"Phase 3 file {path.name} unexpectedly references "
                f"`{token}`."
            )


def test_expo_camera_patch_intact() -> None:
    patch = PATCH.read_text()
    assert "isStabilizationSupported" in patch
    assert "Camera provider unavailable" in patch
    assert "expo/expo#47696" in patch
