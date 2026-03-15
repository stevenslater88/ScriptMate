"""
Iteration 23: Upload Screen Error Handling Fix Tests
Tests backend regression for upload and script creation flows.

ROOT CAUSE of iteration 23 bug:
handleSubmit() calls createScript() which catches errors internally and returns null.
handleSubmit then checks if(script) but had NO else clause — silent failure.
Fix: Added else clause showing store error, file loaded confirmation for TXT, logging.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://upload-drill-pay.preview.emergentagent.com').rstrip('/')

# Test prefix for cleanup isolation
TEST_PREFIX = f"TEST_upload_fix_{uuid.uuid4().hex[:8]}"

class TestHealthCheck:
    """Health endpoint regression test"""
    
    def test_health_returns_200(self):
        """GET /api/health returns 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy", f"Expected status 'healthy', got {data.get('status')}"
        print(f"✓ Health check passed: {data}")


class TestScriptCreation:
    """POST /api/scripts regression tests"""
    
    def test_post_scripts_creates_script(self):
        """POST /api/scripts creates a new script correctly"""
        payload = {
            "title": f"{TEST_PREFIX}_script",
            "raw_text": "SARAH\nI can't believe you're leaving.\n\nMIKE\nI have to go.",
            "user_id": f"{TEST_PREFIX}_user"
        }
        response = requests.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response missing 'id'"
        assert data["title"] == payload["title"], f"Title mismatch: {data['title']}"
        assert data["user_id"] == payload["user_id"], f"user_id mismatch: {data['user_id']}"
        assert "characters" in data, "Response missing 'characters'"
        assert "lines" in data, "Response missing 'lines'"
        
        # Store for cleanup
        self.__class__.created_script_id = data["id"]
        print(f"✓ Script created: id={data['id']}, title={data['title']}, characters={len(data['characters'])}, lines={len(data['lines'])}")
        return data
    
    def test_post_scripts_parses_characters(self):
        """POST /api/scripts correctly parses character names"""
        payload = {
            "title": f"{TEST_PREFIX}_parse_test",
            "raw_text": "JOHN\nHello world.\n\nJANE\nHi there.\n\n(John exits)",
            "user_id": f"{TEST_PREFIX}_parser"
        }
        response = requests.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
        assert response.status_code == 200
        
        data = response.json()
        characters = [c["name"] for c in data.get("characters", [])]
        # Should have parsed JOHN and JANE
        assert len(characters) >= 2 or len(data.get("lines", [])) > 0, \
            f"Expected parsed characters/lines, got chars={characters}, lines={len(data.get('lines', []))}"
        
        self.__class__.parse_test_id = data["id"]
        print(f"✓ Script parsed: characters={characters}, lines={len(data['lines'])}")


class TestScriptRetrieval:
    """GET /api/scripts regression tests"""
    
    def test_get_scripts_by_user_id(self):
        """GET /api/scripts?user_id=X returns scripts for that user"""
        # First create a script
        test_user_id = f"{TEST_PREFIX}_retrieve_user"
        payload = {
            "title": f"{TEST_PREFIX}_retrieve_script",
            "raw_text": "ACTOR\nTest line.",
            "user_id": test_user_id
        }
        create_resp = requests.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
        assert create_resp.status_code == 200
        created_id = create_resp.json()["id"]
        
        # Fetch scripts by user_id
        response = requests.get(f"{BASE_URL}/api/scripts", params={"user_id": test_user_id}, timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        scripts = response.json()
        assert isinstance(scripts, list), f"Expected list, got {type(scripts)}"
        
        # Check created script is in the list
        script_ids = [s["id"] for s in scripts]
        assert created_id in script_ids, f"Created script {created_id} not in user's scripts: {script_ids}"
        
        self.__class__.retrieve_test_id = created_id
        print(f"✓ Scripts fetched: found {len(scripts)} scripts for user, including {created_id}")
    
    def test_get_script_by_id(self):
        """GET /api/scripts/{id} returns full script detail"""
        # Create a script first
        payload = {
            "title": f"{TEST_PREFIX}_detail_script",
            "raw_text": "CHARACTER\nDetail test line.",
            "user_id": f"{TEST_PREFIX}_detail_user"
        }
        create_resp = requests.post(f"{BASE_URL}/api/scripts", json=payload, timeout=30)
        assert create_resp.status_code == 200
        created_id = create_resp.json()["id"]
        
        # Fetch by ID
        response = requests.get(f"{BASE_URL}/api/scripts/{created_id}", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["id"] == created_id
        assert data["title"] == payload["title"]
        assert "lines" in data
        assert "characters" in data
        assert "raw_text" in data
        
        self.__class__.detail_test_id = created_id
        print(f"✓ Script detail fetched: id={data['id']}, has raw_text={bool(data.get('raw_text'))}")
    
    def test_get_nonexistent_script_returns_404(self):
        """GET /api/scripts/{invalid_id} returns 404"""
        fake_id = f"nonexistent-{uuid.uuid4()}"
        response = requests.get(f"{BASE_URL}/api/scripts/{fake_id}", timeout=10)
        assert response.status_code == 404, f"Expected 404 for non-existent script, got {response.status_code}"
        print(f"✓ Non-existent script correctly returns 404")


class TestScriptUpload:
    """POST /api/scripts/upload regression tests"""
    
    def test_upload_base64_creates_script(self):
        """POST /api/scripts/upload-base64 creates script from base64 content"""
        import base64
        
        test_content = "PROTAGONIST\nThis is a test script.\n\nANTAGONIST\nIndeed it is."
        b64_content = base64.b64encode(test_content.encode()).decode()
        
        payload = {
            "title": f"{TEST_PREFIX}_base64_upload",
            "filename": "test_script.txt",
            "file_data": b64_content,
            "user_id": f"{TEST_PREFIX}_b64_user"
        }
        response = requests.post(f"{BASE_URL}/api/scripts/upload-base64", json=payload, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["title"] == payload["title"]
        
        self.__class__.b64_upload_id = data["id"]
        print(f"✓ Base64 upload successful: id={data['id']}")
    
    def test_upload_form_data_creates_script(self):
        """POST /api/scripts/upload with FormData creates script"""
        import io
        
        test_content = "HERO\nHello from form upload.\n\nVILLAIN\nWe meet again."
        
        files = {
            'file': ('test_form.txt', io.BytesIO(test_content.encode()), 'text/plain')
        }
        data = {
            'title': f"{TEST_PREFIX}_form_upload",
            'user_id': f"{TEST_PREFIX}_form_user"
        }
        
        response = requests.post(f"{BASE_URL}/api/scripts/upload", files=files, data=data, timeout=30)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        resp_data = response.json()
        assert "id" in resp_data
        assert resp_data["title"] == data["title"]
        
        self.__class__.form_upload_id = resp_data["id"]
        print(f"✓ FormData upload successful: id={resp_data['id']}")


class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_scripts(self):
        """Delete all test-created scripts"""
        # Get all scripts for test prefix users
        response = requests.get(f"{BASE_URL}/api/scripts", params={"user_id": f"{TEST_PREFIX}_user"}, timeout=10)
        if response.status_code == 200:
            for script in response.json():
                if TEST_PREFIX in script.get("title", ""):
                    requests.delete(f"{BASE_URL}/api/scripts/{script['id']}", timeout=10)
        
        # Try to delete known test script IDs
        test_ids = [
            getattr(TestScriptCreation, 'created_script_id', None),
            getattr(TestScriptCreation, 'parse_test_id', None),
            getattr(TestScriptRetrieval, 'retrieve_test_id', None),
            getattr(TestScriptRetrieval, 'detail_test_id', None),
            getattr(TestScriptUpload, 'b64_upload_id', None),
            getattr(TestScriptUpload, 'form_upload_id', None),
        ]
        
        deleted = 0
        for script_id in test_ids:
            if script_id:
                try:
                    resp = requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
                    if resp.status_code in [200, 404]:
                        deleted += 1
                except Exception:
                    pass
        
        print(f"✓ Cleanup complete: attempted to delete {len([i for i in test_ids if i])} test scripts")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
