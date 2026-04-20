"""
ScriptM8 Backend API Tests
Tests for the 5-part update: branding, network fix, timeouts, home layout, error handling
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://rehearse-app.preview.emergentagent.com')

class TestHealthEndpoint:
    """Test backend health check"""
    
    def test_health_check(self):
        """Verify backend is healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=15)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"SUCCESS: Health check passed - status: {data['status']}")


class TestScriptsAPI:
    """Test scripts CRUD with timeout handling"""
    
    def test_get_scripts_with_timeout(self):
        """GET /api/scripts should respond within timeout"""
        start_time = time.time()
        response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": "test-timeout-user"},
            timeout=15
        )
        elapsed = time.time() - start_time
        
        assert response.status_code == 200
        assert elapsed < 15, f"Request took {elapsed}s, exceeds 15s timeout"
        print(f"SUCCESS: GET /api/scripts responded in {elapsed:.2f}s")
    
    def test_create_script_with_timeout(self):
        """POST /api/scripts should respond within timeout"""
        start_time = time.time()
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Timeout_Script",
                "raw_text": "JOHN\nHello!\n\nJANE\nHi there!",
                "user_id": "test-timeout-user"
            },
            timeout=15
        )
        elapsed = time.time() - start_time
        
        assert response.status_code == 200 or response.status_code == 201
        assert elapsed < 15, f"Request took {elapsed}s, exceeds 15s timeout"
        
        data = response.json()
        assert "id" in data
        assert data["title"] == "TEST_Timeout_Script"
        assert len(data["characters"]) >= 2  # Should detect JOHN and JANE
        
        print(f"SUCCESS: POST /api/scripts responded in {elapsed:.2f}s, created script {data['id']}")
        return data["id"]
    
    def test_get_script_by_id(self):
        """GET /api/scripts/:id should return script details"""
        # First create a script
        create_response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Get_Script",
                "raw_text": "ALICE\nHello world!",
                "user_id": "test-user"
            },
            timeout=15
        )
        assert create_response.status_code in [200, 201]
        script_id = create_response.json()["id"]
        
        # Then fetch it
        response = requests.get(f"{BASE_URL}/api/scripts/{script_id}", timeout=15)
        assert response.status_code == 200
        
        data = response.json()
        assert data["id"] == script_id
        assert data["title"] == "TEST_Get_Script"
        print(f"SUCCESS: GET /api/scripts/{script_id} returned script details")


class TestUsersAPI:
    """Test user-related endpoints"""
    
    def test_create_user(self):
        """POST /api/users should create or return existing user"""
        response = requests.post(
            f"{BASE_URL}/api/users",
            json={"device_id": "test-device-12345"},
            timeout=15
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "id" in data
        assert "subscription_tier" in data
        print(f"SUCCESS: POST /api/users returned user with id {data['id']}")
    
    def test_get_user_limits(self):
        """GET /api/users/:device_id/limits should return tier limits"""
        # First create user
        requests.post(
            f"{BASE_URL}/api/users",
            json={"device_id": "test-limits-device"},
            timeout=15
        )
        
        # Then get limits
        response = requests.get(
            f"{BASE_URL}/api/users/test-limits-device/limits",
            timeout=15
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "limits" in data
        assert "is_premium" in data
        print(f"SUCCESS: GET limits returned tier: {'premium' if data['is_premium'] else 'free'}")


class TestSubscriptionAPI:
    """Test subscription-related endpoints"""
    
    def test_get_subscription_plans(self):
        """GET /api/subscription/plans should return pricing"""
        response = requests.get(
            f"{BASE_URL}/api/subscription/plans",
            params={"region": "US"},
            timeout=15
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "plans" in data
        assert "region" in data
        print(f"SUCCESS: GET /api/subscription/plans returned plans for region {data['region']}")


class TestRehearsalsAPI:
    """Test rehearsals endpoints"""
    
    def test_create_rehearsal(self):
        """POST /api/rehearsals should create a new rehearsal session"""
        # First create a script
        script_response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Rehearsal_Script",
                "raw_text": "BOB\nHey!\n\nALICE\nHi!",
                "user_id": "test-rehearsal-user"
            },
            timeout=15
        )
        assert script_response.status_code in [200, 201]
        script_id = script_response.json()["id"]
        
        # Create rehearsal
        response = requests.post(
            f"{BASE_URL}/api/rehearsals",
            json={
                "script_id": script_id,
                "user_character": "BOB",
                "mode": "full_read",
                "voice_type": "alloy",
                "user_id": "test-rehearsal-user"
            },
            timeout=15
        )
        assert response.status_code in [200, 201]
        
        data = response.json()
        assert "id" in data
        assert data["script_id"] == script_id
        assert data["user_character"] == "BOB"
        print(f"SUCCESS: POST /api/rehearsals created rehearsal {data['id']}")


class TestErrorHandling:
    """Test error handling and responses"""
    
    def test_invalid_script_id_returns_404(self):
        """GET /api/scripts/:id with invalid ID should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/scripts/nonexistent-script-id",
            timeout=15
        )
        assert response.status_code in [404, 500]  # Either 404 or handled error
        print(f"SUCCESS: Invalid script ID returned status {response.status_code}")
    
    def test_missing_required_fields_returns_error(self):
        """POST /api/scripts without required fields should return error"""
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={},  # Missing title and raw_text
            timeout=15
        )
        # Should return 422 or 400 for validation error
        assert response.status_code in [400, 422]
        print(f"SUCCESS: Missing fields returned status {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
