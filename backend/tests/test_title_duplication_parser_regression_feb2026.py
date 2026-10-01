"""
Physical build 1.0.66 / VC1110 — TITLE-duplication parser regression
====================================================================

The ScriptM8_Parser_Parity_Test.pdf, when extracted via PyPDF2 on the
Samsung S23 Ultra production path, produces this exact representation
*after* `_coalesce_pdf_header_value_splits` has been applied:

    THE CALL
    TITLE: THE CALL
    AUTHOR: ScriptM8 QA
    CHARACTERS:
    JACK
    SARAH
    JACK:
    Are you ready?
    SARAH:
    I've been ready for ten minutes.
    JACK:
    Then let's do this.
    SARAH:
    Together?
    JACK:
    Together.

PyPDF2 duplicates the on-page title. The leading standalone `THE CALL`
is uppercase, two words, and not a scene heading / header keyword /
inline cue — so the pre-fix parser promoted it to a speaking character
alongside JACK and SARAH.

Expected characters: `{JACK, SARAH}`.
Pre-fix characters:  `{JACK, SARAH, THE CALL}` ← the physical failure.

Structural rule under test:

    If an explicit `TITLE: <value>` header exists AND a preceding
    standalone line equals that `<value>`, treat the preceding line as
    duplicated document-title extraction and exclude it from character
    detection.

Also asserts:
  * no hard-coding of "THE CALL"
  * legitimate `JACK: Hello.` script with no TITLE metadata preserves JACK
  * legitimate multi-word character `THE DETECTIVE:` is preserved
  * frontend ↔ backend parity on the exact physical representation
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

from server import _coalesce_pdf_header_value_splits, fallback_parse_script

# ─── Fixtures ──────────────────────────────────────────────────────────

# The EXACT extracted representation from the physical S23 QA failure.
PHYSICAL_EXTRACTED_TEXT = (
    "THE CALL\n"
    "TITLE: THE CALL\n"
    "AUTHOR: ScriptM8 QA\n"
    "CHARACTERS:\n"
    "JACK\n"
    "SARAH\n"
    "JACK:\n"
    "Are you ready?\n"
    "SARAH:\n"
    "I've been ready for ten minutes.\n"
    "JACK:\n"
    "Then let's do this.\n"
    "SARAH:\n"
    "Together?\n"
    "JACK:\n"
    "Together."
)


# ─── Backend parser regression ────────────────────────────────────────


def test_backend_physical_representation_excludes_title_duplicate():
    """The exact physical representation must yield only JACK + SARAH.

    Pre-fix behaviour: `{JACK, SARAH, THE CALL}` (the physical bug).
    Post-fix behaviour: `{JACK, SARAH}`.
    """
    result = fallback_parse_script(PHYSICAL_EXTRACTED_TEXT)
    chars = set(result["characters"])
    assert chars == {"JACK", "SARAH"}, (
        f"TITLE duplicate 'THE CALL' leaked into characters: {chars}"
    )
    assert "THE CALL" not in chars, (
        "'THE CALL' is the document title, not a speaking character"
    )


def test_backend_title_duplicate_logged_as_stage_direction():
    """The suppressed duplicate must still appear in the lines array
    as a stage-direction line — it is NOT silently dropped from the
    user's content, only excluded from the character set."""
    result = fallback_parse_script(PHYSICAL_EXTRACTED_TEXT)
    stage_direction_texts = [
        ln["text"] for ln in result["lines"] if ln.get("is_stage_direction")
    ]
    assert "THE CALL" in stage_direction_texts, (
        "duplicate title should be stored as stage direction, not dropped"
    )


def test_backend_different_title_duplicate_excluded():
    """Rule must be generic — different title ('ANOTHER TITLE') also
    suppressed. Proves the fix is NOT hard-coded to 'THE CALL'."""
    raw = (
        "ANOTHER TITLE\n"
        "TITLE: ANOTHER TITLE\n"
        "CHARACTERS:\n"
        "ANNA\n"
        "BEN\n"
        "ANNA: Hello.\n"
        "BEN: Hi.\n"
    )
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert chars == {"ANNA", "BEN"}, (
        f"'ANOTHER TITLE' leaked into characters: {chars}"
    )


def test_backend_no_title_metadata_preserves_first_character():
    """Without a `TITLE: X` header, a legitimate first character
    `JACK:` must still be detected. Proves the suppression is gated
    on the presence of an explicit TITLE header, not blanket."""
    raw = "JACK:\nHello.\nSARAH:\nHi back.\n"
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert chars == {"JACK", "SARAH"}, chars


def test_backend_no_title_metadata_bare_first_character():
    """Without any TITLE header, bare `JACK` first line is still a
    character cue."""
    raw = "JACK\nHello.\n\nSARAH\nHi back.\n"
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert chars == {"JACK", "SARAH"}, chars


def test_backend_legitimate_multiword_character_preserved():
    """`THE DETECTIVE:` is a valid 2-word character cue when it is NOT
    a duplicate of the document title. Fix must not touch this path."""
    raw = (
        "TITLE: Noir Night\n"
        "CHARACTERS:\n"
        "THE DETECTIVE\n"
        "SUSPECT\n"
        "THE DETECTIVE: Where were you?\n"
        "SUSPECT: Nowhere.\n"
    )
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert chars == {"THE DETECTIVE", "SUSPECT"}, chars


def test_backend_character_named_like_title_after_header_preserved():
    """A line equal to the TITLE value that appears AFTER the
    `TITLE: X` header is NOT a duplicate — it is a legitimate
    character cue and must be preserved. Only PRECEDING duplicates
    are suppressed, matching the PyPDF2 extraction pattern."""
    raw = (
        "TITLE: BOSS\n"
        "CHARACTERS:\n"
        "BOSS\n"
        "WORKER\n"
        "BOSS: Get in here.\n"
        "WORKER: Right away.\n"
    )
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert "BOSS" in chars, f"BOSS character after TITLE header must survive: {chars}"
    assert "WORKER" in chars, chars


def test_backend_existing_jack_sarah_qa_dialogue_unchanged():
    """Legacy JACK/SARAH script with TITLE but no preceding title
    duplicate must still parse exactly as before."""
    raw = (
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
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert chars == {"JACK", "SARAH"}, chars
    dialogue = [ln for ln in result["lines"] if not ln.get("is_stage_direction")]
    assert len(dialogue) == 5
    assert dialogue[0]["character"] == "JACK"
    assert dialogue[0]["text"] == "Are you ready?"


def test_backend_trailing_colon_character_cue_regression():
    """Prior fix (build 1.0.65) stripped trailing colons so `JACK:`
    and `JACK` collapse to the same character key. Must still hold."""
    raw = (
        "TITLE: Chat\n"
        "JACK:\n"
        "Hello.\n"
        "JACK\n"
        "More.\n"
    )
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    # JACK must be present exactly once (no `JACK:` sibling key).
    assert chars == {"JACK"}, chars


def test_backend_no_hard_coded_title_value():
    """Fix must be generic — swap 'THE CALL' for 'LA TRAVIATA' and the
    behaviour must be identical. Confirms no hard-coding."""
    raw = (
        "LA TRAVIATA\n"
        "TITLE: LA TRAVIATA\n"
        "CHARACTERS:\n"
        "VIOLETTA\n"
        "ALFREDO\n"
        "VIOLETTA: Un di felice.\n"
        "ALFREDO: Si, da un anno.\n"
    )
    result = fallback_parse_script(raw)
    chars = set(result["characters"])
    assert chars == {"VIOLETTA", "ALFREDO"}, chars
    assert "LA TRAVIATA" not in chars


# ─── PyPDF2 extraction pass-through sanity ────────────────────────────


def test_coalesce_passthrough_leaves_non_split_titles_intact():
    """`_coalesce_pdf_header_value_splits` must not mangle a
    `TITLE: X`-on-one-line input. The duplicate-title suppression
    lives in the PARSER, not the coalescer."""
    coalesced = _coalesce_pdf_header_value_splits(PHYSICAL_EXTRACTED_TEXT)
    # The TITLE line is already complete — no join should occur on it.
    assert "TITLE: THE CALL" in coalesced
    # The leading duplicate must survive the coalesce step (it is the
    # parser's job to suppress it, not the coalescer's).
    assert coalesced.splitlines()[0].strip() == "THE CALL"


# ─── Frontend parity (ts → js via tsc, invoke via node) ───────────────


def _tooling_available() -> bool:
    return shutil.which("node") is not None and shutil.which("npx") is not None


@pytest.fixture(scope="module")
def frontend_parser_js(tmp_path_factory):
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
        pytest.skip("smartScriptParser.js not emitted")
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


def test_frontend_physical_representation_excludes_title_duplicate(
    frontend_parser_js,
):
    r = _run_frontend_parser(frontend_parser_js, PHYSICAL_EXTRACTED_TEXT)
    assert sorted(r["detectedCharacters"]) == ["JACK", "SARAH"], (
        f"frontend must suppress TITLE duplicate; got {r['detectedCharacters']}"
    )


def test_frontend_backend_parity_on_physical_representation(frontend_parser_js):
    """SEC-worthy parity: the preview the user sees and the saved
    result the rehearsal plays must agree on the exact physical
    PyPDF2 extraction."""
    fe = _run_frontend_parser(frontend_parser_js, PHYSICAL_EXTRACTED_TEXT)
    be = fallback_parse_script(PHYSICAL_EXTRACTED_TEXT)
    fe_chars = set(fe["detectedCharacters"])
    be_chars = set(be["characters"])
    assert fe_chars == be_chars, (
        f"parity broken: frontend={fe_chars} backend={be_chars}"
    )
    assert fe_chars == {"JACK", "SARAH"}, fe_chars


def test_frontend_different_title_duplicate_excluded(frontend_parser_js):
    raw = (
        "ANOTHER TITLE\n"
        "TITLE: ANOTHER TITLE\n"
        "CHARACTERS:\n"
        "ANNA\n"
        "BEN\n"
        "ANNA: Hello.\n"
        "BEN: Hi.\n"
    )
    r = _run_frontend_parser(frontend_parser_js, raw)
    assert sorted(r["detectedCharacters"]) == ["ANNA", "BEN"], (
        r["detectedCharacters"]
    )


def test_frontend_no_title_metadata_preserves_first_character(frontend_parser_js):
    raw = "JACK:\nHello.\nSARAH:\nHi back.\n"
    r = _run_frontend_parser(frontend_parser_js, raw)
    assert sorted(r["detectedCharacters"]) == ["JACK", "SARAH"], (
        r["detectedCharacters"]
    )


def test_frontend_legitimate_multiword_character_preserved(frontend_parser_js):
    raw = (
        "TITLE: Noir Night\n"
        "CHARACTERS:\n"
        "THE DETECTIVE\n"
        "SUSPECT\n"
        "THE DETECTIVE: Where were you?\n"
        "SUSPECT: Nowhere.\n"
    )
    r = _run_frontend_parser(frontend_parser_js, raw)
    assert sorted(r["detectedCharacters"]) == ["SUSPECT", "THE DETECTIVE"], (
        r["detectedCharacters"]
    )
