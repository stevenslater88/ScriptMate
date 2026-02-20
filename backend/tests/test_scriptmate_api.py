"""
ScriptMate Backend API Tests
Tests for: health, scripts, users, subscriptions, rehearsals, analytics endpoints
"""
import pytest
import requests
import os
import uuid

# Base URL from environment - ScriptMate app API
BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://audition-hub-2.preview.emergentagent.com').rstrip('/')

# Test data prefix for cleanup
TEST_PREFIX = "TEST_"


class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_check_returns_healthy(self):
        """Verify /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        
        # Status assertion
        assert response.status_code == 200, f"Health endpoint failed: {response.text}"
        
        # Data assertions
        data = response.json()
        assert "status" in data, "Response missing 'status' field"
        assert data["status"] == "healthy", f"Expected healthy status, got: {data['status']}"
        assert "timestamp" in data, "Response missing 'timestamp' field"
        print(f"✅ Health check passed: {data}")


class TestScriptsEndpoint:
    """Scripts CRUD endpoint tests"""
    
    def test_get_scripts_returns_array(self):
        """Verify /api/scripts returns an array (can be empty)"""
        response = requests.get(f"{BASE_URL}/api/scripts")
        
        # Status assertion
        assert response.status_code == 200, f"Scripts endpoint failed: {response.text}"
        
        # Data assertions
        data = response.json()
        assert isinstance(data, list), f"Expected array, got: {type(data)}"
        print(f"✅ Scripts endpoint returns array with {len(data)} items")
    
    def test_get_scripts_with_user_id(self):
        """Verify /api/scripts accepts user_id parameter"""
        test_user_id = f"{TEST_PREFIX}user_{uuid.uuid4().hex[:8]}"
        response = requests.get(f"{BASE_URL}/api/scripts", params={"user_id": test_user_id})
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list), "Expected array response"
        print(f"✅ Scripts endpoint with user_id filter works: {len(data)} scripts")
    
    def test_create_script_and_verify_persistence(self):
        """Create a script and verify it's persisted"""
        test_user_id = f"{TEST_PREFIX}user_{uuid.uuid4().hex[:8]}"
        
        # Create script
        create_payload = {
            "title": f"{TEST_PREFIX}Script_Test_{uuid.uuid4().hex[:6]}",
            "raw_text": "JOHN\nHello, how are you?\n\nJANE\nI'm doing well, thanks!",
            "user_id": test_user_id
        }
        
        create_response = requests.post(f"{BASE_URL}/api/scripts", json=create_payload)
        
        # Status assertion
        assert create_response.status_code == 200, f"Create script failed: {create_response.text}"
        
        # Data assertions
        script = create_response.json()
        assert "id" in script, "Created script missing 'id'"
        assert script["title"] == create_payload["title"], "Title mismatch"
        assert "characters" in script, "Script missing 'characters'"
        assert "lines" in script, "Script missing 'lines'"
        
        script_id = script["id"]
        print(f"✅ Script created: {script_id}")
        
        # Verify GET returns the created script
        get_response = requests.get(f"{BASE_URL}/api/scripts/{script_id}")
        assert get_response.status_code == 200, f"Get script failed: {get_response.text}"
        
        fetched_script = get_response.json()
        assert fetched_script["id"] == script_id, "Script ID mismatch"
        assert fetched_script["title"] == create_payload["title"], "Title mismatch on GET"
        print(f"✅ Script verified via GET: {fetched_script['title']}")
        
        # Cleanup - delete the test script
        delete_response = requests.delete(f"{BASE_URL}/api/scripts/{script_id}")
        assert delete_response.status_code == 200, f"Delete script failed: {delete_response.text}"
        print(f"✅ Script cleanup: deleted {script_id}")
    
    def test_get_nonexistent_script_returns_404(self):
        """Verify requesting non-existent script returns 404"""
        fake_id = f"nonexistent_{uuid.uuid4().hex}"
        response = requests.get(f"{BASE_URL}/api/scripts/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✅ Non-existent script correctly returns 404")


class TestUsersEndpoint:
    """User management endpoint tests"""
    
    def test_create_or_get_user(self):
        """Test creating a new user with device ID"""
        device_id = f"{TEST_PREFIX}device_{uuid.uuid4().hex[:8]}"
        
        payload = {
            "device_id": device_id,
            "email": f"test_{uuid.uuid4().hex[:6]}@test.com",
            "name": "Test User"
        }
        
        response = requests.post(f"{BASE_URL}/api/users", json=payload)
        
        assert response.status_code == 200, f"Create user failed: {response.text}"
        
        user = response.json()
        assert "id" in user, "User missing 'id'"
        assert user["device_id"] == device_id, "Device ID mismatch"
        assert user["subscription_tier"] == "free", "New user should be free tier"
        print(f"✅ User created: {user['id']}")
        
        # Verify get user works
        get_response = requests.get(f"{BASE_URL}/api/users/{device_id}")
        assert get_response.status_code == 200, f"Get user failed: {get_response.text}"
        
        fetched_user = get_response.json()
        assert fetched_user["device_id"] == device_id
        print(f"✅ User verified via GET")
    
    def test_get_user_limits(self):
        """Test getting user limits"""
        device_id = f"{TEST_PREFIX}device_{uuid.uuid4().hex[:8]}"
        
        # First create user
        requests.post(f"{BASE_URL}/api/users", json={"device_id": device_id})
        
        # Get limits
        response = requests.get(f"{BASE_URL}/api/users/{device_id}/limits")
        
        assert response.status_code == 200, f"Get limits failed: {response.text}"
        
        limits = response.json()
        assert "tier" in limits, "Missing tier field"
        assert "limits" in limits, "Missing limits field"
        assert "usage" in limits, "Missing usage field"
        assert limits["tier"] == "free", "New user should be free tier"
        print(f"✅ User limits retrieved: tier={limits['tier']}")


class TestSubscriptionEndpoint:
    """Subscription plans endpoint tests"""
    
    def test_get_subscription_plans_us(self):
        """Test getting US subscription plans"""
        response = requests.get(f"{BASE_URL}/api/subscription/plans", params={"region": "US"})
        
        assert response.status_code == 200, f"Get plans failed: {response.text}"
        
        plans = response.json()
        assert "currency" in plans, "Missing currency"
        assert plans["currency"] == "USD", f"Expected USD, got {plans['currency']}"
        assert "plans" in plans, "Missing plans"
        assert "monthly" in plans["plans"], "Missing monthly plan"
        assert "yearly" in plans["plans"], "Missing yearly plan"
        print(f"✅ US subscription plans: {plans['currency_symbol']}{plans['plans']['monthly']['price']}/month")
    
    def test_get_subscription_plans_uk(self):
        """Test getting UK subscription plans"""
        response = requests.get(f"{BASE_URL}/api/subscription/plans", params={"region": "GB"})
        
        assert response.status_code == 200
        plans = response.json()
        assert plans["currency"] == "GBP", f"Expected GBP, got {plans['currency']}"
        print(f"✅ UK subscription plans: {plans['currency_symbol']}{plans['plans']['monthly']['price']}/month")
    
    def test_get_subscription_plans_eu(self):
        """Test getting EU subscription plans"""
        response = requests.get(f"{BASE_URL}/api/subscription/plans", params={"region": "EU"})
        
        assert response.status_code == 200
        plans = response.json()
        assert plans["currency"] == "EUR", f"Expected EUR, got {plans['currency']}"
        print(f"✅ EU subscription plans: {plans['currency_symbol']}{plans['plans']['monthly']['price']}/month")
    
    def test_get_all_regions(self):
        """Test getting pricing for all regions"""
        response = requests.get(f"{BASE_URL}/api/subscription/regions")
        
        assert response.status_code == 200
        data = response.json()
        assert "regions" in data, "Missing regions"
        assert "US" in data["regions"], "Missing US region"
        assert "GB" in data["regions"], "Missing GB region"
        assert "EU" in data["regions"], "Missing EU region"
        print(f"✅ All regions pricing retrieved: {list(data['regions'].keys())}")


class TestRehearsalEndpoint:
    """Rehearsal session endpoint tests"""
    
    def test_get_rehearsals_returns_array(self):
        """Verify /api/rehearsals returns an array"""
        response = requests.get(f"{BASE_URL}/api/rehearsals")
        
        assert response.status_code == 200, f"Rehearsals endpoint failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), f"Expected array, got: {type(data)}"
        print(f"✅ Rehearsals endpoint returns array with {len(data)} items")


class TestAnalyzeEndpoint:
    """Script analysis endpoint tests"""
    
    def test_analyze_script_text(self):
        """Test script text analysis"""
        payload = {
            "raw_text": "ALICE\nHello there!\n\nBOB\nHi Alice, how are you?\n\nALICE\nI'm great, thanks!"
        }
        
        response = requests.post(f"{BASE_URL}/api/analyze", json=payload)
        
        assert response.status_code == 200, f"Analyze failed: {response.text}"
        
        result = response.json()
        assert "characters" in result, "Missing characters in analysis"
        assert "lines" in result, "Missing lines in analysis"
        assert len(result["characters"]) >= 2, "Should detect at least 2 characters"
        print(f"✅ Script analysis: {len(result['characters'])} characters, {len(result['lines'])} lines detected")


class TestRootEndpoint:
    """Root API endpoint test"""
    
    def test_root_endpoint(self):
        """Test root API endpoint"""
        response = requests.get(f"{BASE_URL}/api/")
        
        assert response.status_code == 200, f"Root endpoint failed: {response.text}"
        
        data = response.json()
        assert "message" in data, "Missing message in response"
        print(f"✅ Root endpoint: {data['message']}")


class TestTrialAndSubscription:
    """Trial and subscription flow tests"""
    
    def test_start_trial_flow(self):
        """Test starting a 3-day trial"""
        device_id = f"{TEST_PREFIX}device_{uuid.uuid4().hex[:8]}"
        
        # Create user first
        create_response = requests.post(f"{BASE_URL}/api/users", json={"device_id": device_id})
        assert create_response.status_code == 200
        
        # Start trial
        trial_response = requests.post(f"{BASE_URL}/api/users/{device_id}/start-trial")
        
        assert trial_response.status_code == 200, f"Start trial failed: {trial_response.text}"
        
        user = trial_response.json()
        assert user["subscription_tier"] == "premium", "User should be premium after trial"
        assert user["trial_used"] == True, "Trial should be marked as used"
        print(f"✅ Trial started successfully for user {device_id}")
        
        # Try to start trial again - should fail
        second_trial = requests.post(f"{BASE_URL}/api/users/{device_id}/start-trial")
        assert second_trial.status_code == 400, "Second trial should fail"
        print("✅ Second trial correctly rejected")


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
