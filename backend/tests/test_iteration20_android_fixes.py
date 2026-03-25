"""
Iteration 20: Android Device Build Fixes - Backend Regression Tests
Tests backend API endpoints that support the Android device build fixes:
- Script upload/save
- Script retrieval 
- Health endpoint
"""

import pytest
import requests
import os
import uuid

# Get base URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://save-script-verify.preview.emergentagent.com').rstrip('/')

# Test prefix for isolation
TEST_PREFIX = f"TEST_iteration20_{uuid.uuid4().hex[:8]}"


class TestHealthEndpoint:
    """Health endpoint regression test"""
    
    def test_health_returns_200_with_healthy_status(self):
        """GET /api/health should return 200 with status=healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("status") == "healthy", f"Expected status=healthy, got {data}"
        print(f"PASS: Health endpoint returned: {data}")


class TestScriptEndpoints:
    """Script CRUD regression tests"""
    
    @pytest.fixture
    def test_user_id(self):
        return f"{TEST_PREFIX}_user"
    
    @pytest.fixture
    def created_script_id(self, test_user_id):
        """Create a script for testing and clean up after"""
        # Create script
        payload = {
            "title": f"{TEST_PREFIX} Test Script",
            "raw_text": "INT. LIVING ROOM - DAY\n\nJOHN: Hello there!\n\nMARY: Hi John, how are you?\n\nJOHN: I'm doing well, thanks.",
            "user_id": test_user_id
        }
        response = requests.post(f"{BASE_URL}/api/scripts", json=payload, timeout=15)
        assert response.status_code in [200, 201], f"Failed to create script: {response.status_code}"
        
        script_id = response.json().get("id")
        assert script_id, "Script ID not returned"
        
        yield script_id
        
        # Cleanup
        try:
            requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
        except:
            pass
    
    def test_post_scripts_creates_script(self, test_user_id):
        """POST /api/scripts should create a script with parsed lines"""
        payload = {
            "title": f"{TEST_PREFIX} Creation Test",
            "raw_text": "INT. OFFICE - DAY\n\nBOSS: We need to talk.\n\nEMPLOYEE: Sure, what about?",
            "user_id": test_user_id
        }
        
        response = requests.post(f"{BASE_URL}/api/scripts", json=payload, timeout=15)
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}"
        
        data = response.json()
        assert "id" in data, "Script ID not returned"
        assert data.get("title") == payload["title"], "Title mismatch"
        
        # Verify lines were parsed
        lines = data.get("lines", [])
        assert len(lines) > 0, "No lines parsed from script"
        
        # Verify characters extracted
        characters = data.get("characters", [])
        assert len(characters) >= 2, f"Expected at least 2 characters, got {len(characters)}"
        
        print(f"PASS: Script created with {len(lines)} lines, {len(characters)} characters")
        
        # Cleanup
        script_id = data["id"]
        requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
    
    def test_get_scripts_by_user_id(self, test_user_id, created_script_id):
        """GET /api/scripts?user_id=X should return list of scripts"""
        response = requests.get(f"{BASE_URL}/api/scripts", params={"user_id": test_user_id}, timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        assert len(data) >= 1, "Expected at least 1 script"
        
        # Check that our created script is in the list
        script_ids = [s.get("id") for s in data]
        assert created_script_id in script_ids, f"Created script {created_script_id} not found in list"
        
        print(f"PASS: Retrieved {len(data)} scripts for user")
    
    def test_get_script_by_id(self, created_script_id):
        """GET /api/scripts/{id} should return full script detail"""
        response = requests.get(f"{BASE_URL}/api/scripts/{created_script_id}", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("id") == created_script_id, "ID mismatch"
        assert "lines" in data, "Lines not in response"
        assert "characters" in data, "Characters not in response"
        
        print(f"PASS: Script detail retrieved with {len(data.get('lines', []))} lines")


class TestScriptUploadEndpoints:
    """Script upload endpoints regression tests"""
    
    @pytest.fixture
    def test_user_id(self):
        return f"{TEST_PREFIX}_upload_user"
    
    def test_post_scripts_upload_returns_200_or_422(self, test_user_id):
        """POST /api/scripts/upload should accept multipart form data"""
        import io
        
        # Create a test file
        test_content = "INT. TEST SCENE - DAY\n\nACTOR: This is my line.\n\nDIRECTOR: That was great!"
        files = {
            'file': ('test_script.txt', io.BytesIO(test_content.encode()), 'text/plain')
        }
        data = {
            'user_id': test_user_id
        }
        
        response = requests.post(f"{BASE_URL}/api/scripts/upload", files=files, data=data, timeout=15)
        
        # Upload endpoint should return 200/201 on success or 422 if validation needed
        assert response.status_code in [200, 201, 422], f"Unexpected status: {response.status_code}"
        
        if response.status_code in [200, 201]:
            result = response.json()
            script_id = result.get("id")
            if script_id:
                # Cleanup
                requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
                print(f"PASS: Upload successful, script created with ID {script_id}")
            else:
                print(f"PASS: Upload returned 200 with response: {result}")
        else:
            print(f"INFO: Upload returned 422 (validation error) - may need additional params")


class TestAPIEndpointAvailability:
    """Verify all key endpoints are responding"""
    
    def test_health_endpoint_responds(self):
        """Health endpoint should respond"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        print("PASS: /api/health responding")
    
    def test_scripts_endpoint_responds(self):
        """Scripts list endpoint should respond"""
        response = requests.get(f"{BASE_URL}/api/scripts", params={"user_id": "test"}, timeout=10)
        assert response.status_code == 200
        print("PASS: /api/scripts responding")
    
    def test_daily_drill_endpoint_responds(self):
        """Daily drill endpoint should respond"""
        response = requests.get(f"{BASE_URL}/api/daily-drill/test_user", timeout=10)
        assert response.status_code == 200
        print("PASS: /api/daily-drill responding")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
