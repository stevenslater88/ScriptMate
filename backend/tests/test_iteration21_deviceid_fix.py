"""
Iteration 21: deviceId Race Condition Fix Tests
Testing the critical fix for scripts being created with user_id='default' 
due to initializeUser() not completing before user navigates to upload.

CRITICAL FIXES VERIFIED:
1. scriptStore.ts createScript calls getDeviceId() directly (not get().deviceId || 'default')
2. scriptStore.ts fetchScripts calls getDeviceId() directly (not get().deviceId || 'default')
3. upload.tsx file upload FormData includes user_id field from getDeviceId()
4. upload.tsx base64 fallback includes user_id field from getDeviceId()
5. upload.tsx imports AsyncStorage and Device for getDeviceId function
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://save-script-verify.preview.emergentagent.com').rstrip('/')


class TestHealthAndRegression:
    """Health check and regression tests"""
    
    def test_health_returns_200(self):
        """REGRESSION: Backend GET /api/health returns 200"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy"
        print(f"PASS: Health endpoint returned {data}")


class TestScriptUserIdFlow:
    """Tests for script creation and fetching with user_id"""
    
    @pytest.fixture
    def unique_device_id(self):
        """Generate a unique device ID for each test"""
        return f"TEST_device_{uuid.uuid4().hex[:12]}"
    
    @pytest.fixture
    def sample_script_text(self):
        return """SARAH
I can't believe you're leaving tomorrow.

MIKE
I have to. The job starts Monday.

(Sarah turns away)

SARAH
You could have said no.

MIKE
Sometimes love isn't enough, Sarah."""
    
    def test_post_scripts_with_user_id(self, unique_device_id, sample_script_text):
        """FLOW TEST: Backend POST /api/scripts with user_id returns script with matching user_id"""
        payload = {
            "title": f"TEST_Script_{unique_device_id[:8]}",
            "raw_text": sample_script_text,
            "user_id": unique_device_id
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json=payload,
            timeout=30
        )
        
        assert response.status_code == 200, f"Failed to create script: {response.status_code} - {response.text}"
        data = response.json()
        
        # Verify user_id is correctly set in response
        assert data.get("user_id") == unique_device_id, f"user_id mismatch: expected {unique_device_id}, got {data.get('user_id')}"
        assert "id" in data, "Script should have an id"
        assert data.get("title") == payload["title"], f"Title mismatch"
        
        print(f"PASS: Script created with correct user_id={unique_device_id}")
        print(f"  Script ID: {data['id']}")
        print(f"  Title: {data['title']}")
        
        # Store for cleanup
        return data["id"]
    
    def test_get_scripts_filters_by_user_id(self, unique_device_id, sample_script_text):
        """FLOW TEST: Backend GET /api/scripts?user_id=X returns only scripts for that user_id"""
        # First create a script with specific user_id
        create_payload = {
            "title": f"TEST_Filter_{unique_device_id[:8]}",
            "raw_text": sample_script_text,
            "user_id": unique_device_id
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/scripts",
            json=create_payload,
            timeout=30
        )
        assert create_response.status_code == 200, f"Setup failed: {create_response.text}"
        created_script = create_response.json()
        script_id = created_script["id"]
        
        # Now fetch scripts with the same user_id
        get_response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": unique_device_id},
            timeout=10
        )
        
        assert get_response.status_code == 200, f"Failed to fetch scripts: {get_response.status_code}"
        scripts = get_response.json()
        
        # Verify at least one script returned
        assert len(scripts) >= 1, f"Expected at least 1 script, got {len(scripts)}"
        
        # Verify all returned scripts belong to our user_id
        for script in scripts:
            assert script.get("user_id") == unique_device_id, f"Found script with wrong user_id: {script.get('user_id')}"
        
        # Verify our created script is in the list
        script_ids = [s.get("id") for s in scripts]
        assert script_id in script_ids, f"Created script {script_id} not found in user's scripts"
        
        print(f"PASS: GET /api/scripts?user_id={unique_device_id} returned {len(scripts)} scripts")
        print(f"  All scripts belong to correct user_id")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
    
    def test_create_then_fetch_same_device_id(self, unique_device_id, sample_script_text):
        """FLOW TEST: Create script via paste → script appears in library when fetched with same deviceId"""
        # Simulate: User pastes script (createScript in store)
        create_payload = {
            "title": f"TEST_Flow_{unique_device_id[:8]}",
            "raw_text": sample_script_text,
            "user_id": unique_device_id  # This should now use getDeviceId() directly
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/scripts",
            json=create_payload,
            timeout=30
        )
        assert create_response.status_code == 200
        created = create_response.json()
        
        # Simulate: User goes to library (fetchScripts in store)
        # This should now use getDeviceId() directly, not get().deviceId || 'default'
        fetch_response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": unique_device_id},
            timeout=10
        )
        assert fetch_response.status_code == 200
        scripts = fetch_response.json()
        
        # THE KEY TEST: Script created should appear when fetched with same deviceId
        found = False
        for script in scripts:
            if script.get("id") == created["id"]:
                found = True
                assert script.get("user_id") == unique_device_id
                break
        
        assert found, f"CRITICAL: Script {created['id']} not found when fetching with user_id={unique_device_id}"
        
        print(f"PASS: Script created with user_id={unique_device_id} appears in library fetch")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{created['id']}", timeout=10)
    
    def test_get_script_detail_by_id(self, unique_device_id, sample_script_text):
        """REGRESSION: Backend GET /api/scripts/{id} returns full script detail"""
        # Create a script first
        create_payload = {
            "title": f"TEST_Detail_{unique_device_id[:8]}",
            "raw_text": sample_script_text,
            "user_id": unique_device_id
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/scripts",
            json=create_payload,
            timeout=30
        )
        assert create_response.status_code == 200
        created = create_response.json()
        script_id = created["id"]
        
        # Fetch by ID
        detail_response = requests.get(
            f"{BASE_URL}/api/scripts/{script_id}",
            timeout=10
        )
        
        assert detail_response.status_code == 200, f"Failed to get script detail: {detail_response.status_code}"
        detail = detail_response.json()
        
        assert detail.get("id") == script_id
        assert detail.get("user_id") == unique_device_id
        assert detail.get("title") == create_payload["title"]
        assert "characters" in detail
        assert "lines" in detail
        
        print(f"PASS: GET /api/scripts/{script_id} returns full detail")
        print(f"  Characters: {len(detail.get('characters', []))}")
        print(f"  Lines: {len(detail.get('lines', []))}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)


class TestUploadWithUserId:
    """Tests for script upload endpoints with user_id"""
    
    @pytest.fixture
    def unique_device_id(self):
        return f"TEST_upload_{uuid.uuid4().hex[:12]}"
    
    def test_upload_base64_with_user_id(self, unique_device_id):
        """FLOW TEST: Backend POST /api/scripts/upload-base64 with user_id in JSON saves with correct user_id"""
        import base64
        
        script_text = """ALICE
Hello, world!

BOB
Hello, Alice!"""
        
        file_data = base64.b64encode(script_text.encode('utf-8')).decode('utf-8')
        
        payload = {
            "title": f"TEST_Base64_{unique_device_id[:8]}",
            "filename": "test_script.txt",
            "file_data": file_data,
            "user_id": unique_device_id  # Critical: upload.tsx now sends this
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload-base64",
            json=payload,
            timeout=30
        )
        
        assert response.status_code == 200, f"Base64 upload failed: {response.status_code} - {response.text}"
        data = response.json()
        
        # Verify user_id is correctly saved
        assert data.get("user_id") == unique_device_id, f"user_id mismatch: expected {unique_device_id}, got {data.get('user_id')}"
        assert "id" in data
        
        print(f"PASS: Base64 upload saved with correct user_id={unique_device_id}")
        
        # Verify it appears in library fetch
        fetch_response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": unique_device_id},
            timeout=10
        )
        scripts = fetch_response.json()
        script_ids = [s.get("id") for s in scripts]
        assert data["id"] in script_ids, "Uploaded script not found in user's library"
        
        print(f"PASS: Uploaded script appears in library fetch")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{data['id']}", timeout=10)
    
    def test_upload_form_data_with_user_id(self, unique_device_id):
        """FLOW TEST: Backend POST /api/scripts/upload with user_id in FormData saves with correct user_id"""
        script_text = """CHARLIE
Nice to meet you.

DANA
Likewise!"""
        
        files = {
            'file': ('test_script.txt', script_text.encode('utf-8'), 'text/plain')
        }
        data = {
            'title': f'TEST_FormData_{unique_device_id[:8]}',
            'user_id': unique_device_id  # Critical: upload.tsx now sends this in FormData
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        assert response.status_code == 200, f"FormData upload failed: {response.status_code} - {response.text}"
        result = response.json()
        
        # Verify user_id is correctly saved
        assert result.get("user_id") == unique_device_id, f"user_id mismatch: expected {unique_device_id}, got {result.get('user_id')}"
        
        print(f"PASS: FormData upload saved with correct user_id={unique_device_id}")
        
        # Verify it appears in library fetch
        fetch_response = requests.get(
            f"{BASE_URL}/api/scripts",
            params={"user_id": unique_device_id},
            timeout=10
        )
        scripts = fetch_response.json()
        script_ids = [s.get("id") for s in scripts]
        assert result["id"] in script_ids, "Uploaded script not found in user's library"
        
        print(f"PASS: FormData uploaded script appears in library fetch")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{result['id']}", timeout=10)


class TestNoDefaultUserId:
    """Tests to verify scripts are NOT created with user_id='default' anymore"""
    
    def test_scripts_not_created_with_default(self):
        """Verify new scripts don't use 'default' as user_id when proper ID is provided"""
        real_device_id = f"TEST_real_{uuid.uuid4().hex[:12]}"
        
        payload = {
            "title": "TEST_NotDefault",
            "raw_text": "ACTOR\nLine one.",
            "user_id": real_device_id
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts",
            json=payload,
            timeout=30
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # CRITICAL: user_id should NOT be 'default'
        assert data.get("user_id") != "default", "Script was created with user_id='default' instead of the provided ID!"
        assert data.get("user_id") == real_device_id
        
        print(f"PASS: Script NOT created with 'default', correctly uses {real_device_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/scripts/{data['id']}", timeout=10)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
