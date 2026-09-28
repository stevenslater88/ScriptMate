"""Regression: import-latency fix (POST /api/scripts uses the
deterministic parser, not gpt-4o) + prep-screen "Enable Teleprompter"
removal.

Background:
    Physical Samsung SM-S918B / Build 1110 evidence:
        POST /api/scripts started:   14:03:19.500
        POST /api/scripts completed: 14:03:46.710
        Duration:                    27,210 ms
        Script size:                 2,260 chars / 39 lines / 3 chars
    The bottleneck was ``parse_script_with_ai`` (synchronous gpt-4o
    JSON parse). ``fallback_parse_script`` produces the same output
    shape in ~0.02 ms and was already trusted as the LLM's safety net.

    Also: the prep-screen "Enable Teleprompter" toggle + speed slider
    were removed. The single teleprompter entry point is now
    Self Tape Studio → Teleprompter Mode NEW → /selftape/teleprompter
    (Route B, converged in commit 6e21ef7).
"""

from __future__ import annotations

import ast
import re
import time
from pathlib import Path
from typing import Any, Dict

REPO = Path("/app")
BACKEND_SERVER = REPO / "backend/server.py"
FRONTEND = REPO / "frontend"


def _read(rel: str) -> str:
    return (FRONTEND / rel).read_text()


def _get_source_function(src: str, name: str) -> str:
    tree = ast.parse(src)
    for node in ast.walk(tree):
        # Match both sync `def` and `async def` handlers.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            seg = ast.get_source_segment(src, node)
            if seg:
                return seg
    raise AssertionError(f"function `{name}` not found in server.py")


# ─────────────────────────────────────────────────────────────────────────────
# Backend: POST /api/scripts no longer calls the LLM synchronously
# ─────────────────────────────────────────────────────────────────────────────

def test_create_script_handler_uses_deterministic_parser() -> None:
    """create_script must call fallback_parse_script (deterministic) and
    must NOT call parse_script_with_ai (gpt-4o) synchronously."""
    src = BACKEND_SERVER.read_text()
    fn = _get_source_function(src, "create_script")

    # Strip the docstring so the "forbidden call" scan doesn't match a
    # historical reference in explanatory prose.
    tree = ast.parse(fn)
    stripped = fn
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc:
                stripped = stripped.replace(doc, "")
            break

    assert "fallback_parse_script(script_data.raw_text)" in stripped, (
        "create_script must call fallback_parse_script(script_data.raw_text) "
        "— the same deterministic parser already trusted as the LLM's "
        "safety net. Without this, POST /api/scripts takes ~27s (physical "
        "Samsung SM-S918B timing, 2260-char script)."
    )
    # Forbid a CALL to parse_script_with_ai (mentions in the docstring are
    # allowed since the helper is intentionally retained for future use).
    assert not re.search(r"\bparse_script_with_ai\s*\(", stripped), (
        "create_script must NOT call parse_script_with_ai synchronously. "
        "The gpt-4o call was the proven bottleneck (27,210 ms for a "
        "2,260-char script). Any future LLM enhancement must run out "
        "of the save request path."
    )


def test_fallback_parse_script_still_available_for_reuse() -> None:
    """The deterministic parser must still be defined and importable."""
    src = BACKEND_SERVER.read_text()
    assert "def fallback_parse_script" in src, (
        "fallback_parse_script must remain in server.py — create_script "
        "depends on it, and it is the resilient path for any future "
        "LLM-enhancement flow."
    )


def test_parse_script_with_ai_helper_is_not_deleted() -> None:
    """We keep the LLM helper in place for future non-blocking use;
    only its synchronous call from create_script was removed."""
    src = BACKEND_SERVER.read_text()
    assert "async def parse_script_with_ai" in src, (
        "parse_script_with_ai must remain defined — it's kept for a "
        "future background-enhancement endpoint. Its call from "
        "create_script was removed to fix the 27s import latency, not "
        "the function itself."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic parser: correctness + latency ceiling
# ─────────────────────────────────────────────────────────────────────────────

# Mid-size sample matching the shape of the Samsung physical repro
# (roughly 2 KB, ~40 dialogue lines, 3 speaking characters).
_SAMPLE = """INT. COFFEE SHOP - DAY

Two friends meet after years apart.

ALICE
Hey, is that really you?

BOB
Alice! I can't believe it. How long has it been?

ALICE
Five years? Six?

BOB
Seven. Since college graduation.

ALICE
Wow. What have you been up to?

BOB
Working in the city. Marketing job. What about you?

ALICE
Teaching. Third grade.

CHARLIE
(entering)
Am I interrupting?

BOB
Charlie! Sit down, join us.

ALICE
Yeah, we were just catching up.

CHARLIE
Perfect timing then.

BOB
It's been way too long since the three of us were in the same room.

ALICE
I know. We should do this more often.

CHARLIE
Agreed. Life gets in the way.

BOB
So what's new with everyone?

ALICE
I got engaged last month.

BOB
Congratulations!

CHARLIE
Amazing news, Alice.
"""


def _load_fallback_parser():
    """Extract fallback_parse_script by AST without triggering server.py's
    top-level DB/env dependencies."""
    src = BACKEND_SERVER.read_text()
    code = _get_source_function(src, "fallback_parse_script")
    ns: Dict[str, Any] = {}
    # Provide the type imports the source references in the signature.
    from typing import Dict as _D, Any as _A  # noqa: F401
    ns["Dict"] = _D
    ns["Any"] = _A
    exec(code, ns)  # noqa: S102 — intentional isolated eval of local source
    return ns["fallback_parse_script"]


def test_fallback_parse_script_extracts_expected_output_shape() -> None:
    """fallback_parse_script must return {'characters': [...], 'lines': [...]}
    with speaking characters detected and dialogue attributed to them."""
    fn = _load_fallback_parser()
    r = fn(_SAMPLE)
    assert set(r["characters"]) == {"ALICE", "BOB", "CHARLIE"}, (
        f"Expected {{ALICE, BOB, CHARLIE}}, got {set(r['characters'])}"
    )
    assert len(r["lines"]) >= 10, (
        f"Expected at least 10 parsed lines, got {len(r['lines'])}"
    )
    # Each attributed line should carry the correct character.
    speaking = [ln for ln in r["lines"] if not ln["is_stage_direction"]]
    assert speaking, "Expected some non-stage-direction dialogue lines"
    for ln in speaking:
        assert ln["character"] in {"ALICE", "BOB", "CHARLIE"}


def test_fallback_parse_script_is_orders_of_magnitude_faster_than_llm() -> None:
    """The whole point of this fix. The deterministic parser must complete
    a Samsung-repro-shape script well under 100 ms per call (100 iters).
    Physical LLM baseline: 27,210 ms per call."""
    fn = _load_fallback_parser()
    iters = 100
    t0 = time.perf_counter()
    for _ in range(iters):
        fn(_SAMPLE)
    elapsed = time.perf_counter() - t0
    mean_ms = (elapsed / iters) * 1000
    # Extremely generous ceiling — real value is ~0.02 ms. Anything under
    # 100 ms is orders of magnitude better than the 27,210 ms LLM baseline
    # and is well within the "feels immediate" UX budget for POST /api/scripts.
    assert mean_ms < 100, (
        f"fallback_parse_script mean latency {mean_ms:.2f} ms exceeds the "
        f"100 ms ceiling — the import-latency fix is not effective. "
        f"Physical LLM baseline was 27,210 ms."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Frontend: prep-screen "Enable Teleprompter" toggle is removed
# ─────────────────────────────────────────────────────────────────────────────

def test_prep_screen_no_longer_has_enable_teleprompter_toggle() -> None:
    """The old Route A "Enable Teleprompter" toggle + "Auto-scroll script
    during recording" description must be gone from prep.tsx."""
    src = _read("app/selftape/prep.tsx")
    # Strip JSX block comments `{/* ... */}` and JS block comments `/* ... */`
    # and `//` line comments so that historical mentions in explanatory
    # comments are allowed. What must be gone is any user-visible label.
    stripped = re.sub(r"\{/\*.*?\*/\}", "", src, flags=re.DOTALL)
    stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.DOTALL)
    stripped = re.sub(r"^\s*//.*$", "", stripped, flags=re.MULTILINE)
    assert "Enable Teleprompter" not in stripped, (
        "prep.tsx must not render the 'Enable Teleprompter' label. "
        "The single teleprompter entry point is now Self Tape Studio → "
        "Teleprompter Mode NEW."
    )
    assert "Auto-scroll script during recording" not in stripped, (
        "prep.tsx must not render the 'Auto-scroll script during "
        "recording' description."
    )


def test_prep_screen_no_longer_has_teleprompter_state_or_params() -> None:
    """The obsolete state hooks and URL-param passing must be gone."""
    src = _read("app/selftape/prep.tsx")
    # Code-only scan — comments describing the removal are allowed.
    code = "\n".join(
        ln for ln in src.splitlines() if not ln.lstrip().startswith("//")
    )
    for forbidden in (
        "teleprompterEnabled",
        "setTeleprompterEnabled",
        "teleprompterSpeed",
        "setTeleprompterSpeed",
    ):
        assert forbidden not in code, (
            f"prep.tsx must not reference `{forbidden}` in active code — "
            f"the old teleprompter toggle was removed."
        )
    # And the navigation params must no longer include teleprompter fields.
    assert not re.search(r"teleprompter:\s*teleprompterEnabled", code), (
        "prep.tsx must not pass a `teleprompter` param to /selftape/record "
        "— that param existed solely for the old toggle."
    )
    assert not re.search(r"teleprompterSpeed:\s*teleprompterSpeed", code), (
        "prep.tsx must not pass a `teleprompterSpeed` param to "
        "/selftape/record — that param existed solely for the old toggle."
    )


def test_teleprompter_mode_new_entry_still_present() -> None:
    """The Teleprompter Mode NEW card in Self Tape Studio (the SINGLE
    intended entry point) must still exist."""
    src = _read("app/selftape/index.tsx")
    assert "Teleprompter Mode" in src, (
        "app/selftape/index.tsx must still render the 'Teleprompter Mode' "
        "card — this is the single teleprompter entry point."
    )
    assert "/selftape/teleprompter" in src, (
        "Self Tape Studio must still route to /selftape/teleprompter for "
        "the Teleprompter Mode entry."
    )


def test_teleprompter_route_b_untouched_by_this_fix() -> None:
    """The Route B implementation (commit 6e21ef7) must be intact — the
    JS RAF driver, ScrollView, segmented [1..5] speed, pxPerSecond
    pacing, onContentSizeChange, and expo-file-system/legacy import."""
    src = _read("app/selftape/teleprompter.tsx")
    assert "requestAnimationFrame(step)" in src
    assert "scrollViewRef.current?.scrollTo" in src
    assert "[30, 60, 90, 120, 150]" in src
    assert "onContentSizeChange" in src
    assert "from 'expo-file-system/legacy'" in src


def test_camera_stabilization_patch_untouched_by_this_fix() -> None:
    """The expo-camera stabilization patch (commit ed6a1bf) must be intact."""
    patch = FRONTEND / "patches" / "expo-camera+17.0.10.patch"
    assert patch.exists()
    body = patch.read_text()
    assert "SCRIPTmate patch" in body
    assert "isStabilizationSupported" in body
