"""
Iteration 22: Teleprompter Fix & Build Stamp - Backend Regression Tests
Tests that backend script APIs still work correctly after frontend teleprompter fix.
"""

import pytest
import requests
import uuid
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://device-validation.preview.emergentagent.com').rstrip('/')


class TestBackendRegression:
    """Backend API regression tests for teleprompter fix iteration"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.test_user_id = f"TEST_teleprompter_{uuid.uuid4().hex[:8]}"
        self.created_script_ids = []
        yield
        # Cleanup
        for script_id in self.created_script_ids:
            try:
                requests.delete(f"{BASE_URL}/api/scripts/{script_id}")
            except:
                pass
    
    def test_health_returns_200(self):
        """REGRESSION: Backend GET /api/health returns 200"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed with {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"✓ Health check passed: {data}")
    
    def test_post_scripts_creates_script(self):
        """REGRESSION: Backend POST /api/scripts still works"""
        script_payload = {
            "title": "TEST Teleprompter Script",
            "raw_text": """JOHN
Hello, how are you today?

MARY
I'm doing well, thanks for asking.

JOHN
That's great to hear!""",
            "user_id": self.test_user_id
        }
        
        response = requests.post(f"{BASE_URL}/api/scripts", json=script_payload)
        assert response.status_code == 200, f"POST /api/scripts failed with {response.status_code}: {response.text}"
        
        data = response.json()
        self.created_script_ids.append(data["id"])
        
        # Verify script structure
        assert "id" in data
        assert data["title"] == script_payload["title"]
        assert data["user_id"] == self.test_user_id
        assert "lines" in data
        assert len(data["lines"]) > 0
        assert "characters" in data
        print(f"✓ POST /api/scripts created script: {data['id']}")
        
        return data["id"]
    
    def test_get_scripts_by_user_id(self):
        """REGRESSION: Backend GET /api/scripts?user_id=X still works"""
        # First create a script
        script_id = self.test_post_scripts_creates_script()
        
        # Now fetch scripts for this user
        response = requests.get(f"{BASE_URL}/api/scripts", params={"user_id": self.test_user_id})
        assert response.status_code == 200, f"GET /api/scripts failed with {response.status_code}"
        
        scripts = response.json()
        assert isinstance(scripts, list)
        
        # Should contain our created script
        script_ids = [s["id"] for s in scripts]
        assert script_id in script_ids, f"Created script {script_id} not found in user's scripts"
        print(f"✓ GET /api/scripts?user_id={self.test_user_id} returned {len(scripts)} scripts")
    
    def test_get_script_by_id(self):
        """REGRESSION: Backend GET /api/scripts/{id} still works"""
        # First create a script
        script_payload = {
            "title": "TEST Get Script By ID",
            "raw_text": """ACTOR
This is a test line for the teleprompter.

DIRECTOR
And this is another character's line.""",
            "user_id": self.test_user_id
        }
        
        create_response = requests.post(f"{BASE_URL}/api/scripts", json=script_payload)
        assert create_response.status_code == 200
        created_script = create_response.json()
        script_id = created_script["id"]
        self.created_script_ids.append(script_id)
        
        # Now fetch by ID
        response = requests.get(f"{BASE_URL}/api/scripts/{script_id}")
        assert response.status_code == 200, f"GET /api/scripts/{script_id} failed with {response.status_code}"
        
        data = response.json()
        assert data["id"] == script_id
        assert data["title"] == script_payload["title"]
        assert "lines" in data
        assert len(data["lines"]) > 0
        print(f"✓ GET /api/scripts/{script_id} returned script with {len(data['lines'])} lines")
    
    def test_get_nonexistent_script_returns_404(self):
        """Test that fetching non-existent script returns 404"""
        fake_id = f"nonexistent_{uuid.uuid4().hex}"
        response = requests.get(f"{BASE_URL}/api/scripts/{fake_id}")
        assert response.status_code == 404, f"Expected 404 for non-existent script, got {response.status_code}"
        print(f"✓ GET /api/scripts/{fake_id} correctly returned 404")
    
    def test_script_has_lines_structure(self):
        """Verify script lines have correct structure for teleprompter"""
        script_payload = {
            "title": "TEST Line Structure",
            "raw_text": """PROTAGONIST
My first line of dialogue.

ANTAGONIST
My response to that.

(Stage direction: they stare at each other)

PROTAGONIST
Another line from me.""",
            "user_id": self.test_user_id
        }
        
        response = requests.post(f"{BASE_URL}/api/scripts", json=script_payload)
        assert response.status_code == 200
        script = response.json()
        self.created_script_ids.append(script["id"])
        
        lines = script.get("lines", [])
        assert len(lines) > 0, "Script should have lines"
        
        # Check line structure
        for line in lines:
            assert "id" in line, "Line should have 'id'"
            assert "character" in line, "Line should have 'character'"
            assert "text" in line, "Line should have 'text'"
            assert "is_stage_direction" in line, "Line should have 'is_stage_direction'"
        
        # Verify we have dialogue lines (not all stage directions)
        dialogue_lines = [l for l in lines if not l.get("is_stage_direction") and l.get("character")]
        assert len(dialogue_lines) >= 2, f"Should have at least 2 dialogue lines, got {len(dialogue_lines)}"
        
        print(f"✓ Script lines have correct structure: {len(lines)} total, {len(dialogue_lines)} dialogue lines")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
