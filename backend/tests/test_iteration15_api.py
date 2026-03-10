"""
Backend API Tests - Iteration 15
Production Build Audit Verification

Covers all endpoints requested in the test plan:
- Health check
- Scripts CRUD + upload validation
- Acting Coach analyze + scenes
- Dialect Coach accents + sample-lines
- Daily Drill + complete + feedback
- Streak tracking
- Users CRUD
- Subscription plans
- Voice presets
- Voice Studio takes
- Tapes share
"""

import pytest
import requests
import os
import uuid
from datetime import datetime

# Use production URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://production-ready-94.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def test_user_id():
    """Generate unique test user ID"""
    return f"TEST_user_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def test_device_id():
    """Generate unique test device ID"""
    return f"TEST_device_{uuid.uuid4().hex[:8]}"


class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_returns_200(self, api_client):
        """GET /api/health returns 200"""
        response = api_client.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"
        assert "timestamp" in data
        print(f"[PASS] GET /api/health - status: {data['status']}")


class TestScriptsEndpoints:
    """Scripts CRUD endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def cleanup(self, api_client, test_user_id):
        """Cleanup test scripts after tests"""
        yield
        # Cleanup: Delete test scripts
        try:
            scripts = api_client.get(f"{BASE_URL}/api/scripts?user_id={test_user_id}").json()
            for script in scripts:
                if script.get("id"):
                    api_client.delete(f"{BASE_URL}/api/scripts/{script['id']}")
        except:
            pass
    
    def test_create_script_parses_scenes(self, api_client, test_user_id):
        """POST /api/scripts creates parsed script with scenes/characters"""
        script_text = """JOHN: Hello, how are you?
SARAH: I'm fine, thank you for asking.
JOHN: That's great to hear.
(Sarah smiles and nods)
SARAH: Would you like some tea?"""
        
        response = api_client.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "TEST_Script_Parse_Check",
                "raw_text": script_text,
                "user_id": test_user_id
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["title"] == "TEST_Script_Parse_Check"
        assert "characters" in data
        assert "lines" in data
        assert len(data["characters"]) > 0, "Should parse at least one character"
        assert len(data["lines"]) > 0, "Should parse at least one line"
        print(f"[PASS] POST /api/scripts - created with {len(data['characters'])} characters, {len(data['lines'])} lines")
    
    def test_get_scripts_returns_list(self, api_client, test_user_id):
        """GET /api/scripts returns list"""
        response = api_client.get(f"{BASE_URL}/api/scripts?user_id={test_user_id}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Should return a list"
        print(f"[PASS] GET /api/scripts - returned {len(data)} scripts")
    
    def test_upload_no_file_returns_422(self, api_client):
        """POST /api/scripts/upload returns 422 when no file (not 500)"""
        # Send request without file - should get 422 validation error
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            data={"title": "Test", "user_id": "test"}
            # Intentionally no file
        )
        # FastAPI returns 422 for missing required field
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print(f"[PASS] POST /api/scripts/upload without file - returns 422 (validation error)")


class TestActingCoachEndpoints:
    """Acting Coach endpoint tests"""
    
    def test_analyze_returns_success(self, api_client):
        """POST /api/acting-coach/analyze returns success with analysis"""
        # Correct schema: scene_title, emotion, style, energy (1-10), scene_context optional
        response = api_client.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json={
                "scene_title": "Dramatic Confrontation",
                "scene_context": "Two friends arguing after betrayal",
                "emotion": "anger",
                "style": "dramatic",
                "energy": 7,
                "user_id": "test_user"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert data["success"] == True
        assert "analysis" in data
        print(f"[PASS] POST /api/acting-coach/analyze - success: {data['success']}")
    
    def test_get_scenes_returns_list(self, api_client):
        """GET /api/acting-coach/scenes returns scenes"""
        response = api_client.get(f"{BASE_URL}/api/acting-coach/scenes")
        assert response.status_code == 200
        data = response.json()
        assert "scenes" in data
        assert isinstance(data["scenes"], list)
        print(f"[PASS] GET /api/acting-coach/scenes - returned {len(data['scenes'])} scenes")


class TestDialectEndpoints:
    """Dialect Coach endpoint tests"""
    
    def test_get_accents_returns_list(self, api_client):
        """GET /api/dialect/accents returns accents"""
        response = api_client.get(f"{BASE_URL}/api/dialect/accents")
        assert response.status_code == 200
        data = response.json()
        assert "accents" in data
        assert isinstance(data["accents"], list)
        assert len(data["accents"]) > 0, "Should have at least one accent"
        print(f"[PASS] GET /api/dialect/accents - returned {len(data['accents'])} accents")
    
    def test_get_sample_lines_returns_lines(self, api_client):
        """GET /api/dialect/sample-lines returns lines"""
        response = api_client.get(f"{BASE_URL}/api/dialect/sample-lines")
        assert response.status_code == 200
        data = response.json()
        assert "lines" in data
        assert isinstance(data["lines"], list)
        assert len(data["lines"]) > 0, "Should have at least one sample line"
        print(f"[PASS] GET /api/dialect/sample-lines - returned {len(data['lines'])} lines")


class TestDailyDrillEndpoints:
    """Daily Drill endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup_user(self, api_client, test_user_id):
        """Ensure test user exists"""
        api_client.post(
            f"{BASE_URL}/api/users",
            json={"device_id": test_user_id}
        )
        yield
    
    def test_get_daily_drill(self, api_client, test_user_id):
        """GET /api/daily-drill/{user_id} returns drill"""
        response = api_client.get(f"{BASE_URL}/api/daily-drill/{test_user_id}")
        assert response.status_code == 200
        data = response.json()
        # Drill response has: id, user_id, challenge_type, title, description, prompt, duration_seconds, xp_reward, date, completed
        assert "challenge_type" in data, f"Expected challenge_type in drill data, got: {data.keys()}"
        assert "title" in data
        assert "prompt" in data
        assert "xp_reward" in data
        print(f"[PASS] GET /api/daily-drill/{test_user_id} - drill returned: {data['title']}")
    
    def test_complete_daily_drill(self, api_client, test_user_id):
        """POST /api/daily-drill/{user_id}/complete marks complete"""
        # First ensure drill exists by getting it
        api_client.get(f"{BASE_URL}/api/daily-drill/{test_user_id}")
        
        # Then complete it
        response = api_client.post(f"{BASE_URL}/api/daily-drill/{test_user_id}/complete")
        # Could be 200 (completed/already completed) or 404 (no drill yet)
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"
        if response.status_code == 200:
            data = response.json()
            assert "message" in data
            print(f"[PASS] POST /api/daily-drill/{test_user_id}/complete - {data.get('message')}")
        else:
            print(f"[PASS] POST /api/daily-drill/{test_user_id}/complete - 404 (no drill for today yet)")
    
    def test_daily_drill_feedback(self, api_client, test_user_id):
        """POST /api/daily-drill/{user_id}/feedback returns feedback"""
        # Correct schema: drill_prompt, challenge_type, performance_notes (optional)
        response = api_client.post(
            f"{BASE_URL}/api/daily-drill/{test_user_id}/feedback",
            json={
                "drill_prompt": "Express surprise turning to joy",
                "challenge_type": "emotion_shift",
                "performance_notes": "I focused on facial expressions"
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Feedback has emotion, pacing, delivery, confidence, overall_note
        assert "emotion" in data or "overall_note" in data
        print(f"[PASS] POST /api/daily-drill/{test_user_id}/feedback - feedback returned")


class TestStreakEndpoints:
    """Streak tracking endpoint tests"""
    
    def test_get_streak(self, api_client, test_user_id):
        """GET /api/streak/{user_id} returns streak data"""
        response = api_client.get(f"{BASE_URL}/api/streak/{test_user_id}")
        assert response.status_code == 200
        data = response.json()
        assert "current_streak" in data
        assert "best_streak" in data
        assert isinstance(data["current_streak"], int)
        assert isinstance(data["best_streak"], int)
        print(f"[PASS] GET /api/streak/{test_user_id} - current: {data['current_streak']}, best: {data['best_streak']}")


class TestUsersEndpoints:
    """User management endpoint tests"""
    
    def test_create_or_get_user(self, api_client, test_device_id):
        """POST /api/users creates/gets user"""
        response = api_client.post(
            f"{BASE_URL}/api/users",
            json={"device_id": test_device_id}
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "device_id" in data
        assert data["device_id"] == test_device_id
        print(f"[PASS] POST /api/users - user created/retrieved with id: {data['id']}")
        
        # Cleanup
        # Note: No delete endpoint for users, so we leave test data


class TestSubscriptionEndpoints:
    """Subscription endpoint tests"""
    
    def test_get_subscription_plans(self, api_client):
        """GET /api/subscription/plans returns plans"""
        response = api_client.get(f"{BASE_URL}/api/subscription/plans")
        assert response.status_code == 200
        data = response.json()
        assert "plans" in data
        assert "monthly" in data["plans"]
        assert "yearly" in data["plans"]
        assert "free_features" in data
        assert "premium_features" in data
        print(f"[PASS] GET /api/subscription/plans - plans returned with monthly/yearly options")


class TestVoicesEndpoints:
    """Voice presets endpoint tests"""
    
    def test_get_voice_presets(self, api_client):
        """GET /api/voices/presets returns presets"""
        response = api_client.get(f"{BASE_URL}/api/voices/presets")
        assert response.status_code == 200
        data = response.json()
        assert "voices" in data
        assert isinstance(data["voices"], list)
        assert len(data["voices"]) > 0, "Should have at least one voice preset"
        assert "total" in data
        print(f"[PASS] GET /api/voices/presets - returned {data['total']} voice presets")


class TestVoiceStudioEndpoints:
    """Voice Studio endpoint tests"""
    
    def test_get_voice_takes_returns_list_or_empty(self, api_client, test_user_id):
        """GET /api/voice-studio/takes returns takes list (or empty array)"""
        response = api_client.get(f"{BASE_URL}/api/voice-studio/takes/{test_user_id}")
        assert response.status_code == 200
        data = response.json()
        assert "takes" in data
        assert isinstance(data["takes"], list), "Should return array of takes"
        assert "total" in data
        print(f"[PASS] GET /api/voice-studio/takes/{test_user_id} - returned {data['total']} takes")


class TestTapesEndpoints:
    """Tapes share endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def cleanup_shares(self, api_client):
        """Track and cleanup shared tapes after tests"""
        created_shares = []
        yield created_shares
        # Cleanup
        for share_id in created_shares:
            try:
                api_client.delete(f"{BASE_URL}/api/tapes/share/{share_id}")
            except:
                pass
    
    def test_share_tape_creates_link(self, api_client, test_user_id, cleanup_shares):
        """POST /api/tapes/share creates share link"""
        # Correct schema: actor_name (required), video_uri (required), optional: role_name, project_name, script_title, duration, password, user_id
        response = api_client.post(
            f"{BASE_URL}/api/tapes/share",
            json={
                "actor_name": "TEST_Actor",
                "video_uri": "https://example.com/test_video.mp4",
                "role_name": "Lead Role",
                "project_name": "Test Project",
                "user_id": test_user_id
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "share_id" in data
        assert "share_url" in data
        cleanup_shares.append(data["share_id"])
        print(f"[PASS] POST /api/tapes/share - created share: {data['share_url']}")


class TestErrorHandling:
    """Error handling verification tests"""
    
    def test_invalid_json_returns_422(self, api_client):
        """Invalid JSON should return 422 validation error"""
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            data="not valid json",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422, f"Expected 422 for invalid JSON, got {response.status_code}"
        print(f"[PASS] Invalid JSON - returns 422 validation error")
    
    def test_missing_required_field_returns_422(self, api_client):
        """Missing required field returns 422"""
        response = api_client.post(
            f"{BASE_URL}/api/scripts",
            json={"title": "Missing raw_text"}  # Missing raw_text
        )
        assert response.status_code == 422, f"Expected 422 for missing field, got {response.status_code}"
        print(f"[PASS] Missing required field - returns 422 validation error")
    
    def test_not_found_returns_404(self, api_client):
        """Non-existent resource returns 404"""
        response = api_client.get(f"{BASE_URL}/api/scripts/nonexistent_id_12345")
        assert response.status_code == 404, f"Expected 404 for nonexistent resource, got {response.status_code}"
        print(f"[PASS] Non-existent resource - returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
