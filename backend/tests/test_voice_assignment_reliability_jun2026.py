"""Character -> assigned voice reliability in rehearsal (Jun 2026).

Confirmed defects fixed:
1. Rehearsal decided "is ElevenLabs available" ONCE at mount (`isElevenLabsConfigured()`
   snapshot). If the backend health probe was still pending, every character used the
   shared device voice for the whole rehearsal.
2. A single failed health probe (network blip at app start) set the verdict to false
   for the entire app session; nothing ever re-probed.
3. Lines spoken before the AsyncStorage assignment load finished had no assignment.
4. A stale load for a previous script could overwrite the current script's map.
5. An assignment saved with an empty voiceId (unknown key at save time) never played.
"""
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "fixtures/voice_assignment_harness.js"
FRONTEND = HERE.parents[1] / "frontend"
REHEARSAL = (FRONTEND / "app/rehearsal/[id].tsx").read_text()
SERVICE = (FRONTEND / "services/elevenLabsService.ts").read_text()


def run(scenario):
    out = subprocess.run(["node", str(HARNESS), scenario], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_each_character_uses_its_own_voice_id():
    r = run("distinct_characters_use_own_voice")
    ids = r["ids"]
    assert len(set(ids.values())) == 3
    expected = {"JOHN": ids["drew"], "MARY": ids["rachel"], "DET. HARRIS": ids["george"]}
    for line in r["lines"]:
        assert line["provider"] == "elevenlabs"
        assert line["voiceIdSent"] == expected[line["character"]], line


def test_character_name_case_drift_keeps_assigned_voice():
    r = run("case_drift_resolves_same_voice")
    assert [l["voiceIdSent"] for l in r["lines"]] == [r["george"], r["rachel"]]


def test_assignments_are_per_script_and_reassignment_is_used():
    r = run("scripts_are_isolated_and_reassignment_persists")
    assert r["a1"][0]["voiceIdSent"] == r["drew"]
    assert r["b"][0]["voiceIdSent"] == r["josh"]
    assert r["a2"][0]["voiceIdSent"] == r["callum"]


def test_empty_saved_voice_id_is_rederived_from_voice_key():
    r = run("empty_voice_id_rederived_from_key")
    assert r["lines"][0] == {"character": "JOHN", "provider": "elevenlabs", "voiceIdSent": r["thomas"]}


def test_unassigned_character_never_borrows_another_characters_voice():
    r = run("unassigned_character_falls_back_without_borrowing_a_voice")
    stranger, john = r["lines"]
    assert stranger == {"character": "STRANGER", "provider": "expo-speech", "voiceIdSent": None}
    assert john["voiceIdSent"] == r["drew"]


def test_failed_health_probe_is_retried_instead_of_disabling_voices_for_session():
    r = run("probe_failure_recovers_after_retry_window")
    assert r["startConfigured"] is False
    assert r["withinWindow"][0]["provider"] == "expo-speech"
    assert r["afterWindow"][0] == {"character": "JOHN", "provider": "elevenlabs", "voiceIdSent": r["drew"]}


def test_hung_health_probe_cannot_stall_a_line():
    r = run("probe_hang_is_bounded")
    assert r["configured"] is False
    assert r["waitedMs"] < 1500


# ---- screen wiring ------------------------------------------------------------------

def test_rehearsal_refreshes_provider_verdict_per_line_after_assignments_load():
    body = REHEARSAL[REHEARSAL.index("const speakLine = useCallback("):]
    wait = body.index("await voiceAssignmentsLoadRef.current;")
    refresh = body.index("elevenLabsAvailable.current = await ensureElevenLabsConfigured(2500);")
    select = body.index("const provider = selectProvider(elevenLabsAvailable.current, resolution);")
    assert wait < refresh < select


def test_rehearsal_load_uses_shared_map_builder_and_ignores_stale_loads():
    assert "buildVoiceAssignmentMap(list, (key) => getVoiceByKey(key)?.id)" in REHEARSAL
    assert "if (cancelled) return;" in REHEARSAL
    assert "return () => { cancelled = true; };" in REHEARSAL


def test_rehearsal_plays_with_the_resolved_assignment_voice_id():
    assert "await playSpeech(text, assignment.voiceId, {" in REHEARSAL
    assert "if (a?.voiceId) prefetchSpeech(l.text, a.voiceId," in REHEARSAL


def test_service_probe_is_deduped_and_retried():
    assert "const PROBE_RETRY_MS = 15000;" in SERVICE
    assert "if (!(await ensureElevenLabsConfigured())) {" in SERVICE
    assert "export const isElevenLabsConfigured = (): boolean => _backendConfigured === true;" in SERVICE
