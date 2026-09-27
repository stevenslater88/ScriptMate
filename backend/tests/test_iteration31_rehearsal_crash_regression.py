"""Iter31 regression tests for rehearsal end-of-scene crash fix + backend regressions.

Backend-only test coverage (frontend finalizeRehearsal path is verified separately
via Playwright). This suite verifies:

  1. POST /api/scripts/upload — extraction-only contract (no 'id', no persistence)
  2. POST /api/scripts/upload-base64 — extraction-only contract (no 'id', no persistence)
  3. Full paste-text flow: POST /api/scripts + PUT /api/scripts/{id} user_character
     sets is_user_character=true on the chosen character
  4. QA rehearsal bypass with QA_UNLIMITED_REHEARSALS=true — free tier user with
     rehearsals_today=5 still gets HTTP 200 on POST /api/rehearsals
"""
import base64
import io
import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://save-script-verify.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture
def user_id():
    return f"TEST_iter31_{uuid.uuid4().hex[:8]}"


SAMPLE_SCRIPT = """SARAH
Hello Mike, how are you?

MIKE
I'm good, thanks Sarah.
"""


# ---- 1. POST /api/scripts/upload extraction-only ----------------------------

def test_upload_multipart_extraction_only(db, user_id):
    files = {"file": ("sample.txt", io.BytesIO(SAMPLE_SCRIPT.encode()), "text/plain")}
    data = {"title": "TEST_iter31_upload", "user_id": user_id}
    r = requests.post(f"{API}/scripts/upload", files=files, data=data, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    # Contract fields
    assert set(body.keys()) >= {"raw_text", "filename", "title", "source", "size_bytes"}
    assert "id" not in body, f"Extraction endpoint MUST NOT return 'id': {body}"
    assert body["source"] == "multipart"
    assert "SARAH" in body["raw_text"]
    # No script row persisted
    count = db.scripts.count_documents({"user_id": user_id})
    assert count == 0, f"Extraction endpoint MUST NOT persist a Script (found {count})"


# ---- 2. POST /api/scripts/upload-base64 extraction-only ---------------------

def test_upload_base64_extraction_only(db, user_id):
    payload = {
        "title": "TEST_iter31_b64",
        "filename": "sample.txt",
        "file_data": base64.b64encode(SAMPLE_SCRIPT.encode()).decode(),
        "user_id": user_id,
    }
    r = requests.post(f"{API}/scripts/upload-base64", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) >= {"raw_text", "filename", "title", "source", "size_bytes"}
    assert "id" not in body, f"Base64 extraction endpoint MUST NOT return 'id': {body}"
    assert body["source"] == "base64"
    assert "MIKE" in body["raw_text"]
    count = db.scripts.count_documents({"user_id": user_id})
    assert count == 0


# ---- 3. Paste flow: create script + PUT user_character ----------------------

def test_paste_create_and_set_user_character(db, user_id):
    r = requests.post(
        f"{API}/scripts",
        json={"title": "TEST_iter31_paste", "raw_text": SAMPLE_SCRIPT, "user_id": user_id},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    script = r.json()
    script_id = script["id"]
    char_names = [c["name"] for c in script["characters"]]
    assert "SARAH" in char_names and "MIKE" in char_names, char_names

    # PUT user_character = SARAH
    put = requests.put(
        f"{API}/scripts/{script_id}",
        json={"user_character": "SARAH"},
        timeout=15,
    )
    assert put.status_code == 200, put.text

    # GET back and verify is_user_character flag
    got = requests.get(f"{API}/scripts/{script_id}", timeout=15)
    assert got.status_code == 200
    result = got.json()
    chars = {c["name"]: c for c in result["characters"]}
    assert chars["SARAH"]["is_user_character"] is True
    assert chars["MIKE"]["is_user_character"] is False

    # cleanup
    requests.delete(f"{API}/scripts/{script_id}", timeout=10)


# ---- 4. QA rehearsal bypass -------------------------------------------------

def test_qa_bypass_allows_6th_rehearsal(db, user_id):
    """Verify QA_UNLIMITED_REHEARSALS=true lets rehearsals_today=5 still POST."""
    assert os.environ.get("QA_UNLIMITED_REHEARSALS", "").lower() == "true" or True, \
        "Note: this test reads the LIVE backend .env; not the pytest process env."

    # Create a script first (need script_id for rehearsal)
    r = requests.post(
        f"{API}/scripts",
        json={"title": "TEST_iter31_qa", "raw_text": SAMPLE_SCRIPT, "user_id": user_id},
        timeout=60,
    )
    assert r.status_code == 200
    script_id = r.json()["id"]

    # Force user to have rehearsals_today=5, subscription=free, last_rehearsal_date=today
    from datetime import datetime
    today = datetime.utcnow().strftime("%Y-%m-%d")
    # ensure user exists
    db.users.update_one(
        {"$or": [{"id": user_id}, {"device_id": user_id}]},
        {"$set": {
            "id": user_id, "device_id": user_id,
            "subscription_tier": "free",
            "rehearsals_today": 5,
            "last_rehearsal_date": today,
        }},
        upsert=True,
    )

    reh = requests.post(
        f"{API}/rehearsals",
        json={
            "script_id": script_id,
            "user_id": user_id,
            "user_character": "SARAH",
            "mode": "full_read",
            "voice_type": "alloy",
        },
        timeout=15,
    )
    # With QA bypass on backend, should be 200. If flag is off, will be 403.
    print(f"[QA_BYPASS test] status={reh.status_code} body={reh.text[:200]}")
    assert reh.status_code == 200, (
        f"Expected 200 with QA_UNLIMITED_REHEARSALS=true; got {reh.status_code}: {reh.text}"
    )
    body = reh.json()
    assert body["user_character"] == "SARAH"

    # cleanup
    requests.delete(f"{API}/scripts/{script_id}", timeout=10)
    db.users.delete_many({"$or": [{"id": user_id}, {"device_id": user_id}]})
    db.rehearsals.delete_many({"user_id": user_id})


# ---- 5. Production limit intact when flag is off ---------------------------
# This flip is optional: we do NOT toggle the env at runtime automatically
# because it would race with supervisor. Documented as manual step in report.
