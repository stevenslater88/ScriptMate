"""
Crash Safety Audit Tests - Iteration 12

Tests all backend APIs to verify stability after crash safety fixes.
Key focus areas:
- Error handling in acting-coach/analyze (line 2388)
- Error handling in dialect/analyze (line 2178)
- Error handling in daily-drill/feedback (line 2700)
- General API regression testing

All APIs tested:
- GET /api/health
- GET /api/daily-drill/{user_id}
- POST /api/daily-drill/{user_id}/complete
- POST /api/daily-drill/{user_id}/feedback
- GET /api/streak/{user_id}
- POST /api/acting-coach/analyze
- GET /api/acting-coach/scenes
- GET /api/acting-coach/history/{user_id}
- GET /api/dialect/accents
- GET /api/dialect/sample-lines
- POST /api/tapes/share
- GET /api/tapes/share/{share_id}
- POST /api/scripts
- GET /api/scripts
- POST /api/users
- GET /api/subscription/plans
- POST /api/voice-studio/process
- GET /api/voices/presets
"""

import pytest
import requests
import os
import time
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://device-validation.preview.emergentagent.com')

# Test user prefix for cleanup
TEST_USER_ID = f"TEST_crash_audit_{int(time.time())}"


class TestHealthAndBasics:
    """Basic health check and core API verification"""
    
    def test_health_endpoint(self):
        """GET /api/health returns 200 with status healthy"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        print(f"✓ Health check passed: {data}")

    def test_root_endpoint(self):
        """GET /api/ returns API info"""
        response = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print(f"✓ Root endpoint: {data['message']}")


class TestDailyDrillAPIs:
    """Tests for Daily Drill endpoints"""
    
    def test_get_daily_drill_returns_valid_structure(self):
        """GET /api/daily-drill/{user_id} returns drill with required fields"""
        user_id = f"TEST_drill_{int(time.time())}"
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify all required fields from test spec
        assert "id" in data, "Missing 'id' field"
        assert "prompt" in data, "Missing 'prompt' field"
        assert "challenge_type" in data, "Missing 'challenge_type' field"
        assert "xp_reward" in data, "Missing 'xp_reward' field"
        
        # Verify XP reward value
        assert data["xp_reward"] == 25, f"Expected xp_reward=25, got {data['xp_reward']}"
        
        print(f"✓ Daily drill created: {data['challenge_type']}, XP: {data['xp_reward']}")

    def test_complete_daily_drill_awards_xp(self):
        """POST /api/daily-drill/{user_id}/complete marks drill complete and awards XP"""
        user_id = f"TEST_complete_{int(time.time())}"
        
        # First get a drill
        get_response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert get_response.status_code == 200
        
        # Complete the drill
        response = requests.post(f"{BASE_URL}/api/daily-drill/{user_id}/complete", timeout=15)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "xp_awarded" in data, "Missing 'xp_awarded' field"
        print(f"✓ Drill completed, XP awarded: {data['xp_awarded']}")

    def test_drill_feedback_returns_structured_response(self):
        """POST /api/daily-drill/{user_id}/feedback returns structured feedback"""
        user_id = f"TEST_feedback_{int(time.time())}"
        
        # First get a drill
        get_response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert get_response.status_code == 200
        drill = get_response.json()
        
        # Request feedback
        feedback_payload = {
            "drill_prompt": drill["prompt"],
            "challenge_type": drill["challenge_type"],
            "performance_notes": "Test performance notes"
        }
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/feedback",
            json=feedback_payload,
            timeout=30  # AI may take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify required feedback fields from spec
        assert "emotion" in data, "Missing 'emotion' field"
        assert "pacing" in data, "Missing 'pacing' field"
        assert "delivery" in data, "Missing 'delivery' field"
        assert "confidence" in data, "Missing 'confidence' field"
        assert "overall_note" in data, "Missing 'overall_note' field"
        
        # Verify structure of each feedback component
        for key in ["emotion", "pacing", "delivery", "confidence"]:
            assert "score" in data[key], f"Missing score in {key}"
            assert "label" in data[key], f"Missing label in {key}"
        
        print(f"✓ Drill feedback received: emotion={data['emotion']['score']}, pacing={data['pacing']['score']}")


class TestStreakAPIs:
    """Tests for Streak endpoints"""
    
    def test_get_streak_returns_required_fields(self):
        """GET /api/streak/{user_id} returns streak data with all required fields"""
        user_id = f"TEST_streak_{int(time.time())}"
        
        response = requests.get(f"{BASE_URL}/api/streak/{user_id}", timeout=15)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Verify all required fields from spec
        assert "current_streak" in data, "Missing 'current_streak' field"
        assert "best_streak" in data, "Missing 'best_streak' field"
        assert "total_xp" in data, "Missing 'total_xp' field"
        assert "today_completed" in data, "Missing 'today_completed' field"
        assert "activities_today" in data, "Missing 'activities_today' field"
        
        print(f"✓ Streak data: current={data['current_streak']}, best={data['best_streak']}, xp={data['total_xp']}")


class TestActingCoachAPIs:
    """Tests for Acting Coach endpoints - focus on crash safety error handling"""
    
    def test_analyze_performance_success(self):
        """POST /api/acting-coach/analyze returns success with analysis object"""
        payload = {
            "scene_title": "The Breakup",
            "scene_context": "Test scene context",
            "emotion": "sad",
            "style": "naturalistic",
            "energy": 5,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload,
            timeout=30  # AI may take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get("success") is True, "Expected success:true"
        assert "analysis" in data, "Missing 'analysis' object"
        
        analysis = data["analysis"]
        # Verify all required fields from spec
        assert "performance_score" in analysis, "Missing performance_score"
        assert "score_label" in analysis, "Missing score_label"
        assert "what_works" in analysis, "Missing what_works"
        assert "improvement_tips" in analysis, "Missing improvement_tips"
        assert "example_delivery" in analysis, "Missing example_delivery"
        assert "director_note" in analysis, "Missing director_note"
        
        print(f"✓ Acting coach analysis: score={analysis['performance_score']}, label={analysis['score_label']}")

    def test_analyze_performance_invalid_data_returns_structured_error(self):
        """POST /api/acting-coach/analyze with invalid data returns structured error"""
        # Missing required field 'scene_title'
        payload = {
            "emotion": "happy",
            "style": "theatrical",
            "energy": 7
        }
        
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload,
            timeout=15
        )
        
        # Should return 422 validation error for missing required field
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
        print(f"✓ Validation error returned correctly for missing fields")

    def test_analyze_performance_empty_scene_title(self):
        """POST /api/acting-coach/analyze with empty scene_title returns validation error"""
        payload = {
            "scene_title": "",  # Empty - should fail validation
            "emotion": "angry",
            "style": "method",
            "energy": 8,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload,
            timeout=15
        )
        
        # Should return 422 for empty scene_title (min_length=1)
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
        print(f"✓ Validation error for empty scene_title")

    def test_get_scenes(self):
        """GET /api/acting-coach/scenes returns scenes array"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/scenes", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "scenes" in data, "Missing 'scenes' field"
        assert isinstance(data["scenes"], list), "scenes should be an array"
        assert len(data["scenes"]) > 0, "scenes array should not be empty"
        
        # Verify scene structure
        scene = data["scenes"][0]
        assert "title" in scene, "Scene missing title"
        assert "context" in scene, "Scene missing context"
        
        print(f"✓ Got {len(data['scenes'])} scenes")

    def test_get_history(self):
        """GET /api/acting-coach/history/{user_id} returns attempts array"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/history/{TEST_USER_ID}", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "attempts" in data, "Missing 'attempts' field"
        assert isinstance(data["attempts"], list), "attempts should be an array"
        
        print(f"✓ History returned: {len(data['attempts'])} attempts")


class TestDialectCoachAPIs:
    """Tests for Dialect Coach endpoints"""
    
    def test_get_accents(self):
        """GET /api/dialect/accents returns list of accents"""
        response = requests.get(f"{BASE_URL}/api/dialect/accents", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "accents" in data, "Missing 'accents' field"
        assert isinstance(data["accents"], list), "accents should be an array"
        assert len(data["accents"]) > 0, "accents array should not be empty"
        
        print(f"✓ Got {len(data['accents'])} accents")

    def test_get_sample_lines(self):
        """GET /api/dialect/sample-lines returns sample lines"""
        response = requests.get(f"{BASE_URL}/api/dialect/sample-lines", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "lines" in data, "Missing 'lines' field"
        assert isinstance(data["lines"], list), "lines should be an array"
        
        print(f"✓ Got {len(data['lines'])} sample lines")


class TestTapesShareAPIs:
    """Tests for Self Tape Share endpoints"""
    
    def test_create_share_link(self):
        """POST /api/tapes/share creates a share link and returns share_id"""
        payload = {
            "actor_name": "Test Actor",
            "role_name": "Test Role",
            "project_name": "Test Project",
            "video_uri": "test-video-uri.mp4",
            "script_title": "Test Script",
            "duration": 120,
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=payload,
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "share_id" in data, "Missing 'share_id' field"
        assert len(data["share_id"]) > 0, "share_id should not be empty"
        
        print(f"✓ Share link created: {data['share_id']}")
        return data["share_id"]

    def test_get_share_page_html(self):
        """GET /api/tapes/share/{share_id} returns the share page (HTML or JSON)"""
        # First create a share
        create_payload = {
            "actor_name": "Share Test Actor",
            "role_name": "Share Test Role",
            "video_uri": "test-video.mp4",
            "user_id": TEST_USER_ID
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=create_payload,
            timeout=15
        )
        assert create_response.status_code == 200
        share_id = create_response.json()["share_id"]
        
        # Now get the share
        response = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "share_id" in data, "Missing share_id in response"
        assert "watermark" in data, "Missing watermark field (crash safety audit requirement)"
        
        print(f"✓ Share page retrieved: {share_id}, watermark: {data['watermark'][:30]}...")


class TestScriptAPIs:
    """Tests for Script CRUD endpoints"""
    
    def test_create_script(self):
        """POST /api/scripts creates a script from raw text"""
        payload = {
            "title": "Test Script Crash Audit",
            "raw_text": "JOHN: Hello there.\nMARY: Hi John, how are you?",
            "user_id": TEST_USER_ID
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json=payload,
            timeout=30  # AI parsing may take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Missing 'id' field"
        assert data["title"] == payload["title"], "Title mismatch"
        
        print(f"✓ Script created: {data['id']}")
        return data["id"]

    def test_get_scripts_list(self):
        """GET /api/scripts returns list of scripts"""
        response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": TEST_USER_ID},
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be an array"
        
        print(f"✓ Got {len(data)} scripts")


class TestUserAPIs:
    """Tests for User endpoints"""
    
    def test_create_or_get_user(self):
        """POST /api/users creates or gets a user"""
        payload = {
            "device_id": f"TEST_device_{int(time.time())}",
            "name": "Test User"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/users",
            json=payload,
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Missing 'id' field"
        assert "device_id" in data, "Missing 'device_id' field"
        
        print(f"✓ User created/retrieved: {data['id']}")


class TestSubscriptionAPIs:
    """Tests for Subscription endpoints"""
    
    def test_get_subscription_plans(self):
        """GET /api/subscription/plans returns subscription plans"""
        response = requests.get(f"{BASE_URL}/api/subscription/plans", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "plans" in data, "Missing 'plans' field"
        assert "monthly" in data["plans"], "Missing monthly plan"
        assert "yearly" in data["plans"], "Missing yearly plan"
        
        print(f"✓ Subscription plans: monthly=${data['plans']['monthly']['price']}, yearly=${data['plans']['yearly']['price']}")


class TestVoiceStudioAPIs:
    """Tests for Voice Studio endpoints"""
    
    def test_process_audio_without_file_returns_error(self):
        """POST /api/voice-studio/process returns error gracefully if no audio provided"""
        # Send request without audio file
        response = requests.post(
            f"{BASE_URL}/api/voice-studio/process",
            data={"operation": "normalize"},
            timeout=15
        )
        
        # Should return 422 (validation error) for missing required file
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print(f"✓ Voice studio correctly returns error when no audio provided")


class TestVoicesPresetAPIs:
    """Tests for Voice Presets endpoints"""
    
    def test_get_voice_presets(self):
        """GET /api/voices/presets returns voice list"""
        response = requests.get(f"{BASE_URL}/api/voices/presets", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "voices" in data, "Missing 'voices' field"
        assert isinstance(data["voices"], list), "voices should be an array"
        assert len(data["voices"]) > 0, "voices array should not be empty"
        
        print(f"✓ Got {len(data['voices'])} voice presets")


class TestDailyDrillFeedbackErrorHandling:
    """Specific error handling tests for daily-drill/feedback endpoint"""
    
    def test_feedback_with_empty_body_returns_validation_error(self):
        """POST /api/daily-drill/test/feedback with empty body returns validation error"""
        user_id = "TEST_empty_feedback"
        
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/feedback",
            json={},  # Empty body
            timeout=15
        )
        
        # Should return 422 for missing required fields
        assert response.status_code == 422, f"Expected 422, got {response.status_code}: {response.text}"
        print(f"✓ Empty body correctly returns 422 validation error")

    def test_feedback_with_partial_data(self):
        """POST /api/daily-drill/test/feedback with partial data"""
        user_id = f"TEST_partial_{int(time.time())}"
        
        # Only provide drill_prompt, missing challenge_type
        payload = {
            "drill_prompt": "Test prompt"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/feedback",
            json=payload,
            timeout=15
        )
        
        # Should return 422 for missing required field
        assert response.status_code == 422, f"Expected 422, got {response.status_code}"
        print(f"✓ Partial data correctly returns 422 validation error")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
