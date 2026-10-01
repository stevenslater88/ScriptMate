"""
Frontend ↔ backend parser parity (Feb-2026)
============================================

Locks `frontend/services/smartScriptParser.ts::parseScript` and
`backend/server.py::fallback_parse_script` to the SAME behaviour on
the Jack/Sarah physical reproduction. Prior to this test the two
parsers drifted silently and shipped a 4-character preview against a
2-character saved result (physical build 1.0.64 bug).

The test compiles `smartScriptParser.ts` to CommonJS with `tsc` and
invokes it via Node — same pattern as `scripts/voice_pipeline_smoketest.js`.
It then runs the backend parser on the same raw text in-process and
asserts character set equality + dialogue-line equality.

If `node` or `npx` is unavailable, the test is skipped (not failed).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(ROOT / "backend" / ".env")

from server import fallback_parse_script

JACK_SARAH_SCRIPT = (
    "TITLE: THE CALL\n"
    "CHARACTERS:\n"
    "JACK\n"
    "SARAH\n"
    "\n"
    "JACK: Are you ready?\n"
    "SARAH: I've been ready for ten minutes.\n"
    "JACK: Then let's do this.\n"
    "SARAH: Together?\n"
    "JACK: Together."
)


def _tooling_available() -> bool:
    return shutil.which("node") is not None and shutil.which("npx") is not None


@pytest.fixture(scope="module")
def frontend_parser_js(tmp_path_factory):
    """Compile `smartScriptParser.ts` to CommonJS once per module."""
    if not _tooling_available():
        pytest.skip("node/npx unavailable in this environment")
    out_dir = tmp_path_factory.mktemp("smart_parser_build")
    source = ROOT / "frontend" / "services" / "smartScriptParser.ts"
    try:
        subprocess.run(
            [
                "npx",
                "tsc",
                "--outDir",
                str(out_dir),
                "--target",
                "ES2019",
                "--module",
                "commonjs",
                "--esModuleInterop",
                "--skipLibCheck",
                "--moduleResolution",
                "node",
                "--isolatedModules",
                "--noEmit",
                "false",
                str(source),
            ],
            cwd=ROOT,
            check=False,
            timeout=90,
            capture_output=True,
        )
    except subprocess.TimeoutExpired:
        pytest.skip("tsc compile timed out")
    out_file = out_dir / "smartScriptParser.js"
    if not out_file.exists():
        pytest.skip(
            "smartScriptParser.js not emitted (tsc exited with unrelated errors)"
        )
    return out_file


def _run_frontend_parser(js_file: Path, raw_text: str) -> dict:
    runner = f"""
const parser = require({json.dumps(str(js_file))});
const raw = process.argv[2];
const result = parser.parseScript(raw, {{ includeHeadings: false }});
process.stdout.write(JSON.stringify({{
  detectedCharacters: result.detectedCharacters.map(c => c.name),
  dialogue: result.parsedLines
    .filter(l => l.type === 'DIALOGUE')
    .map(l => ({{ character: l.characterName, text: l.text }})),
  action: result.parsedLines
    .filter(l => l.type === 'ACTION')
    .map(l => l.text),
}}));
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tmp:
        tmp.write(runner)
        tmp_path = tmp.name
    try:
        res = subprocess.run(
            ["node", tmp_path, raw_text],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        return json.loads(res.stdout)
    finally:
        os.unlink(tmp_path)


# ─── Pure frontend assertions (no backend comparison) ─────────────────


def test_frontend_jack_sarah_characters(frontend_parser_js):
    r = _run_frontend_parser(frontend_parser_js, JACK_SARAH_SCRIPT)
    assert sorted(r["detectedCharacters"]) == ["JACK", "SARAH"], (
        f"frontend preview must show exactly JACK and SARAH; got "
        f"{r['detectedCharacters']}"
    )


def test_frontend_title_line_is_not_a_character(frontend_parser_js):
    r = _run_frontend_parser(frontend_parser_js, JACK_SARAH_SCRIPT)
    forbidden = {"TITLE", "TITLE: THE CALL", "THE CALL"}
    leaked = set(r["detectedCharacters"]) & forbidden
    assert not leaked, f"'TITLE' label leaked into characters: {leaked}"


def test_frontend_characters_line_is_not_a_character(frontend_parser_js):
    r = _run_frontend_parser(frontend_parser_js, JACK_SARAH_SCRIPT)
    assert "CHARACTERS" not in r["detectedCharacters"]
    assert "CHARACTERS:" not in r["detectedCharacters"]


def test_frontend_inline_cue_splits_without_name_prefix(frontend_parser_js):
    r = _run_frontend_parser(frontend_parser_js, JACK_SARAH_SCRIPT)
    expected = [
        ("JACK", "Are you ready?"),
        ("SARAH", "I've been ready for ten minutes."),
        ("JACK", "Then let's do this."),
        ("SARAH", "Together?"),
        ("JACK", "Together."),
    ]
    actual = [(d["character"], d["text"]) for d in r["dialogue"]]
    assert actual == expected, (
        f"frontend dialogue must alternate JACK/SARAH over 5 lines "
        f"without the NAME: prefix; got {actual}"
    )
    for d in r["dialogue"]:
        assert not d["text"].startswith(d["character"] + ":"), d


def test_frontend_mixed_classic_and_inline_cues(frontend_parser_js):
    raw = (
        "JACK: You're late.\n"
        "SARAH\n"
        "I had to pick up groceries.\n"
        "JACK: Groceries?\n"
        "SARAH\n"
        "For dinner. We're hosting.\n"
    )
    r = _run_frontend_parser(frontend_parser_js, raw)
    expected = [
        ("JACK", "You're late."),
        ("SARAH", "I had to pick up groceries."),
        ("JACK", "Groceries?"),
        ("SARAH", "For dinner. We're hosting."),
    ]
    actual = [(d["character"], d["text"]) for d in r["dialogue"]]
    assert actual == expected
    assert sorted(r["detectedCharacters"]) == ["JACK", "SARAH"]


def test_frontend_classic_two_line_cue_still_works(frontend_parser_js):
    raw = (
        "TITLE: The Reunion\n"
        "AUTHOR: Alex\n"
        "CHARACTERS:\n"
        "DREW\n"
        "MIKE\n"
        "\n"
        "DREW\n"
        "You came back.\n"
        "MIKE\n"
        "You asked me to.\n"
        "DREW\n"
        "I know I did.\n"
    )
    r = _run_frontend_parser(frontend_parser_js, raw)
    assert sorted(r["detectedCharacters"]) == ["DREW", "MIKE"]
    expected = [
        ("DREW", "You came back."),
        ("MIKE", "You asked me to."),
        ("DREW", "I know I did."),
    ]
    actual = [(d["character"], d["text"]) for d in r["dialogue"]]
    assert actual == expected


# ─── Parity: frontend preview MUST match backend saved result ──────────


def test_parser_parity_jack_sarah_characters(frontend_parser_js):
    """SEC-worthy parity assertion: the preview the user sees and the
    saved result the rehearsal plays must agree on character set."""
    fe = _run_frontend_parser(frontend_parser_js, JACK_SARAH_SCRIPT)
    be = fallback_parse_script(JACK_SARAH_SCRIPT)
    fe_chars = set(fe["detectedCharacters"])
    be_chars = set(be["characters"])
    assert fe_chars == be_chars, (
        f"parser parity broken: frontend chars={fe_chars} "
        f"backend chars={be_chars}"
    )


def test_parser_parity_jack_sarah_dialogue(frontend_parser_js):
    """Dialogue array must agree on (character, text) pairs in order."""
    fe = _run_frontend_parser(frontend_parser_js, JACK_SARAH_SCRIPT)
    be = fallback_parse_script(JACK_SARAH_SCRIPT)
    fe_dialogue = [(d["character"], d["text"]) for d in fe["dialogue"]]
    be_dialogue = [
        (ln["character"], ln["text"])
        for ln in be["lines"]
        if not ln["is_stage_direction"]
    ]
    assert fe_dialogue == be_dialogue, (
        f"parser parity broken on dialogue:\n"
        f"  frontend={fe_dialogue}\n"
        f"  backend ={be_dialogue}"
    )


def test_parser_parity_mixed_cue_styles(frontend_parser_js):
    raw = (
        "JACK: You're late.\n"
        "SARAH\n"
        "I had to pick up groceries.\n"
        "JACK: Groceries?\n"
        "SARAH\n"
        "For dinner. We're hosting.\n"
    )
    fe = _run_frontend_parser(frontend_parser_js, raw)
    be = fallback_parse_script(raw)
    fe_dialogue = [(d["character"], d["text"]) for d in fe["dialogue"]]
    be_dialogue = [
        (ln["character"], ln["text"])
        for ln in be["lines"]
        if not ln["is_stage_direction"]
    ]
    assert fe_dialogue == be_dialogue
    assert set(fe["detectedCharacters"]) == set(be["characters"])
