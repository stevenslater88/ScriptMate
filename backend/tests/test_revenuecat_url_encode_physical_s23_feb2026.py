"""
V1 Release Blocker — RevenueCat subscriber-id URL encoding (Feb 2026).

Physical evidence
-----------------
Device: Samsung Galaxy S23 Ultra, APK 1.0.89 / VC1155.

RevenueCat on-device reported:
    activeEntitlementIds   = ["ScriptMate Pro"]
    activeSubscriptions    = ["scriptmate_annual:3"]
    currentId              = "S's S23 Ultra-1790484231681-ngc4oj4cj"

Backend simultaneously classified the user as `free`:
    createRehearsal(performance|loop) → 403 "requires Premium"
    /api/tts/elevenlabs/generate      → 402 {tier:'free', limit:500}

Root cause
----------
The stable RevenueCat app_user_id is derived from `Device.deviceName`,
which the owner had set to "S's S23 Ultra". On first launch the ID
generator in `_layout.tsx::getStableRevenueCatAppUserId` concatenates
that raw string into `"S's S23 Ultra-<ts>-<rand>"`. This id is then:

  1. Registered with RevenueCat via the native SDK (SDK handles encoding).
  2. Sent to the backend as `X-RC-App-User-Id` header.
  3. Used by the backend's `fetch_premium_entitlement` to call
     `GET https://api.revenuecat.com/v1/subscribers/{id}` — WITHOUT
     URL-encoding. The apostrophe + two spaces produce a malformed
     URL → RC returns 400/404 → the resolver sees `active=False` →
     user stays FREE → BOTH the rehearsal gate and the TTS gate 403/402.

Fix contract pinned here
------------------------
A. `backend/revenuecat_client.py::fetch_premium_entitlement` URL-encodes
   `app_user_id` with `urllib.parse.quote(..., safe='')`.
B. `frontend/app/_layout.tsx::getStableRevenueCatAppUserId` sanitises the
   source string to `[A-Za-z0-9._-]` for all FUTURE installs — the
   backend fix remains the authoritative repair for devices that
   already minted an unsafe id.
C. The RC error-code 7723 (V1/V2 secret-key mismatch) flagged by the
   deployer is a SEPARATE operator action and is noted but out of scope
   for a code fix.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

RC_CLIENT_PATH = Path("/app/backend/revenuecat_client.py")
LAYOUT_PATH = Path("/app/frontend/app/_layout.tsx")


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(scope="module")
def rc_client_source() -> str:
    return RC_CLIENT_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def layout_source() -> str:
    return LAYOUT_PATH.read_text(encoding="utf-8")


# ─── 1. Backend URL-encoding fix ───────────────────────────────────────

def test_rc_client_imports_url_quote(rc_client_source: str):
    assert "from urllib.parse import quote" in rc_client_source


def test_rc_client_url_encodes_app_user_id(rc_client_source: str):
    """The subscribers URL must be built with `quote(app_user_id, safe='')`
    so apostrophes, spaces and any Unicode characters are percent-encoded."""
    assert "f\"{REVENUECAT_API_BASE}/subscribers/{quote(app_user_id, safe='')}\"" in rc_client_source


def test_rc_client_url_encodes_physical_s23_ultra_id():
    """Exact repro of the S23 Ultra id. Verify the URL httpx would send
    is well-formed and contains no raw apostrophes or spaces."""
    from urllib.parse import quote
    raw = "S's S23 Ultra-1790484231681-ngc4oj4cj"
    encoded = quote(raw, safe="")
    url = f"https://api.revenuecat.com/v1/subscribers/{encoded}"
    # No raw unsafe chars in the final URL path
    assert "'" not in url
    assert " " not in url
    # Positive encoding assertions
    assert "%27" in encoded  # apostrophe
    assert "%20" in encoded  # space
    # Decoding round-trips to the exact raw id (no data loss)
    from urllib.parse import unquote
    assert unquote(encoded) == raw


def test_rc_client_fetch_uses_encoded_url_live_httpx_stub():
    """Behavioural: `fetch_premium_entitlement` must send a properly-encoded
    URL to RC even when the app_user_id contains an apostrophe + spaces.
    We stub httpx.AsyncClient.get and inspect the URL."""
    sys.path.insert(0, "/app/backend")
    import revenuecat_client as rc  # type: ignore

    captured = {}

    class _StubResp:
        status_code = 404
        text = ""
        def json(self):
            return {"subscriber": {"entitlements": {}}}

    class _StubClient:
        def __init__(self, *_a, **_kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_a): return None
        async def get(self, url, headers=None):
            captured["url"] = url
            return _StubResp()

    raw_id = "S's S23 Ultra-1790484231681-ngc4oj4cj"
    with patch.object(rc.httpx, "AsyncClient", _StubClient):
        result = _run(rc.fetch_premium_entitlement(raw_id, secret_key="sk_test"))

    assert result.active is False  # 404 → inactive, as before
    url = captured["url"]
    assert url.startswith("https://api.revenuecat.com/v1/subscribers/")
    # URL must be percent-encoded, apostrophe + space encoded, raw chars absent.
    assert "'" not in url
    assert " " not in url
    assert "%27" in url
    assert "%20" in url


def test_rc_client_still_works_for_plain_ids():
    """Regression: a URL-safe id must not be double-encoded or altered."""
    sys.path.insert(0, "/app/backend")
    import revenuecat_client as rc  # type: ignore

    captured = {}

    class _StubResp:
        status_code = 404
        text = ""
        def json(self):
            return {"subscriber": {"entitlements": {}}}

    class _StubClient:
        def __init__(self, *_a, **_kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_a): return None
        async def get(self, url, headers=None):
            captured["url"] = url
            return _StubResp()

    plain_id = "abc123-1700000000000-xyz9"
    with patch.object(rc.httpx, "AsyncClient", _StubClient):
        _run(rc.fetch_premium_entitlement(plain_id, secret_key="sk_test"))

    assert captured["url"].endswith(f"/subscribers/{plain_id}")


# ─── 2. Frontend id-safety fix (prevents recurrence on NEW installs) ──

def test_frontend_sanitises_new_device_name(layout_source: str):
    """New installs must produce an id in the character class
    `[A-Za-z0-9._-]`. Existing devices keep their stored id (the backend
    URL-encode fix remains authoritative for them)."""
    assert "/[^A-Za-z0-9._-]+/g" in layout_source
    # The sanitiser must be applied to the raw device string.
    assert "const safeUniq = rawUniq.replace(/[^A-Za-z0-9._-]+/g, '-')" in layout_source


def test_frontend_sanitiser_handles_s23_ultra_physical_value():
    """Simulate the exact JS transform on the physical device name."""
    raw = "S's S23 Ultra"
    # Mirror the regex applied in getStableRevenueCatAppUserId
    import re as _re
    safe = _re.sub(r"[^A-Za-z0-9._-]+", "-", raw)
    safe = _re.sub(r"^-+|-+$", "", safe) or "device"
    assert "'" not in safe
    assert " " not in safe
    # Expected shape: "S-s-S23-Ultra" or similar; no apostrophes or spaces.
    assert safe == "S-s-S23-Ultra"


def test_frontend_existing_device_id_is_preserved(layout_source: str):
    """Idempotency: if AsyncStorage already holds a device_id, the
    function must return it unchanged — do NOT retroactively rename a
    stable id, that would break the user's RC entitlement binding."""
    pattern = re.compile(
        r"const existing = await AsyncStorage\.getItem\('device_id'\);\s*"
        r"if \(existing\) return existing;",
        re.DOTALL,
    )
    assert pattern.search(layout_source)


# ─── 3. Documentation guard — V1/V2 secret key is operator action ─────

def test_v1_rest_endpoint_still_used(rc_client_source: str):
    """We intentionally use the V1 subscribers endpoint. A V2 secret
    key cannot be used here (returns 403 code 7723). This is an
    operator-side secret rotation, not a code change."""
    assert "https://api.revenuecat.com/v1" in rc_client_source
    assert "/subscribers/" in rc_client_source
