"""Thin server-side RevenueCat REST client — SEC-003 (Feb 2026).

Purpose
-------
Provide a *single* function the subscription routes can call to confirm,
server-side, that a given `app_user_id` holds an active Premium
entitlement in RevenueCat. The client-supplied `subscription_tier`
flow (pre-SEC-003) is replaced by this authoritative check.

Design notes
------------
* V1 REST endpoint: `GET https://api.revenuecat.com/v1/subscribers/{id}`
  authenticated with the server-only `REVENUECAT_SECRET_KEY` (never the
  public SDK key). This is read-only; no customer data is mutated here.
* Returns a `RevenueCatEntitlement` with `active` + `expires_at`. An
  entitlement is treated as active when RevenueCat reports it under
  `subscriber.entitlements[<id>]` AND either `expires_date` is null
  (lifetime) or `expires_date` > now (UTC).
* Network / 5xx errors raise `RevenueCatUnavailable` so the caller can
  translate to HTTP 503 (do NOT silently grant Premium).
* 404 (subscriber not found in RC) is a *known* "not entitled" response,
  not an infra error — returns inactive.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

REVENUECAT_API_BASE = "https://api.revenuecat.com/v1"
# Match the entitlement identifier configured in the RevenueCat dashboard
# (same literal used by the frontend — frontend/services/revenuecat.ts).
# Dashboard identifier (verified Feb 2026): "ScriptMate Pro".
DEFAULT_ENTITLEMENT_ID = "ScriptMate Pro"


class RevenueCatUnavailable(RuntimeError):
    """RevenueCat REST API could not be reached or returned 5xx. The
    caller MUST translate this to a 503 and MUST NOT grant Premium."""


class RevenueCatNotConfigured(RuntimeError):
    """REVENUECAT_SECRET_KEY is missing. In production this is a hard
    error (fail-closed). Dev/test paths may stub this client instead."""


@dataclass(frozen=True)
class RevenueCatEntitlement:
    active: bool
    expires_at: Optional[datetime]  # UTC-aware; None for lifetime


def _parse_expires_date(raw: Optional[str]) -> Optional[datetime]:
    """RevenueCat returns `expires_date` as ISO-8601 with trailing 'Z'
    (e.g. `2026-03-15T10:00:00Z`). `None` means a lifetime entitlement.
    """
    if raw is None:
        return None
    # Normalise 'Z' → '+00:00' so fromisoformat accepts it on 3.10.
    normalised = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalised)
    except ValueError:
        logger.warning("revenuecat: unparseable expires_date=%r", raw)
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def fetch_premium_entitlement(
    app_user_id: str,
    *,
    entitlement_id: Optional[str] = None,
    secret_key: Optional[str] = None,
    timeout: float = 8.0,
) -> RevenueCatEntitlement:
    """Return the current Premium entitlement state for `app_user_id`.

    * `active=True` iff RC reports the entitlement AND it has not expired.
    * Raises `RevenueCatUnavailable` on timeout / 5xx / network error.
    * Raises `RevenueCatNotConfigured` if the server secret is missing.
    """
    if not app_user_id:
        return RevenueCatEntitlement(active=False, expires_at=None)

    entitlement_id = entitlement_id or os.environ.get(
        "REVENUECAT_PREMIUM_ENTITLEMENT_ID",
        DEFAULT_ENTITLEMENT_ID,
    )
    secret_key = secret_key or os.environ.get("REVENUECAT_SECRET_KEY", "")
    if not secret_key:
        raise RevenueCatNotConfigured(
            "REVENUECAT_SECRET_KEY is not set — refusing to grant Premium",
        )

    url = f"{REVENUECAT_API_BASE}/subscribers/{app_user_id}"
    headers = {
        "Authorization": f"Bearer {secret_key}",
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("revenuecat: network error for %s: %s", app_user_id, exc)
        raise RevenueCatUnavailable(str(exc)) from exc

    if resp.status_code == 404:
        # Subscriber unknown to RC → never purchased.
        return RevenueCatEntitlement(active=False, expires_at=None)
    if resp.status_code >= 500:
        logger.warning(
            "revenuecat: upstream %s for %s: %s",
            resp.status_code, app_user_id, resp.text[:200],
        )
        raise RevenueCatUnavailable(f"RC {resp.status_code}")
    if resp.status_code != 200:
        # 4xx other than 404 → treat as not entitled, but log loudly.
        logger.warning(
            "revenuecat: unexpected %s for %s: %s",
            resp.status_code, app_user_id, resp.text[:200],
        )
        return RevenueCatEntitlement(active=False, expires_at=None)

    try:
        body = resp.json()
    except ValueError as exc:
        raise RevenueCatUnavailable("RC returned non-JSON body") from exc

    entitlements = (
        (body.get("subscriber") or {}).get("entitlements") or {}
    )
    entry = entitlements.get(entitlement_id)
    if not entry:
        return RevenueCatEntitlement(active=False, expires_at=None)

    expires_at = _parse_expires_date(entry.get("expires_date"))
    now = datetime.now(timezone.utc)
    active = expires_at is None or expires_at > now
    return RevenueCatEntitlement(active=active, expires_at=expires_at)
