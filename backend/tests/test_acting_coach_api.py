"""
Acting Coach API Tests
Tests for AI-powered acting performance coaching feature
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://android-upload-test.preview.emergentagent.com').rstrip('/')


class TestActingCoachScenes:
    """Tests for /api/acting-coach/scenes endpoint"""
    
    def test_get_scenes_returns_200(self):
        """GET /api/acting-coach/scenes returns 200 status"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/scenes")
        assert response.status_code == 200
        print(f"✅ GET /api/acting-coach/scenes returned 200")
    
    def test_get_scenes_returns_12_scenes(self):
        """GET /api/acting-coach/scenes returns exactly 12 scenes"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/scenes")
        data = response.json()
        assert "scenes" in data
        assert len(data["scenes"]) == 12
        print(f"✅ Scenes endpoint returns 12 scenes")
    
    def test_scenes_have_required_fields(self):
        """Each scene has title, context, genre fields"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/scenes")
        data = response.json()
        
        for scene in data["scenes"]:
            assert "title" in scene, f"Scene missing 'title' field"
            assert "context" in scene, f"Scene missing 'context' field"
            assert "genre" in scene, f"Scene missing 'genre' field"
            # Validate non-empty
            assert len(scene["title"]) > 0
            assert len(scene["context"]) > 0
            assert len(scene["genre"]) > 0
        print(f"✅ All scenes have required fields: title, context, genre")
    
    def test_scenes_have_expected_genres(self):
        """Scenes include various genres"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/scenes")
        data = response.json()
        genres = {s["genre"] for s in data["scenes"]}
        
        # Should have at least Drama and a few others
        assert "Drama" in genres
        print(f"✅ Scenes include genres: {genres}")


class TestActingCoachAnalyze:
    """Tests for /api/acting-coach/analyze endpoint"""
    
    def test_analyze_returns_200_with_valid_data(self):
        """POST /api/acting-coach/analyze returns 200 with valid request"""
        payload = {
            "scene_title": "The Breakup",
            "scene_context": "Ending a long relationship",
            "emotion": "emotional",
            "style": "dramatic",
            "energy": 7
        }
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 200
        print(f"✅ POST /api/acting-coach/analyze returned 200")
    
    def test_analyze_returns_required_fields(self):
        """Analyze response contains all required coaching fields"""
        payload = {
            "scene_title": "The Confession",
            "scene_context": "Admitting a secret",
            "emotion": "vulnerable",
            "style": "natural_tv",
            "energy": 5
        }
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        data = response.json()
        
        assert data["success"] == True
        assert "analysis" in data
        
        analysis = data["analysis"]
        assert "performance_score" in analysis
        assert "score_label" in analysis
        assert "what_works" in analysis
        assert "improvement_tips" in analysis
        assert "example_delivery" in analysis
        assert "director_note" in analysis
        
        # Validate types
        assert isinstance(analysis["performance_score"], int)
        assert 1 <= analysis["performance_score"] <= 10
        assert isinstance(analysis["what_works"], list)
        assert isinstance(analysis["improvement_tips"], list)
        assert isinstance(analysis["example_delivery"], str)
        assert isinstance(analysis["director_note"], str)
        
        print(f"✅ Analyze returns all required fields with correct types")
    
    def test_analyze_with_all_emotions(self):
        """Analyze endpoint works with all 6 emotions"""
        emotions = ['neutral', 'angry', 'emotional', 'confident', 'nervous', 'vulnerable']
        
        for emotion in emotions:
            payload = {
                "scene_title": "Test Scene",
                "emotion": emotion,
                "style": "natural_tv",
                "energy": 5
            }
            response = requests.post(
                f"{BASE_URL}/api/acting-coach/analyze",
                json=payload
            )
            assert response.status_code == 200, f"Failed for emotion: {emotion}"
        
        print(f"✅ All 6 emotions work: {emotions}")
    
    def test_analyze_with_all_styles(self):
        """Analyze endpoint works with all 4 styles"""
        styles = ['natural_tv', 'dramatic', 'film_subtle', 'social_media']
        
        for style in styles:
            payload = {
                "scene_title": "Test Scene",
                "emotion": "neutral",
                "style": style,
                "energy": 5
            }
            response = requests.post(
                f"{BASE_URL}/api/acting-coach/analyze",
                json=payload
            )
            assert response.status_code == 200, f"Failed for style: {style}"
        
        print(f"✅ All 4 styles work: {styles}")
    
    def test_analyze_energy_range(self):
        """Analyze accepts energy from 1 to 10"""
        for energy in [1, 5, 10]:
            payload = {
                "scene_title": "Test Scene",
                "emotion": "neutral",
                "style": "natural_tv",
                "energy": energy
            }
            response = requests.post(
                f"{BASE_URL}/api/acting-coach/analyze",
                json=payload
            )
            assert response.status_code == 200, f"Failed for energy: {energy}"
        
        print(f"✅ Energy levels 1-10 accepted")
    
    def test_analyze_rejects_invalid_energy(self):
        """Analyze rejects energy outside 1-10 range"""
        payload = {
            "scene_title": "Test Scene",
            "emotion": "neutral",
            "style": "natural_tv",
            "energy": 0  # Invalid
        }
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 422  # Validation error
        
        payload["energy"] = 11  # Invalid
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 422
        
        print(f"✅ Invalid energy values rejected (0, 11)")
    
    def test_analyze_requires_scene_title(self):
        """Analyze requires non-empty scene_title"""
        payload = {
            "scene_title": "",  # Empty
            "emotion": "neutral",
            "style": "natural_tv",
            "energy": 5
        }
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 422
        print(f"✅ Empty scene_title rejected")
    
    def test_analyze_with_optional_user_id(self):
        """Analyze works with and without user_id"""
        # Without user_id
        payload = {
            "scene_title": "Test Scene",
            "emotion": "neutral",
            "style": "natural_tv",
            "energy": 5
        }
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 200
        
        # With user_id
        payload["user_id"] = "test-user-pytest"
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 200
        
        print(f"✅ user_id is optional")


class TestActingCoachHistory:
    """Tests for /api/acting-coach/history/{user_id} endpoint"""
    
    def test_history_returns_200(self):
        """GET /api/acting-coach/history/{user_id} returns 200"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/history/test-user-123")
        assert response.status_code == 200
        print(f"✅ GET /api/acting-coach/history returns 200")
    
    def test_history_returns_expected_structure(self):
        """History response has attempts and total fields"""
        response = requests.get(f"{BASE_URL}/api/acting-coach/history/test-user-123")
        data = response.json()
        
        assert "attempts" in data
        assert "total" in data
        assert isinstance(data["attempts"], list)
        assert isinstance(data["total"], int)
        
        print(f"✅ History returns expected structure")
    
    def test_history_after_analyze(self):
        """History includes attempts after analyze is called"""
        user_id = "TEST_pytest_history_user"
        
        # Create an attempt
        payload = {
            "scene_title": "Test Scene for History",
            "emotion": "confident",
            "style": "dramatic",
            "energy": 8,
            "user_id": user_id
        }
        response = requests.post(
            f"{BASE_URL}/api/acting-coach/analyze",
            json=payload
        )
        assert response.status_code == 200
        
        # Check history
        response = requests.get(f"{BASE_URL}/api/acting-coach/history/{user_id}")
        data = response.json()
        
        assert len(data["attempts"]) >= 1
        latest = data["attempts"][0]
        assert latest["scene_title"] == "Test Scene for History"
        assert latest["emotion"] == "confident"
        assert latest["style"] == "dramatic"
        assert latest["energy"] == 8
        
        print(f"✅ History includes attempts after analyze")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
