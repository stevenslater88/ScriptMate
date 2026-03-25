"""
Phase E: Voice Actor Studio API Tests
Tests for audio processing, demo reel builder, and take metadata CRUD.
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://save-script-verify.preview.emergentagent.com').rstrip('/')

class TestVoiceStudioHealthAndPrerequisites:
    """Verify health endpoint and test prerequisites"""

    def test_health_endpoint(self):
        """Verify API is running"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print("✅ Health check passed")

    def test_audio_files_exist(self):
        """Verify test audio files were created"""
        assert os.path.exists("/tmp/test_audio.wav"), "Test audio file 1 not found"
        assert os.path.exists("/tmp/test_audio2.wav"), "Test audio file 2 not found"
        print("✅ Test audio files exist")


class TestVoiceStudioAudioProcessing:
    """Tests for POST /api/voice-studio/process endpoint"""

    def test_normalize_audio(self):
        """POST /api/voice-studio/process with operation=normalize"""
        with open("/tmp/test_audio.wav", "rb") as f:
            files = {"audio": ("test.wav", f, "audio/wav")}
            data = {"operation": "normalize", "trim_start": "0", "trim_end": "0"}
            response = requests.post(
                f"{BASE_URL}/api/voice-studio/process",
                files=files,
                data=data,
                timeout=30
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "audio_base64" in result, "Missing audio_base64 in response"
        assert result["format"] == "mp3", f"Expected mp3 format, got {result['format']}"
        assert result["operation"] == "normalize"
        assert "original_duration" in result
        assert "new_duration" in result
        assert len(result["audio_base64"]) > 100, "audio_base64 too short"
        print(f"✅ Normalize: original={result['original_duration']}s, new={result['new_duration']}s")

    def test_trim_audio(self):
        """POST /api/voice-studio/process with operation=trim"""
        with open("/tmp/test_audio.wav", "rb") as f:
            files = {"audio": ("test.wav", f, "audio/wav")}
            data = {"operation": "trim", "trim_start": "0.5", "trim_end": "0.5"}
            response = requests.post(
                f"{BASE_URL}/api/voice-studio/process",
                files=files,
                data=data,
                timeout=30
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "audio_base64" in result
        assert result["operation"] == "trim"
        # Original 3 seconds - 0.5 from start - 0.5 from end = ~2 seconds
        assert result["new_duration"] < result["original_duration"], "Trimmed audio should be shorter"
        expected_new_duration = result["original_duration"] - 1.0  # 0.5 + 0.5 trimmed
        assert abs(result["new_duration"] - expected_new_duration) < 0.2, \
            f"Expected ~{expected_new_duration}s, got {result['new_duration']}s"
        print(f"✅ Trim: original={result['original_duration']}s, new={result['new_duration']}s")

    def test_remove_silence(self):
        """POST /api/voice-studio/process with operation=remove_silence"""
        with open("/tmp/test_audio.wav", "rb") as f:
            files = {"audio": ("test.wav", f, "audio/wav")}
            data = {"operation": "remove_silence", "trim_start": "0", "trim_end": "0"}
            response = requests.post(
                f"{BASE_URL}/api/voice-studio/process",
                files=files,
                data=data,
                timeout=30
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "audio_base64" in result
        assert result["operation"] == "remove_silence"
        # Test audio has no silence so duration should be similar
        assert result["new_duration"] > 0, "Duration should be positive"
        print(f"✅ Remove silence: original={result['original_duration']}s, new={result['new_duration']}s")

    def test_all_operations(self):
        """POST /api/voice-studio/process with operation=all (trim+normalize+remove_silence)"""
        with open("/tmp/test_audio.wav", "rb") as f:
            files = {"audio": ("test.wav", f, "audio/wav")}
            data = {"operation": "all", "trim_start": "0.3", "trim_end": "0.3"}
            response = requests.post(
                f"{BASE_URL}/api/voice-studio/process",
                files=files,
                data=data,
                timeout=30
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "audio_base64" in result
        assert result["format"] == "mp3"
        assert result["operation"] == "all"
        assert result["new_duration"] < result["original_duration"], "Processed audio should be shorter"
        print(f"✅ All operations: original={result['original_duration']}s, new={result['new_duration']}s")


class TestVoiceStudioDemoReel:
    """Tests for POST /api/voice-studio/demo-reel endpoint"""

    def test_demo_reel_concatenate(self):
        """POST /api/voice-studio/demo-reel with multiple files"""
        with open("/tmp/test_audio.wav", "rb") as f1, open("/tmp/test_audio2.wav", "rb") as f2:
            files = [
                ("files", ("test1.wav", f1, "audio/wav")),
                ("files", ("test2.wav", f2, "audio/wav")),
            ]
            data = {"gaps": "0.5"}
            response = requests.post(
                f"{BASE_URL}/api/voice-studio/demo-reel",
                files=files,
                data=data,
                timeout=60
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "audio_base64" in result, "Missing audio_base64"
        assert result["format"] == "mp3"
        assert result["segments_count"] == 2, f"Expected 2 segments, got {result['segments_count']}"
        # 3s + 0.5s gap + 2s = ~5.5s
        assert result["duration"] >= 5.0, f"Expected ~5.5s duration, got {result['duration']}s"
        print(f"✅ Demo reel: {result['segments_count']} segments, duration={result['duration']}s")

    def test_demo_reel_with_gaps(self):
        """POST /api/voice-studio/demo-reel with custom gap durations"""
        with open("/tmp/test_audio.wav", "rb") as f1, open("/tmp/test_audio2.wav", "rb") as f2:
            files = [
                ("files", ("test1.wav", f1, "audio/wav")),
                ("files", ("test2.wav", f2, "audio/wav")),
            ]
            data = {"gaps": "1.0"}  # 1 second gap
            response = requests.post(
                f"{BASE_URL}/api/voice-studio/demo-reel",
                files=files,
                data=data,
                timeout=60
            )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "audio_base64" in result
        # 3s + 1s gap + 2s = ~6s
        assert result["duration"] >= 5.5, f"Expected ~6s duration with 1s gap, got {result['duration']}s"
        print(f"✅ Demo reel with 1s gap: duration={result['duration']}s")


class TestVoiceStudioTakesCRUD:
    """Tests for voice take metadata CRUD endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data prefix"""
        import uuid
        self.test_user_id = f"TEST_user_{uuid.uuid4().hex[:8]}"
        self.created_take_ids = []
        yield
        # Cleanup
        for take_id in self.created_take_ids:
            try:
                requests.delete(f"{BASE_URL}/api/voice-studio/takes/{take_id}", timeout=10)
            except:
                pass

    def test_save_take_metadata(self):
        """POST /api/voice-studio/takes - save take metadata"""
        data = {
            "user_id": self.test_user_id,
            "take_name": "TEST_Take 1",
            "duration": 30.5,
            "script_id": "test-script-123"
        }
        response = requests.post(
            f"{BASE_URL}/api/voice-studio/takes",
            data=data,
            timeout=10
        )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "id" in result, "Missing take ID in response"
        assert result["user_id"] == self.test_user_id
        assert result["take_name"] == "TEST_Take 1"
        assert result["duration"] == 30.5
        assert result["script_id"] == "test-script-123"
        assert "created_at" in result
        
        self.created_take_ids.append(result["id"])
        print(f"✅ Save take: id={result['id']}, name={result['take_name']}")

    def test_get_user_takes(self):
        """GET /api/voice-studio/takes/{user_id} - get all takes for user"""
        # First create a take
        data = {
            "user_id": self.test_user_id,
            "take_name": "TEST_Get Take Test",
            "duration": 15.0,
            "script_id": ""
        }
        create_resp = requests.post(f"{BASE_URL}/api/voice-studio/takes", data=data, timeout=10)
        assert create_resp.status_code == 200
        created = create_resp.json()
        self.created_take_ids.append(created["id"])

        # Then get takes for user
        response = requests.get(
            f"{BASE_URL}/api/voice-studio/takes/{self.test_user_id}",
            timeout=10
        )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert "takes" in result
        assert "total" in result
        assert result["total"] >= 1
        
        # Verify the created take is in the list
        take_ids = [t["id"] for t in result["takes"]]
        assert created["id"] in take_ids, "Created take not found in user's takes"
        print(f"✅ Get user takes: total={result['total']}")

    def test_delete_take(self):
        """DELETE /api/voice-studio/takes/{take_id} - delete a take"""
        # First create a take
        data = {
            "user_id": self.test_user_id,
            "take_name": "TEST_Delete Me",
            "duration": 10.0,
            "script_id": ""
        }
        create_resp = requests.post(f"{BASE_URL}/api/voice-studio/takes", data=data, timeout=10)
        assert create_resp.status_code == 200
        created = create_resp.json()
        take_id = created["id"]

        # Delete the take
        response = requests.delete(
            f"{BASE_URL}/api/voice-studio/takes/{take_id}",
            timeout=10
        )

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        result = response.json()
        assert result["message"] == "Take deleted"

        # Verify it's gone
        get_resp = requests.get(f"{BASE_URL}/api/voice-studio/takes/{self.test_user_id}", timeout=10)
        takes = get_resp.json()["takes"]
        take_ids = [t["id"] for t in takes]
        assert take_id not in take_ids, "Take should have been deleted"
        print(f"✅ Delete take: id={take_id} successfully deleted")

    def test_delete_nonexistent_take(self):
        """DELETE /api/voice-studio/takes/{take_id} - 404 for non-existent take"""
        response = requests.delete(
            f"{BASE_URL}/api/voice-studio/takes/nonexistent-take-id-12345",
            timeout=10
        )

        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Delete non-existent take returns 404")


class TestExistingEndpointsNotBroken:
    """Verify existing endpoints from previous phases still work"""

    def test_health_still_works(self):
        """GET /api/health should still work"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
        print("✅ /api/health still works")

    def test_daily_drill_still_works(self):
        """GET /api/daily-drill/{user_id} should still work"""
        response = requests.get(f"{BASE_URL}/api/daily-drill/test-user-regression", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert "challenge_type" in data
        # Daily drill returns 'prompt' field, not 'content'
        assert "prompt" in data or "title" in data or "duration" in data
        print("✅ /api/daily-drill still works")

    def test_share_endpoint_still_works(self):
        """POST /api/tapes/share should still work"""
        data = {
            "actor_name": "TEST_Regression Actor",
            "video_uri": "test://regression-video.mp4",
            "tape_title": "Regression Test Tape"
        }
        response = requests.post(
            f"{BASE_URL}/api/tapes/share",
            json=data,
            timeout=10
        )
        assert response.status_code == 200
        result = response.json()
        assert "share_id" in result
        
        # Clean up
        share_id = result["share_id"]
        requests.delete(f"{BASE_URL}/api/tapes/share/{share_id}", timeout=10)
        print("✅ /api/tapes/share still works")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
