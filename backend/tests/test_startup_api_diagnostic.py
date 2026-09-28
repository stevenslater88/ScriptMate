"""Regression: the startup API-URL diagnostic in
`frontend/services/apiConfig.ts` must not raise a false "WRONG URL"
alert for the current legitimate ScriptMate backend hosts.

Background:
    Build 1110-QA showed a startup popup:
        "Correct: NO x WRONG URL!"
    against the live, healthy backend at https://scriptmate-8.emergent.host.

    Root cause: the diagnostic required the substring 'script-recovery-1'
    (an obsolete preview subdomain).

    Fix: recognise Emergent production hosts (*.emergent.host) and
    Emergent preview hosts (*.preview.emergentagent.com) as legitimate,
    while still flagging genuinely wrong values (empty, or the retired
    android-upload-test host).
"""

from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path("/app/frontend")


def _read(rel: str) -> str:
    return (FRONTEND / rel).read_text()


def test_startup_diagnostic_does_not_hardcode_obsolete_substring() -> None:
    """apiConfig.ts must not USE the obsolete 'script-recovery-1' substring
    as an active domain check. The string may still appear in explanatory
    comments; it must not appear in any executable condition."""
    src = _read("services/apiConfig.ts")
    # Strip // line comments and /* … */ block comments before scanning
    # for the obsolete substring, so that documentation of the historical
    # bug is allowed but any live check on that substring is not.
    stripped = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    stripped = re.sub(r"^\s*//.*$", "", stripped, flags=re.MULTILINE)
    assert "script-recovery-1" not in stripped, (
        "apiConfig.ts must no longer use the obsolete 'script-recovery-1' "
        "host as an active check — that substring caused the false "
        "'Correct: NO / WRONG URL!' popup on Build 1110-QA against the "
        "live https://scriptmate-8.emergent.host backend."
    )


def test_startup_diagnostic_accepts_legitimate_emergent_hosts() -> None:
    """apiConfig.ts must recognise `*.emergent.host` and
    `*.preview.emergentagent.com` as legitimate backend hosts."""
    src = _read("services/apiConfig.ts")
    assert "'.emergent.host'" in src, (
        "apiConfig.ts must whitelist the '.emergent.host' host suffix "
        "so the startup diagnostic passes for the live ScriptMate "
        "production backend."
    )
    assert "'.preview.emergentagent.com'" in src, (
        "apiConfig.ts must whitelist the '.preview.emergentagent.com' "
        "host suffix so the startup diagnostic passes for Emergent "
        "preview environments."
    )


def test_startup_diagnostic_still_flags_genuinely_wrong_urls() -> None:
    """The QA diagnostic must remain useful — it must still catch empty
    URLs and the retired android-upload-test host."""
    src = _read("services/apiConfig.ts")
    assert "FATAL: API_BASE_URL is empty or undefined" in src, (
        "The empty-URL check must remain intact."
    )
    assert "android-upload-test" in src, (
        "The android-upload-test warning must remain intact so a "
        "regression to the retired host is still flagged."
    )
    # And there must still be a not-legitimate warning path.
    assert re.search(
        r"WARNING:\s*API_BASE_URL\s+is not a recognised Emergent backend host",
        src,
    ), (
        "apiConfig.ts must still emit a WARNING when the URL is not a "
        "recognised legitimate Emergent backend host — the diagnostic's "
        "purpose must be preserved, not silently disabled."
    )


def test_getApiDiagnostics_isCorrectDomain_uses_legitimate_url_helper() -> None:
    """The exported diagnostic must use the new legitimate-host helper
    (not the obsolete substring check)."""
    src = _read("services/apiConfig.ts")
    # getApiDiagnostics' isCorrectDomain must call isLegitimateBackendUrl.
    m = re.search(
        r"isCorrectDomain:\s*isLegitimateBackendUrl\(API_BASE_URL\)",
        src,
    )
    assert m, (
        "getApiDiagnostics().isCorrectDomain must be computed via "
        "isLegitimateBackendUrl(API_BASE_URL) so the startup popup at "
        "app/_layout.tsx no longer shows 'Correct: NO / WRONG URL!' for "
        "the live scriptmate-8.emergent.host backend."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Pure-logic sanity checks — replicate the helper's rule in Python and
# confirm the runtime backend URL passes.
# ─────────────────────────────────────────────────────────────────────────────

def _is_legitimate(url: str) -> bool:
    """Mirror of isLegitimateBackendUrl for offline test coverage."""
    from urllib.parse import urlparse
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    return host.endswith(".emergent.host") or host.endswith(
        ".preview.emergentagent.com"
    )


def test_live_scriptmate_backend_url_passes_diagnostic() -> None:
    """https://scriptmate-8.emergent.host must pass the new check."""
    assert _is_legitimate("https://scriptmate-8.emergent.host") is True


def test_preview_backend_url_still_passes_diagnostic() -> None:
    """Emergent preview hosts must still pass."""
    assert _is_legitimate(
        "https://save-script-verify.preview.emergentagent.com"
    ) is True
    assert _is_legitimate(
        "https://script-recovery-1.preview.emergentagent.com"
    ) is True


def test_wrong_urls_still_fail_diagnostic() -> None:
    """Genuinely wrong URLs must still be flagged."""
    assert _is_legitimate("") is False
    assert _is_legitimate("https://example.com") is False
    assert _is_legitimate("https://android-upload-test.example.net") is False
    # Bare host without protocol → parses with hostname=None → fails.
    assert _is_legitimate("scriptmate-8.emergent.host") is False


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
