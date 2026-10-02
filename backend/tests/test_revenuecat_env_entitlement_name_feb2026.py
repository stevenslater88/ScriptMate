"""Regression lock — backend .env entitlement identifier must equal
`ScriptMate Pro`.

Context (2026-02 overnight investigation of the Samsung S23 Ultra
"Restore Purchases → No Purchases Found" blocker):

* The entitlement identifier was renamed in code from `ScriptM8 Pro`
  → `ScriptMate Pro` across all runtime files (frontend
  `services/revenuecat.ts`, backend `revenuecat_client.py` default,
  all referencing hooks and stores).
* `backend/revenuecat_client.py::fetch_premium_entitlement` reads the
  identifier from `os.environ["REVENUECAT_PREMIUM_ENTITLEMENT_ID"]`
  FIRST and only falls back to the `ScriptMate Pro` code default
  when the env var is unset.
* `backend/.env` was *not* updated during the earlier rename and
  still carried the override `REVENUECAT_PREMIUM_ENTITLEMENT_ID=
  ScriptM8 Pro`. Any Premium subscriber hitting
  `/api/users/{device_id}/revenuecat/sync` therefore produced
  `is_premium: False` even when RevenueCat correctly reported the
  active `ScriptMate Pro` entitlement — because the backend was
  looking up a key RC never emits.
* Symptom: the backend row stayed `subscription_tier=free` after a
  successful SDK-side restore, re-locking Performance / Loop
  rehearsal modes behind 403s. The pre-existing frontend fallback in
  `scriptStore::fetchUserLimits` (`checkPremiumAccess()`) partly
  masked the UX, but the backend was still refusing writes.

Fix: `backend/.env::REVENUECAT_PREMIUM_ENTITLEMENT_ID=ScriptMate Pro`.

This test locks the fix. If the env drifts again, this suite fails
loudly in CI before an APK can ship with the mismatched config.
"""

from __future__ import annotations

from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
CLIENT_FILE = Path(__file__).resolve().parents[1] / "revenuecat_client.py"
EXPECTED = "ScriptMate Pro"
FORBIDDEN = "ScriptM8 Pro"


def _env_pairs() -> dict[str, str]:
    pairs: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        pairs[k.strip()] = v.strip()
    return pairs


def test_backend_env_entitlement_matches_dashboard_identifier() -> None:
    """If `REVENUECAT_PREMIUM_ENTITLEMENT_ID` is set in backend/.env,
    it MUST equal the dashboard identifier `ScriptMate Pro`.

    Any other value is treated as a hard regression — this is the
    exact bug that locked legitimate Premium users out of
    Performance / Loop modes in Feb 2026.
    """
    pairs = _env_pairs()
    if "REVENUECAT_PREMIUM_ENTITLEMENT_ID" not in pairs:
        # Unset is fine — the code default `ScriptMate Pro` applies.
        return
    actual = pairs["REVENUECAT_PREMIUM_ENTITLEMENT_ID"]
    assert actual == EXPECTED, (
        f"backend/.env::REVENUECAT_PREMIUM_ENTITLEMENT_ID is {actual!r};"
        f" the RevenueCat dashboard entitlement is {EXPECTED!r}. Any"
        " other value makes /revenuecat/sync look up a key RC never"
        " emits, so legitimate Premium subscribers silently stay"
        " 'free' in the backend after a successful SDK restore."
    )


def test_backend_env_does_not_carry_stale_script_m8_name() -> None:
    """Belt-and-braces: `ScriptM8 Pro` must not appear as a value for
    this env key under any circumstance."""
    pairs = _env_pairs()
    for key, value in pairs.items():
        if key == "REVENUECAT_PREMIUM_ENTITLEMENT_ID":
            assert value != FORBIDDEN, (
                "backend/.env still carries the pre-rename "
                f"{FORBIDDEN!r} entitlement name. The dashboard was "
                f"migrated to {EXPECTED!r} in Feb 2026."
            )


def test_revenuecat_client_default_still_scriptmate_pro() -> None:
    """The code-side default must also stay `ScriptMate Pro` so the
    system is correct even when the .env override is removed."""
    src = CLIENT_FILE.read_text(encoding="utf-8")
    assert f'DEFAULT_ENTITLEMENT_ID = "{EXPECTED}"' in src, (
        f"revenuecat_client.py::DEFAULT_ENTITLEMENT_ID must equal "
        f"{EXPECTED!r}."
    )
    # The forbidden name must only appear in commentary, never in
    # runtime defaults.
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith('*'):
            continue
        assert FORBIDDEN not in line, (
            f"revenuecat_client.py has a runtime reference to "
            f"{FORBIDDEN!r}: {line}"
        )


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v", "-s"])
