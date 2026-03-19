"""
Iteration 19: Scene Partner Feature - Backend Regression Tests
Tests backend APIs remain functional after Scene Partner frontend addition.
Scene Partner is a frontend-only feature using expo-speech for TTS.
"""
import pytest
import requests
import os
import uuid
from datetime import datetime

# Get BASE_URL from environment
BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8001').rstrip('/')
TEST_PREFIX = f"TEST_scenePartner_{uuid.uuid4().hex[:8]}"

class TestHealthEndpoint:
    """Health check - most basic test"""
    
    def test_health_returns_200(self):
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"
        print("✓ Health endpoint returns 200 with healthy status")


class TestScriptsAPIRegression:
    """Regression tests for Scripts API - critical for Scene Partner"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data"""
        self.user_id = f"{TEST_PREFIX}_user"
        self.script_id = None
        yield
        # Cleanup
        if self.script_id:
            try:
                requests.delete(f"{BASE_URL}/api/scripts/{self.script_id}")
            except:
                pass
    
    def test_post_scripts_creates_with_characters(self):
        """POST /api/scripts - creates script and extracts characters"""
        script_text = """ALICE
Hi, how are you today?

BOB
I'm doing well, thanks for asking!

ALICE
That's great to hear."""
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "Scene Partner Regression Test",
                "raw_text": script_text,
                "user_id": self.user_id
            }
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        
        # Store for cleanup
        self.script_id = data.get("id")
        
        # Verify script structure
        assert "id" in data, "Response should contain script ID"
        assert "characters" in data, "Response should contain characters array"
        assert "lines" in data, "Response should contain lines array"
        
        # Verify characters extraction (critical for Scene Partner character selection)
        characters = data.get("characters", [])
        char_names = [c.get("name") for c in characters]
        assert "ALICE" in char_names, "Should extract character ALICE"
        assert "BOB" in char_names, "Should extract character BOB"
        
        # Verify line_count in characters (displayed in Scene Partner setup)
        alice_char = next((c for c in characters if c.get("name") == "ALICE"), None)
        assert alice_char is not None, "ALICE character should exist"
        assert alice_char.get("line_count", 0) >= 1, "ALICE should have at least 1 line"
        
        print(f"✓ POST /api/scripts creates script with {len(characters)} characters extracted")
    
    def test_get_scripts_returns_user_scripts(self):
        """GET /api/scripts?user_id=X - returns scripts for scene partner navigation"""
        # First create a script
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "Get Scripts Test",
                "raw_text": "CHAR1\nLine one\n\nCHAR2\nLine two",
                "user_id": self.user_id
            }
        )
        assert response.status_code == 200
        self.script_id = response.json().get("id")
        
        # Get scripts list
        list_response = requests.get(f"{BASE_URL}/api/scripts?user_id={self.user_id}")
        assert list_response.status_code == 200
        
        scripts = list_response.json()
        assert isinstance(scripts, list), "Response should be a list"
        assert len(scripts) >= 1, "Should have at least 1 script"
        
        # Verify script contains fields needed for Scene Partner
        script = scripts[0]
        assert "id" in script, "Script should have id"
        assert "title" in script, "Script should have title"
        assert "characters" in script, "Script should have characters"
        
        print(f"✓ GET /api/scripts returns {len(scripts)} scripts with required fields")
    
    def test_get_script_by_id_returns_full_detail(self):
        """GET /api/scripts/{id} - returns full script for Scene Partner rehearsal"""
        # First create a script
        script_text = """PROTAGONIST
This is my first line in the scene.

ANTAGONIST
And this is my response to you.

(Stage direction: They face each other)

PROTAGONIST
Then I shall respond with this!"""
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "Full Detail Test",
                "raw_text": script_text,
                "user_id": self.user_id
            }
        )
        assert response.status_code == 200
        self.script_id = response.json().get("id")
        
        # Get full script detail
        detail_response = requests.get(f"{BASE_URL}/api/scripts/{self.script_id}")
        assert detail_response.status_code == 200
        
        script = detail_response.json()
        
        # Verify all fields needed by Scene Partner
        assert "id" in script, "Script should have id"
        assert "title" in script, "Script should have title"
        assert "characters" in script, "Script should have characters"
        assert "lines" in script, "Script should have lines"
        
        # Verify lines have required fields for Scene Partner queue building
        lines = script.get("lines", [])
        assert len(lines) >= 3, "Should have at least 3 lines"
        
        for line in lines:
            assert "character" in line, "Line should have character field"
            assert "text" in line, "Line should have text field"
            assert "is_stage_direction" in line, "Line should have is_stage_direction field"
        
        # Verify stage directions are properly flagged (Scene Partner filters these)
        stage_directions = [l for l in lines if l.get("is_stage_direction")]
        dialogue_lines = [l for l in lines if not l.get("is_stage_direction")]
        
        print(f"✓ GET /api/scripts/{{id}} returns {len(dialogue_lines)} dialogue lines, {len(stage_directions)} stage directions")


class TestDailyDrillAPIRegression:
    """Regression tests for Daily Drill API"""
    
    def test_get_daily_drill_returns_drill(self):
        """GET /api/daily-drill/{userId} - still works after Scene Partner added"""
        user_id = f"{TEST_PREFIX}_drill_user"
        
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert "id" in data, "Drill should have id"
        assert "challenge_type" in data, "Drill should have challenge_type"
        assert "prompt" in data, "Drill should have prompt"
        assert "xp_reward" in data, "Drill should have xp_reward"
        
        print(f"✓ GET /api/daily-drill returns drill with type: {data.get('challenge_type')}")


class TestScriptCharacterExtraction:
    """Tests specific to Scene Partner's character selection feature"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.user_id = f"{TEST_PREFIX}_char_test"
        self.script_ids = []
        yield
        for sid in self.script_ids:
            try:
                requests.delete(f"{BASE_URL}/api/scripts/{sid}")
            except:
                pass
    
    def test_multi_character_script_extraction(self):
        """Verify extraction of multiple characters for selection"""
        script_text = """DETECTIVE SMITH
Where were you on the night of the murder?

SUSPECT JONES
I was at home, I swear!

WITNESS BROWN
I can confirm that. I saw him there.

DETECTIVE SMITH
And what time was this?

WITNESS BROWN
Around 9 PM.

SUSPECT JONES
Yes, exactly! 9 PM!"""
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "Multi Character Test",
                "raw_text": script_text,
                "user_id": self.user_id
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        self.script_ids.append(data.get("id"))
        
        characters = data.get("characters", [])
        assert len(characters) == 3, f"Should have 3 characters, got {len(characters)}"
        
        # Verify line counts are correct
        char_dict = {c["name"]: c["line_count"] for c in characters}
        assert char_dict.get("DETECTIVE SMITH", 0) == 2, "DETECTIVE SMITH should have 2 lines"
        assert char_dict.get("SUSPECT JONES", 0) == 2, "SUSPECT JONES should have 2 lines"
        assert char_dict.get("WITNESS BROWN", 0) == 2, "WITNESS BROWN should have 2 lines"
        
        print(f"✓ Multi-character extraction: {len(characters)} characters with correct line counts")
    
    def test_script_with_stage_directions_filtered(self):
        """Verify stage directions are properly flagged (Scene Partner filters these)"""
        script_text = """ROMEO
O, she doth teach the torches to burn bright!

(He gazes at Juliet across the room)

JULIET
What man art thou that thus bescreen'd in night?

[Stage Direction: She moves to the balcony]

ROMEO
By a name I know not how to tell thee who I am."""
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json={
                "title": "Stage Direction Test",
                "raw_text": script_text,
                "user_id": self.user_id
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        self.script_ids.append(data.get("id"))
        
        lines = data.get("lines", [])
        dialogue_lines = [l for l in lines if not l.get("is_stage_direction")]
        stage_directions = [l for l in lines if l.get("is_stage_direction")]
        
        assert len(dialogue_lines) >= 3, "Should have at least 3 dialogue lines"
        assert len(stage_directions) >= 1, "Should have at least 1 stage direction"
        
        print(f"✓ Stage direction filtering: {len(dialogue_lines)} dialogue, {len(stage_directions)} directions")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
