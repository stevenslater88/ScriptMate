"""Regression guard for the Daily Drill UX 3-state fix (Feb 2026).

Locks the UX contract that resolved the QA-build-1110 finding:
  - Fresh drill loads with a "Start Drill" button (not "I Did It").
  - Tapping "Start Drill" flips only a *local* state — it must NOT call
    the completion endpoint.
  - Once started, an "in progress" indicator is shown and the primary
    action becomes "Complete Drill — Claim XP".
  - Only that second action calls POST /api/daily-drill/{userId}/complete.
  - No new local persistence — the started flag is component-local
    useState, so navigating away resets to "available" (that's OK
    because no XP has been awarded yet).
  - Backend, DB schema, XP, and streak paths are unchanged.

The test is purely static — reads the source file and asserts invariants.
No network, no mock, no HTTP.
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
DRILL = FRONTEND / "app" / "daily-drill.tsx"


def _src() -> str:
    return DRILL.read_text()


# ---- Presence of the three-state flow -------------------------------------


def test_daily_drill_file_exists():
    assert DRILL.exists(), f"expected {DRILL} to exist"


def test_started_local_state_is_present():
    src = _src()
    # A useState<bool> for the local "started" flag must exist.
    assert re.search(
        r"const\s+\[\s*started\s*,\s*setStarted\s*\]\s*=\s*useState\s*\(\s*false\s*\)",
        src,
    ), "expected `const [started, setStarted] = useState(false)` — the local active-state flag"


def test_start_button_uses_new_label_and_testid():
    src = _src()
    assert 'testID="start-drill-btn"' in src, (
        "expected the initial button to expose testID='start-drill-btn'"
    )
    assert ">Start Drill<" in src, (
        "expected the initial button label to be 'Start Drill'"
    )


def test_start_button_does_not_call_complete_endpoint_or_completeDrill():
    """The 'Start Drill' TouchableOpacity must ONLY call setStarted(true)."""
    src = _src()
    # Locate the opening `<TouchableOpacity ... testID="start-drill-btn" ...>`
    # element. JSX attribute values may contain `=>` (arrow fns) so we can't
    # rely on simple char classes — instead we locate the testID anchor and
    # take the surrounding tag by scanning back to the opening `<`.
    anchor = src.find('testID="start-drill-btn"')
    assert anchor != -1, "start-drill-btn testID anchor not found"
    open_lt = src.rfind("<TouchableOpacity", 0, anchor)
    assert open_lt != -1, "start-drill-btn TouchableOpacity opener not found"
    # From the opener, find the first `>` at attribute depth 0 (i.e. not
    # inside `{...}`). Simple depth counter is enough since JSX attributes
    # only use `{...}` for expressions.
    i = open_lt
    depth = 0
    while i < len(src):
        c = src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            break
        i += 1
    start_tag = src[open_lt : i + 1]
    # The opening element must call setStarted(true).
    assert "setStarted(true)" in start_tag, (
        f"Start Drill onPress must call setStarted(true); got: {start_tag}"
    )
    # It MUST NOT reference the completion function or the /complete endpoint.
    assert "completeDrill" not in start_tag, (
        "Start Drill button must NOT call completeDrill()"
    )
    assert "/complete" not in start_tag, (
        "Start Drill button must NOT reference the /complete endpoint"
    )


def test_complete_button_now_uses_claim_xp_label():
    src = _src()
    assert 'testID="complete-drill-btn"' in src, (
        "expected the completion button to expose testID='complete-drill-btn'"
    )
    assert ">Complete Drill — Claim XP<" in src, (
        "expected completion button label to be 'Complete Drill — Claim XP'"
    )


def test_old_label_is_removed():
    src = _src()
    # The previous 'I Did It! Claim XP' label must no longer be reachable —
    # otherwise the fix regressed.
    assert "I Did It! Claim XP" not in src, (
        "previous 'I Did It! Claim XP' label must be removed"
    )


def test_active_indicator_shown_when_started():
    src = _src()
    assert 'testID="drill-active-indicator"' in src, (
        "expected an in-progress indicator with testID='drill-active-indicator'"
    )
    assert "Drill in progress" in src, (
        "expected the in-progress indicator to include the text 'Drill in progress'"
    )


# ---- Guardrails: backend + persistence contracts unchanged ----------------


def test_only_completeDrill_posts_to_complete_endpoint():
    """/api/daily-drill/{...}/complete must be POSTed by exactly one code
    path (the completeDrill function). Nothing else in this file may.
    """
    src = _src()
    complete_post_lines = [
        ln
        for ln in src.splitlines()
        if "/complete" in ln and "axios.post" in ln
    ]
    assert len(complete_post_lines) == 1, (
        f"exactly one axios.post to /complete expected, "
        f"found {len(complete_post_lines)}: {complete_post_lines}"
    )
    # And that single call must live inside completeDrill (not e.g. on mount
    # or inside the Start button handler). Simple containment check on the
    # function body region.
    complete_fn_match = re.search(
        r"const\s+completeDrill\s*=\s*async\s*\(\s*\)\s*=>\s*\{(.*?)\n\s{2}\};",
        src,
        re.DOTALL,
    )
    assert complete_fn_match, "completeDrill function not found"
    assert (
        "/complete" in complete_fn_match.group(1)
    ), "the single /complete POST must live inside completeDrill()"


def test_no_asyncstorage_persistence_of_started_flag():
    """The active/in-progress flag is deliberately NOT persisted (per
    requirement 10 — leaving the screen resets it to available, since no
    XP was awarded)."""
    src = _src()
    # AsyncStorage may only touch 'device_id' in this file.
    calls = re.findall(r"AsyncStorage\.[A-Za-z]+\(['\"]([^'\"]+)['\"]", src)
    for key in calls:
        assert key == "device_id", (
            f"AsyncStorage used with unexpected key '{key}' — the started "
            f"flag must remain component-local, per requirement 10."
        )


def test_completed_banner_wording_preserved():
    """After genuine completion, the banner must still read exactly
    'Today's drill complete!' (requirement 11)."""
    src = _src()
    assert "Today's drill complete!" in src


def test_no_new_dependencies_imported_in_daily_drill():
    """Sanity — no new imports leaked in (no new packages, no camera,
    audio, timer libraries)."""
    src = _src()
    imports = re.findall(r"^import [^;]+;", src, re.MULTILINE)
    banned = ["expo-camera", "expo-av", "expo-speech", "expo-haptics",
              "react-native-camera", "expo-recording"]
    for imp in imports:
        for pkg in banned:
            assert pkg not in imp, (
                f"forbidden dependency introduced: {pkg} (line: {imp})"
            )


# ---- Guardrails: nothing outside daily-drill.tsx changed ------------------


def test_backend_daily_drill_endpoints_unchanged_signatures():
    """The 3 backend daily-drill endpoints must exist with their current
    signatures — no schema or route change."""
    server = FRONTEND.parent / "backend" / "server.py"
    src = server.read_text()
    assert '@api_router.get("/daily-drill/{user_id}")' in src
    assert '@api_router.post("/daily-drill/{user_id}/complete")' in src
    assert '@api_router.post("/daily-drill/{user_id}/feedback")' in src
    # Only ONE place sets completed:True.
    completed_writes = re.findall(
        r'\$set["\']\s*:\s*\{[^}]*completed["\']\s*:\s*True',
        src,
    )
    assert len(completed_writes) == 1, (
        f"exactly one write of completed=True expected in server.py, "
        f"found {len(completed_writes)}"
    )
