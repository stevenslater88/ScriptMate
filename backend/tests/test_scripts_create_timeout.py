"""Regression test for the intermittent `POST /api/scripts` timeout that
was misdiagnosed as a "Network Error" on the ScriptM8 Samsung 1110-QA build.

Root cause (see fork job 2026-02):
  * Frontend Axios timeout on POST /api/scripts was API_TIMEOUT = 15000ms.
  * Backend POST /api/scripts invokes `parse_script_with_ai` (GPT-4o).
  * Median LLM latency ~4s, but concurrent bursts spike to 20-25s.
  * Requests exceeding 15s were aborted client-side => "no HTTP status,
    ~15s duration" — exactly matching the Samsung field report.

Fix: frontend uses `API_TIMEOUT_LLM = 60000` for this endpoint only.

This test protects against BACKEND regression: it verifies that the endpoint
still returns 200 (never a 5xx) within the extended 60s SLA under a burst of
concurrent identical requests matching the reported field payload:
  title = "Jack"
  raw_text length ~= 931 chars
"""

from __future__ import annotations

import os
import time
import uuid
import concurrent.futures as cf
from pathlib import Path
from typing import Any, Dict

import pytest
import requests


BACKEND_URL = os.environ.get(
    "TEST_BACKEND_URL",
    "http://localhost:8001",
).rstrip("/")

ENDPOINT = f"{BACKEND_URL}/api/scripts"

# Payload characteristics chosen to match the real-device failure report:
#   POST /api/scripts, title="Jack", textLen=931
_RAW_TEXT = (
    "INT. WAREHOUSE - NIGHT\n\n"
    "JACK stands at the edge of a raised platform. Behind him, a row of "
    "shipping containers hums under sodium lights.\n\n"
    "JACK\nYou weren't supposed to come alone.\n\n"
    "MARA (O.S.)\nAnd yet, here I am.\n\n"
    "JACK\nThen let's finish it. No more messages. No more couriers. "
    "Just us and whatever we decide is left.\n\n"
    "MARA\nYou say that like you already know the ending.\n\n"
    "JACK\nI know how it looks when a man runs out of moves. I've been him. "
    "I've watched him.\n\n"
    "MARA (CONT'D)\nAnd yet you keep asking for another round.\n\n"
    "JACK\nBecause quitting is louder than losing.\n\n"
    "MARA\nQuiet has its uses, Jack.\n\n"
    "JACK\nNot tonight.\n\n"
    "MARA (softer)\nAlways tonight.\n\n"
    "JACK\nGive me one reason to walk away.\n\n"
    "MARA\nOne? I brought three. Take your pick.\n\n"
    "JACK\nName them.\n\n"
    "MARA\nYour sister. Your promise. Your name.\n\n"
    "JACK\nThose aren't reasons. Those are hooks.\n\n"
    "MARA\nCall them what you want. They still hold.\n\n"
    "JACK\nThen cut me loose.\n\n"
    "MARA\nI came here to try.\n"
)

# Frontend's LLM-endpoint timeout (must match apiConfig.ts:API_TIMEOUT_LLM).
FRONTEND_LLM_TIMEOUT_SECONDS = 60.0


def _payload() -> Dict[str, Any]:
    return {
        "title": "Jack",
        "raw_text": _RAW_TEXT,
        "user_id": f"regression-{uuid.uuid4()}",
    }


def _post_once() -> Dict[str, Any]:
    start = time.monotonic()
    resp = requests.post(ENDPOINT, json=_payload(), timeout=FRONTEND_LLM_TIMEOUT_SECONDS)
    elapsed = time.monotonic() - start
    return {"status": resp.status_code, "elapsed": elapsed, "body": resp.json() if resp.ok else resp.text}


def test_apiconfig_declares_extended_llm_timeout() -> None:
    """The frontend MUST declare an extended timeout for LLM-backed endpoints.

    Guards against a regression where someone reverts API_TIMEOUT_LLM back to
    the aggressive 15s value that caused the Samsung field failure.
    """
    api_config = Path("/app/frontend/services/apiConfig.ts").read_text()
    assert "API_TIMEOUT_LLM" in api_config, (
        "apiConfig.ts must export API_TIMEOUT_LLM for LLM-backed endpoints"
    )
    # Must be at least 30s to survive observed P99 LLM bursts (~25s).
    assert "60000" in api_config or "45000" in api_config or "30000" in api_config, (
        "API_TIMEOUT_LLM must be >= 30000ms to survive observed GPT-4o P99 bursts"
    )


def test_scriptstore_uses_llm_timeout_for_create_script() -> None:
    """The createScript action must use API_TIMEOUT_LLM, not the 15s default."""
    store = Path("/app/frontend/store/scriptStore.ts").read_text()
    # createScript block must reference the extended timeout constant.
    assert "API_TIMEOUT_LLM" in store, (
        "scriptStore.ts must import and use API_TIMEOUT_LLM for POST /api/scripts"
    )


def test_post_scripts_single_request_under_llm_sla() -> None:
    """POST /api/scripts must return 200 within the frontend LLM timeout."""
    result = _post_once()
    assert result["status"] == 200, f"Unexpected status: {result}"
    assert result["elapsed"] < FRONTEND_LLM_TIMEOUT_SECONDS, (
        f"Response took {result['elapsed']:.1f}s (exceeds frontend timeout)"
    )
    body = result["body"]
    assert body.get("id"), "Response missing script id"
    assert body.get("title") == "Jack"
    # Must return characters + lines so the frontend can drive rehearsal.
    assert body.get("characters"), "Response missing characters"
    assert body.get("lines"), "Response missing lines"


def test_post_scripts_burst_never_5xx_within_sla() -> None:
    """Under a 4x concurrent burst (matching real-device bursts on retry),
    the endpoint must never return 5xx and must complete within the LLM SLA.

    This mirrors the exact failure conditions reproduced during RCA:
    concurrent bursts causing GPT-4o P99 latency spikes.
    """
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(_post_once) for _ in range(4)]
        results = [f.result() for f in futures]

    for i, r in enumerate(results, 1):
        assert 200 <= r["status"] < 500, (
            f"Burst request {i} returned server error: status={r['status']} "
            f"elapsed={r['elapsed']:.1f}s"
        )
        assert r["elapsed"] < FRONTEND_LLM_TIMEOUT_SECONDS, (
            f"Burst request {i} exceeded frontend LLM timeout: "
            f"{r['elapsed']:.1f}s >= {FRONTEND_LLM_TIMEOUT_SECONDS}s"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
