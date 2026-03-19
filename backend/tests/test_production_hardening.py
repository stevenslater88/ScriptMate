"""
Production Hardening Backend Tests - Iteration 13
Focus: XSS protection, error sanitization, share page functionality, validation errors
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthEndpoints:
    """Basic health and info endpoints"""
    
    def test_health_returns_200(self):
        """GET /api/health returns 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        print("✓ GET /api/health returns 200 with healthy status")


class TestDailyDrillEndpoints:
    """Daily drill endpoints testing"""
    
    def test_get_daily_drill_returns_all_fields(self):
        """GET /api/daily-drill/{user_id} returns drill with all fields"""
        response = requests.get(f"{BASE_URL}/api/daily-drill/TEST_prod_user_001")
        assert response.status_code == 200
        data = response.json()
        # Check all required fields exist
        assert "id" in data
        assert "prompt" in data
        assert "challenge_type" in data
        assert "xp_reward" in data
        print(f"✓ Daily drill has all fields: id={data['id'][:8]}..., challenge_type={data['challenge_type']}")
    
    def test_complete_drill_marks_complete(self):
        """POST /api/daily-drill/{user_id}/complete marks drill complete"""
        response = requests.post(f"{BASE_URL}/api/daily-drill/TEST_prod_user_001/complete")
        assert response.status_code == 200
        data = response.json()
        assert "xp_awarded" in data
        assert "message" in data  # Response includes message field
        print(f"✓ Drill complete: xp_awarded={data['xp_awarded']}")
    
    def test_drill_feedback_returns_structured(self):
        """POST /api/daily-drill/{user_id}/feedback returns structured feedback"""
        # Correct payload format for DrillFeedbackRequest
        payload = {
            "drill_prompt": "Deliver the line: 'I can't believe you did this!'",
            "challenge_type": "emotion",
            "performance_notes": "I delivered the line with passion and conviction, making sure to pause for dramatic effect."
        }
        response = requests.post(
            f"{BASE_URL}/api/daily-drill/TEST_prod_user_001/feedback",
            json=payload
        )
        assert response.status_code == 200
        data = response.json()
        # Check structured feedback fields
        assert "emotion" in data
        assert "pacing" in data
        assert "delivery" in data
        assert "confidence" in data
        assert "overall_note" in data
        print(f"✓ Feedback structured: confidence={data.get('confidence', {})}")


class TestStreakEndpoint:
    """Streak tracking endpoint"""
    
    def test_get_streak_returns_data(self):
        """GET /api/streak/{user_id} returns streak data"""
        response = requests.get(f"{BASE_URL}/api/streak/TEST_prod_user_001")
        assert response.status_code == 200
        data = response.json()
        assert "current_streak" in data
        assert "best_streak" in data
        assert "total_xp" in data
        assert "today_completed" in data
        print(f"✓ Streak data: current={data['current_streak']}, best={data['best_streak']}")


class TestActingCoachEndpoints:
    """Acting coach AI analysis endpoints"""
    
    def test_analyze_returns_success(self):
        """POST /api/acting-coach/analyze returns success:true with analysis"""
        # Correct payload format for ActingCoachRequest
        payload = {
            "scene_title": "Test Scene",
            "scene_context": "A dramatic confrontation between two characters",
            "emotion": "anger",
            "style": "naturalistic",
            "energy": 7,
            "user_id": "TEST_prod_user_001"
        }
        response = requests.post(f"{BASE_URL}/api/acting-coach/analyze", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") == True
        assert "analysis" in data
        print("✓ Acting coach analyze returns success:true")
    
    def test_analyze_empty_body_returns_422(self):
        """POST /api/acting-coach/analyze with empty body returns 422 (not raw error)"""
        response = requests.post(f"{BASE_URL}/api/acting-coach/analyze", json={})
        assert response.status_code == 422
        data = response.json()
        # Verify it's a Pydantic validation error, not raw exception
        assert "detail" in data
        # Check that detail is not a raw Python exception string
        detail_str = str(data["detail"])
        assert "Traceback" not in detail_str
        assert "Exception" not in detail_str or "ValidationError" in detail_str or "value_error" in detail_str.lower()
        print("✓ Empty body returns 422 with validation error (not raw exception)")
    
    def test_get_scenes_returns_list(self):
        """GET /api/acting-coach/scenes returns scenes"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/scenes")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "scenes" in data
        print(f"✓ Scenes endpoint returns data")
    
    def test_get_history_returns_array(self):
        """GET /api/acting-coach/history/{user_id} returns array"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/history/TEST_prod_user_001")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "attempts" in data
        print("✓ History endpoint returns array")


class TestDialectEndpoints:
    """Dialect coach endpoints"""
    
    def test_get_accents_returns_list(self):
        """GET /api/dialect/accents returns list"""
        response = requests.get(f"{BASE_URL}/api/dialect/accents")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "accents" in data
        accents = data if isinstance(data, list) else data.get("accents", [])
        assert len(accents) > 0
        print(f"✓ Accents: {len(accents)} accents available")
    
    def test_get_sample_lines_returns_lines(self):
        """GET /api/dialect/sample-lines returns lines"""
        response = requests.get(f"{BASE_URL}/api/dialect/sample-lines")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "lines" in data
        lines = data if isinstance(data, list) else data.get("lines", [])
        assert len(lines) > 0
        print(f"✓ Sample lines: {len(lines)} lines available")


class TestTapeShareEndpoints:
    """Self tape sharing endpoints with XSS protection testing"""
    
    @pytest.fixture
    def created_share(self):
        """Create a test share for other tests"""
        payload = {
            "actor_name": "Test Actor",
            "role_name": "Lead Role",
            "project_name": "Test Film",
            "video_uri": "https://example.com/test.mp4",
            "user_id": "TEST_prod_user_001"
        }
        response = requests.post(f"{BASE_URL}/api/tapes/share", json=payload)
        assert response.status_code == 200
        return response.json()
    
    def test_create_share_link(self):
        """POST /api/tapes/share creates share link"""
        payload = {
            "actor_name": "Normal Actor Name",
            "role_name": "Test Role",
            "project_name": "Test Project",
            "video_uri": "https://example.com/video.mp4",
            "user_id": "TEST_prod_user_001"
        }
        response = requests.post(f"{BASE_URL}/api/tapes/share", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "share_id" in data
        assert "share_url" in data
        print(f"✓ Created share link: {data['share_id']}")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/tapes/share/{data['share_id']}")
    
    def test_get_shared_tape_increments_views(self):
        """GET /api/tapes/share/{share_id} returns tape data with view count incremented"""
        # Create share first
        payload = {
            "actor_name": "View Test Actor",
            "video_uri": "https://example.com/view_test.mp4",
            "user_id": "TEST_prod_user_001"
        }
        create_resp = requests.post(f"{BASE_URL}/api/tapes/share", json=payload)
        share_id = create_resp.json()["share_id"]
        
        # Get twice and check view increment
        resp1 = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}")
        assert resp1.status_code == 200
        views1 = resp1.json().get("views", 0)
        
        resp2 = requests.get(f"{BASE_URL}/api/tapes/share/{share_id}")
        views2 = resp2.json().get("views", 0)
        
        assert views2 > views1
        print(f"✓ Views incremented: {views1} -> {views2}")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}")
    
    def test_html_share_page_xss_protection(self):
        """GET /api/tape/{actor_slug}/{share_id} returns HTML with XSS-safe content"""
        # Create share with XSS payload in actor_name
        xss_payload = "<script>alert(1)</script>"
        payload = {
            "actor_name": xss_payload,
            "role_name": "Role <img src=x onerror=alert(2)>",
            "project_name": "Project\"><script>alert(3)</script>",
            "video_uri": "https://example.com/xss_test.mp4",
            "user_id": "TEST_prod_user_001"
        }
        create_resp = requests.post(f"{BASE_URL}/api/tapes/share", json=payload)
        assert create_resp.status_code == 200
        share_id = create_resp.json()["share_id"]
        
        # Get the HTML page - use any slug, as the lookup is by share_id
        html_resp = requests.get(f"{BASE_URL}/api/tape/test/{share_id}")
        assert html_resp.status_code == 200
        html_content = html_resp.text
        
        # CRITICAL: Verify XSS is escaped
        # The raw <script> tag should NOT appear - it should be &lt;script&gt;
        assert "<script>alert(1)</script>" not in html_content, "SECURITY: Unescaped XSS in actor_name!"
        
        # Verify the <img onerror= payload is escaped - check there's no actual <img tag with onerror
        # The string "onerror" may appear as TEXT content (safe) but not as HTML attribute (dangerous)
        assert "<img src=x onerror" not in html_content, "SECURITY: Unescaped XSS img tag!"
        
        # Verify escaped versions ARE present (HTML entities)
        assert "&lt;script&gt;" in html_content, "XSS should be HTML-escaped"
        assert "&lt;img" in html_content, "img tag should be HTML-escaped"
        
        print("✓ XSS payloads properly HTML-escaped in share page")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}")
    
    def test_html_share_page_404(self):
        """GET /api/tape/fake/fake returns 404 HTML"""
        response = requests.get(f"{BASE_URL}/api/tape/fake-actor/fakeshareid")
        assert response.status_code == 404
        assert "expired" in response.text.lower() or "doesn't exist" in response.text.lower()
        print("✓ Non-existent share returns 404 with appropriate message")
    
    def test_html_share_page_missing_video_shows_unavailable(self):
        """SHARE PAGE: verify missing video_uri shows 'Video unavailable' message"""
        # Create share without video_uri (empty string)
        payload = {
            "actor_name": "No Video Actor",
            "video_uri": "",
            "user_id": "TEST_prod_user_001"
        }
        create_resp = requests.post(f"{BASE_URL}/api/tapes/share", json=payload)
        assert create_resp.status_code == 200
        share_id = create_resp.json()["share_id"]
        actor_slug = create_resp.json()["share_url"].split("/")[2]
        
        # Get the HTML page
        html_resp = requests.get(f"{BASE_URL}/api/tape/{actor_slug}/{share_id}")
        assert html_resp.status_code == 200
        html_content = html_resp.text
        
        # Check for "Video unavailable" message
        assert "Video unavailable" in html_content, "Missing video should show 'Video unavailable'"
        print("✓ Missing video_uri shows 'Video unavailable' message")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}")


class TestScriptEndpoints:
    """Script management endpoints"""
    
    def test_create_script(self):
        """POST /api/scripts creates script"""
        payload = {
            "title": "TEST_Production Test Script",
            "raw_text": "JOHN: Hello, world.\nJANE: Hi there!",
            "user_id": "TEST_prod_user_001"
        }
        response = requests.post(f"{BASE_URL}/api/scripts", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["title"] == payload["title"]
        print(f"✓ Created script: {data['id'][:8]}...")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/scripts/{data['id']}")
    
    def test_get_scripts_returns_list(self):
        """GET /api/scripts returns list"""
        response = requests.get(f"{BASE_URL}/api/scripts?user_id=TEST_prod_user_001")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Scripts list: {len(data)} scripts")


class TestUserEndpoints:
    """User management endpoints"""
    
    def test_create_or_get_user(self):
        """POST /api/users creates/gets user"""
        payload = {
            "device_id": "TEST_device_prod_001",
            "name": "Test Production User"
        }
        response = requests.post(f"{BASE_URL}/api/users", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["device_id"] == payload["device_id"]
        print(f"✓ User created/retrieved: {data['id'][:8]}...")


class TestSubscriptionEndpoints:
    """Subscription and plans endpoints"""
    
    def test_get_subscription_plans(self):
        """GET /api/subscription/plans returns plans"""
        response = requests.get(f"{BASE_URL}/api/subscription/plans")
        assert response.status_code == 200
        data = response.json()
        assert "plans" in data
        assert "monthly" in data["plans"] or "yearly" in data["plans"]
        print("✓ Subscription plans returned")


class TestVoiceStudioValidation:
    """Voice studio endpoints - validation error testing (422 not raw errors)"""
    
    def test_process_without_file_returns_422(self):
        """POST /api/voice-studio/process without file returns 422 (not raw error)"""
        # Send without required file
        response = requests.post(f"{BASE_URL}/api/voice-studio/process", data={"operation": "trim"})
        assert response.status_code == 422
        data = response.json()
        # Should be a validation error, not raw exception
        detail_str = str(data.get("detail", ""))
        assert "Traceback" not in detail_str
        print("✓ voice-studio/process without file returns 422")
    
    def test_demo_reel_without_files_returns_422(self):
        """POST /api/voice-studio/demo-reel without files returns 422 (not raw error)"""
        response = requests.post(f"{BASE_URL}/api/voice-studio/demo-reel", data={"gaps": "0.5"})
        assert response.status_code == 422
        data = response.json()
        detail_str = str(data.get("detail", ""))
        assert "Traceback" not in detail_str
        print("✓ voice-studio/demo-reel without files returns 422")


class TestVoicesEndpoint:
    """Voice presets endpoint"""
    
    def test_get_presets_returns_list(self):
        """GET /api/voices/presets returns list"""
        response = requests.get(f"{BASE_URL}/api/voices/presets")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "voices" in data or "presets" in data
        print("✓ Voice presets returned")


class TestErrorSanitization:
    """SECURITY: Verify 500 errors return sanitized messages, not raw exceptions"""
    
    def test_scripts_create_error_sanitized(self):
        """Scripts endpoint errors should be sanitized"""
        # Send malformed data to try to trigger an error
        # The endpoint should catch exceptions and return friendly messages
        response = requests.post(f"{BASE_URL}/api/scripts", json={
            "title": "T",  # Very short title
            "raw_text": "",  # Empty text
            "user_id": "TEST_error_check"
        })
        # Whether 200 or error, response should not contain Python tracebacks
        response_text = response.text
        assert "Traceback" not in response_text
        assert "File \"/" not in response_text  # No file paths
        print(f"✓ Scripts endpoint response sanitized (status: {response.status_code})")
    
    def test_auth_sync_error_sanitized(self):
        """Auth/sync endpoints should return sanitized errors"""
        # Test sync/push with invalid user
        response = requests.post(f"{BASE_URL}/api/sync/push", json={
            "user_id": "nonexistent_user_12345"
        })
        # Should get 404 or error, but not raw exception
        response_text = response.text
        assert "Traceback" not in response_text
        assert "Exception:" not in response_text or "detail" in response.json()
        print(f"✓ Sync endpoint error sanitized (status: {response.status_code})")
    
    def test_acting_coach_invalid_data_sanitized(self):
        """Acting coach with partial data should return clean error"""
        response = requests.post(f"{BASE_URL}/api/acting-coach/analyze", json={
            "scene_title": "",  # Empty required field
        })
        # Should get 422 validation error, not raw exception
        assert response.status_code == 422
        data = response.json()
        detail_str = str(data)
        assert "Traceback" not in detail_str
        print("✓ Acting coach validation error sanitized")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_data(self):
        """Clean up TEST_ prefixed data"""
        # Get and delete test scripts
        scripts = requests.get(f"{BASE_URL}/api/scripts?user_id=TEST_prod_user_001").json()
        deleted_count = 0
        for script in scripts:
            if "TEST_" in script.get("title", ""):
                requests.delete(f"{BASE_URL}/api/scripts/{script['id']}")
                deleted_count += 1
        print(f"✓ Cleaned up {deleted_count} test scripts")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
