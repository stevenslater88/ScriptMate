"""
Mobile ElevenLabs credential-leak hardening — tree-wide regression
===================================================================

Context — Oct 2026 incident
---------------------------

Between 2026-09-27 and 2026-10-01 00:24 UTC, `frontend/services/
elevenLabsService.ts` called `https://api.elevenlabs.io/v1/text-to-
speech/{voice_id}` directly from the device, carrying an
`xi-api-key` header whose value was supplied by `AppConfig.
ELEVENLABS_API_KEY` — which in turn resolved to
`EXPO_PUBLIC_ELEVENLABS_API_KEY` baked into the JS bundle at build
time via `eas.json`.

APKs built from that window burned ~10,000 `/v1/text-to-speech`
requests and ~39,996 Starter-plan credits (ElevenLabs Analytics
dashboard confirmed). The direct-call code and the baked-in key
were removed in commits `c1584e0` and later. This test suite locks
in the removal across the ENTIRE mobile tree so no future refactor
can reintroduce either the direct-call URL, the `xi-api-key`
header, or any `EXPO_PUBLIC_ELEVENLABS_*` env variable.

Complements (does not replace) the existing narrower tests in
`test_voice_backend_proxy_refactor_feb2026.py`, which only scan
two specific files.

Scope: READ-ONLY static scan of the committed source tree. No live
ElevenLabs calls. No credit consumption.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


# ─── File discovery helpers ────────────────────────────────────────

MOBILE_SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}
MOBILE_CONFIG_FILES = {
    "eas.json",
    "app.json",
    "app.config.js",
    ".env",
}
# Scripts in /app/scripts are build-time Node tooling, NOT shipped
# with the APK. They may legitimately contain the HISTORICAL key
# shape as a classifier/reject fixture. They are excluded from the
# mobile-bundle scan but still asserted below to never ship.
EXCLUDED_FRONTEND_DIRS = {"node_modules", ".expo", "dist", "build", ".metro-cache"}


def _iter_mobile_source_files() -> list[Path]:
    """Return every source/config file that could be bundled into
    the APK, excluding build output and third-party deps."""
    results: list[Path] = []
    for path in FRONTEND.rglob("*"):
        if not path.is_file():
            continue
        if any(part in EXCLUDED_FRONTEND_DIRS for part in path.parts):
            continue
        if path.suffix in MOBILE_SOURCE_SUFFIXES or path.name in MOBILE_CONFIG_FILES:
            results.append(path)
    return results


def _read(path: Path) -> str:
    """Read a text file known to be present (filtered by suffix /
    name upstream). Any OSError here is a legitimate test failure."""
    return path.read_text(encoding="utf-8", errors="replace")


# ─── A. No direct ElevenLabs URL anywhere in the mobile bundle ────


def test_mobile_tree_contains_no_api_elevenlabs_io_url():
    """Covers ALL mobile source and config files — not just the
    service file that already has a narrower assertion."""
    offenders: list[tuple[Path, int, str]] = []
    for f in _iter_mobile_source_files():
        txt = _read(f)
        for i, line in enumerate(txt.splitlines(), start=1):
            if "api.elevenlabs.io" in line:
                offenders.append((f.relative_to(ROOT), i, line.strip()[:120]))
    assert not offenders, (
        "The mobile bundle must not reference api.elevenlabs.io "
        "directly — all synthesis goes through the ScriptMate "
        f"backend proxy. Found:\n{offenders}"
    )


# ─── B. No `xi-api-key` header value anywhere in the mobile bundle


def test_mobile_tree_contains_no_xi_api_key_header():
    offenders: list[tuple[Path, int, str]] = []
    for f in _iter_mobile_source_files():
        txt = _read(f)
        for i, line in enumerate(txt.splitlines(), start=1):
            if "xi-api-key" in line.lower():
                offenders.append((f.relative_to(ROOT), i, line.strip()[:120]))
    assert not offenders, (
        "`xi-api-key` is the ElevenLabs secret-bearing header. It "
        "must only ever appear in server-side Python inside the "
        f"ScriptMate backend. Found in mobile bundle:\n{offenders}"
    )


# ─── C. No EXPO_PUBLIC ElevenLabs variable (any suffix) ───────────


def test_mobile_tree_declares_no_expo_public_elevenlabs_var():
    """Any `EXPO_PUBLIC_ELEVENLABS…` is inlined into the APK's JS
    bundle by Metro — once committed it is unrevocable. Ban them
    across the whole mobile tree."""
    pattern = re.compile(r"EXPO_PUBLIC_ELEVENLABS[A-Z_]*")
    offenders: list[tuple[Path, int, str]] = []
    for f in _iter_mobile_source_files():
        txt = _read(f)
        for i, line in enumerate(txt.splitlines(), start=1):
            if pattern.search(line):
                offenders.append((f.relative_to(ROOT), i, line.strip()[:120]))
    assert not offenders, (
        "EXPO_PUBLIC_ELEVENLABS_* variables ship inside the APK "
        "bundle. The ElevenLabs credential must live only in "
        f"backend/.env. Found:\n{offenders}"
    )


# ─── D. eas.json env sections carry no ElevenLabs entry ───────────


def test_eas_json_env_has_no_elevenlabs_entries():
    """`eas.json` → build.*.env entries are baked into the APK at
    build time. Scan every value for any ElevenLabs reference."""
    import json

    eas_file = FRONTEND / "eas.json"
    assert eas_file.exists(), "frontend/eas.json missing"
    data = json.loads(eas_file.read_text(encoding="utf-8"))

    offenders: list[tuple[str, str]] = []
    for profile, cfg in (data.get("build") or {}).items():
        env = (cfg or {}).get("env") or {}
        for key, value in env.items():
            key_hit = "ELEVENLABS" in key.upper()
            val_hit = isinstance(value, str) and (
                "ELEVENLABS" in value.upper()
                or "elevenlabs.io" in value.lower()
                or value.lower().startswith("sk_")
            )
            if key_hit or val_hit:
                offenders.append((f"build.{profile}.env.{key}", "<redacted>"))
    assert not offenders, (
        "eas.json build.*.env must not reference any ElevenLabs "
        f"credential. Found:\n{offenders}"
    )


# ─── E. app.config.js emits no ElevenLabs field in `extra` ────────


def test_app_config_js_emits_no_elevenlabs_extra_field():
    src = (FRONTEND / "app.config.js").read_text(encoding="utf-8")
    # Comments and template-literal log strings are permitted — they
    # document the removal. We only forbid executable key:value
    # entries inside the `extra: { … }` block that gets inlined
    # into `Constants.expoConfig.extra` at bundle time.
    non_comment = re.sub(r"//[^\n]*", "", src)
    non_comment = re.sub(r"/\*[\s\S]*?\*/", "", non_comment)
    # Isolate the extra: { ... } block (brace-balanced).
    m = re.search(r"extra\s*:\s*\{", non_comment)
    assert m, "app.config.js must declare an `extra` block"
    start = m.end()
    depth = 1
    i = start
    while i < len(non_comment) and depth > 0:
        if non_comment[i] == "{":
            depth += 1
        elif non_comment[i] == "}":
            depth -= 1
        i += 1
    extra_block = non_comment[start : i - 1]
    assert not re.search(
        r"\bELEVENLABS[A-Z_]*\s*:",
        extra_block,
    ), "app.config.js `extra:` block must not emit any ElevenLabs key"


# ─── F. AppConfig does not export ELEVENLABS_API_KEY ──────────────


def test_app_config_ts_does_not_export_elevenlabs_key():
    src = (FRONTEND / "services" / "appConfig.ts").read_text(encoding="utf-8")
    # Strip comments so documentation references are allowed.
    non_comment = re.sub(r"//[^\n]*", "", src)
    non_comment = re.sub(r"/\*[\s\S]*?\*/", "", non_comment)
    # Must not re-introduce a resolve() call for the key.
    assert "EXPO_PUBLIC_ELEVENLABS_API_KEY" not in non_comment, (
        "appConfig.ts must not resolve EXPO_PUBLIC_ELEVENLABS_API_KEY"
    )
    # Must not export a property named ELEVENLABS_API_KEY on AppConfig.
    assert not re.search(r"ELEVENLABS_API_KEY\s*:", non_comment), (
        "AppConfig must not expose an ELEVENLABS_API_KEY property"
    )


# ─── G. Current TTS flow routes to the ScriptMate backend ─────────


def test_current_tts_flow_posts_to_scriptmate_backend_proxy():
    src = (FRONTEND / "services" / "elevenLabsService.ts").read_text(encoding="utf-8")
    assert "/api/tts/elevenlabs/generate" in src, (
        "elevenLabsService.ts must POST to the backend proxy"
    )
    # Must not import or reference an API-key constant.
    non_comment = re.sub(r"//[^\n]*", "", src)
    non_comment = re.sub(r"/\*[\s\S]*?\*/", "", non_comment)
    assert "ELEVENLABS_API_KEY" not in non_comment, (
        "elevenLabsService.ts must not reference ELEVENLABS_API_KEY"
    )


# ─── H. Backend remains the sole credential holder ────────────────


def test_backend_server_reads_elevenlabs_api_key_from_env():
    src = (BACKEND / "server.py").read_text(encoding="utf-8")
    assert re.search(
        r"ELEVENLABS_API_KEY\s*=\s*os\.environ\.get\(\s*['\"]ELEVENLABS_API_KEY['\"]",
        src,
    ), "backend must read ELEVENLABS_API_KEY from os.environ"
    assert "eleven_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)" in src, (
        "backend must initialise the SDK with the server-side key"
    )


# ─── I. Backend TTS endpoint enforces bearer auth ─────────────────


def test_backend_generate_endpoint_requires_authentication():
    src = (BACKEND / "server.py").read_text(encoding="utf-8")
    ep_start = src.find('@api_router.post("/tts/elevenlabs/generate")')
    assert ep_start > 0, "generate endpoint missing"
    next_ep = src.find("\n@api_router.", ep_start + 1)
    endpoint = src[ep_start : next_ep if next_ep > 0 else len(src)]
    # Must call an authenticated-user helper. The SEC-004 refactor
    # named it `_require_authenticated_user_id` or similar.
    assert re.search(
        r"_require_authenticated_user_id|get_authenticated_user_id|get_current_user",
        endpoint,
    ), (
        "TTS generate endpoint must resolve an authenticated user "
        "id (bearer-token-based) before calling ElevenLabs"
    )


# ─── J. Backend TTS rate limit remains active ─────────────────────


def test_backend_tts_rate_limit_active():
    src = (BACKEND / "server.py").read_text(encoding="utf-8")
    # The limiter constants must exist and remain non-zero.
    m_max = re.search(r"TTS_RATE_LIMIT_MAX\s*=\s*(\d+)", src)
    m_win = re.search(r"TTS_RATE_LIMIT_WINDOW_SECONDS\s*=\s*(\d+)", src)
    assert m_max and int(m_max.group(1)) > 0, (
        "TTS_RATE_LIMIT_MAX must remain positive"
    )
    assert m_win and int(m_win.group(1)) > 0, (
        "TTS_RATE_LIMIT_WINDOW_SECONDS must remain positive"
    )
    # And the generate endpoint must still call the limiter.
    ep_start = src.find('@api_router.post("/tts/elevenlabs/generate")')
    next_ep = src.find("\n@api_router.", ep_start + 1)
    endpoint = src[ep_start : next_ep if next_ep > 0 else len(src)]
    assert "_tts_check_rate_limit" in endpoint, (
        "TTS generate endpoint must invoke _tts_check_rate_limit"
    )


# ─── K. The historical compromised key value does not ship ────────


HISTORICAL_LEAKED_HEX = (
    "c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb"
)


def test_historical_leaked_key_does_not_ship_in_mobile_bundle():
    """The exact 64-char hex value that was committed into eas.json
    between Feb 2026 and the Oct 1 cleanup is still allowed to
    appear as a REJECT fixture in `scripts/*` build-time tooling
    (those files never ship with the APK). But it must not appear
    anywhere inside `frontend/` that would be bundled into the
    mobile JS bundle."""
    offenders: list[Path] = []
    for f in _iter_mobile_source_files():
        if HISTORICAL_LEAKED_HEX in _read(f):
            offenders.append(f.relative_to(ROOT))
    assert not offenders, (
        "The historical compromised 64-char hex credential must "
        f"not ship inside the mobile bundle. Found in:\n{offenders}"
    )


# ─── L. No tracked raw `sk_` ElevenLabs secret in the mobile tree


_SK_PATTERN = re.compile(r"\bsk_[A-Za-z0-9]{32,}\b")


def test_no_raw_elevenlabs_sk_secret_in_mobile_tree():
    """Belt-and-suspenders: scan every mobile-bundle file for the
    `sk_…` secret-key shape. Must not be present anywhere."""
    offenders: list[tuple[Path, int]] = []
    for f in _iter_mobile_source_files():
        txt = _read(f)
        for i, line in enumerate(txt.splitlines(), start=1):
            if _SK_PATTERN.search(line):
                # Permit comments that document the removed pattern
                # using placeholder text like `sk_YOUR_REAL_KEY`.
                lo = line.lower()
                if "sk_your_real_key" in lo or "sk_..." in lo or "sk_…" in lo:
                    continue
                offenders.append((f.relative_to(ROOT), i))
    assert not offenders, (
        "A raw ElevenLabs `sk_…` secret must never appear in the "
        f"mobile bundle. Found at:\n{offenders}"
    )
