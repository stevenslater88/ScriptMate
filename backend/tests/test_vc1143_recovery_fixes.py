"""VC1143 recovery — character line counts, rehearsal mic prompting, ElevenLabs player release.

Parser tests execute the real `services/smartScriptParser.ts` in Node (sucrase)
against the physical Great Snack Heist PyPDF2 fixture (200 numbered cues).
"""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
FRONTEND = Path("/app/frontend")
FIXTURE = BACKEND / "tests/fixtures/scriptm8_great_snack_heist_pypdf2_physical.txt"
REHEARSAL = (FRONTEND / "app/rehearsal/[id].tsx").read_text()
EXPECTED = {"JACK": 68, "EMILY": 40, "BELLA": 52, "LILY": 40}

_JS = """
require('/app/frontend/node_modules/sucrase/register/ts');
const {parseScript}=require('/app/frontend/services/smartScriptParser.ts');
const raw=require('fs').readFileSync(process.argv[1],'utf8');
const r=parseScript(raw,{includeHeadings:false});
const dlg={},cues={};
r.parsedLines.forEach(l=>{
  if(l.type==='DIALOGUE'&&l.characterName) dlg[l.characterName]=(dlg[l.characterName]||0)+1;
  if(l.type==='CHARACTER') cues[l.characterName]=(cues[l.characterName]||0)+1;
});
process.stdout.write(JSON.stringify({dlg,cues,chars:r.detectedCharacters.map(c=>c.name)}));
"""


def _client_parse(path: Path) -> dict:
    out = subprocess.run(["node", "-e", _JS, str(path)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_fixture_ground_truth():
    cues = re.findall(r"^\s*\d+\s*[—-]\s*([A-Z]+)\s*$", FIXTURE.read_text(), re.M)
    assert dict(Counter(cues)) == EXPECTED


def test_client_detects_all_200_cues_including_two_and_three_digit_numbers():
    r = _client_parse(FIXTURE)
    assert r["cues"] == EXPECTED, r["cues"]


def test_client_dialogue_line_counts_match_ground_truth():
    # These are the counts shown on the import screen (script-parser.tsx:494).
    r = _client_parse(FIXTURE)
    assert r["dlg"] == EXPECTED, r["dlg"]
    assert sorted(r["chars"]) == sorted(EXPECTED)


def test_client_matches_backend_saved_line_counts():
    import server
    parsed = server.fallback_parse_script(FIXTURE.read_text())
    backend = dict(Counter(l["character"] for l in parsed["lines"] if l.get("character")))
    assert backend == EXPECTED
    assert _client_parse(FIXTURE)["dlg"] == backend


def test_blank_line_after_cue_keeps_dialogue(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text("10 — LILY\nAll of them?\n11 — JACK\n\nProbably.\n12 — EMILY\nRight.\n")
    r = _client_parse(p)
    assert r["dlg"] == {"LILY": 1, "JACK": 1, "EMILY": 1}, r


def test_blank_line_still_ends_dialogue_after_dialogue(tmp_path):
    p = tmp_path / "s.txt"
    p.write_text("JACK\nHello there.\n\nThe door slams shut and the lights go out.\n\nEMILY\nWho's there?\n")
    r = _client_parse(p)
    assert r["dlg"] == {"JACK": 1, "EMILY": 1}, r


# ─── Rehearsal microphone prompting ──────────────────────────────────

def test_mic_denial_is_remembered():
    assert "const speechPermissionDeniedRef = useRef(false);" in REHEARSAL
    i = REHEARSAL.index("const ensureSpeechPermission")
    body = REHEARSAL[i:i + 2200]
    assert body.count("speechPermissionDeniedRef.current = true;") == 2
    assert "speechPermissionDeniedRef.current = false;" in body


def test_auto_start_skips_after_denial():
    i = REHEARSAL.index("// Auto-start listening when it's the user's turn")
    block = REHEARSAL[i:i + 900]
    assert "!speechPermissionDeniedRef.current" in block
    assert "startListening();" in block


def test_manual_mic_button_still_calls_start_listening():
    assert "onPress={startListening}" in REHEARSAL


# ─── ElevenLabs player release ───────────────────────────────────────

def test_finished_elevenlabs_sound_is_unloaded():
    i = REHEARSAL.index("if (status.didJustFinish && !doneFired) {")
    block = REHEARSAL[i:i + 600]
    assert "Promise.resolve(sound.unloadAsync()).catch(() => {});" in block
    assert block.index("safeAdvance();") < block.index("unloadAsync")
