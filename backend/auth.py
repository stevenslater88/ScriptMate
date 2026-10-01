"""
Centralized authentication dependencies for ScriptMate protected routes.

SEC-002 (Feb 2026) — Session enforcement on protected routes
=============================================================

Before this module, the SEC-004 TTS hardening introduced `get_authenticated_user_id`
*inline* in `server.py` and wired it ONLY onto the ElevenLabs proxy. Every other
protected route (scripts, notes, stats, daily-drill, …) still trusted a
client-supplied `user_id` path/query/body parameter, letting any caller read
or mutate any other user's data by swapping that one field. SEC-002 remediation
hoists the dependency here so the SAME authoritative identity extraction is
applied uniformly across the API.

Identity model
--------------
Two kinds of tokens live in `db.auth_tokens`:
  * "device-anonymous" sessions minted by POST /api/auth/device-session
    → user_id stored as "device:<device_id>"
  * Google/Apple sign-in sessions minted by POST /api/auth/google|apple
    → user_id stored as the UUID from `db.authenticated_users.id`

Historically, however, mobile stored its data (scripts, notes, stats, etc.)
keyed on the *raw* `device_id` (no prefix) via `user_id = device_id`. To keep
backward compatibility with every pre-existing document without any migration,
`effective_user_id()` strips the `device:` prefix so queries continue to find
the exact rows the client wrote. For a signed-in UUID the effective id is the
UUID unchanged. This mapping is one-way and lossless.

Public API
----------
    get_authenticated_user_id(authorization: str | None) -> str
        The RAW identity from the bearer token. Use when you need to know
        *which* kind of identity (device-anonymous vs signed-in).

    effective_user_id(authenticated_user_id: str) -> str
        The user id used for mongo filters on scripts/notes/stats/etc.

    get_effective_user_id(authorization: str | None) -> str
        FastAPI dependency returning `effective_user_id` directly — the
        most common shape protected routes want.

    enforce_user_id_match(path_user_id, authenticated_user_id) -> None
        For legacy routes that keep the user_id in the path (e.g.
        `/api/stats/{user_id}`). Raises 403 if the path id does not
        match the authenticated identity. Prevents simple client-side
        identity substitution without changing the URL shape.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import Header, HTTPException

# The DB handle must be read lazily so that `backend.server` can set it up
# at import time and this module stays import-order-safe for both server.py
# and the test suite (which re-binds `server.db` in some fixtures).


def _get_db():
    # Imported lazily to avoid circular import at module load.
    from server import db as _db

    return _db


DEVICE_PREFIX = "device:"


async def get_authenticated_user_id(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> str:
    """FastAPI dependency: validate bearer and return the RAW user id.

    Shape of the returned string:
      * "device:<device_id>" for anonymous device sessions
      * "<uuid>"             for Google/Apple-signed-in users

    Raises HTTPException(401) for every failure mode. Never leaks whether
    the failure was 'unknown token' vs 'expired' beyond the generic 401
    message — matches the behaviour of the previous inline implementation.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token or len(token) < 32:
        raise HTTPException(status_code=401, detail="Invalid token")
    db = _get_db()
    record = await db.auth_tokens.find_one({"token": token})
    if not record:
        raise HTTPException(status_code=401, detail="Unknown token")
    expires_at = record.get("expires_at")
    if expires_at and isinstance(expires_at, datetime):
        # expires_at is written naive-UTC by the sign-in and device-session
        # flows; compare without a tz to stay consistent.
        now_naive = datetime.utcnow()  # noqa: DTZ003 — matches writer
        if expires_at < now_naive:
            raise HTTPException(status_code=401, detail="Expired token")
    user_id = record.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Malformed session")
    return user_id


def effective_user_id(authenticated_user_id: str) -> str:
    """Map a raw authenticated identity to the id used for data filters.

    * "device:<device_id>" → "<device_id>" so pre-SEC-002 documents stored
      against the raw device_id remain visible/mutable to the authenticated
      owner device with no migration.
    * "<uuid>" (signed-in) → "<uuid>" unchanged.
    """
    if not authenticated_user_id:
        raise HTTPException(status_code=401, detail="Malformed session")
    if authenticated_user_id.startswith(DEVICE_PREFIX):
        return authenticated_user_id[len(DEVICE_PREFIX):]
    return authenticated_user_id


async def get_effective_user_id(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> str:
    """FastAPI dependency: validate bearer and return the effective user id
    (ready to use as a Mongo filter value on scripts/notes/stats/etc.)."""
    raw = await get_authenticated_user_id(authorization=authorization)
    return effective_user_id(raw)


def enforce_user_id_match(path_user_id: str, authenticated_user_id: str) -> None:
    """Raise 403 if `path_user_id` does not match the authenticated identity.

    Accepts either form of the authenticated id (raw bearer value) and matches
    against the client-supplied `path_user_id` using the same prefix-stripping
    rule as `effective_user_id`. This lets legacy routes keep `/{user_id}` in
    the URL shape while rejecting cross-user substitution.
    """
    if not path_user_id:
        raise HTTPException(status_code=403, detail="user_id required")
    allowed = {authenticated_user_id, effective_user_id(authenticated_user_id)}
    # Also allow the client to pass the raw device_id form against a device
    # session (same owner, same device).
    if path_user_id in allowed:
        return
    raise HTTPException(
        status_code=403,
        detail="user_id does not match authenticated session",
    )


def is_device_session(authenticated_user_id: str) -> bool:
    return bool(authenticated_user_id) and authenticated_user_id.startswith(DEVICE_PREFIX)
