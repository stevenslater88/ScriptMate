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
    targets the given URL fragment, scoped to the function body.

    Supports BOTH shapes:
      a) Inline URL inside axios: `axios.post(`${API_BASE_URL}/api/.../x`, …)`
      b) Extracted endpoint var:  `const endpoint = `/api/.../x`;
                                   ...
                                   axios.post(`${API_BASE_URL}${endpoint}`, …)`

    (b) was introduced by the 2026-02 SCRIPT M8 DebugLog
    instrumentation of `startTrial` and `subscribe`, so both the URL
    literal AND `${endpoint}` must be considered equivalent targets.
    """
    url_idx = body.find(url_fragment)
    assert url_idx != -1, (
        f"URL fragment {url_fragment!r} not found in function body — "
        f"has the endpoint been renamed?"
    )
    # If the URL appears inside an axios call, the axios opener is
    # BEFORE url_idx. If the URL was extracted to `const endpoint =
    # \`...\`` and axios uses `${endpoint}`, the axios opener is
    # AFTER url_idx. Try both.
    all_axios = list(re.finditer(
        r"axios\.(get|post|put|patch|delete)\s*\(", body,
    ))
    assert all_axios, (
        f"No axios.<verb>(...) call anywhere in function containing "
        f"URL fragment {url_fragment!r}"
    )

    # First, the inline shape (axios opener before url_idx).
    inline_match = None
    for m in all_axios:
        if m.end() <= url_idx:
            inline_match = m
        else:
            break

    # Second, the extracted-endpoint shape (axios opener after
    # url_idx, in a function body that also references `${endpoint}`).
    extracted_match = None
    uses_endpoint_var = "${endpoint}" in body and "const endpoint" in body
    if uses_endpoint_var:
        for m in all_axios:
            if m.start() > url_idx:
                extracted_match = m
                break

    axios_match = inline_match or extracted_match
    assert axios_match, (
        f"No axios.<verb>(...) call found referencing URL fragment "
        f"{url_fragment!r} (inline nor via extracted `endpoint` var)"
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

    2026-02 SCRIPT M8: understands both call shapes —
      (a) Inline URL inside axios call (original shape).
      (b) `const endpoint = `<url>`; axios.post(`${API_BASE_URL}${endpoint}`, …)`
          (new shape used by the DebugLog-instrumented startTrial and
          subscribe actions).
    """
    offenders: list[tuple[str, str, str]] = []

    def _axios_block_from_opener(text: str, opener: re.Match) -> str | None:
        """Return the balanced-paren text of the axios call starting
        at `opener`, or None if parens never balance."""
        depth = 0
        for j in range(opener.end() - 1, len(text)):
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    return text[opener.start() : j + 1]
        return None

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
                # Shape (a): axios opener immediately before URL.
                prefix = text[:idx]
                inline_opener = None
                for m in re.finditer(
                    r"axios\.(get|post|put|patch|delete)\s*\(",
                    prefix,
                ):
                    inline_opener = m
                inline_call = (
                    _axios_block_from_opener(text, inline_opener)
                    if inline_opener is not None
                    else None
                )
                # Only accept as shape (a) if the URL fragment is
                # inside the axios call text (otherwise it's a leak
                # from an unrelated earlier axios call in the file).
                if inline_call and frag in inline_call:
                    if not re.search(
                        r"headers\s*:\s*await\s+getAuthHeader\s*\(\s*\)",
                        inline_call,
                    ):
                        offenders.append((str(ts_file), frag, inline_call[:160]))
                    idx += len(frag)
                    continue

                # Shape (b): URL is in a `const endpoint = …` or
                # similar assignment; the axios call AFTER the URL
                # references `${endpoint}` or `${url}` and lives
                # within the same ~800 chars of code (same function).
                nearby = text[idx : idx + 1200]
                if "${endpoint}" in nearby or "${url}" in nearby or "${path}" in nearby:
                    next_axios = re.search(
                        r"axios\.(get|post|put|patch|delete)\s*\(",
                        nearby,
                    )
                    if next_axios:
                        # Reconstruct absolute position for balanced-
                        # paren scan.
                        abs_opener_start = idx + next_axios.start()
                        abs_opener = re.match(
                            r"axios\.(get|post|put|patch|delete)\s*\(",
                            text[abs_opener_start:],
                        )
                        # Build a shim Match-like object with .start()
                        # and .end() for the helper.
                        class _Shim:
                            def __init__(self, s: int, e: int) -> None:
                                self._s, self._e = s, e

                            def start(self) -> int:
                                return self._s

                            def end(self) -> int:
                                return self._e

                        shim = _Shim(abs_opener_start, abs_opener_start + abs_opener.end())
                        axios_call = _axios_block_from_opener(text, shim)  # type: ignore[arg-type]
                        if axios_call and not re.search(
                            r"headers\s*:\s*await\s+getAuthHeader\s*\(\s*\)",
                            axios_call,
                        ):
                            offenders.append((str(ts_file), frag, axios_call[:160]))
                        idx += len(frag)
                        continue

                # Neither shape matched — the URL appears in text
                # that doesn't correspond to an axios call (e.g. a
                # comment or type literal). Skip.
                idx += len(frag)

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
