"""P0 ScriptM8 end-to-end parity — frontend parser (smartScriptParser.ts)
vs backend parser (fallback_parse_script).

The physical ScriptM8_The_Great_Snack_Heist APK reproduced TWO distinct
corruption modes that must be fixed in BOTH parsers:

  BUG 1 — Numbered character cues produce N distinct identities
    PyPDF2 extraction of theater PDFs with embedded line numbers emits
    cues like `1 JACK`, `2 EMILY`, `61 — JACK`, `192 - JACK`. Without
    leading-number stripping, these dedup as N separate characters
    instead of collapsing to {JACK, EMILY}. The physical review screen
    showed 9 entries (`1 — JACK` through `9 — JACK`) because the parser
    stored 9 distinct normalized keys.

  BUG 2 — Implicit title/subtitle lines promoted to characters
    When the PDF has NO explicit `TITLE:` header, PyPDF2 extracts the
    centered title and subtitle as standalone uppercase cue-shaped
    lines (`THE GREAT SNACK HEIST` / `SCRIPT M8 STRESS-TEST SCRIPT`),
    which pass the character-cue heuristic and are promoted alongside
    the real cast.

The frontend `smartScriptParser.ts` and backend `fallback_parse_script`
MUST produce equivalent character identities and equivalent dialogue
attribution. This test file locks that contract by running BOTH parsers
against the same hostile fixtures and asserting they agree.

The frontend parser is invoked via a tiny Node shim that imports the
TypeScript source through `ts-node` or `esbuild-register` and dumps a
JSON result. If neither is available, the TypeScript tests skip
(frontend-side) and the Python-side assertions still run end-to-end
on the backend fallback_parse_script.
"""

from __future__ import annotations

import importlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

server = importlib.import_module("server")
fallback_parse_script = server.fallback_parse_script


# ─── Hostile ScriptM8-style fixtures ────────────────────────────────────

FIXTURE_IMPLICIT_TITLE_NUMBERED_CUES = "\n".join([
    "THE GREAT SNACK HEIST",
    "",
    "SCRIPT M8 STRESS-TEST SCRIPT",
    "",
    "INT. KITCHEN - DAY",
    "",
    "1 JACK",
    "I knew it. The last cookie is gone.",
    "",
    "2 EMILY",
    "WHERE?",
    "",
    "3 BELLA",
    "APPARENTLY.",
    "",
    "4 LILY",
    "Oh no.",
    "",
    "5 JACK",
    "Still me.",
    "",
    "6 EMILY",
    "Still me too.",
    "",
    "61 \u2014 JACK",   # em-dash separator (U+2014)
    "That isn't funny.",
    "",
    "192 - JACK",       # ASCII hyphen
    "Much later.",
    "",
    "87 - LILY",
    "I agree.",
    "",
    "110 - LILY",
    "Still agreeing.",
    "",
    "112 \u2014 EMILY",
    "Me too.",
])

FIXTURE_REPEATED_SAME_CHARACTER = "\n".join([
    "TITLE: REPEATED",
    "",
    "INT. ROOM - DAY",
    "",
    "JACK",
    "Hello.",
    "",
    "JACK",
    "Where?",
    "",
    "JACK",
    "I'm here.",
    "",
    "JACK",
    "Come on.",
])

FIXTURE_HOSTILE_PUNCTUATION = "\n".join([
    "TITLE: HOSTILE",
    "",
    "INT. ROOM - DAY",
    "",
    "JACK",
    "Hello.",
    "",
    "JACK.",           # must NOT become a character
    "No.",             # must NOT become a character
    "JACK!",           # must NOT become a character
    "JACK?",           # must NOT become a character
    "",
    "JACK (V.O.)",
    "Voice over.",
    "",
    "JACK (CONT'D)",
    "Continued.",
])


# ─── A. Backend parser assertions ──────────────────────────────────────

def test_backend_implicit_title_and_numbered_cues_collapse() -> None:
    parsed = fallback_parse_script(FIXTURE_IMPLICIT_TITLE_NUMBERED_CUES)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"Backend parser: expected 4 chars, got {sorted(chars)}"
    )
    assert "THE GREAT SNACK HEIST" not in chars
    assert "SCRIPT M8 STRESS-TEST SCRIPT" not in chars
    # No numbered variants leak through:
    for c in chars:
        assert not c[:1].isdigit(), f"Leading-digit character leaked: {c!r}"


def test_backend_repeated_character_collapses_to_one_identity() -> None:
    parsed = fallback_parse_script(FIXTURE_REPEATED_SAME_CHARACTER)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK"}, f"Expected {{JACK}}, got {sorted(chars)}"
    jack_dialogue = [
        ln for ln in parsed.get("lines", [])
        if not ln.get("is_stage_direction")
        and str(ln.get("character", "")).upper().strip() == "JACK"
    ]
    assert len(jack_dialogue) == 4, (
        f"Expected 4 JACK dialogue blocks, got {len(jack_dialogue)}"
    )


def test_backend_hostile_punctuation_only_jack_retained() -> None:
    parsed = fallback_parse_script(FIXTURE_HOSTILE_PUNCTUATION)
    chars = {str(c).upper().strip() for c in parsed.get("characters", [])}
    assert chars == {"JACK"}, (
        f"Expected only JACK, got {sorted(chars)}. "
        f"JACK./JACK!/JACK? and NO. must not be promoted; "
        f"(V.O.)/(CONT'D) variants must dedup to JACK."
    )


# ─── B. Frontend parser invocation via Node shim ───────────────────────

FRONTEND_PARSER_SHIM = r"""
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Resolve frontend/node_modules absolutely so require() finds packages
// regardless of this shim's filesystem location.
const FRONTEND_NM = process.env.FRONTEND_NODE_MODULES
  || path.resolve(__dirname, '..', '..', 'frontend', 'node_modules');
Module.globalPaths.push(FRONTEND_NM);

function requireFromFrontend(name) {
  const p = require.resolve(name, { paths: [FRONTEND_NM] });
  return require(p);
}

// Transpile TypeScript on the fly using @babel/core + preset-typescript
// (both already present in frontend/node_modules via Expo deps).
// No new dependency is added. If babel is unavailable we exit with
// rc=2 and the Python side skips the frontend tests gracefully.
let babel, presetTS;
try {
  babel = requireFromFrontend('@babel/core');
  presetTS = require.resolve('@babel/preset-typescript', { paths: [FRONTEND_NM] });
} catch (e) {
  console.error(JSON.stringify({ error: 'no-babel', detail: e.message, FRONTEND_NM }));
  process.exit(2);
}

// Register a .ts loader that uses babel to strip TypeScript types.
Module._extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = babel.transformSync(source, {
    filename,
    presets: [[presetTS, { allowDeclareFields: true }]],
    babelrc: false,
    configFile: false,
  });
  module._compile(code, filename);
};

const smartParserPath = path.resolve(
  __dirname, '..', '..', 'frontend', 'services', 'smartScriptParser.ts'
);
let parseScript;
try {
  ({ parseScript } = require(smartParserPath));
} catch (e) {
  console.error(JSON.stringify({
    error: 'require-failed',
    detail: e.message || String(e),
    stack: e.stack,
    smartParserPath,
  }));
  process.exit(3);
}

const rawText = process.argv[2];
try {
  const result = parseScript(rawText);
  const chars = result.detectedCharacters.map(c => c.name);
  const dialogueLines = result.parsedLines
    .filter(l => l.type === 'DIALOGUE')
    .map(l => ({ character: l.characterName, text: l.text }));
  console.log(JSON.stringify({
    characters: chars,
    dialogue_count: dialogueLines.length,
    dialogue: dialogueLines,
    stats: result.stats,
  }));
} catch (err) {
  console.error(JSON.stringify({ error: 'parse-failed', detail: err.message || String(err) }));
  process.exit(4);
}
"""


def _run_frontend_parser(raw_text: str) -> dict | None:
    """Invoke the frontend TS parser against raw_text. Returns parsed
    JSON, or None if no TS loader is available in this environment.
    """
    shim_path = ROOT / "backend" / "tests" / "_frontend_parser_shim.js"
    shim_path.write_text(FRONTEND_PARSER_SHIM, encoding="utf-8")
    frontend_node_modules = ROOT / "frontend" / "node_modules"
    import os as _os
    env = {
        **_os.environ,
        "NODE_PATH": str(frontend_node_modules),
        "FRONTEND_NODE_MODULES": str(frontend_node_modules),
    }
    try:
        result = subprocess.run(
            ["node", str(shim_path), raw_text],
            cwd=str(ROOT / "frontend"),
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
    except FileNotFoundError:
        return None  # node not available
    if result.returncode == 2:
        return None  # no babel available
    if result.returncode != 0:
        pytest.fail(
            f"Frontend parser shim failed (rc={result.returncode}):\n"
            f"stdout={result.stdout!r}\nstderr={result.stderr!r}"
        )
    return json.loads(result.stdout)


# ─── C. Parity assertions (skipped if frontend TS loader unavailable) ──

def _skip_if_no_ts_loader(parsed):
    if parsed is None:
        pytest.skip(
            "Frontend TS parser not runnable in this env "
            "(esbuild-register / ts-node not installed in frontend/node_modules). "
            "Parity contract is still enforced by the hand-authored "
            "static-regex and shape tests in test_frontend_backend_parser_parity_feb2026.py."
        )


def test_frontend_implicit_title_and_numbered_cues_collapse() -> None:
    parsed = _run_frontend_parser(FIXTURE_IMPLICIT_TITLE_NUMBERED_CUES)
    _skip_if_no_ts_loader(parsed)
    chars = {str(c).upper().strip() for c in parsed["characters"]}
    assert chars == {"JACK", "EMILY", "BELLA", "LILY"}, (
        f"Frontend parser: expected 4 chars, got {sorted(chars)}"
    )
    assert "THE GREAT SNACK HEIST" not in chars
    assert "SCRIPT M8 STRESS-TEST SCRIPT" not in chars
    for c in chars:
        assert not c[:1].isdigit(), f"Leading-digit character leaked: {c!r}"


def test_frontend_repeated_character_collapses_to_one_identity() -> None:
    parsed = _run_frontend_parser(FIXTURE_REPEATED_SAME_CHARACTER)
    _skip_if_no_ts_loader(parsed)
    chars = {str(c).upper().strip() for c in parsed["characters"]}
    assert chars == {"JACK"}
    dialogue = parsed["dialogue"]
    jack_lines = [d for d in dialogue if str(d["character"]).upper() == "JACK"]
    assert len(jack_lines) == 4


def test_frontend_hostile_punctuation_only_jack_retained() -> None:
    parsed = _run_frontend_parser(FIXTURE_HOSTILE_PUNCTUATION)
    _skip_if_no_ts_loader(parsed)
    chars = {str(c).upper().strip() for c in parsed["characters"]}
    assert chars == {"JACK"}


def test_frontend_backend_character_sets_agree_scriptm8() -> None:
    """The TWO parsers MUST produce the same character identity set for
    the ScriptM8 hostile fixture. If they drift, the user sees a
    different cast on the review screen vs the rehearsal screen."""
    frontend = _run_frontend_parser(FIXTURE_IMPLICIT_TITLE_NUMBERED_CUES)
    _skip_if_no_ts_loader(frontend)
    backend = fallback_parse_script(FIXTURE_IMPLICIT_TITLE_NUMBERED_CUES)
    fe_chars = {str(c).upper().strip() for c in frontend["characters"]}
    be_chars = {str(c).upper().strip() for c in backend.get("characters", [])}
    assert fe_chars == be_chars, (
        f"FRONTEND/BACKEND PARITY FAILURE.\n"
        f"frontend: {sorted(fe_chars)}\n"
        f"backend:  {sorted(be_chars)}\n"
        f"delta FE-only: {sorted(fe_chars - be_chars)}\n"
        f"delta BE-only: {sorted(be_chars - fe_chars)}"
    )


def test_frontend_backend_character_sets_agree_repeated() -> None:
    frontend = _run_frontend_parser(FIXTURE_REPEATED_SAME_CHARACTER)
    _skip_if_no_ts_loader(frontend)
    backend = fallback_parse_script(FIXTURE_REPEATED_SAME_CHARACTER)
    fe_chars = {str(c).upper().strip() for c in frontend["characters"]}
    be_chars = {str(c).upper().strip() for c in backend.get("characters", [])}
    assert fe_chars == be_chars


def test_frontend_backend_character_sets_agree_hostile_punctuation() -> None:
    frontend = _run_frontend_parser(FIXTURE_HOSTILE_PUNCTUATION)
    _skip_if_no_ts_loader(frontend)
    backend = fallback_parse_script(FIXTURE_HOSTILE_PUNCTUATION)
    fe_chars = {str(c).upper().strip() for c in frontend["characters"]}
    be_chars = {str(c).upper().strip() for c in backend.get("characters", [])}
    assert fe_chars == be_chars


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
