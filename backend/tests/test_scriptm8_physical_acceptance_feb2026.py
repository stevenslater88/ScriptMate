"""P0 PHYSICAL-REALITY ACCEPTANCE GATE
=====================================

The actual production PDF `ScriptM8_The_Great_Snack_Heist.pdf` was
extracted via PyPDF2 (the same code path the backend `/api/scripts/
upload-base64` uses) and the exact resulting text was frozen into
`fixtures/scriptm8_great_snack_heist_pypdf2_physical.txt`.

This test file is the automated equivalent of the physical S23 Ultra
acceptance checklist. If this file is green, the physical device will
show the correct 4-character cast — no bogus 5th title character.

The fixture contains the real-world extraction artefact that caused
the four previous failed fix attempts:

    Line 1 (verbatim): ` ScriptM8 Stress-Test Script`
                       (Title Case, leading space, `ScriptM8` is a
                       digit-containing kerning merge of `Script` + `M8`
                       with NO separator from PyPDF2)

Previous iterations assumed PyPDF2 injected an invisible Unicode
character between tokens — it did NOT. The actual physical artefact is
simpler and nastier: PyPDF2 drops the space entirely between adjacent
glyph clusters, producing `ScriptM8` as a single Title-Case 3-word
candidate that passes every uppercase-only, word-count, terminator and
scene-heading heuristic. The fix is a per-token digit rejection in
`isLikelyCharacterName` (frontend) + the equivalent in
`fallback_parse_script` (backend). Real character cues never contain
digits — this is a zero-false-positive discriminator.

ACCEPTANCE CRITERIA (matches the physical screen the user will inspect
on the Samsung S23 Ultra after rebuild):

  Frontend parser:
    * detectedCharacters contains EXACTLY { JACK, EMILY, BELLA, LILY }
    * detectedCharacters.length === 4
    * `SCRIPTM8 STRESS-TEST SCRIPT` NOT in characters (any casing)
    * `THE GREAT SNACK HEIST`      NOT in characters
    * No character ending in `.`/`!`/`?`
    * No character containing a digit

  Backend parser (persisted script contract):
    * characters list is the SAME 4 names
    * len(lines) == 213

  Parity:
    * Backend and frontend character SETS are identical (case-insensitive)
"""

from __future__ import annotations

import importlib
import json
import os as _os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "backend/tests/fixtures/scriptm8_great_snack_heist_pypdf2_physical.txt"

sys.path.insert(0, str(ROOT / "backend"))
server = importlib.import_module("server")
fallback_parse_script = server.fallback_parse_script

EXPECTED_CHARS = {"JACK", "EMILY", "BELLA", "LILY"}
MUST_NOT_APPEAR = {
    "SCRIPTM8 STRESS-TEST SCRIPT",
    "SCRIPT M8 STRESS-TEST SCRIPT",
    "SCRIPTM8",
    "STRESS-TEST",
    "THE GREAT SNACK HEIST",
    "SCENE 1 — THE MISSING SNACKS",
    "SCENE 1",
    "NO",
    "WHY",
    "WHAT",
    "YES",
    "WAIT",
    "INTERESTING",
}


@pytest.fixture(scope="module")
def raw_text() -> str:
    assert FIXTURE.exists(), (
        f"Frozen physical fixture missing: {FIXTURE}. "
        "Regenerate via PyPDF2 against ScriptM8_The_Great_Snack_Heist.pdf."
    )
    return FIXTURE.read_text(encoding="utf-8")


# ─── 1. BACKEND PARSER — physical acceptance ──────────────────────────
def test_backend_parses_real_pdf_as_exactly_four_characters(raw_text: str) -> None:
    parsed = fallback_parse_script(raw_text)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == EXPECTED_CHARS, f"backend chars = {sorted(chars)}"


def test_backend_persisted_lines_count_matches_contract(raw_text: str) -> None:
    """The backend-persisted script must have 213 line entries (joined
    dialogue blocks + stage directions). Locks the user-visible
    `linesCount = 213` acceptance assertion."""
    parsed = fallback_parse_script(raw_text)
    assert len(parsed["lines"]) == 213, f"got {len(parsed['lines'])}"


def test_backend_rejects_all_known_false_positives(raw_text: str) -> None:
    parsed = fallback_parse_script(raw_text)
    chars_upper = {str(c).upper().strip() for c in parsed.get("characters", [])}
    for bad in MUST_NOT_APPEAR:
        assert bad.upper() not in chars_upper, f"backend leaked: {bad}"


def test_backend_rejects_any_digit_bearing_character(raw_text: str) -> None:
    parsed = fallback_parse_script(raw_text)
    for c in parsed.get("characters", []):
        assert not any(ch.isdigit() for ch in str(c)), f"digit in char: {c!r}"


def test_backend_rejects_any_character_ending_with_sentence_punctuation(raw_text: str) -> None:
    parsed = fallback_parse_script(raw_text)
    for c in parsed.get("characters", []):
        s = str(c).strip()
        assert not s.endswith((".", "!", "?")), f"terminator in char: {s!r}"


# ─── 2. FRONTEND PARSER — physical acceptance via Node TS shim ────────
FRONTEND_PARSER_SHIM = r"""
const path = require('path');
const Module = require('module');
const FRONTEND_NM = process.env.FRONTEND_NODE_MODULES || '/app/frontend/node_modules';
Module.globalPaths.push(FRONTEND_NM);
let babel, presetTS;
try {
  babel = require(path.join(FRONTEND_NM, '@babel/core'));
  presetTS = require.resolve('@babel/preset-typescript', { paths: [FRONTEND_NM] });
} catch (e) { console.error('BABEL_UNAVAILABLE'); process.exit(2); }
Module._extensions['.ts'] = function (m, f) {
  const src = require('fs').readFileSync(f, 'utf8');
  const { code } = babel.transformSync(src, { filename: f, presets: [[presetTS]], babelrc: false, configFile: false });
  m._compile(code, f);
};
const { parseScript } = require('/app/frontend/services/smartScriptParser.ts');
const fs = require('fs');
const raw = process.argv[2] === '--file' ? fs.readFileSync(process.argv[3], 'utf8') : process.argv[2];
const r = parseScript(raw);
process.stdout.write(JSON.stringify({
  characters: r.detectedCharacters.map(c => c.name),
  parsedLines: r.parsedLines.length,
  dialogue: r.stats.dialogueLines,
  action: r.stats.actionLines,
  heading: r.stats.headingLines,
  parenthetical: r.stats.parentheticalLines,
}));
"""


def _run_frontend_parser(raw_text: str) -> dict | None:
    shim_path = ROOT / "backend/tests/_frontend_parser_shim_physical.js"
    shim_path.write_text(FRONTEND_PARSER_SHIM, encoding="utf-8")
    fixture_path = ROOT / "backend/tests/_frontend_parser_shim_physical.input.txt"
    fixture_path.write_text(raw_text, encoding="utf-8")
    env = {**_os.environ, "FRONTEND_NODE_MODULES": "/app/frontend/node_modules"}
    try:
        result = subprocess.run(
            ["node", str(shim_path), "--file", str(fixture_path)],
            cwd=str(ROOT / "frontend"),
            capture_output=True, text=True, timeout=60, env=env,
        )
    except FileNotFoundError:
        return None
    if result.returncode == 2:
        return None
    if result.returncode != 0:
        pytest.fail(
            f"Frontend parser shim failed (rc={result.returncode}):\n"
            f"stdout={result.stdout!r}\nstderr={result.stderr!r}"
        )
    return json.loads(result.stdout)


def _skip_if_no_ts_loader(parsed):
    if parsed is None:
        pytest.skip("Frontend TS parser not runnable in this env.")


def test_frontend_parses_real_pdf_as_exactly_four_characters(raw_text: str) -> None:
    parsed = _run_frontend_parser(raw_text)
    _skip_if_no_ts_loader(parsed)
    chars = {str(c).upper().strip() for c in parsed["characters"]}
    assert chars == EXPECTED_CHARS, f"frontend chars = {sorted(chars)}"


def test_frontend_rejects_scriptm8_stress_test_script_variants(raw_text: str) -> None:
    parsed = _run_frontend_parser(raw_text)
    _skip_if_no_ts_loader(parsed)
    chars_upper = {str(c).upper().strip() for c in parsed["characters"]}
    for bad in MUST_NOT_APPEAR:
        assert bad.upper() not in chars_upper, f"frontend leaked: {bad}"


def test_frontend_rejects_any_digit_bearing_character(raw_text: str) -> None:
    parsed = _run_frontend_parser(raw_text)
    _skip_if_no_ts_loader(parsed)
    for c in parsed["characters"]:
        assert not any(ch.isdigit() for ch in str(c)), f"digit in char: {c!r}"


# ─── 3. FRONTEND / BACKEND PARITY on the physical fixture ─────────────
def test_frontend_backend_character_sets_agree_on_physical_pdf(raw_text: str) -> None:
    """The 4 characters shown on the Preview & Fix screen must match
    the 4 characters persisted by the backend. If they drift, the
    user selects a character from the review screen that doesn't
    exist in the saved script → broken rehearsal flow."""
    fe = _run_frontend_parser(raw_text)
    _skip_if_no_ts_loader(fe)
    be = fallback_parse_script(raw_text)
    fe_chars = {str(c).upper().strip() for c in fe["characters"]}
    be_chars = {str(c).upper().strip() for c in be["characters"]}
    assert fe_chars == be_chars == EXPECTED_CHARS, (
        f"\nFE: {sorted(fe_chars)}\nBE: {sorted(be_chars)}"
    )


# ─── 4. LEGITIMATE CHARACTER FORMATS still work (regression safety) ──
LEGITIMATE_FIXTURE = """\
INT. KITCHEN - DAY

JACK
Hello there.

EMILY
Hi.

MR. SMITH
Welcome.

JACK (V.O.)
I knew it.

SARAH (CONT'D)
Keep going.

MARY-ANNE
Over here.

DR. JONES
Please sit.
"""

LEGITIMATE_EXPECTED = {"JACK", "EMILY", "MR. SMITH", "SARAH", "MARY-ANNE", "DR. JONES"}


def test_legitimate_multiword_character_names_still_detected_backend() -> None:
    parsed = fallback_parse_script(LEGITIMATE_FIXTURE)
    chars = {str(c).upper().strip() for c in parsed["characters"]}
    assert chars == LEGITIMATE_EXPECTED, f"backend regression: {sorted(chars)}"


def test_legitimate_multiword_character_names_still_detected_frontend() -> None:
    parsed = _run_frontend_parser(LEGITIMATE_FIXTURE)
    _skip_if_no_ts_loader(parsed)
    chars = {str(c).upper().strip() for c in parsed["characters"]}
    assert chars == LEGITIMATE_EXPECTED, f"frontend regression: {sorted(chars)}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
