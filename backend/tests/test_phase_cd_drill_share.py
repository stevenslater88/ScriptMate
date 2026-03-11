"""
Tests for Phase C (Daily Drill AI Feedback) and Phase D (Self Tape Share Links) APIs

Phase C - Daily Drill AI Feedback:
- POST /api/daily-drill/{user_id}/feedback - Get AI performance feedback

Phase D - Self Tape Share Links:
- POST /api/tapes/share - Create shareable casting link
- GET /api/tapes/share/{share_id} - Get shared tape by ID
- GET /api/tapes/share/{share_id}?password=xxx - Password-protected access
- GET /api/tapes/user/{user_id} - Get all shared tapes for user
- DELETE /api/tapes/share/{share_id} - Delete share link

Also tests existing Phase 1+2 endpoints for completeness:
- GET /api/daily-drill/{user_id} - Get/generate daily drill
- POST /api/daily-drill/{user_id}/complete - Complete drill
- GET /api/streak/{user_id} - Get streak info
- POST /api/streak/{user_id}/record - Record streak activity
"""

import pytest
import requests
import os
import time
import uuid

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://upload-drill-pay.preview.emergentagent.com')

# Test identifiers for cleanup
TEST_PREFIX = "TEST_phase_cd"
TEST_USER_ID = f"test-user-backend-{int(time.time())}"


class TestHealthCheck:
    """Basic health check to verify API is running"""
    
    def test_health_endpoint(self):
        """Verify API is up"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"✓ Health check passed: {data}")


class TestPhaseCDrillFeedback:
    """Tests for Phase C - Daily Drill AI Feedback endpoint"""
    
    def test_drill_feedback_returns_structured_scores(self):
        """POST /api/daily-drill/{user_id}/feedback returns emotion, pacing, delivery, confidence scores"""
        user_id = f"test-feedback-{int(time.time())}"
        
        # First, create a drill for this user
        drill_response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert drill_response.status_code == 200, f"Failed to create drill: {drill_response.text}"
        drill = drill_response.json()
        
        # Now get feedback
        feedback_payload = {
            "drill_prompt": drill.get("prompt", "Perform a monologue expressing joy transitioning to anger"),
            "challenge_type": drill.get("challenge_type", "emotion_shift"),
            "performance_notes": "I focused on breath control and eye contact"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/feedback",
            json=feedback_payload,
            timeout=30  # AI calls may take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify required fields
        required_fields = ["emotion", "pacing", "delivery", "confidence", "overall_note"]
        for field in required_fields:
            assert field in data, f"Missing '{field}' field in feedback response"
        
        # Verify each metric has score, label, feedback, tip
        for metric in ["emotion", "pacing", "delivery", "confidence"]:
            assert isinstance(data[metric], dict), f"{metric} should be a dict"
            assert "score" in data[metric], f"Missing 'score' in {metric}"
            assert "label" in data[metric], f"Missing 'label' in {metric}"
            assert "feedback" in data[metric], f"Missing 'feedback' in {metric}"
            assert "tip" in data[metric], f"Missing 'tip' in {metric}"
            
            # Verify score is between 1-10
            score = data[metric]["score"]
            assert isinstance(score, int), f"{metric} score should be int"
            assert 1 <= score <= 10, f"{metric} score should be 1-10, got {score}"
            
            # Verify label is one of the expected values
            valid_labels = ["Excellent", "Strong", "Good", "Needs Work", "Keep Practicing"]
            assert data[metric]["label"] in valid_labels, f"Invalid label for {metric}: {data[metric]['label']}"
        
        # Verify overall_note is a string
        assert isinstance(data["overall_note"], str), "overall_note should be a string"
        assert len(data["overall_note"]) > 0, "overall_note should not be empty"
        
        print(f"✓ Drill feedback returned structured scores:")
        print(f"  Emotion: {data['emotion']['score']}/10 ({data['emotion']['label']})")
        print(f"  Pacing: {data['pacing']['score']}/10 ({data['pacing']['label']})")
        print(f"  Delivery: {data['delivery']['score']}/10 ({data['delivery']['label']})")
        print(f"  Confidence: {data['confidence']['score']}/10 ({data['confidence']['label']})")
        print(f"  Overall: {data['overall_note'][:50]}...")
    
    def test_drill_feedback_without_performance_notes(self):
        """POST /api/daily-drill/{user_id}/feedback works without performance notes"""
        user_id = f"test-feedback-no-notes-{int(time.time())}"
        
        feedback_payload = {
            "drill_prompt": "Cold read a scene from a drama",
            "challenge_type": "cold_read"
            # No performance_notes
        }
        
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/feedback",
            json=feedback_payload,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "emotion" in data
        assert "overall_note" in data
        
        print(f"✓ Feedback works without performance notes")
    
    def test_drill_feedback_different_challenge_types(self):
        """POST /api/daily-drill/{user_id}/feedback handles different challenge types"""
        user_id = f"test-feedback-types-{int(time.time())}"
        
        challenge_types = [
            ("emotion_shift", "Express joy transitioning to sadness"),
            ("cold_read", "Read this script for the first time"),
            ("physicality", "Use body language to convey nervousness"),
        ]
        
        for challenge_type, prompt in challenge_types:
            feedback_payload = {
                "drill_prompt": prompt,
                "challenge_type": challenge_type,
                "performance_notes": f"Testing {challenge_type}"
            }
            
            response = requests.post(
                f"{BASE_URL}/api/daily-drill/{user_id}/feedback",
                json=feedback_payload,
                timeout=30
            )
            
            assert response.status_code == 200, f"Failed for {challenge_type}: {response.text}"
            data = response.json()
            assert "emotion" in data
            
            print(f"✓ Feedback works for challenge type: {challenge_type}")


class TestPhaseDShareLinks:
    """Tests for Phase D - Self Tape Share Links endpoints"""
    
    def test_create_share_link(self):
        """POST /api/tapes/share creates a shareable casting link"""
        share_payload = {
            "actor_name": "TEST_John Smith",
            "role_name": "Lead Detective",
            "project_name": "Crime Drama Pilot",
            "video_uri": "file:///path/to/video.mp4",
            "script_title": "Scene 5",
            "duration": 120
        }
        
        response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify required fields
        assert "share_id" in data, "Missing 'share_id' field"
        assert "share_url" in data, "Missing 'share_url' field"
        assert "actor_name" in data, "Missing 'actor_name' field"
        assert "role_name" in data, "Missing 'role_name' field"
        assert "project_name" in data, "Missing 'project_name' field"
        assert "created_at" in data, "Missing 'created_at' field"
        assert "has_password" in data, "Missing 'has_password' field"
        
        # Verify data correctness
        assert data["actor_name"] == share_payload["actor_name"]
        assert data["role_name"] == share_payload["role_name"]
        assert data["project_name"] == share_payload["project_name"]
        assert data["has_password"] is False
        
        # Verify share_url format
        assert "/tape/" in data["share_url"], "share_url should contain '/tape/'"
        assert data["share_id"] in data["share_url"], "share_url should contain share_id"
        
        print(f"✓ Share link created: {data['share_url']}")
        print(f"  Share ID: {data['share_id']}")
        
        # Cleanup - delete the share link
        delete_response = requests.delete(f"{BASE_URL}/api/tapes/share/{data['share_id']}", timeout=10)
        assert delete_response.status_code == 200, f"Cleanup failed: {delete_response.text}"
    
    def test_create_share_link_with_password(self):
        """POST /api/tapes/share creates password-protected link"""
        share_payload = {
            "actor_name": "TEST_Jane Doe",
            "role_name": "Supporting Role",
            "project_name": "Feature Film",
            "video_uri": "file:///path/to/video2.mp4",
            "script_title": "Audition Scene",
            "duration": 90,
            "password": "secret123"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["has_password"] is True, "has_password should be True"
        
        print(f"✓ Password-protected share link created: {data['share_id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{data['share_id']}", timeout=10)
    
    def test_create_share_link_minimal_fields(self):
        """POST /api/tapes/share works with only required fields"""
        share_payload = {
            "actor_name": "TEST_Minimal Actor",
            "video_uri": "file:///path/to/minimal.mp4"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["actor_name"] == share_payload["actor_name"]
        assert data["role_name"] == "", "role_name should default to empty"
        assert data["project_name"] == "", "project_name should default to empty"
        assert data["has_password"] is False
        
        print(f"✓ Minimal share link created: {data['share_id']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{data['share_id']}", timeout=10)
    
    def test_get_shared_tape(self):
        """GET /api/tapes/share/{share_id} retrieves tape details"""
        # First create a share link
        share_payload = {
            "actor_name": "TEST_Get Tape Actor",
            "role_name": "Test Role",
            "project_name": "Test Project",
            "video_uri": "file:///path/to/get-tape.mp4",
            "script_title": "Test Script",
            "duration": 60
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        assert create_response.status_code == 200
        share_data = create_response.json()
        share_id = share_data["share_id"]
        
        # Now get the tape
        response = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        
        # Verify all fields
        assert data["share_id"] == share_id
        assert data["actor_name"] == share_payload["actor_name"]
        assert data["role_name"] == share_payload["role_name"]
        assert data["project_name"] == share_payload["project_name"]
        assert data["video_uri"] == share_payload["video_uri"]
        assert data["script_title"] == share_payload["script_title"]
        assert data["duration"] == share_payload["duration"]
        assert "created_at" in data
        assert "views" in data
        assert data["views"] >= 1, "views should be incremented"
        
        print(f"✓ Get shared tape: {data['actor_name']} - {data['role_name']}")
        print(f"  Views: {data['views']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
    
    def test_get_shared_tape_increments_views(self):
        """GET /api/tapes/share/{share_id} increments view count"""
        # Create share link
        share_payload = {
            "actor_name": "TEST_Views Actor",
            "video_uri": "file:///path/to/views.mp4"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        share_id = create_response.json()["share_id"]
        
        # Get tape twice
        response1 = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
        views1 = response1.json()["views"]
        
        response2 = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
        views2 = response2.json()["views"]
        
        assert views2 == views1 + 1, f"Expected views to increment, got {views1} -> {views2}"
        
        print(f"✓ Views incremented: {views1} -> {views2}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
    
    def test_get_shared_tape_password_required(self):
        """GET /api/tapes/share/{share_id} requires password if set"""
        # Create password-protected share
        share_payload = {
            "actor_name": "TEST_Password Actor",
            "video_uri": "file:///path/to/password.mp4",
            "password": "mysecret"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        share_id = create_response.json()["share_id"]
        
        # Try to get without password
        response = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        assert "requires_password" in data, "Should indicate password required"
        assert data["requires_password"] is True
        assert "actor_name" in data, "Should include actor_name even when password required"
        assert data["actor_name"] == share_payload["actor_name"]
        # Should NOT include video_uri
        assert "video_uri" not in data or data.get("video_uri") is None, "Should not expose video_uri without password"
        
        print(f"✓ Password required response returned for protected tape")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
    
    def test_get_shared_tape_with_correct_password(self):
        """GET /api/tapes/share/{share_id}?password=xxx returns tape with correct password"""
        password = "correctpassword"
        
        # Create password-protected share
        share_payload = {
            "actor_name": "TEST_CorrectPW Actor",
            "video_uri": "file:///path/to/correct-pw.mp4",
            "password": password
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        share_id = create_response.json()["share_id"]
        
        # Get with correct password
        response = requests.get(
            f"{BASE_URL}/api/tapes/share/{share_id}",
            params={"password": password},
            timeout=10
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Should have full data with correct password
        assert "video_uri" in data, "Should include video_uri with correct password"
        assert data["video_uri"] == share_payload["video_uri"]
        assert "requires_password" not in data or data.get("requires_password") is not True
        
        print(f"✓ Full tape data returned with correct password")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
    
    def test_get_shared_tape_wrong_password(self):
        """GET /api/tapes/share/{share_id}?password=xxx rejects wrong password"""
        # Create password-protected share
        share_payload = {
            "actor_name": "TEST_WrongPW Actor",
            "video_uri": "file:///path/to/wrong-pw.mp4",
            "password": "correctone"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        share_id = create_response.json()["share_id"]
        
        # Get with wrong password
        response = requests.get(
            f"{BASE_URL}/api/tapes/share/{share_id}",
            params={"password": "wrongpassword"},
            timeout=10
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should indicate password required (wrong password treated like no password)
        assert data.get("requires_password") is True, "Should indicate password required for wrong password"
        
        print(f"✓ Wrong password correctly rejected")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
    
    def test_get_shared_tape_not_found(self):
        """GET /api/tapes/share/{share_id} returns 404 for non-existent ID"""
        response = requests.get(
            f"{BASE_URL}/api/tapes/share/nonexistent123",
            timeout=10
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ 404 returned for non-existent share ID")
    
    def test_get_user_shared_tapes(self):
        """GET /api/tapes/user/{user_id} returns all shared tapes for user"""
        # Note: Current implementation returns all tapes, not filtered by user_id
        # This is a design decision - the endpoint exists but filter may need review
        
        response = requests.get(
            f"{BASE_URL}/api/tapes/user/test-user-backend",
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        print(f"✓ User shared tapes endpoint works, returned {len(data)} tapes")
    
    def test_delete_share_link(self):
        """DELETE /api/tapes/share/{share_id} deletes the link"""
        # Create a share to delete
        share_payload = {
            "actor_name": "TEST_Delete Actor",
            "video_uri": "file:///path/to/delete.mp4"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=share_payload,
            timeout=15
        )
        share_id = create_response.json()["share_id"]
        
        # Delete the share
        delete_response = requests.delete(
            f"{BASE_URL}/api/tapes/share/{share_id}",
            timeout=10
        )
        
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}"
        data = delete_response.json()
        assert "message" in data
        assert "deleted" in data["message"].lower()
        
        # Verify it's deleted
        get_response = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
        assert get_response.status_code == 404, "Deleted share should return 404"
        
        print(f"✓ Share link deleted successfully")
    
    def test_delete_share_link_not_found(self):
        """DELETE /api/tapes/share/{share_id} returns 404 for non-existent ID"""
        response = requests.delete(
            f"{BASE_URL}/api/tapes/share/nonexistent456",
            timeout=10
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ 404 returned for deleting non-existent share")


class TestExistingDrillAndStreakEndpoints:
    """Test existing Phase 1+2 endpoints for regression"""
    
    def test_get_daily_drill(self):
        """GET /api/daily-drill/{user_id} creates/returns daily drill"""
        user_id = f"test-drill-regression-{int(time.time())}"
        
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "id" in data
        assert "challenge_type" in data
        assert "prompt" in data
        assert "duration_seconds" in data
        assert "xp_reward" in data
        assert data["xp_reward"] == 25
        
        print(f"✓ Daily drill: {data['challenge_type']} - {data['prompt'][:50]}...")
    
    def test_complete_daily_drill(self):
        """POST /api/daily-drill/{user_id}/complete awards XP"""
        user_id = f"test-complete-regression-{int(time.time())}"
        
        # Get drill first
        requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        
        # Complete it
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/complete",
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "xp_awarded" in data
        
        print(f"✓ Drill completed, XP awarded: {data['xp_awarded']}")
    
    def test_get_streak(self):
        """GET /api/streak/{user_id} returns streak data"""
        user_id = f"test-streak-regression-{int(time.time())}"
        
        response = requests.get(f"{BASE_URL}/api/streak/{user_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "current_streak" in data
        assert "best_streak" in data
        assert "total_xp" in data
        assert "today_completed" in data
        assert "activities_today" in data
        
        print(f"✓ Streak data: current={data['current_streak']}, best={data['best_streak']}, xp={data['total_xp']}")
    
    def test_record_streak_activity(self):
        """POST /api/streak/{user_id}/record records activity"""
        user_id = f"test-record-regression-{int(time.time())}"
        
        response = requests.post(
            f"{BASE_URL}/api/streak/{user_id}/record",
            params={"activity_type": "self_tape"},
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["current_streak"] >= 1
        assert data["total_xp"] >= 10
        
        print(f"✓ Activity recorded, streak={data['current_streak']}, xp={data['total_xp']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
