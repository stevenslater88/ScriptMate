"""
Shared pytest fixtures and monkey-patches for the ScriptMate backend suite.

SEC-002 (2026-02) — Test suite compatibility
=============================================

The SEC-002 remediation gates every protected API route behind a bearer
token issued by POST /api/auth/device-session. Dozens of pre-existing
tests predate that gate and still hit protected routes without an
Authorization header. Rather than touch 30+ files, this conftest:

  * Mints a canonical device-session token at session-start.
  * Patches the module-level `requests.get/post/put/delete/patch/request`
    functions so that any request whose URL points at the ScriptMate
    API host receives the bearer header automatically.
  * Patches `httpx.Client.request` so FastAPI TestClient-based tests
    also get the header.

Opting out — a test that must verify unauth behaviour can either
clear the headers inline:

    r = requests.post(f"{API}/scripts", json={...}, headers={"Authorization": ""})

or use the `unauthenticated_requests` fixture, which temporarily
restores the un-patched versions for the duration of the test.

This file is 100% test-only. It is NEVER imported by production code.
"""

from __future__ import annotations

import logging as _conftest_logging
import os
import uuid
from pathlib import Path
from urllib.parse import urlparse

import pytest
import requests

_conftest_log = _conftest_logging.getLogger("scriptmate.tests.conftest")

# ─── Load env so MONGO_URL / BACKEND_URL are available to tests ───────
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except (ImportError, OSError) as _env_err:
    _conftest_log.debug("conftest: dotenv load skipped: %s", _env_err)


# The suite hits two possible hosts: the live preview URL (integration
# tests using `requests`) and the in-process TestClient (unit tests).
# Only auto-attach the shared bearer to real-network callers; TestClient-
# based tests explicitly manage their own `Authorization` headers (the
# SEC-004 TTS suite in particular needs to prove anonymous requests
# receive 401, which would be defeated by auto-authentication).
_API_HOSTS = {
    "127.0.0.1",
    "localhost",
}
_PREVIEW_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://save-script-verify.preview.emergentagent.com",
).rstrip("/")
# Several older test files default to a stale `REACT_APP_BACKEND_URL`
# hostname (preview URLs are rotated across jobs). Normalise both
# names to the current preview URL so SEC-002 regression work isn't
# obscured by a pre-existing env-var mismatch. This is test-only.
if _PREVIEW_URL:
    os.environ.setdefault("REACT_APP_BACKEND_URL", _PREVIEW_URL)
    os.environ.setdefault("EXPO_PUBLIC_BACKEND_URL", _PREVIEW_URL)
if _PREVIEW_URL:
    try:
        parsed = urlparse(_PREVIEW_URL)
        if parsed.hostname:
            _API_HOSTS.add(parsed.hostname)
    except ValueError as _parse_err:
        _conftest_log.debug("conftest: preview URL parse failed: %s", _parse_err)


_DEVICE_ID = f"sec002-test-{uuid.uuid4().hex[:12]}"
_BEARER_TOKEN: str | None = None


def _mint_bearer_via_requests() -> str | None:
    """Mint a device-session token via the live preview URL. Returns None
    if the preview URL is unreachable (unit tests that only use
    TestClient will mint through the TestClient path instead).

    Uses the ORIGINAL `Session.request` so this never recurses into the
    patched wrapper that calls `_ensure_bearer()` itself (requests.post
    internally dispatches through Session.request which IS wrapped)."""
    if not _PREVIEW_URL:
        return None
    try:
        session = requests.sessions.Session()
        try:
            r = _ORIG_SESSION_REQUEST(
                session,
                "POST",
                f"{_PREVIEW_URL}/api/auth/device-session",
                json={"device_id": _DEVICE_ID},
                timeout=10,
            )
            if r.status_code == 200:
                return r.json().get("token")
        finally:
            session.close()
    except requests.RequestException as _err:
        _conftest_log.debug("conftest: live-URL mint unreachable: %s", _err)
        return None
    return None


def _mint_bearer_via_testclient() -> str | None:
    """Mint a device-session token via the in-process FastAPI app so
    TestClient-only test modules don't require network access."""
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from fastapi.testclient import TestClient

        from server import app

        with TestClient(app) as c:
            r = c.post(
                "/api/auth/device-session",
                json={"device_id": _DEVICE_ID},
            )
        if r.status_code == 200:
            return r.json().get("token")
    except (ImportError, RuntimeError, ValueError) as _err:
        _conftest_log.debug("conftest: TestClient mint failed: %s", _err)
        return None
    return None


def _ensure_bearer() -> str | None:
    global _BEARER_TOKEN
    if _BEARER_TOKEN:
        return _BEARER_TOKEN
    _BEARER_TOKEN = _mint_bearer_via_requests() or _mint_bearer_via_testclient()
    return _BEARER_TOKEN


def _rewrite_user_scoped_url(url: str) -> str:
    """Legacy tests pre-SEC-002 embed arbitrary strings in the
    `{user_id}` path segment of /api/daily-drill/{user_id},
    /api/stats/{user_id}, /api/streak/{user_id}. The server now
    403s when that segment does not match the authenticated bearer.

    To keep those tests meaningful (they verify handler behaviour,
    not identity enforcement — the SEC-002 regression suite tests
    identity enforcement directly), rewrite the user_id segment to
    the canonical conftest device_id when a bearer is being attached.

    This rewrite happens ONLY for the three /{user_id} families
    that the SEC-002 ticket gates. Any URL without one of those
    prefixes is returned unchanged."""
    if not url:
        return url
    import re as _re
    pattern = _re.compile(
        r"(?P<prefix>/api/(?:"
        r"daily-drill|stats|streak|dialect/history|acting-coach/history|"
        r"sync/pull|tapes/user|voice-studio/takes|auth/user"
        r")/)"
        r"(?P<user>[^/?#]+)"
    )
    # Also rewrite the /api/users/{device_id}/... family (preserve the suffix).
    # Must NOT rewrite /api/users/me — that's a literal route, not a user_id slot.
    users_pattern = _re.compile(
        r"(?P<prefix>/api/users/)"
        r"(?!me(?:[/?#]|$))"
        r"(?P<user>[^/?#]+)"
        r"(?P<suffix>/(?:limits|stats|subscribe|start-trial|cancel-subscription)(?:[/?#].*)?|$|[/?#].*)"
    )

    def _users_sub(m: _re.Match[str]) -> str:
        return f"{m.group('prefix')}{_DEVICE_ID}{m.group('suffix')}"

    url = users_pattern.sub(_users_sub, url)

    def _sub(m: _re.Match[str]) -> str:
        return f"{m.group('prefix')}{_DEVICE_ID}"

    return pattern.sub(_sub, url)


def _should_attach_header(url: str | None) -> bool:
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return False
    return host in _API_HOSTS


def _merge_auth_header(kwargs: dict, token: str) -> dict:
    """Return a copy of kwargs with the Authorization header injected,
    unless the caller has already set one (even an empty one, which is
    the opt-out signal)."""
    headers = dict(kwargs.get("headers") or {})
    # Normalise key casing so an explicit `Authorization: ""` always wins.
    lower = {k.lower(): k for k in headers}
    if "authorization" in lower:
        return kwargs
    headers["Authorization"] = f"Bearer {token}"
    new = dict(kwargs)
    new["headers"] = headers
    return new


# ─── requests.* patch ─────────────────────────────────────────────────

_ORIG_REQUESTS_REQUEST = requests.request
_ORIG_REQUESTS_GET = requests.get
_ORIG_REQUESTS_POST = requests.post
_ORIG_REQUESTS_PUT = requests.put
_ORIG_REQUESTS_DELETE = requests.delete
_ORIG_REQUESTS_PATCH = requests.patch
_ORIG_SESSION_REQUEST = requests.sessions.Session.request


def _wrap_requests_method(method_name: str, orig):
    def wrapped(url, *args, **kwargs):
        if _should_attach_header(url):
            token = _ensure_bearer()
            if token:
                url = _rewrite_user_scoped_url(url)
                kwargs = _merge_auth_header(kwargs, token)
        return orig(url, *args, **kwargs)

    wrapped.__name__ = f"wrapped_{method_name}"
    return wrapped


def _wrap_requests_request():
    orig = _ORIG_REQUESTS_REQUEST

    def wrapped(method, url, **kwargs):
        if _should_attach_header(url):
            token = _ensure_bearer()
            if token:
                url = _rewrite_user_scoped_url(url)
                kwargs = _merge_auth_header(kwargs, token)
        return orig(method, url, **kwargs)

    return wrapped


# ─── httpx (FastAPI TestClient) patch ─────────────────────────────────

try:
    import httpx

    _ORIG_HTTPX_CLIENT_REQUEST = httpx.Client.request

    def _wrapped_httpx_client_request(self, method, url, **kwargs):
        # httpx may receive URL as str or httpx.URL
        url_str = str(url) if url is not None else ""
        if _should_attach_header(url_str):
            token = _ensure_bearer()
            if token:
                url = _rewrite_user_scoped_url(url_str)
                kwargs = _merge_auth_header(kwargs, token)
        return _ORIG_HTTPX_CLIENT_REQUEST(self, method, url, **kwargs)

except ImportError:  # pragma: no cover — httpx should always be present
    _ORIG_HTTPX_CLIENT_REQUEST = None


def pytest_configure(config):
    # Apply the global wrappers once at session start so every test
    # module (including those that import `requests` at the top of
    # their file) picks up the auth-attaching behaviour.
    requests.get = _wrap_requests_method("get", _ORIG_REQUESTS_GET)
    requests.post = _wrap_requests_method("post", _ORIG_REQUESTS_POST)
    requests.put = _wrap_requests_method("put", _ORIG_REQUESTS_PUT)
    requests.delete = _wrap_requests_method("delete", _ORIG_REQUESTS_DELETE)
    requests.patch = _wrap_requests_method("patch", _ORIG_REQUESTS_PATCH)
    requests.request = _wrap_requests_request()

    # Session.request is the dispatch point for Session.get/post/put/delete
    # (they call `self.request(...)` under the hood), so wrapping it once
    # auth-enables every requests.Session() instance.
    def _wrapped_session_request(self, method, url, **kwargs):
        if _should_attach_header(url):
            token = _ensure_bearer()
            if token:
                url = _rewrite_user_scoped_url(url)
                kwargs = _merge_auth_header(kwargs, token)
        return _ORIG_SESSION_REQUEST(self, method, url, **kwargs)

    requests.sessions.Session.request = _wrapped_session_request

    if _ORIG_HTTPX_CLIENT_REQUEST is not None:
        import httpx

        httpx.Client.request = _wrapped_httpx_client_request


@pytest.fixture
def unauthenticated_requests():
    """Temporarily restore the un-patched `requests.*` entry points for a
    single test that must verify unauth (401) behaviour explicitly."""
    saved = {
        "request": requests.request,
        "get": requests.get,
        "post": requests.post,
        "put": requests.put,
        "delete": requests.delete,
        "patch": requests.patch,
    }
    saved_session_request = requests.sessions.Session.request
    requests.request = _ORIG_REQUESTS_REQUEST
    requests.get = _ORIG_REQUESTS_GET
    requests.post = _ORIG_REQUESTS_POST
    requests.put = _ORIG_REQUESTS_PUT
    requests.delete = _ORIG_REQUESTS_DELETE
    requests.patch = _ORIG_REQUESTS_PATCH
    requests.sessions.Session.request = _ORIG_SESSION_REQUEST
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(requests, k, v)
        requests.sessions.Session.request = saved_session_request


@pytest.fixture
def sec002_bearer_token():
    """Expose the shared test bearer token to any test that wants to
    construct its own Authorization header explicitly (e.g. to test
    cross-user access by minting a SECOND token)."""
    return _ensure_bearer()


@pytest.fixture
def sec002_device_id():
    """The canonical device_id the shared bearer is bound to."""
    return _DEVICE_ID
