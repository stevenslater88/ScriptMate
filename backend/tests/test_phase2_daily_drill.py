"""
Tests for Phase 2 - Daily Drill & Streak System APIs

Tests cover:
- GET /api/daily-drill/{user_id} - Get today's drill challenge
- POST /api/daily-drill/{user_id}/complete - Complete drill and award XP
- GET /api/streak/{user_id} - Get streak data
- POST /api/streak/{user_id}/record - Record activity and update streak
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://device-validation.preview.emergentagent.com')

# Test user prefix for cleanup
TEST_USER_ID = f"test-drill-user-{int(time.time())}"


class TestHealthCheck:
    """Basic health check to verify API is running"""
    
    def test_health_endpoint(self):
        """Verify API is up"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print(f"✓ Health check passed: {data}")


class TestDailyDrillEndpoints:
    """Tests for Daily Drill API endpoints"""
    
    def test_get_daily_drill_creates_new(self):
        """GET /api/daily-drill/{user_id} creates a new drill for a new user"""
        user_id = f"test-new-user-{int(time.time())}"
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify required fields
        assert "id" in data, "Missing 'id' field"
        assert "challenge_type" in data, "Missing 'challenge_type' field"
        assert "title" in data, "Missing 'title' field"
        assert "prompt" in data, "Missing 'prompt' field"
        assert "duration_seconds" in data, "Missing 'duration_seconds' field"
        assert "xp_reward" in data, "Missing 'xp_reward' field"
        assert "date" in data, "Missing 'date' field"
        
        # Verify XP reward is 25
        assert data["xp_reward"] == 25, f"Expected xp_reward=25, got {data['xp_reward']}"
        
        # Verify challenge_type is valid
        valid_types = ["emotion_shift", "cold_read", "physicality", "improv_react", "accent_sprint"]
        assert data["challenge_type"] in valid_types, f"Invalid challenge_type: {data['challenge_type']}"
        
        print(f"✓ Daily drill created: {data['title']} ({data['challenge_type']})")
        print(f"  Prompt: {data['prompt'][:80]}...")
    
    def test_get_daily_drill_returns_same_for_same_day(self):
        """GET /api/daily-drill/{user_id} returns same drill when called twice same day"""
        user_id = f"test-same-day-{int(time.time())}"
        
        # First call
        response1 = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert response1.status_code == 200
        drill1 = response1.json()
        
        # Second call
        response2 = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert response2.status_code == 200
        drill2 = response2.json()
        
        # Verify same drill ID
        assert drill1["id"] == drill2["id"], "Expected same drill ID for same day"
        assert drill1["prompt"] == drill2["prompt"], "Expected same prompt for same day"
        
        print(f"✓ Same drill returned on repeat call: {drill1['id']}")
    
    def test_complete_daily_drill(self):
        """POST /api/daily-drill/{user_id}/complete awards XP"""
        user_id = f"test-complete-{int(time.time())}"
        
        # First get a drill
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert response.status_code == 200
        drill = response.json()
        
        # Complete the drill
        complete_response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/complete",
            timeout=15
        )
        assert complete_response.status_code == 200, f"Expected 200, got {complete_response.status_code}: {complete_response.text}"
        
        complete_data = complete_response.json()
        assert "xp_awarded" in complete_data, "Missing 'xp_awarded' field"
        assert complete_data["xp_awarded"] == 25, f"Expected 25 XP, got {complete_data['xp_awarded']}"
        
        print(f"✓ Drill completed, awarded {complete_data['xp_awarded']} XP")
    
    def test_complete_already_completed_drill(self):
        """POST /api/daily-drill/{user_id}/complete returns 0 XP if already completed"""
        user_id = f"test-double-complete-{int(time.time())}"
        
        # Get and complete drill
        requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        requests.post(f"{BASE_URL}/api/daily-drill/{user_id}/complete", timeout=15)
        
        # Try to complete again
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/complete",
            timeout=15
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data["xp_awarded"] == 0, f"Expected 0 XP for repeat completion, got {data['xp_awarded']}"
        
        print(f"✓ Repeat completion correctly returns 0 XP")
    
    def test_complete_nonexistent_drill_returns_404(self):
        """POST /api/daily-drill/{user_id}/complete returns 404 if no drill exists"""
        user_id = f"test-no-drill-{int(time.time())}"
        
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/{user_id}/complete",
            timeout=15
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ 404 returned for completing non-existent drill")


class TestStreakEndpoints:
    """Tests for Streak API endpoints"""
    
    def test_get_streak_new_user(self):
        """GET /api/streak/{user_id} returns zero values for new user"""
        user_id = f"test-streak-new-{int(time.time())}"
        
        response = requests.get(f"{BASE_URL}/api/streak/{user_id}", timeout=15)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "current_streak" in data, "Missing 'current_streak' field"
        assert "best_streak" in data, "Missing 'best_streak' field"
        assert "total_xp" in data, "Missing 'total_xp' field"
        assert "today_completed" in data, "Missing 'today_completed' field"
        assert "activities_today" in data, "Missing 'activities_today' field"
        
        # New user should have 0 values
        assert data["current_streak"] == 0, f"Expected current_streak=0, got {data['current_streak']}"
        assert data["best_streak"] == 0, f"Expected best_streak=0, got {data['best_streak']}"
        assert data["total_xp"] == 0, f"Expected total_xp=0, got {data['total_xp']}"
        assert data["today_completed"] is False, "Expected today_completed=False"
        
        print(f"✓ New user streak: {data}")
    
    def test_streak_updates_after_drill_completion(self):
        """GET /api/streak/{user_id} reflects XP and streak after drill completion"""
        user_id = f"test-streak-update-{int(time.time())}"
        
        # Complete a drill
        requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        requests.post(f"{BASE_URL}/api/daily-drill/{user_id}/complete", timeout=15)
        
        # Check streak
        response = requests.get(f"{BASE_URL}/api/streak/{user_id}", timeout=15)
        assert response.status_code == 200
        
        data = response.json()
        assert data["current_streak"] >= 1, f"Expected streak >= 1, got {data['current_streak']}"
        assert data["total_xp"] >= 25, f"Expected XP >= 25, got {data['total_xp']}"
        assert data["today_completed"] is True, "Expected today_completed=True"
        assert "daily_drill" in data["activities_today"], "daily_drill should be in activities_today"
        
        print(f"✓ Streak after drill: streak={data['current_streak']}, XP={data['total_xp']}")
    
    def test_record_streak_activity(self):
        """POST /api/streak/{user_id}/record records activity"""
        user_id = f"test-record-activity-{int(time.time())}"
        
        response = requests.post(
            f"{BASE_URL}/api/streak/{user_id}/record",
            params={"activity_type": "acting_coach"},
            timeout=15
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["current_streak"] >= 1, f"Expected streak >= 1, got {data['current_streak']}"
        assert data["total_xp"] >= 10, f"Expected XP >= 10, got {data['total_xp']}"
        
        print(f"✓ Activity recorded: streak={data['current_streak']}, XP={data['total_xp']}")
    
    def test_record_multiple_activities_same_day(self):
        """POST /api/streak/{user_id}/record doesn't double count streak for same day"""
        user_id = f"test-multi-activity-{int(time.time())}"
        
        # Record first activity
        requests.post(
            f"{BASE_URL}/api/streak/{user_id}/record",
            params={"activity_type": "acting_coach"},
            timeout=15
        )
        
        # Record second activity
        response = requests.post(
            f"{BASE_URL}/api/streak/{user_id}/record",
            params={"activity_type": "dialect_coach"},
            timeout=15
        )
        
        data = response.json()
        # Streak should still be 1 (same day)
        assert data["current_streak"] == 1, f"Expected streak=1, got {data['current_streak']}"
        # XP should accumulate
        assert data["total_xp"] >= 20, f"Expected XP >= 20, got {data['total_xp']}"
        
        print(f"✓ Multiple activities same day: streak={data['current_streak']}, XP={data['total_xp']}")


class TestDailyDrillDataValidation:
    """Tests for data validation and edge cases"""
    
    def test_drill_has_valid_duration(self):
        """Drill duration should be positive integer"""
        user_id = f"test-duration-{int(time.time())}"
        
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        data = response.json()
        
        assert isinstance(data["duration_seconds"], int), "duration_seconds should be int"
        assert data["duration_seconds"] > 0, "duration_seconds should be positive"
        
        print(f"✓ Valid duration: {data['duration_seconds']}s")
    
    def test_drill_prompt_is_not_empty(self):
        """Drill prompt should not be empty"""
        user_id = f"test-prompt-{int(time.time())}"
        
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        data = response.json()
        
        assert len(data["prompt"]) > 10, f"Prompt too short: {data['prompt']}"
        
        print(f"✓ Valid prompt: {len(data['prompt'])} chars")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
