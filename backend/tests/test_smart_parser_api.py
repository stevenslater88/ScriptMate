"""
Backend API tests for Smart Script Parser V2 feature
Tests: POST /api/scripts, PUT /api/scripts/{id}, GET /api/scripts/{id}
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://android-upload-test.preview.emergentagent.com')

# Test data
TEST_DEVICE_ID = f"TEST_parser_device_{uuid.uuid4().hex[:8]}"
TEST_SCRIPT_TITLE = "TEST_Smart_Parser_Script"
TEST_SCRIPT_TEXT = """SARAH
I can't believe you're leaving tomorrow.

MIKE
I have to. The job starts Monday.

(Sarah turns away, looking out the window)

SARAH
You could have said no.

MIKE
And then what? Stay here and watch everything fall apart?

SARAH
At least we'd be together.

MIKE
Sometimes love isn't enough, Sarah.

(Long pause)

SARAH
Then I guess this is goodbye."""


class TestSmartParserAPI:
    """Test backend APIs for Smart Script Parser V2 feature"""
    
    created_script_id = None
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup - create user first"""
        # Create test user
        response = requests.post(f"{BASE_URL}/api/users", json={
            "device_id": TEST_DEVICE_ID
        })
        assert response.status_code in [200, 201], f"Failed to create user: {response.text}"
    
    def test_01_create_script(self):
        """Test POST /api/scripts - creates script with parsed characters"""
        response = requests.post(f"{BASE_URL}/api/scripts", json={
            "title": TEST_SCRIPT_TITLE,
            "raw_text": TEST_SCRIPT_TEXT,
            "user_id": TEST_DEVICE_ID
        })
        
        assert response.status_code in [200, 201], f"Failed to create script: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain script id"
        assert data["title"] == TEST_SCRIPT_TITLE, "Title should match"
        assert "characters" in data, "Response should contain characters"
        assert len(data["characters"]) >= 2, f"Should detect at least 2 characters (SARAH, MIKE), got {len(data['characters'])}"
        
        # Verify character names
        char_names = [c["name"] for c in data["characters"]]
        assert any("SARAH" in name.upper() for name in char_names), f"SARAH should be detected, got {char_names}"
        assert any("MIKE" in name.upper() for name in char_names), f"MIKE should be detected, got {char_names}"
        
        # Store script ID for subsequent tests
        TestSmartParserAPI.created_script_id = data["id"]
        print(f"Created script with ID: {data['id']}")
    
    def test_02_get_script(self):
        """Test GET /api/scripts/{id} - returns script with characters"""
        if not TestSmartParserAPI.created_script_id:
            pytest.skip("No script created in previous test")
        
        script_id = TestSmartParserAPI.created_script_id
        response = requests.get(f"{BASE_URL}/api/scripts/{script_id}")
        
        assert response.status_code == 200, f"Failed to get script: {response.text}"
        
        data = response.json()
        assert data["id"] == script_id, "Script ID should match"
        assert data["title"] == TEST_SCRIPT_TITLE, "Title should match"
        assert "characters" in data, "Response should contain characters"
        assert "lines" in data, "Response should contain lines"
        assert "raw_text" in data, "Response should contain raw_text"
        
        print(f"Script has {len(data['characters'])} characters and {len(data['lines'])} lines")
    
    def test_03_update_script_user_character(self):
        """Test PUT /api/scripts/{id} - updates user_character field"""
        if not TestSmartParserAPI.created_script_id:
            pytest.skip("No script created in previous test")
        
        script_id = TestSmartParserAPI.created_script_id
        
        # First get the script to know character names
        get_response = requests.get(f"{BASE_URL}/api/scripts/{script_id}")
        assert get_response.status_code == 200
        script_data = get_response.json()
        
        # Get first character name to set as user_character
        if script_data["characters"]:
            user_char_name = script_data["characters"][0]["name"]
        else:
            user_char_name = "SARAH"
        
        # Update user_character
        response = requests.put(f"{BASE_URL}/api/scripts/{script_id}", json={
            "user_character": user_char_name
        })
        
        assert response.status_code == 200, f"Failed to update script: {response.text}"
        
        data = response.json()
        assert "characters" in data, "Response should contain characters"
        
        # Verify user_character was set
        user_chars = [c for c in data["characters"] if c.get("is_user_character")]
        assert len(user_chars) == 1, f"Exactly one character should be marked as user_character, got {len(user_chars)}"
        assert user_chars[0]["name"] == user_char_name, f"User character name should be {user_char_name}"
        
        print(f"Set user_character to: {user_char_name}")
    
    def test_04_update_script_title(self):
        """Test PUT /api/scripts/{id} - updates title field"""
        if not TestSmartParserAPI.created_script_id:
            pytest.skip("No script created in previous test")
        
        script_id = TestSmartParserAPI.created_script_id
        new_title = "TEST_Updated_Parser_Script"
        
        response = requests.put(f"{BASE_URL}/api/scripts/{script_id}", json={
            "title": new_title
        })
        
        assert response.status_code == 200, f"Failed to update script title: {response.text}"
        
        data = response.json()
        assert data["title"] == new_title, f"Title should be updated to {new_title}"
        
        # Verify persistence
        get_response = requests.get(f"{BASE_URL}/api/scripts/{script_id}")
        assert get_response.status_code == 200
        assert get_response.json()["title"] == new_title, "Title change should persist"
        
        print(f"Updated title to: {new_title}")
    
    def test_05_get_script_not_found(self):
        """Test GET /api/scripts/{id} - 404 for non-existent script"""
        fake_id = f"fake-{uuid.uuid4().hex}"
        response = requests.get(f"{BASE_URL}/api/scripts/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404 for non-existent script, got {response.status_code}"
    
    def test_06_update_script_not_found(self):
        """Test PUT /api/scripts/{id} - 404 for non-existent script"""
        fake_id = f"fake-{uuid.uuid4().hex}"
        response = requests.put(f"{BASE_URL}/api/scripts/{fake_id}", json={
            "title": "Should Fail"
        })
        
        assert response.status_code == 404, f"Expected 404 for non-existent script, got {response.status_code}"
    
    def test_07_delete_test_script(self):
        """Cleanup - delete the test script"""
        if not TestSmartParserAPI.created_script_id:
            pytest.skip("No script to delete")
        
        script_id = TestSmartParserAPI.created_script_id
        response = requests.delete(f"{BASE_URL}/api/scripts/{script_id}")
        
        assert response.status_code == 200, f"Failed to delete script: {response.text}"
        
        # Verify deletion
        get_response = requests.get(f"{BASE_URL}/api/scripts/{script_id}")
        assert get_response.status_code == 404, "Deleted script should return 404"
        
        print(f"Deleted test script: {script_id}")


class TestScriptParsing:
    """Test script parsing accuracy"""
    
    def test_parse_simple_dialogue(self):
        """Test parsing a simple two-character dialogue"""
        simple_script = """JACK
Hello there.

SARAH
Hi Jack!"""
        
        response = requests.post(f"{BASE_URL}/api/scripts", json={
            "title": "TEST_Simple_Dialogue",
            "raw_text": simple_script,
            "user_id": TEST_DEVICE_ID
        })
        
        assert response.status_code in [200, 201], f"Failed: {response.text}"
        data = response.json()
        
        # Verify characters detected
        char_names = [c["name"].upper() for c in data["characters"]]
        assert "JACK" in char_names or any("JACK" in n for n in char_names), f"JACK should be detected, got {char_names}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{data['id']}")
    
    def test_parse_with_parentheticals(self):
        """Test parsing script with parentheticals/stage directions"""
        script_with_parens = """MIKE
(nervously)
I don't know what to say.

(He looks away)

SARAH
(softly)
It's okay."""
        
        response = requests.post(f"{BASE_URL}/api/scripts", json={
            "title": "TEST_Parentheticals",
            "raw_text": script_with_parens,
            "user_id": TEST_DEVICE_ID
        })
        
        assert response.status_code in [200, 201], f"Failed: {response.text}"
        data = response.json()
        
        # Should have at least 2 characters
        assert len(data["characters"]) >= 2, f"Should detect 2 characters, got {len(data['characters'])}"
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{data['id']}")
    
    def test_parse_empty_script(self):
        """Test parsing empty script text"""
        response = requests.post(f"{BASE_URL}/api/scripts", json={
            "title": "TEST_Empty_Script",
            "raw_text": "",
            "user_id": TEST_DEVICE_ID
        })
        
        # Should either fail or create with no characters
        if response.status_code in [200, 201]:
            data = response.json()
            # Cleanup
            requests.delete(f"{BASE_URL}/api/scripts/{data['id']}")
        # If it fails, that's also acceptable behavior
        print(f"Empty script response: {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
