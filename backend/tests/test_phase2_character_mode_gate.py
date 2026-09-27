"""Regression test for the Phase 2 physical Samsung failure:

  "Error — 'character' mode requires Premium.
   Upgrade to unlock all training modes!"

Root cause (see fork job 2026-02, Phase 2 blocker):
  * frontend/app/script/[id].tsx exposed a MODE_OPTIONS entry
        { id: 'character', name: 'Character', premium: false, ... }
  * FREE_TIER_LIMITS.available_modes  = ['full_read', 'cue_only']
    PREMIUM_TIER_LIMITS.available_modes = ['full_read', 'cue_only',
                                           'performance', 'missing_words',
                                           'first_letter', 'loop']
  * 'character' was not registered on the backend — for ANY tier — so the
    endpoint responded with the misleading 403 "requires Premium" message
    even though the mode was intended to look free in the UI.
  * The engine had no 'character'-specific code path either — its stated
    behaviour ("focus on your character lines only") is what 'full_read'
    already does when the reader plays every non-user character.

Fix: removed the orphan MODE_OPTIONS entry from script/[id].tsx.
No backend changes. Premium monetisation preserved (performance + loop
remain premium-only).

This suite locks:
  1. Free tier can create a 'full_read' rehearsal (baseline Phase 1 journey).
  2. Free tier can create a 'cue_only' rehearsal (second free-tier mode).
  3. 'character' mode is no longer offered by the frontend UI (static grep).
  4. Genuinely premium-only modes ('performance', 'loop') remain 403 for
     the free tier — no accidental monetisation regression.
  5. Backend still rejects 'character' if a stale client somehow sends it
     (defence in depth — the mode is not a valid rehearsal mode at all).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Dict

import pytest
import requests


BACKEND_URL = os.environ.get(
    "TEST_BACKEND_URL",
    "http://localhost:8001",
).rstrip("/")

SCRIPTS_URL = f"{BACKEND_URL}/api/scripts"
REHEARSALS_URL = f"{BACKEND_URL}/api/rehearsals"

RAW_TEXT = (
    "JACK\nHello.\n\n"
    "MARA\nHi Jack. How are you?\n\n"
    "JACK\nI'm alright. You?\n\n"
    "MARA\nFine. Let's begin.\n"
)


def _new_device() -> str:
    return f"phase2-char-mode-{uuid.uuid4()}"


def _qa_premium_active() -> bool:
    """Return True if the running backend has QA_PREMIUM=true (bypass enabled).

    When the bypass is on, ALL users are reported as premium, so tests that
    assert "free-tier gets 403" become inapplicable and are skipped.
    """
    try:
        probe = f"phase2-probe-{uuid.uuid4()}"
        requests.post(f"{BACKEND_URL}/api/users", json={"device_id": probe}, timeout=10)
        r = requests.get(f"{BACKEND_URL}/api/users/{probe}/limits", timeout=10)
        return bool(r.ok and r.json().get("qa_premium_bypass") is True)
    except Exception:
        return False


def _create_script(device: str) -> str:
    resp = requests.post(
        SCRIPTS_URL,
        json={"title": "Jack", "raw_text": RAW_TEXT, "user_id": device},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _post_rehearsal(script_id: str, device: str, mode: str) -> requests.Response:
    return requests.post(
        REHEARSALS_URL,
        json={
            "script_id": script_id,
            "user_id": device,
            "user_character": "JACK",
            "mode": mode,
            "voice_type": "alloy",
        },
        timeout=30,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Backend contract: free-tier modes still work
# ─────────────────────────────────────────────────────────────────────────────

def test_free_tier_full_read_still_works() -> None:
    """Phase 1 baseline — must not regress."""
    device = _new_device()
    script_id = _create_script(device)
    r = _post_rehearsal(script_id, device, "full_read")
    assert r.status_code == 200, f"full_read should be free-tier: {r.status_code} {r.text}"
    body = r.json()
    assert body["mode"] == "full_read"
    assert body["user_character"] == "JACK"
    assert body["total_lines"] == 2  # JACK has 2 lines in RAW_TEXT


def test_free_tier_cue_only_still_works() -> None:
    """cue_only is the second free-tier mode — must not regress."""
    device = _new_device()
    script_id = _create_script(device)
    r = _post_rehearsal(script_id, device, "cue_only")
    assert r.status_code == 200, f"cue_only should be free-tier: {r.status_code} {r.text}"
    assert r.json()["mode"] == "cue_only"


# ─────────────────────────────────────────────────────────────────────────────
# Frontend static contract: orphan 'character' MODE_OPTION is gone
# ─────────────────────────────────────────────────────────────────────────────

_SCRIPT_DETAIL = Path("/app/frontend/app/script/[id].tsx")


def test_frontend_mode_options_no_longer_offers_character() -> None:
    """The orphan MODE_OPTIONS entry that caused the field failure must be gone.

    We grep for the exact object-literal shape rather than the substring
    'character' (which appears legitimately in user_character etc.).
    """
    src = _SCRIPT_DETAIL.read_text()
    assert "id: 'character'" not in src, (
        "MODE_OPTIONS must not contain the orphan { id: 'character', ... } entry — "
        "it is not a valid rehearsal mode on the backend for any tier."
    )
    assert 'id: "character"' not in src


def test_frontend_mode_options_preserves_known_modes() -> None:
    """Guard against accidental removal of the modes that DO exist server-side."""
    src = _SCRIPT_DETAIL.read_text()
    # Free-tier modes offered by the UI must still be present.
    assert "id: 'full_read'" in src
    assert "id: 'cue_only'" in src
    # Premium-tier UI cards must still be present + premium-gated.
    assert "id: 'performance'" in src
    assert "id: 'loop'" in src


def test_frontend_premium_modes_still_marked_premium() -> None:
    """Monetisation invariant — do not accidentally free premium modes."""
    src = _SCRIPT_DETAIL.read_text()
    # These two lines are the exact MODE_OPTIONS entries — asserting the
    # `premium: true` substring co-occurs in the same line.
    perf_line = next(
        (line for line in src.splitlines() if "id: 'performance'" in line), ""
    )
    loop_line = next(
        (line for line in src.splitlines() if "id: 'loop'" in line), ""
    )
    assert "premium: true" in perf_line, "'performance' mode must remain premium-gated"
    assert "premium: true" in loop_line, "'loop' mode must remain premium-gated"


# ─────────────────────────────────────────────────────────────────────────────
# Defence in depth: backend still rejects stale clients sending 'character'
# ─────────────────────────────────────────────────────────────────────────────

def test_backend_still_rejects_character_mode_from_stale_clients() -> None:
    """A cached / stale client that still sends mode='character' must be
    rejected with a 403 (never silently accepted). The UI orphan is removed
    but the backend gate itself is unchanged."""
    device = _new_device()
    script_id = _create_script(device)
    r = _post_rehearsal(script_id, device, "character")
    assert r.status_code == 403, (
        f"backend must still reject unknown mode 'character' (got {r.status_code})"
    )
    detail = (r.json().get("detail") or "").lower()
    assert "premium" in detail  # existing gating message is preserved


# ─────────────────────────────────────────────────────────────────────────────
# Monetisation invariant: genuinely premium modes stay 403 for free tier
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("premium_mode", ["performance", "loop"])
def test_free_tier_still_blocks_premium_only_modes(premium_mode: str) -> None:
    if _qa_premium_active():
        pytest.skip(
            "QA_PREMIUM=true is enabled on the running backend — every user "
            "is reported as premium, so free-tier gating cannot be exercised "
            "here. See test_qa_premium_bypass.py for the flag-off verification."
        )
    device = _new_device()
    script_id = _create_script(device)
    r = _post_rehearsal(script_id, device, premium_mode)
    assert r.status_code == 403, (
        f"free tier must still be blocked from '{premium_mode}' "
        f"(got {r.status_code} — monetisation regression!)"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
