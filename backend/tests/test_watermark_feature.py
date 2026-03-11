"""
Test watermark feature for ScriptM8
Tests: Casting share API watermark field
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://upload-drill-pay.preview.emergentagent.com').rstrip('/')


class TestWatermarkFeature:
    """Watermark feature tests - Phase G"""

    def test_api_health(self):
        """Test API health check works"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("PASS: API health check returns healthy status")

    def test_casting_share_api_returns_watermark(self):
        """Test GET /api/tapes/share/{share_id} returns watermark field"""
        test_share_id = "92c6929d"  # Test share ID provided
        response = requests.get(f"{BASE_URL}/api/tapes/share/{test_share_id}")
        
        # Check status code
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Check data
        data = response.json()
        assert "watermark" in data, "Watermark field missing from response"
        
        # Verify watermark text
        expected_watermark = "Recorded with ScriptM8 · AI Training Studio for Actors"
        assert data["watermark"] == expected_watermark, f"Watermark text mismatch: {data['watermark']}"
        
        print(f"PASS: Casting share API returns watermark: '{data['watermark']}'")

    def test_casting_share_api_returns_required_fields(self):
        """Test casting share API returns all expected fields including watermark"""
        test_share_id = "92c6929d"
        response = requests.get(f"{BASE_URL}/api/tapes/share/{test_share_id}")
        
        assert response.status_code == 200
        data = response.json()
        
        # Check all expected fields
        expected_fields = ["share_id", "actor_name", "role_name", "project_name", 
                         "video_uri", "duration", "created_at", "watermark"]
        
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        print(f"PASS: All expected fields present including watermark")

    def test_casting_share_not_found(self):
        """Test non-existent share returns 404"""
        response = requests.get(f"{BASE_URL}/api/tapes/share/nonexistent123")
        assert response.status_code == 404
        print("PASS: Non-existent share returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
