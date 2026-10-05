"""2026-02 SCRIPT M8 — Device B "Missing bearer token" repro test.

A second physical Android device (Device B, cold auth cache) tapped
Premium and the UI surfaced the string "Missing bearer token", because
three axios calls in `frontend/store/scriptStore.ts` were hitting
SEC-002-protected backend endpoints without attaching the standard
`getAuthHeader()`:

    * `fetchUserLimits`  → GET  /api/users/{deviceId}/limits
    * `startTrial`       → POST /api/users/{deviceId}/start-trial
    * `subscribe`        → POST /api/users/{deviceId}/subscribe

Every other axios call in the same file already uses `getAuthHeader()`;
these three were overlooked.

This test parses `scriptStore.ts` statically and asserts, for each of
the three functions, that the axios call targeting the matching URL
also attaches `headers: await getAuthHeader()`. A pure-static check is
appropriate here because:

  1. The frontend has no Jest/vitest infrastructure, and introducing
     one would be an unrelated scope change the user explicitly
     forbade.
  2. The failure mode is a *literal missing option field* in an axios
     config object, which text matching catches deterministically.
  3. We also assert the inverse — that no other `/api/users/{...}`
     axios call in the whole frontend is left header-less — so future
     regressions anywhere in `app/`, `services/`, `store/`, `hooks/`
     are caught.

If any assertion in this file fails, "Missing bearer token" will come
back on cold-cache devices.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

FRONTEND_ROOT = Path("/app/frontend")
SCRIPT_STORE = FRONTEND_ROOT / "store" / "scriptStore.ts"


# ─── helpers ──────────────────────────────────────────────────────────────

def _extract_function_body(source: str, fn_name: str) -> str:
    """Return the balanced-brace body of `fn_name: ... => { ... }`.

    scriptStore defines Zustand actions as arrow functions:

        fetchUserLimits: async () => {
          ...
        },

    This helper finds that body by brace counting so the test can
    match patterns scoped to the function (and not accidentally match
    a sibling function in the same file).
    """
    # Find the opening of the function body.
    # We allow any parameter list, `async`, and whitespace.
    marker = re.search(
        rf"\b{re.escape(fn_name)}\s*:\s*async\s*\([^)]*\)\s*=>\s*\{{",
        source,
    )
    assert marker, f"Could not locate function '{fn_name}' in scriptStore.ts"
    start = marker.end() - 1  # position of the opening '{'
    depth = 0
    for idx in range(start, len(source)):
        ch = source[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[start : idx + 1]
    raise AssertionError(f"Unbalanced braces while scanning '{fn_name}'")


def _axios_call_block(body: str, url_fragment: str) -> str:
    """Return the balanced-paren text of the axios.*(…) call that
    contains the given URL fragment, scoped to the function body."""
    url_idx = body.find(url_fragment)
    assert url_idx != -1, (
        f"URL fragment {url_fragment!r} not found in function body — "
        f"has the endpoint been renamed?"
    )
    # Walk backwards from url_idx to the nearest 'axios.' call opener.
    axios_match = None
    for m in re.finditer(r"axios\.(get|post|put|patch|delete)\s*\(", body):
        if m.end() <= url_idx:
            axios_match = m
        else:
            break
    assert axios_match, (
        f"No axios.<verb>(...) call found before URL fragment {url_fragment!r}"
    )
    # Balanced-paren scan from the opening '(' of the axios call.
    open_paren = axios_match.end() - 1
    depth = 0
    for idx in range(open_paren, len(body)):
        ch = body[idx]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return body[axios_match.start() : idx + 1]
    raise AssertionError("Unbalanced parens in axios call scan")


# ─── fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def script_store_source() -> str:
    assert SCRIPT_STORE.exists(), f"Missing file: {SCRIPT_STORE}"
    return SCRIPT_STORE.read_text(encoding="utf-8")


# ─── per-function tests ───────────────────────────────────────────────────

@pytest.mark.parametrize(
    "fn_name,url_fragment,http_verb",
    [
        # GET /api/users/{deviceId}/limits
        ("fetchUserLimits", "/api/users/${deviceId}/limits", "get"),
        # POST /api/users/{deviceId}/start-trial
        ("startTrial", "/api/users/${deviceId}/start-trial", "post"),
        # POST /api/users/{deviceId}/subscribe
        ("subscribe", "/api/users/${deviceId}/subscribe", "post"),
    ],
)
def test_premium_axios_call_attaches_auth_header(
    script_store_source: str,
    fn_name: str,
    url_fragment: str,
    http_verb: str,
) -> None:
    """Each of the three Premium-screen axios calls must attach
    `headers: await getAuthHeader()`.

    This is the exact bug behind the Device B "Missing bearer token"
    repro. If this assertion fails, the 401 regression is back.
    """
    body = _extract_function_body(script_store_source, fn_name)
    call = _axios_call_block(body, url_fragment)

    # 1. The call must use the expected HTTP verb (defence against a
    #    future refactor that silently flips GET↔POST).
    assert f"axios.{http_verb}(" in call, (
        f"{fn_name} expected to use axios.{http_verb}, got: {call[:80]}…"
    )

    # 2. The call MUST pass `headers: await getAuthHeader()` in its
    #    options object. Whitespace is tolerated; the exact helper
    #    name is enforced so a drive-by rename doesn't silently drop
    #    the X-RC-App-User-Id header too.
    assert re.search(r"headers\s*:\s*await\s+getAuthHeader\s*\(\s*\)", call), (
        f"{fn_name} axios call is MISSING `headers: await getAuthHeader()`.\n"
        f"This reintroduces the 'Missing bearer token' 401 on Device B.\n"
        f"Call body was:\n{call}"
    )


# ─── file-wide sweep ──────────────────────────────────────────────────────

# Protected endpoints under /api/users/{...}. `/api/users` (POST,
# create-or-get-user) is intentionally public (anonymous bootstrap)
# so it's excluded. Add new protected paths here as they land.
PROTECTED_USER_PATH_FRAGMENTS = [
    "/api/users/${deviceId}/limits",
    "/api/users/${deviceId}/start-trial",
    "/api/users/${deviceId}/subscribe",
    "/api/users/${deviceId}/revenuecat/sync",
]


def test_no_protected_user_axios_call_is_header_less() -> None:
    """Full-tree sweep: no axios call to a protected /api/users/{...}
    path anywhere under /app/frontend may omit `getAuthHeader()`.

    Catches regressions outside scriptStore.ts (e.g. a new hook or
    screen component adding a quick axios call and forgetting auth).
    """
    offenders: list[tuple[str, str, str]] = []
    for ts_file in [
        *FRONTEND_ROOT.rglob("*.ts"),
        *FRONTEND_ROOT.rglob("*.tsx"),
    ]:
        # Skip vendor/build dirs.
        parts = set(ts_file.parts)
        if parts & {"node_modules", ".expo", "android", "ios", "dist"}:
            continue
        text = ts_file.read_text(encoding="utf-8", errors="ignore")
        if "/api/users/" not in text:
            continue
        for frag in PROTECTED_USER_PATH_FRAGMENTS:
            idx = 0
            while True:
                idx = text.find(frag, idx)
                if idx == -1:
                    break
                # Walk backwards to the nearest axios.<verb>( opener.
                prefix = text[:idx]
                axios_opener = None
                for m in re.finditer(
                    r"axios\.(get|post|put|patch|delete)\s*\(",
                    prefix,
                ):
                    axios_opener = m
                if axios_opener is None:
                    idx += len(frag)
                    continue
                # Balanced-paren scan forward from the opener.
                open_paren = axios_opener.end() - 1
                depth = 0
                end = None
                for j in range(open_paren, len(text)):
                    if text[j] == "(":
                        depth += 1
                    elif text[j] == ")":
                        depth -= 1
                        if depth == 0:
                            end = j + 1
                            break
                if end is None:
                    idx += len(frag)
                    continue
                call = text[axios_opener.start() : end]
                if not re.search(
                    r"headers\s*:\s*await\s+getAuthHeader\s*\(\s*\)",
                    call,
                ):
                    offenders.append((str(ts_file), frag, call[:160]))
                idx = end

    assert not offenders, (
        "Protected /api/users/{...} axios call(s) missing getAuthHeader():\n"
        + "\n".join(
            f"  - {path}  URL={frag}\n    call: {snippet}…"
            for path, frag, snippet in offenders
        )
    )


# ─── backend contract pin (sanity check) ──────────────────────────────────

def test_backend_still_requires_auth_on_these_endpoints() -> None:
    """Pin the backend contract: if someone later removes the
    `Depends(get_authenticated_user_id)` from any of these three
    endpoints, the frontend's bearer attachment becomes dead code,
    but more importantly SEC-002 regresses. Flag it loudly here.
    """
    server = Path("/app/backend/server.py").read_text(encoding="utf-8")
    for endpoint in (
        '@api_router.get("/users/{device_id}/limits")',
        '@api_router.post("/users/{device_id}/subscribe")',
        '@api_router.post("/users/{device_id}/start-trial")',
    ):
        idx = server.find(endpoint)
        assert idx != -1, f"Endpoint missing: {endpoint}"
        # Next ~800 chars should include the auth dependency.
        slice_ = server[idx : idx + 1200]
        assert "Depends(get_authenticated_user_id)" in slice_, (
            f"SEC-002 regression: {endpoint} no longer requires auth. "
            f"Scope: {slice_[:300]}"
        )
