"""
Recovery Mode Test Suite: 5 Core Flows on Android
Tests for: Add Script, Script Library, Teleprompter, Premium, Daily Drill
"""

import pytest
import requests
import base64
import os
import json
import time
from datetime import datetime

BASE_URL = "http://localhost:8001"

# Test user IDs with TEST_ prefix for isolation
TEST_USER_ID = f"TEST_recovery_{int(time.time())}"

# Sample script text for testing
SAMPLE_SCRIPT = """SARAH
I can't believe you're leaving tomorrow.

MIKE
I have to. The job starts Monday.

(Sarah turns away, looking out the window)

SARAH
You could have said no.

MIKE
And then what? Stay here and watch everything fall apart?
"""

class TestFlow1AddScript:
    """FLOW 1 - Add Script: paste + file upload tests"""
    
    created_script_ids = []
    
    def test_post_scripts_creates_script_with_parsed_lines(self):
        """POST /api/scripts creates script with title, raw_text, returns parsed lines and characters"""
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Recovery Script via Paste",
                "raw_text": SAMPLE_SCRIPT,
                "user_id": TEST_USER_ID
            },
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain 'id'"
        assert data["title"] == "TEST_Recovery Script via Paste"
        assert "lines" in data, "Response should contain parsed 'lines'"
        assert "characters" in data, "Response should contain 'characters'"
        assert len(data["lines"]) > 0, "Should have parsed lines"
        assert len(data["characters"]) > 0, "Should have extracted characters"
        
        # Save ID for cleanup
        self.created_script_ids.append(data["id"])
        print(f"✅ POST /api/scripts returned script with {len(data['lines'])} lines, {len(data['characters'])} characters")
    
    def test_post_scripts_upload_multipart_text_file(self):
        """POST /api/scripts/upload (multipart) successfully uploads text file"""
        file_content = SAMPLE_SCRIPT.encode('utf-8')
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            files={"file": ("test_script.txt", file_content, "text/plain")},
            data={"title": "TEST_Recovery Upload Multipart", "user_id": TEST_USER_ID},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["title"] == "TEST_Recovery Upload Multipart"
        assert "lines" in data
        
        self.created_script_ids.append(data["id"])
        print(f"✅ POST /api/scripts/upload (multipart) succeeded with script id={data['id']}")
    
    def test_post_scripts_upload_base64_success(self):
        """POST /api/scripts/upload-base64 (JSON) successfully uploads base64-encoded file"""
        file_content = SAMPLE_SCRIPT.encode('utf-8')
        file_base64 = base64.b64encode(file_content).decode('utf-8')
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload-base64",
            json={
                "title": "TEST_Recovery Upload Base64",
                "filename": "test_script.txt",
                "file_data": file_base64,
                "user_id": TEST_USER_ID
            },
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["title"] == "TEST_Recovery Upload Base64"
        assert "lines" in data
        
        self.created_script_ids.append(data["id"])
        print(f"✅ POST /api/scripts/upload-base64 succeeded with script id={data['id']}")
    
    def test_post_scripts_upload_base64_empty_returns_400(self):
        """POST /api/scripts/upload-base64 returns 400 when file_data is empty"""
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload-base64",
            json={
                "title": "TEST_Empty Upload",
                "filename": "empty.txt",
                "file_data": "",
                "user_id": TEST_USER_ID
            },
            headers={"Content-Type": "application/json"},
            timeout=15
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print(f"✅ POST /api/scripts/upload-base64 with empty file_data returns 400")
    
    @pytest.fixture(autouse=True, scope="class")
    def cleanup(self, request):
        """Cleanup created scripts after tests"""
        yield
        for script_id in self.created_script_ids:
            try:
                requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=5)
            except Exception as e:
                print(f"Warning: Failed to delete script {script_id}: {e}")


class TestFlow2ScriptLibrary:
    """FLOW 2 - Script Library: scripts appear and open correctly"""
    
    test_script_id = None
    
    @pytest.fixture(autouse=True, scope="class")
    def setup_test_script(self, request):
        """Create a script for testing before tests run"""
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Library Script",
                "raw_text": SAMPLE_SCRIPT,
                "user_id": TEST_USER_ID
            },
            timeout=30
        )
        assert response.status_code == 200
        TestFlow2ScriptLibrary.test_script_id = response.json()["id"]
        
        yield
        
        # Cleanup
        if TestFlow2ScriptLibrary.test_script_id:
            try:
                requests.delete(f"{BASE_URL}/api/scripts/{TestFlow2ScriptLibrary.test_script_id}", timeout=5)
            except:
                pass
    
    def test_get_scripts_returns_list(self):
        """GET /api/scripts?user_id=X returns list of scripts with id, title, created_at"""
        response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": TEST_USER_ID},
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # Find our test script
        test_scripts = [s for s in data if s.get("title") == "TEST_Library Script"]
        assert len(test_scripts) > 0, "Test script should appear in list"
        
        script = test_scripts[0]
        assert "id" in script
        assert "title" in script
        assert "created_at" in script
        
        print(f"✅ GET /api/scripts returned {len(data)} scripts with required fields")
    
    def test_get_script_by_id_returns_full_detail(self):
        """GET /api/scripts/{id} returns full script detail with lines, characters, scenes"""
        script_id = TestFlow2ScriptLibrary.test_script_id
        assert script_id is not None, "Test script should exist"
        
        response = requests.get(f"{BASE_URL}/api/scripts/{script_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["id"] == script_id
        assert "lines" in data, "Response should include 'lines'"
        assert "characters" in data, "Response should include 'characters'"
        assert len(data["lines"]) > 0, "Should have parsed lines"
        
        print(f"✅ GET /api/scripts/{script_id} returned full detail with {len(data['lines'])} lines")


class TestFlow3Teleprompter:
    """FLOW 3 - Teleprompter: script opens, no navigation failures"""
    
    test_script_id = None
    test_rehearsal_id = None
    
    @pytest.fixture(autouse=True, scope="class")
    def setup_test_script(self, request):
        """Create a script and get its ID"""
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Teleprompter Script",
                "raw_text": SAMPLE_SCRIPT,
                "user_id": TEST_USER_ID
            },
            timeout=30
        )
        assert response.status_code == 200
        TestFlow3Teleprompter.test_script_id = response.json()["id"]
        
        yield
        
        # Cleanup
        if TestFlow3Teleprompter.test_script_id:
            try:
                requests.delete(f"{BASE_URL}/api/scripts/{TestFlow3Teleprompter.test_script_id}", timeout=5)
            except:
                pass
    
    def test_post_rehearsals_creates_session(self):
        """POST /api/rehearsals creates rehearsal session for a valid script"""
        script_id = TestFlow3Teleprompter.test_script_id
        assert script_id is not None
        
        response = requests.post(
            f"{BASE_URL}/api/rehearsals",
            json={
                "script_id": script_id,
                "user_character": "SARAH",
                "mode": "full_read",
                "voice_type": "alloy",
                "user_id": TEST_USER_ID
            },
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["script_id"] == script_id
        assert data["user_character"] == "SARAH"
        
        TestFlow3Teleprompter.test_rehearsal_id = data["id"]
        print(f"✅ POST /api/rehearsals created session id={data['id']}")
    
    def test_script_detail_returns_for_teleprompter_lookup(self):
        """GET /api/scripts/{id} works for teleprompter scripts.find() lookup"""
        script_id = TestFlow3Teleprompter.test_script_id
        assert script_id is not None
        
        # This simulates what fetchScript does in the store
        response = requests.get(f"{BASE_URL}/api/scripts/{script_id}", timeout=15)
        
        assert response.status_code == 200
        
        data = response.json()
        # Verify fields needed by teleprompter.tsx and prep.tsx
        assert "id" in data
        assert "title" in data
        assert "lines" in data
        assert "characters" in data
        
        # Check lines have required fields for teleprompter display
        if len(data["lines"]) > 0:
            line = data["lines"][0]
            assert "character" in line or "text" in line
        
        print(f"✅ Script {script_id} has all fields needed for teleprompter/prep screens")


class TestFlow5DailyDrill:
    """FLOW 5 - Daily Drill: loads correctly, retry works, real error messages"""
    
    def test_get_daily_drill_returns_drill(self):
        """GET /api/daily-drill/{userId} returns drill with prompt and challenge_type"""
        response = requests.get(
            f"{BASE_URL}/api/daily-drill/{TEST_USER_ID}",
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "prompt" in data, "Drill should have 'prompt'"
        assert "challenge_type" in data, "Drill should have 'challenge_type'"
        
        # Additional expected fields
        assert "title" in data or "xp_reward" in data, "Drill should have title or xp_reward"
        
        print(f"✅ GET /api/daily-drill/{TEST_USER_ID} returned drill: type={data.get('challenge_type')}")
    
    def test_post_daily_drill_complete_returns_success(self):
        """POST /api/daily-drill/{userId}/complete returns success message"""
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{TEST_USER_ID}/complete",
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Should return xp_awarded or message
        assert "xp_awarded" in data or "message" in data, "Response should have xp_awarded or message"
        
        print(f"✅ POST /api/daily-drill/{TEST_USER_ID}/complete returned: {data}")


# =============================================================================
# API Health Check
# =============================================================================

class TestAPIHealth:
    """Basic health check to ensure API is running"""
    
    def test_health_endpoint(self):
        """GET /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✅ API health check passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
