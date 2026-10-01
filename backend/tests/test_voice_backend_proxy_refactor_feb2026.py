"""
2026-02 SCRIPT M8 — Option A backend-proxy refactor regression suite
====================================================================

The physical build 1110 QA fail traced to an ElevenLabs API-key-ID
hard-coded in the mobile client. Fix (Option A, approved by the
user): the client no longer carries any ElevenLabs credential.
Every synthesis is proxied through the ScriptMate backend at
POST /api/tts/elevenlabs/generate. The real `sk_...` secret lives
only in backend/.env (`ELEVENLABS_API_KEY`).

This suite locks the architecture — any regression that reintroduces
a client-side ElevenLabs credential, or that bypasses the backend
proxy, will fail here before shipping.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
APPCONFIG = FRONTEND / "services" / "appConfig.ts"
APP_CONFIG_JS = FRONTEND / "app.config.js"
SERVICE = FRONTEND / "services" / "elevenLabsService.ts"
PURE = FRONTEND / "services" / "elevenLabsPure.ts"
REHEARSAL = FRONTEND / "app" / "rehearsal" / "[id].tsx"
SERVER = BACKEND / "server.py"


# ─── A. CLIENT CARRIES NO ELEVENLABS CREDENTIAL ───────────────────

def test_client_no_longer_declares_ELEVENLABS_API_KEY():
    """`AppConfig.ELEVENLABS_API_KEY` must not exist. The field was
    removed as part of the Option A refactor."""
    src = APPCONFIG.read_text()
    # The DEFAULTS block must not include ELEVENLABS_API_KEY: ...
    assert not re.search(r"^\s*ELEVENLABS_API_KEY\s*:", src, re.MULTILINE), (
        "appConfig DEFAULTS must not declare ELEVENLABS_API_KEY — "
        "the client no longer carries an ElevenLabs credential"
    )
    # And no `resolve('EXPO_PUBLIC_ELEVENLABS_API_KEY', ...)` call.
    assert "EXPO_PUBLIC_ELEVENLABS_API_KEY" not in src, (
        "appConfig must not read EXPO_PUBLIC_ELEVENLABS_API_KEY — "
        "the credential lives only in backend/.env now"
    )
    # The exported AppConfig object must not expose ELEVENLABS_API_KEY.
    export_block = src[src.find("export const AppConfig"):]
    export_block = export_block[: export_block.find("} as const;") + len("} as const;")]
    assert not re.search(r"^\s*ELEVENLABS_API_KEY\s*:", export_block, re.MULTILINE), (
        "AppConfig export must not include ELEVENLABS_API_KEY"
    )


def test_app_config_js_no_longer_declares_EXPO_PUBLIC_ELEVENLABS_API_KEY():
    """The Expo prebuild must not read or emit the credential into
    Constants.expoConfig.extra. If this ever reappears, the Android
    APK would once again ship the secret in cleartext."""
    src = APP_CONFIG_JS.read_text()
    # No process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY reference.
    assert "process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY" not in src, (
        "app.config.js must not read EXPO_PUBLIC_ELEVENLABS_API_KEY — "
        "re-introducing it bundles the secret into the APK"
    )
    # And must not emit it inside the `extra` block.
    assert not re.search(
        r"EXPO_PUBLIC_ELEVENLABS_API_KEY\s*:", src
    ), (
        "app.config.js must not emit EXPO_PUBLIC_ELEVENLABS_API_KEY "
        "in Constants.expoConfig.extra"
    )
    assert not re.search(
        r"^\s*ELEVENLABS_API_KEY\s*:", src, re.MULTILINE
    ), (
        "app.config.js must not emit ELEVENLABS_API_KEY in extra"
    )


def test_service_no_longer_sends_xi_api_key_header():
    """The direct ElevenLabs call carried an `xi-api-key` header.
    After the refactor, the client only calls the ScriptMate backend
    proxy — no `xi-api-key` must appear in the client source."""
    src = SERVICE.read_text()
    assert "'xi-api-key'" not in src and '"xi-api-key"' not in src, (
        "elevenLabsService must not send an xi-api-key header — the "
        "credential lives only server-side"
    )


def test_service_no_longer_contacts_api_elevenlabs_io_directly():
    """The direct URL must be gone — all requests route through the
    ScriptMate backend proxy."""
    src = SERVICE.read_text()
    assert "api.elevenlabs.io" not in src, (
        "elevenLabsService must not call api.elevenlabs.io directly — "
        "it must POST to the backend proxy at /api/tts/elevenlabs/generate"
    )
    assert "/api/tts/elevenlabs/generate" in src, (
        "elevenLabsService must POST to the backend proxy endpoint"
    )


def test_pure_seam_contains_no_elevenlabs_api_key_or_direct_url():
    """The RN-free pure seam must stay free of any client credential
    too — the backend proxy pattern is end-to-end."""
    src = PURE.read_text()
    assert "api.elevenlabs.io" not in src
    assert "xi-api-key" not in src
    assert "ELEVENLABS_API_KEY" not in src


# ─── B. BACKEND PROXY CONTRACT ────────────────────────────────────

def test_backend_health_route_exists():
    src = SERVER.read_text()
    assert '@api_router.get("/tts/elevenlabs/health")' in src, (
        "backend must expose GET /api/tts/elevenlabs/health"
    )
    # The response payload must include `configured` + `classification`.
    m = re.search(
        r'@api_router\.get\("/tts/elevenlabs/health"\)[\s\S]{0,1500}?return\s*\{[\s\S]{0,500}?"configured"[\s\S]{0,500}?"classification"',
        src,
    )
    assert m, (
        "health route must return a dict with 'configured' and "
        "'classification' fields"
    )


def test_backend_generate_route_accepts_speed_and_returns_audio_mpeg():
    src = SERVER.read_text()
    # Request model must accept speed.
    model_idx = src.find("class ElevenLabsTTSRequest")
    model = src[model_idx:src.find("\nclass ", model_idx + 1)]
    assert re.search(r"speed\s*:\s*float", model), (
        "ElevenLabsTTSRequest must accept a `speed: float` field"
    )
    # Endpoint must pass speed into VoiceSettings and return raw MP3.
    ep_start = src.find('@api_router.post("/tts/elevenlabs/generate")')
    assert ep_start > 0, "generate endpoint missing"
    # Walk to next decorator or EOF.
    next_ep = src.find("\n@api_router.", ep_start + 1)
    endpoint = src[ep_start:next_ep] if next_ep > 0 else src[ep_start:]
    assert re.search(r"speed\s*=\s*speed\b", endpoint), (
        "backend must forward the clamped speed into VoiceSettings"
    )
    assert 'media_type="audio/mpeg"' in endpoint, (
        "backend response must be media_type='audio/mpeg' (raw MP3)"
    )
    assert "audio_base64" not in endpoint, (
        "backend response must not use base64 payload anymore"
    )


def test_backend_clamps_speed_to_elevenlabs_range():
    src = SERVER.read_text()
    ep_start = src.find('@api_router.post("/tts/elevenlabs/generate")')
    next_ep = src.find("\n@api_router.", ep_start + 1)
    endpoint = src[ep_start:next_ep] if next_ep > 0 else src[ep_start:]
    assert re.search(r"max\(\s*0\.7\s*,\s*min\(\s*1\.2", endpoint), (
        "backend must clamp speed to the ElevenLabs 0.7-1.2 range"
    )


# ─── C. SECURITY — THE SECRET STAYS OUT OF THE BUNDLE ──────────────

def test_security_scan_frontend_tree_for_raw_sk_prefix():
    """Belt-and-braces: no file under frontend/ may contain a literal
    `sk_` followed by 20+ chars (which would look like an ElevenLabs
    key committed to source). Excludes node_modules."""
    import subprocess as _sp
    rg = _sp.run(
        ["grep", "-rE", "--exclude-dir=node_modules",
         r"sk_[A-Za-z0-9]{20,}", str(FRONTEND)],
        capture_output=True, text=True, check=False,
    )
    hits = [ln for ln in rg.stdout.splitlines() if ln.strip()]
    # Allow synthetic test fixtures (`sk_xxxxx…` placeholder etc.).
    real = [h for h in hits
            if "xxxxx" not in h
            and "YOUR_" not in h
            and not re.search(r"sk_a{20,}", h)]
    assert not real, (
        f"frontend tree contains a credential-shaped literal: {real[:3]}"
    )


def test_security_scan_app_config_no_elevenlabs_extra():
    """The APK's compiled JS reads Constants.expoConfig.extra at
    runtime. Nothing matching an ElevenLabs credential pattern must
    be emitted into that object."""
    src = APP_CONFIG_JS.read_text()
    # No "ELEVENLABS" key assigned a non-empty literal that could be a key.
    assert not re.search(
        r"ELEVENLABS_API_KEY\s*:\s*['\"](?!routed server-side)",
        src,
    ), (
        "app.config.js must not place a credential-shaped literal "
        "into Constants.expoConfig.extra"
    )


# ─── D. PROXY HEALTH PROBE WIRED CORRECTLY ────────────────────────

def test_frontend_probes_backend_health_at_module_load():
    src = SERVICE.read_text()
    # The probe function must exist and be called once at module load.
    assert "probeBackendElevenLabs" in src
    # Called at import time (not just inside playSpeech).
    assert re.search(
        r"^probeBackendElevenLabs\s*\(\s*\)\s*;",
        src,
        re.MULTILINE,
    ), (
        "frontend must call probeBackendElevenLabs() at module load "
        "so the verdict is cached before the first rehearsal line"
    )


def test_frontend_health_endpoint_matches_backend():
    svc = SERVICE.read_text()
    srv = SERVER.read_text()
    # Must probe the same path the backend exposes.
    assert "/api/tts/elevenlabs/health" in svc
    assert '/tts/elevenlabs/health' in srv  # /api prefix added via api_router


def test_frontend_abort_reason_matches_backend_not_configured():
    """When the backend reports unconfigured, the diagnostic reason
    must be `backend-not-configured` so physical QA can distinguish
    a client-side problem from a server-side one."""
    src = SERVICE.read_text()
    assert "'backend-not-configured'" in src


# ─── E. SMOKE: STILL GREEN AFTER THE REFACTOR ─────────────────────

def test_voice_pipeline_smoke_still_passes():
    smoke = ROOT / "scripts" / "voice_pipeline_smoketest.js"
    assert smoke.exists()
    result = subprocess.run(
        ["node", str(smoke)], cwd=str(ROOT),
        capture_output=True, text=True, timeout=120, check=False,
    )
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    assert result.returncode == 0, (
        f"voice pipeline Node smoke failed:\n{output[-2000:]}"
    )


if __name__ == "__main__":
    sys.exit(subprocess.call([sys.executable, "-m", "pytest", __file__, "-v"]))
