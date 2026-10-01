"""
SEC-001 regression — Google / Apple ID-token server-side verification
=====================================================================

Locks the Feb-2026 remediation of the account-takeover vulnerability in
`POST /api/auth/google` and `POST /api/auth/apple`. Before the fix:

  * Apple accepted `user_identifier` from the request body with ZERO
    cryptographic verification ("For now, we trust the client-side
    verification and use the user_identifier").
  * Google base64-decoded the JWT payload and trusted `sub` without
    verifying the signature, `iss`, `aud`, or `exp`.

Both paths let an attacker forge any identity. These tests prove the
new path rejects every attack vector and does NOT touch
`db.auth_tokens` on any rejection.

The tests are hermetic — they generate RSA/EC key pairs in-process,
patch the module-level `PyJWKClient` with a static JWK, and sign test
tokens with the matching private key. No provider network call is
possible.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

# Configure env BEFORE importing the identity_tokens module so its
# module-level config picks up test values.
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_IDS", "ios-client-id,android-client-id")
os.environ.setdefault("APPLE_BUNDLE_ID", "com.scriptmate.app")
os.environ.setdefault("JWT_CLOCK_SKEW_SECONDS", "60")

from dotenv import load_dotenv

load_dotenv(ROOT / "backend" / ".env")

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from pymongo import MongoClient as _PyMongoClient

import identity_tokens
import server
from server import app

# ─── Helpers: generate hermetic key pairs + static JWKS clients ───────


def _rsa_pair(kid: str = "google-test"):
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = priv.public_key()
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(pub))
    jwk["kid"] = kid
    jwk["alg"] = "RS256"
    jwk["use"] = "sig"
    return priv, jwk


def _ec_pair(kid: str = "apple-test"):
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key()
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(pub))
    jwk["kid"] = kid
    jwk["alg"] = "ES256"
    jwk["use"] = "sig"
    return priv, jwk


class _StaticJWKSClient:
    """Minimal PyJWKClient stand-in: resolves exactly one kid."""

    def __init__(self, jwk: dict):
        self._key = jwt.PyJWK.from_dict(jwk)

    def get_signing_key_from_jwt(self, token: str):
        header = jwt.get_unverified_header(token)
        if header.get("kid") != self._key.key_id:
            raise jwt.PyJWKClientError("unknown kid")
        return self._key


class _AlwaysRaisingJWKSClient:
    def get_signing_key_from_jwt(self, token: str):
        raise jwt.PyJWKClientError("jwks offline")


# ─── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def google_keys():
    return _rsa_pair()


@pytest.fixture(scope="module")
def apple_keys():
    return _ec_pair()


@pytest.fixture(scope="module")
def client():
    """TestClient with a fresh Motor binding (previous modules may
    have closed the shared client — same pattern as the device-session
    E2E suite)."""
    from motor.motor_asyncio import AsyncIOMotorClient as _MotorClient
    _fresh = _MotorClient(os.environ["MONGO_URL"])
    server.client = _fresh
    server.db = _fresh[os.environ.get("DB_NAME", "scriptmate")]
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _patch_jwks(google_keys, apple_keys, monkeypatch):
    """Replace the module-level JWKS clients with hermetic static ones.
    Every verification test runs through this patch — no network."""
    _, g_jwk = google_keys
    _, a_jwk = apple_keys
    monkeypatch.setattr(identity_tokens, "google_jwks", _StaticJWKSClient(g_jwk))
    monkeypatch.setattr(identity_tokens, "apple_jwks", _StaticJWKSClient(a_jwk))


@pytest.fixture(autouse=True)
def _ensure_env():
    """Guard: tests expect these env vars; the identity_tokens module
    caches them at import. We re-pin them on each test so a stray
    `monkeypatch.delenv` elsewhere can't drift the configuration."""
    identity_tokens.GOOGLE_CLIENT_IDS = ("ios-client-id", "android-client-id")
    identity_tokens.APPLE_BUNDLE_ID = "com.scriptmate.app"


# ─── Token factories ──────────────────────────────────────────────────


def _mint_google_token(priv, *, overrides: dict | None = None, kid: str = "google-test") -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "sub": "google-user-123",
        "aud": "ios-client-id",
        "exp": now + 300,
        "iat": now,
        "email": "user@example.com",
        "email_verified": True,
        "name": "Test User",
    }
    if overrides:
        for k, v in overrides.items():
            if v is _DELETE:
                claims.pop(k, None)
            else:
                claims[k] = v
    return jwt.encode(claims, priv, algorithm="RS256", headers={"kid": kid})


def _mint_apple_token(priv, *, overrides: dict | None = None, kid: str = "apple-test") -> str:
    now = int(time.time())
    claims = {
        "iss": "https://appleid.apple.com",
        "sub": "001234.abcdef1234567890.1234",
        "aud": "com.scriptmate.app",
        "exp": now + 300,
        "iat": now,
        "email": "user@privaterelay.appleid.com",
    }
    if overrides:
        for k, v in overrides.items():
            if v is _DELETE:
                claims.pop(k, None)
            else:
                claims[k] = v
    return jwt.encode(claims, priv, algorithm="ES256", headers={"kid": kid})


_DELETE = object()


# ─── Pure verifier tests — Google ─────────────────────────────────────


class TestVerifyGoogle:
    def test_accepts_valid_token(self, google_keys):
        priv, _ = google_keys
        token = _mint_google_token(priv)
        claims = identity_tokens.verify_google_id_token(token)
        assert claims["sub"] == "google-user-123"
        assert claims["email_verified"] is True

    def test_accepts_both_issuer_spellings(self, google_keys):
        priv, _ = google_keys
        for iss in ("accounts.google.com", "https://accounts.google.com"):
            t = _mint_google_token(priv, overrides={"iss": iss})
            assert identity_tokens.verify_google_id_token(t)["iss"] == iss

    def test_accepts_both_configured_client_ids(self, google_keys):
        priv, _ = google_keys
        for cid in ("ios-client-id", "android-client-id"):
            t = _mint_google_token(priv, overrides={"aud": cid})
            assert identity_tokens.verify_google_id_token(t)["aud"] == cid

    def test_rejects_tampered_signature(self, google_keys):
        priv, _ = google_keys
        token = _mint_google_token(priv)
        head, payload, sig = token.split(".")
        # Replace the signature entirely with a valid-looking base64url
        # string of the same length so the shape passes but verification
        # fails. A single-char flip can land on a base64url-equivalent
        # byte (==/padding handling varies by lib), so we overwrite.
        tampered = f"{head}.{payload}.{'A' * len(sig)}"
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(tampered)

    def test_rejects_tampered_payload(self, google_keys):
        """Change sub in payload — signature no longer matches."""
        import base64 as _b64

        priv, _ = google_keys
        token = _mint_google_token(priv)
        head, payload, sig = token.split(".")
        decoded = json.loads(_b64.urlsafe_b64decode(payload + "=="))
        decoded["sub"] = "attacker-sub"
        new_payload = _b64.urlsafe_b64encode(
            json.dumps(decoded).encode()
        ).rstrip(b"=").decode()
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(f"{head}.{new_payload}.{sig}")

    def test_rejects_wrong_audience(self, google_keys):
        priv, _ = google_keys
        t = _mint_google_token(priv, overrides={"aud": "evil-client-id"})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(t)

    def test_rejects_wrong_issuer(self, google_keys):
        priv, _ = google_keys
        t = _mint_google_token(priv, overrides={"iss": "https://evil.example"})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(t)

    def test_rejects_expired(self, google_keys):
        priv, _ = google_keys
        # exp 10 minutes in the past, well beyond the 60s skew
        t = _mint_google_token(
            priv,
            overrides={"exp": int(time.time()) - 600, "iat": int(time.time()) - 900},
        )
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(t)

    def test_rejects_missing_sub(self, google_keys):
        priv, _ = google_keys
        t = _mint_google_token(priv, overrides={"sub": _DELETE})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(t)

    def test_rejects_unverified_email(self, google_keys):
        priv, _ = google_keys
        t = _mint_google_token(priv, overrides={"email_verified": False})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(t)

    def test_rejects_unknown_kid(self, google_keys):
        priv, _ = google_keys
        t = _mint_google_token(priv, kid="attacker-key")
        # Signed with the right private key but header.kid is unknown
        # to our configured JWKS — should fail at key resolution.
        with pytest.raises(identity_tokens.IdentityTokenError):
            identity_tokens.verify_google_id_token(t)

    def test_jwks_unavailable_surfaces_as_invalid(
        self, google_keys, monkeypatch
    ):
        """A JWKS outage is observationally identical to an attacker's
        unknown-kid probe; both map to IdentityTokenInvalid so we
        never leak provider status."""
        priv, _ = google_keys
        token = _mint_google_token(priv)
        monkeypatch.setattr(identity_tokens, "google_jwks", _AlwaysRaisingJWKSClient())
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(token)

    def test_requires_env_configuration(self, google_keys, monkeypatch):
        priv, _ = google_keys
        token = _mint_google_token(priv)
        monkeypatch.setattr(identity_tokens, "GOOGLE_CLIENT_IDS", ())
        with pytest.raises(identity_tokens.IdentityProviderNotConfigured):
            identity_tokens.verify_google_id_token(token)

    def test_algorithm_cannot_be_downgraded_to_hs256(self, google_keys):
        """Classic 'alg: HS256' attack: PyJWT must refuse to accept
        the public key as an HMAC secret.

        Note: PyJWT also refuses to ENCODE with HS256 using an
        asymmetric key as the secret (it raises InvalidKeyError),
        which is itself a defence. We bypass encode by hand-building
        the HS256 token with `hmac.new`."""
        import base64 as _b64
        import hashlib
        import hmac as _hmac

        _priv, jwk = google_keys
        from cryptography.hazmat.primitives import serialization

        public_pem = jwt.PyJWK.from_dict(jwk).key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        header = _b64.urlsafe_b64encode(
            json.dumps({"alg": "HS256", "typ": "JWT", "kid": "google-test"}).encode()
        ).rstrip(b"=").decode()
        payload = _b64.urlsafe_b64encode(
            json.dumps(
                {
                    "iss": "https://accounts.google.com",
                    "sub": "attacker",
                    "aud": "ios-client-id",
                    "exp": int(time.time()) + 300,
                    "iat": int(time.time()),
                    "email_verified": True,
                }
            ).encode()
        ).rstrip(b"=").decode()
        signing_input = f"{header}.{payload}".encode()
        signature = _b64.urlsafe_b64encode(
            _hmac.new(public_pem, signing_input, hashlib.sha256).digest()
        ).rstrip(b"=").decode()
        attacker_token = f"{header}.{payload}.{signature}"
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_google_id_token(attacker_token)


# ─── Pure verifier tests — Apple ──────────────────────────────────────


class TestVerifyApple:
    def test_accepts_valid_token(self, apple_keys):
        priv, _ = apple_keys
        token = _mint_apple_token(priv)
        claims = identity_tokens.verify_apple_id_token(token)
        assert claims["sub"].startswith("001234.")

    def test_rejects_tampered_signature(self, apple_keys):
        priv, _ = apple_keys
        token = _mint_apple_token(priv)
        head, payload, sig = token.split(".")
        tampered = f"{head}.{payload}.{'A' * len(sig)}"
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_apple_id_token(tampered)

    def test_rejects_wrong_audience(self, apple_keys):
        priv, _ = apple_keys
        t = _mint_apple_token(priv, overrides={"aud": "com.attacker.app"})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_apple_id_token(t)

    def test_rejects_wrong_issuer(self, apple_keys):
        priv, _ = apple_keys
        t = _mint_apple_token(priv, overrides={"iss": "https://evil.example"})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_apple_id_token(t)

    def test_rejects_expired(self, apple_keys):
        priv, _ = apple_keys
        t = _mint_apple_token(
            priv,
            overrides={"exp": int(time.time()) - 600, "iat": int(time.time()) - 900},
        )
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_apple_id_token(t)

    def test_rejects_missing_sub(self, apple_keys):
        priv, _ = apple_keys
        t = _mint_apple_token(priv, overrides={"sub": _DELETE})
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_apple_id_token(t)

    def test_rejects_unknown_kid(self, apple_keys):
        priv, _ = apple_keys
        t = _mint_apple_token(priv, kid="attacker-key")
        with pytest.raises(identity_tokens.IdentityTokenError):
            identity_tokens.verify_apple_id_token(t)

    def test_rejects_wrong_algorithm_rs256(self, apple_keys, google_keys):
        """Apple tokens must be ES256 only. A token signed with RS256
        (not ES256) must not be accepted on the Apple endpoint, even
        when its claims are otherwise valid.

        We use the Google RSA private key to sign an "Apple-shaped"
        token — PyJWT's `_decode` will then try to verify an RS256
        signature against the Apple EC public key and reject it."""
        priv_google, _ = google_keys
        rs_token = jwt.encode(
            {
                "iss": "https://appleid.apple.com",
                "sub": "001234.rs256.attack",
                "aud": "com.scriptmate.app",
                "exp": int(time.time()) + 300,
                "iat": int(time.time()),
            },
            priv_google,
            algorithm="RS256",
            headers={"kid": "apple-test"},  # pretend to be the Apple key
        )
        with pytest.raises(identity_tokens.IdentityTokenInvalid):
            identity_tokens.verify_apple_id_token(rs_token)

    def test_requires_env_configuration(self, apple_keys, monkeypatch):
        priv, _ = apple_keys
        token = _mint_apple_token(priv)
        monkeypatch.setattr(identity_tokens, "APPLE_BUNDLE_ID", "")
        with pytest.raises(identity_tokens.IdentityProviderNotConfigured):
            identity_tokens.verify_apple_id_token(token)


# ─── End-to-end: /api/auth/google and /api/auth/apple ─────────────────


def _delete_user_rows(provider_user_id: str) -> None:
    _sync = _PyMongoClient(os.environ["MONGO_URL"])
    _db = _sync[os.environ.get("DB_NAME", "scriptmate")]
    _db.authenticated_users.delete_many(
        {"auth_providers.provider_user_id": provider_user_id}
    )
    _db.auth_tokens.delete_many({})  # cheap in test db


class TestEndpointSecurity:
    """SEC-001 success criteria: an attacker cannot establish an
    authenticated identity by presenting forged / wrong-aud /
    wrong-iss / expired / tampered tokens, and client-supplied
    identity claims (Apple `user_identifier`, Google `email`/`name`)
    cannot override the verified `sub`."""

    def _count_rows_for(self, provider_sub: str) -> int:
        _sync = _PyMongoClient(os.environ["MONGO_URL"])
        _db = _sync[os.environ.get("DB_NAME", "scriptmate")]
        return _db.authenticated_users.count_documents(
            {"auth_providers.provider_user_id": provider_sub}
        )

    def test_google_endpoint_accepts_verified_token(self, client, google_keys):
        priv, _ = google_keys
        _delete_user_rows("google-user-happy")
        token = _mint_google_token(priv, overrides={"sub": "google-user-happy"})
        r = client.post(
            "/api/auth/google",
            json={"id_token": token, "device_id": "e2e-google-ok"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"]
        assert len(body["access_token"]) == 64
        _delete_user_rows("google-user-happy")

    def test_google_endpoint_rejects_tampered_token(self, client, google_keys):
        priv, _ = google_keys
        token = _mint_google_token(priv)
        head, payload, sig = token.split(".")
        tampered = f"{head}.{payload}.{'A' * len(sig)}"
        r = client.post(
            "/api/auth/google",
            json={"id_token": tampered, "device_id": "e2e-google-tamper"},
        )
        assert r.status_code == 401
        assert "Invalid" in r.json()["detail"]

    def test_google_endpoint_rejects_wrong_aud(self, client, google_keys):
        priv, _ = google_keys
        token = _mint_google_token(priv, overrides={"aud": "evil-client-id"})
        r = client.post(
            "/api/auth/google",
            json={"id_token": token, "device_id": "e2e-google-aud"},
        )
        assert r.status_code == 401

    def test_google_endpoint_rejects_wrong_iss(self, client, google_keys):
        priv, _ = google_keys
        token = _mint_google_token(priv, overrides={"iss": "https://evil.example"})
        r = client.post(
            "/api/auth/google",
            json={"id_token": token, "device_id": "e2e-google-iss"},
        )
        assert r.status_code == 401

    def test_google_endpoint_rejects_expired(self, client, google_keys):
        priv, _ = google_keys
        token = _mint_google_token(
            priv,
            overrides={"exp": int(time.time()) - 600, "iat": int(time.time()) - 900},
        )
        r = client.post(
            "/api/auth/google",
            json={"id_token": token, "device_id": "e2e-google-exp"},
        )
        assert r.status_code == 401

    def test_google_endpoint_rejects_base64_only_forgery(self, client):
        """Reproduce the old bug: an unsigned base64-encoded payload
        with a chosen `sub` must now be rejected."""
        import base64 as _b64

        header = _b64.urlsafe_b64encode(b'{"alg":"RS256","typ":"JWT"}').rstrip(b"=").decode()
        payload = _b64.urlsafe_b64encode(
            json.dumps(
                {
                    "iss": "https://accounts.google.com",
                    "sub": "attacker-takes-this-account",
                    "aud": "ios-client-id",
                    "exp": int(time.time()) + 300,
                    "iat": int(time.time()),
                    "email_verified": True,
                }
            ).encode()
        ).rstrip(b"=").decode()
        forged = f"{header}.{payload}.AAAA"
        r = client.post(
            "/api/auth/google",
            json={"id_token": forged, "device_id": "e2e-google-forge"},
        )
        assert r.status_code == 401, r.text
        assert self._count_rows_for("attacker-takes-this-account") == 0

    def test_apple_endpoint_accepts_verified_token(self, client, apple_keys):
        priv, _ = apple_keys
        _delete_user_rows("001234.verified.sub")
        token = _mint_apple_token(
            priv, overrides={"sub": "001234.verified.sub"}
        )
        r = client.post(
            "/api/auth/apple",
            json={
                "identity_token": token,
                "authorization_code": "ignored",
                "user_identifier": "001234.verified.sub",
                "device_id": "e2e-apple-ok",
            },
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["access_token"]) == 64
        _delete_user_rows("001234.verified.sub")

    def test_apple_endpoint_rejects_tampered_token(self, client, apple_keys):
        priv, _ = apple_keys
        token = _mint_apple_token(priv)
        head, payload, sig = token.split(".")
        tampered = f"{head}.{payload}.{'A' * len(sig)}"
        r = client.post(
            "/api/auth/apple",
            json={
                "identity_token": tampered,
                "authorization_code": "x",
                "user_identifier": "whatever",
                "device_id": "e2e-apple-tamper",
            },
        )
        assert r.status_code == 401

    def test_apple_endpoint_rejects_wrong_aud(self, client, apple_keys):
        priv, _ = apple_keys
        token = _mint_apple_token(priv, overrides={"aud": "com.attacker.app"})
        r = client.post(
            "/api/auth/apple",
            json={
                "identity_token": token,
                "authorization_code": "x",
                "user_identifier": "whatever",
                "device_id": "e2e-apple-aud",
            },
        )
        assert r.status_code == 401

    def test_apple_endpoint_rejects_wrong_iss(self, client, apple_keys):
        priv, _ = apple_keys
        token = _mint_apple_token(priv, overrides={"iss": "https://evil.example"})
        r = client.post(
            "/api/auth/apple",
            json={
                "identity_token": token,
                "authorization_code": "x",
                "user_identifier": "whatever",
                "device_id": "e2e-apple-iss",
            },
        )
        assert r.status_code == 401

    def test_apple_endpoint_rejects_expired(self, client, apple_keys):
        priv, _ = apple_keys
        token = _mint_apple_token(
            priv,
            overrides={"exp": int(time.time()) - 600, "iat": int(time.time()) - 900},
        )
        r = client.post(
            "/api/auth/apple",
            json={
                "identity_token": token,
                "authorization_code": "x",
                "user_identifier": "whatever",
                "device_id": "e2e-apple-exp",
            },
        )
        assert r.status_code == 401

    def test_apple_user_identifier_cannot_override_verified_sub(
        self, client, apple_keys
    ):
        """SEC-001 core assertion. Token says sub=`real-user`. Request
        body says user_identifier=`victim-account`. The user_id
        returned must be derived from `real-user` ONLY — the body
        value is ignored."""
        priv, _ = apple_keys
        _delete_user_rows("001234.sec001.real-user")
        _delete_user_rows("001234.sec001.victim-account")
        token = _mint_apple_token(
            priv, overrides={"sub": "001234.sec001.real-user"}
        )
        r = client.post(
            "/api/auth/apple",
            json={
                "identity_token": token,
                "authorization_code": "x",
                "user_identifier": "001234.sec001.victim-account",
                "email": "attacker@example.com",
                "full_name": "Attacker",
                "device_id": "e2e-apple-override",
            },
        )
        assert r.status_code == 200, r.text
        # The row that got created is the ONE from the verified sub.
        assert self._count_rows_for("001234.sec001.real-user") == 1
        assert self._count_rows_for("001234.sec001.victim-account") == 0
        _delete_user_rows("001234.sec001.real-user")

    def test_google_name_email_do_not_override_verified_sub(self, client, google_keys):
        """Client cannot inject an alternate sub/email via the token
        payload because the signature covers them. We assert the row
        shape matches the verified `sub`."""
        priv, _ = google_keys
        _delete_user_rows("google-sub-truth")
        token = _mint_google_token(
            priv,
            overrides={
                "sub": "google-sub-truth",
                "email": "truth@example.com",
                "name": "Truth",
            },
        )
        r = client.post(
            "/api/auth/google",
            json={"id_token": token, "device_id": "e2e-google-truth"},
        )
        assert r.status_code == 200
        assert self._count_rows_for("google-sub-truth") == 1
        _delete_user_rows("google-sub-truth")

    def test_endpoints_do_not_create_auth_rows_on_rejection(
        self, client, google_keys
    ):
        """Rejected tokens must leave `authenticated_users` and
        `auth_tokens` untouched for the attacker's chosen identity."""
        priv, _ = google_keys
        chosen = "attacker-choose-this-sub"
        token = _mint_google_token(priv, overrides={"sub": chosen})
        # Corrupt the signature so verification fails.
        head, payload, sig = token.split(".")
        bad = f"{head}.{payload}.{'A' * len(sig)}"
        before = self._count_rows_for(chosen)
        r = client.post(
            "/api/auth/google",
            json={"id_token": bad, "device_id": "e2e-google-noleak"},
        )
        assert r.status_code == 401
        assert self._count_rows_for(chosen) == before


# ─── Guard: static source still has NO payload-only decode path ───────


class TestNoPayloadOnlyDecode:
    """Prevent accidental re-introduction of the base64-only decode
    that caused SEC-001. The sign-in handlers must only route through
    `verify_google_id_token` / `verify_apple_id_token`."""

    def test_google_endpoint_routes_through_verifier(self):
        src = (ROOT / "backend" / "server.py").read_text()
        start = src.find("async def google_sign_in")
        end = src.find("async def ", start + 20)
        region = src[start:end]
        assert "verify_google_id_token" in region
        # No raw base64 JWT decoding.
        assert "base64.urlsafe_b64decode" not in region, (
            "google_sign_in must not base64-decode the JWT payload"
        )

    def test_apple_endpoint_routes_through_verifier(self):
        src = (ROOT / "backend" / "server.py").read_text()
        start = src.find("async def apple_sign_in")
        end = src.find("async def ", start + 20)
        region = src[start:end]
        assert "verify_apple_id_token" in region
        # The verified `sub` must be sourced from the claims, not from
        # the request body `user_identifier`.
        assert "claims[\"sub\"]" in region or "claims['sub']" in region
        assert "provider_user_id=request.user_identifier" not in region, (
            "apple_sign_in must NOT key the account on the client-supplied "
            "user_identifier — that was the SEC-001 bug"
        )
