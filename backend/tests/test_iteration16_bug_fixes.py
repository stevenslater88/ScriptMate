"""
Backend API regression tests for iteration 16 bug fixes verification.
Tests the key endpoints: health, daily-drill, streak, scripts/upload

These tests verify the backend APIs work correctly which are consumed by the 
fixed frontend components (upload.tsx, premium.tsx, daily-drill.tsx).
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://android-upload-test.preview.emergentagent.com').rstrip('/')

class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_returns_200(self):
        """GET /api/health should return 200 with status healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy", f"Expected status 'healthy', got {data.get('status')}"
        assert "timestamp" in data, "Response should include timestamp"
        print(f"PASS: Health endpoint returns 200 with status=healthy")


class TestDailyDrillEndpoint:
    """Daily drill endpoint tests - used by daily-drill.tsx"""
    
    def test_get_daily_drill_returns_drill_data(self):
        """GET /api/daily-drill/{userId} should return drill with all required fields"""
        user_id = "TEST_drill_user_123"
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify required drill fields exist (used by daily-drill.tsx)
        required_fields = ["id", "user_id", "challenge_type", "title", "prompt", "duration_seconds", "xp_reward", "completed"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Verify field types
        assert isinstance(data["prompt"], str), "prompt should be a string"
        assert isinstance(data["completed"], bool), "completed should be a boolean"
        assert isinstance(data["xp_reward"], int), "xp_reward should be an integer"
        
        print(f"PASS: Daily drill returns all required fields - challenge_type={data['challenge_type']}, title={data['title']}")
    
    def test_complete_drill_returns_xp(self):
        """POST /api/daily-drill/{userId}/complete should mark drill complete and return XP"""
        user_id = "TEST_complete_drill_user"
        
        # First, GET the drill to create it for this user
        get_response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert get_response.status_code == 200, f"Failed to get drill first: {get_response.text}"
        
        # Now complete the drill
        response = requests.post(f"{BASE_URL}/api/daily-drill/{user_id}/complete", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify XP was awarded
        assert "xp_awarded" in data, "Response should include xp_awarded"
        assert isinstance(data["xp_awarded"], int), "xp_awarded should be integer"
        
        print(f"PASS: Complete drill returns xp_awarded={data['xp_awarded']}")


class TestStreakEndpoint:
    """Streak endpoint tests - used by daily-drill.tsx"""
    
    def test_get_streak_returns_streak_data(self):
        """GET /api/streak/{userId} should return streak with required fields"""
        user_id = "TEST_streak_user_123"
        response = requests.get(f"{BASE_URL}/api/streak/{user_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Verify required streak fields (used by daily-drill.tsx)
        required_fields = ["current_streak", "best_streak", "total_xp", "today_completed", "activities_today"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Verify field types
        assert isinstance(data["current_streak"], int), "current_streak should be integer"
        assert isinstance(data["best_streak"], int), "best_streak should be integer"
        assert isinstance(data["total_xp"], int), "total_xp should be integer"
        assert isinstance(data["today_completed"], bool), "today_completed should be boolean"
        assert isinstance(data["activities_today"], list), "activities_today should be list"
        
        print(f"PASS: Streak returns current={data['current_streak']}, best={data['best_streak']}, xp={data['total_xp']}")


class TestScriptsUploadEndpoint:
    """Scripts upload endpoint tests - used by upload.tsx"""
    
    def test_upload_text_file_succeeds(self):
        """POST /api/scripts/upload should accept text file and return script"""
        # Create a simple test script content
        script_content = """JOHN
Hello, how are you?

MARY
I'm doing well, thanks for asking.

JOHN
Great! Let's go to the park."""
        
        # Create multipart form data
        files = {
            'file': ('test_script.txt', script_content, 'text/plain')
        }
        data = {
            'title': 'TEST_upload_script',
            'user_id': 'TEST_upload_user'
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        
        # Verify script was created
        assert "id" in result, "Response should include script id"
        assert result.get("title") == "TEST_upload_script", f"Title mismatch: {result.get('title')}"
        
        # Clean up - delete the test script
        if result.get("id"):
            requests.delete(f"{BASE_URL}/api/scripts/{result['id']}", timeout=10)
        
        print(f"PASS: File upload succeeds, script_id={result['id']}")
    
    def test_upload_empty_file_handles_gracefully(self):
        """POST /api/scripts/upload with empty file should handle gracefully"""
        files = {
            'file': ('empty.txt', '', 'text/plain')
        }
        data = {
            'title': 'TEST_empty_upload',
            'user_id': 'TEST_upload_user'
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        # Should either succeed with empty script or return appropriate error (not 500)
        assert response.status_code in [200, 400, 422], f"Expected 200/400/422, got {response.status_code}: {response.text}"
        
        # Clean up if script was created
        if response.status_code == 200:
            result = response.json()
            if result.get("id"):
                requests.delete(f"{BASE_URL}/api/scripts/{result['id']}", timeout=10)
        
        print(f"PASS: Empty file upload handled gracefully, status={response.status_code}")
    
    def test_upload_without_title_returns_validation_error(self):
        """POST /api/scripts/upload without title should return validation error"""
        files = {
            'file': ('test.txt', 'Some content', 'text/plain')
        }
        # Intentionally omit title
        data = {
            'user_id': 'TEST_no_title_user'
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        # Should return 422 validation error
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
        print(f"PASS: Missing title returns 422 validation error")


class TestErrorHandling:
    """Error handling tests - verifies proper error messages are returned"""
    
    def test_nonexistent_drill_user_creates_new_drill(self):
        """GET /api/daily-drill for new user should create drill (not error)"""
        user_id = "TEST_brand_new_user_xyz"
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        
        # API creates drill for new users, should return 200
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "prompt" in data, "Should return drill with prompt"
        print(f"PASS: New user gets drill created automatically")
    
    def test_invalid_script_id_returns_404(self):
        """GET /api/scripts/{id} with invalid ID should return 404"""
        response = requests.get(f"{BASE_URL}/api/scripts/nonexistent-script-xyz", timeout=10)
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}: {response.text}"
        data = response.json()
        assert "detail" in data, "Error response should include detail message"
        print(f"PASS: Invalid script ID returns 404 with detail: {data.get('detail')}")


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
