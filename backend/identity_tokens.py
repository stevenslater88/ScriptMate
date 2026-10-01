"""
SEC-001 remediation — server-side Google / Apple ID-token verification.

This module replaces the previous payload-only decoding path with full
cryptographic verification against each provider's JWKS. It is the
ONLY code path that may convert an ID token into a provider identity.

Security contract (what callers can rely on):

  * The returned claims come from a token whose signature was verified
    against a public key fetched from the provider's live JWKS endpoint
    (short-lived in-memory cache).
  * `iss`, `aud`, `exp` are validated by PyJWT; algorithm is HARD-CODED
    per provider (RS256 for Google, ES256 for Apple) — the token header
    `alg` field is NEVER consulted.
  * `sub` is non-empty.
  * For Google, `email_verified` is True.
  * `aud` is restricted to a server-configured allowlist (comma-
    separated for Google — supports separate iOS/Android client IDs).

Nothing in this module touches `db.auth_tokens` or any application
session. The caller mints the SEC-004 bearer AFTER verification
succeeds. SEC-004 remains unchanged.

Environment variables (names only — values live in secrets):

    GOOGLE_OAUTH_CLIENT_IDS   comma-separated allowlist (ios,android,web)
    APPLE_BUNDLE_ID           Apple `aud` for this client
    JWT_CLOCK_SKEW_SECONDS    optional, default 60
    JWKS_CACHE_SECONDS        optional, default 300

In test mode (any env where GOOGLE_OAUTH_CLIENT_IDS / APPLE_BUNDLE_ID
are absent) the module stays importable with placeholder audiences;
real sign-in requests return 503 because the production configuration
is missing. Tests that exercise verification monkeypatch the JWKS
clients and set the env BEFORE import — see
`backend/tests/test_sec001_identity_token_verification.py`.
"""

from __future__ import annotations

import hmac
import logging
import os
from typing import Any

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError, PyJWTError

logger = logging.getLogger(__name__)

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
GOOGLE_ISSUERS: tuple[str, ...] = (
    "accounts.google.com",
    "https://accounts.google.com",
)
APPLE_ISSUER = "https://appleid.apple.com"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _csv_env(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name, "")
    return tuple(x.strip() for x in raw.split(",") if x.strip())


# Load once at import. Callers should NOT monkey with these at runtime
# except in tests.
GOOGLE_CLIENT_IDS: tuple[str, ...] = _csv_env("GOOGLE_OAUTH_CLIENT_IDS")
APPLE_BUNDLE_ID: str = os.environ.get("APPLE_BUNDLE_ID", "").strip()
LEEWAY_SECONDS: int = _int_env("JWT_CLOCK_SKEW_SECONDS", 60)
JWKS_LIFESPAN_SECONDS: int = _int_env("JWKS_CACHE_SECONDS", 300)


class IdentityTokenError(Exception):
    """Base error — safe to surface as 401 to the client."""


class IdentityTokenUnavailable(IdentityTokenError):
    """JWKS fetch / provider-reachability failure. Treat as transient."""


class IdentityTokenInvalid(IdentityTokenError):
    """Signature, issuer, audience, expiry, claim, or nonce rejection."""


class IdentityProviderNotConfigured(IdentityTokenError):
    """Server env lacks the client-id / bundle-id allowlist."""


# Module-level JWKS clients. Short-lived cache, no persistent HTTP
# session. Each uvicorn worker owns its own cache.
google_jwks: PyJWKClient = PyJWKClient(
    GOOGLE_JWKS_URL,
    cache_jwk_set=True,
    lifespan=JWKS_LIFESPAN_SECONDS,
    cache_keys=True,
    max_cached_keys=16,
    timeout=5,
)
apple_jwks: PyJWKClient = PyJWKClient(
    APPLE_JWKS_URL,
    cache_jwk_set=True,
    lifespan=JWKS_LIFESPAN_SECONDS,
    cache_keys=True,
    max_cached_keys=16,
    timeout=5,
)


def _decode_with_jwks(
    token: str,
    *,
    jwks: PyJWKClient,
    algorithms: list[str],
    audience: str | tuple[str, ...],
    issuer: str | tuple[str, ...],
    required: list[str],
) -> dict[str, Any]:
    """Perform the raw PyJWT verification. Raises IdentityToken* errors
    on every failure path. Never returns on a non-verified token.
    """
    try:
        key = jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=algorithms,  # fixed — never from the header
            audience=audience,
            issuer=issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": required},
        )
        return claims
    except PyJWKClientError as exc:
        # Key-resolution failure (unknown `kid`, JWKS fetch 4xx/5xx,
        # network error — PyJWT merges all three into this one type).
        # Map ALL of them to IdentityTokenInvalid rather than leaking
        # provider availability to an attacker probing with crafted
        # `kid` values. A real provider outage is observationally
        # identical to a kid-not-found and both must return 401.
        logger.warning(
            "identity key resolution failed: %s", type(exc).__name__
        )
        raise IdentityTokenInvalid("identity key not resolvable") from exc
    except PyJWTError as exc:
        logger.warning("identity token rejected: %s", type(exc).__name__)
        raise IdentityTokenInvalid("invalid identity token") from exc
    except (TypeError, ValueError) as exc:
        logger.warning("identity token malformed: %s", type(exc).__name__)
        raise IdentityTokenInvalid("malformed identity token") from exc


def _check_nonce(claims: dict[str, Any], expected_nonce: str | None) -> None:
    if expected_nonce is None:
        return
    supplied = claims.get("nonce")
    if not isinstance(supplied, str) or not hmac.compare_digest(
        supplied, expected_nonce
    ):
        raise IdentityTokenInvalid("nonce mismatch or missing")


def verify_google_id_token(
    id_token: str, *, expected_nonce: str | None = None
) -> dict[str, Any]:
    """Verify a Google OIDC ID token. Returns the trusted claim set.

    Raises:
      IdentityProviderNotConfigured — server env lacks client ID allowlist.
      IdentityTokenUnavailable — JWKS fetch failed (transient).
      IdentityTokenInvalid — tampered sig / wrong aud / wrong iss /
                             expired / missing sub / unverified email /
                             nonce mismatch.
    """
    if not GOOGLE_CLIENT_IDS:
        raise IdentityProviderNotConfigured(
            "GOOGLE_OAUTH_CLIENT_IDS env var is not set"
        )

    claims = _decode_with_jwks(
        id_token,
        jwks=google_jwks,
        algorithms=["RS256"],
        audience=GOOGLE_CLIENT_IDS,
        issuer=GOOGLE_ISSUERS,
        required=["iss", "sub", "aud", "exp", "iat", "email_verified"],
    )
    # Defense in depth: PyJWT already validated `aud` against the
    # allowlist, but we re-assert the exact-string match here so a
    # future refactor can't silently widen the audience.
    aud = claims.get("aud")
    if not isinstance(aud, str) or aud not in GOOGLE_CLIENT_IDS:
        raise IdentityTokenInvalid("unapproved Google audience")
    if claims.get("email_verified") is not True:
        raise IdentityTokenInvalid("Google email is not verified")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise IdentityTokenInvalid("missing Google subject")
    _check_nonce(claims, expected_nonce)
    return claims


def verify_apple_id_token(
    identity_token: str, *, expected_nonce: str | None = None
) -> dict[str, Any]:
    """Verify an Apple Sign In ID token. Returns the trusted claim set.

    The Apple `user_identifier` from the request body is NOT consulted.
    The stable identity is `claims["sub"]`.

    Raises the same exception taxonomy as `verify_google_id_token`.
    """
    if not APPLE_BUNDLE_ID:
        raise IdentityProviderNotConfigured(
            "APPLE_BUNDLE_ID env var is not set"
        )

    claims = _decode_with_jwks(
        identity_token,
        jwks=apple_jwks,
        algorithms=["ES256"],
        audience=APPLE_BUNDLE_ID,
        issuer=APPLE_ISSUER,
        required=["iss", "sub", "aud", "exp", "iat"],
    )
    if claims.get("aud") != APPLE_BUNDLE_ID:
        raise IdentityTokenInvalid("unapproved Apple audience")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise IdentityTokenInvalid("missing Apple subject")
    _check_nonce(claims, expected_nonce)
    return claims
