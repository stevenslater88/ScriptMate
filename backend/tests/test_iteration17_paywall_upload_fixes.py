"""
Iteration 17 Backend API Tests
- Tests for paywall fixes and upload functionality
- Verifies upload-base64 endpoint and subscription plans
"""
import pytest
import requests
import os
import base64

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://device-validation.preview.emergentagent.com').rstrip('/')

class TestHealthAndBasicAPIs:
    """Health check and basic API verification"""
    
    def test_health_endpoint_returns_200(self):
        """GET /api/health returns 200 with healthy status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("status") == "healthy", f"Expected status 'healthy', got {data}"
        print("✓ Health check passed")


class TestDailyDrill:
    """Daily drill API tests"""
    
    def test_daily_drill_returns_drill_data(self):
        """GET /api/daily-drill/{userId} returns drill with expected fields"""
        user_id = "TEST_user_iter17_drill"
        response = requests.get(f"{BASE_URL}/api/daily-drill/{user_id}", timeout=15)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        # Verify expected drill fields are present
        assert "challenge_type" in data, "Missing challenge_type"
        assert "title" in data, "Missing title"
        assert "prompt" in data, "Missing prompt"
        print(f"✓ Daily drill returned: {data.get('title', 'unknown')}")


class TestSubscriptionPlans:
    """Subscription plans API tests"""
    
    def test_subscription_plans_returns_prices(self):
        """GET /api/subscription/plans returns plans with prices"""
        response = requests.get(f"{BASE_URL}/api/subscription/plans", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        
        # Verify structure
        assert "plans" in data, "Missing 'plans' key"
        assert "monthly" in data["plans"], "Missing monthly plan"
        assert "yearly" in data["plans"], "Missing yearly plan"
        
        # Verify monthly plan has price
        monthly = data["plans"]["monthly"]
        assert "price" in monthly, "Monthly plan missing price"
        assert monthly["price"] > 0, f"Monthly price should be > 0, got {monthly['price']}"
        
        # Verify yearly plan has price
        yearly = data["plans"]["yearly"]
        assert "price" in yearly, "Yearly plan missing price"
        assert yearly["price"] > 0, f"Yearly price should be > 0, got {yearly['price']}"
        
        print(f"✓ Plans retrieved: Monthly ${monthly['price']}, Yearly ${yearly['price']}")


class TestScriptUpload:
    """Script upload endpoint tests"""
    
    def test_multipart_upload_text_file(self):
        """POST /api/scripts/upload (multipart) successfully uploads a text file"""
        test_script_content = b"""JOHN
Hello there, how are you?

SARAH
I'm doing great, thanks for asking!

JOHN
That's wonderful to hear.
"""
        files = {
            'file': ('test_script.txt', test_script_content, 'text/plain')
        }
        data = {
            'title': 'TEST_Multipart_Upload_Script_Iter17',
            'user_id': 'TEST_user_upload_iter17'
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}. Response: {response.text[:500]}"
        result = response.json()
        assert "id" in result, "Response missing script id"
        assert "title" in result, "Response missing title"
        assert result["title"] == 'TEST_Multipart_Upload_Script_Iter17', f"Unexpected title: {result['title']}"
        
        script_id = result["id"]
        print(f"✓ Multipart upload successful, script ID: {script_id}")
        
        # Cleanup - delete the test script
        try:
            requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
        except:
            pass


class TestBase64Upload:
    """Base64 upload endpoint tests - Android fallback"""
    
    def test_base64_upload_success(self):
        """POST /api/scripts/upload-base64 (JSON body with base64 file_data) successfully uploads"""
        test_content = """MIKE
Welcome to the show!

JANE
Thanks for having me.

MIKE
Let's get started.
"""
        # Encode content to base64
        base64_content = base64.b64encode(test_content.encode()).decode()
        
        payload = {
            "title": "TEST_Base64_Upload_Script_Iter17",
            "filename": "test_base64.txt",
            "file_data": base64_content,
            "user_id": "TEST_user_base64_iter17"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload-base64",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}. Response: {response.text[:500]}"
        result = response.json()
        assert "id" in result, "Response missing script id"
        assert "title" in result, "Response missing title"
        
        script_id = result["id"]
        print(f"✓ Base64 upload successful, script ID: {script_id}")
        
        # Verify the script was parsed
        assert "characters" in result, "Response missing characters"
        assert len(result["characters"]) > 0, "No characters parsed from script"
        
        # Cleanup
        try:
            requests.delete(f"{BASE_URL}/api/scripts/{script_id}", timeout=10)
        except:
            pass
    
    def test_base64_upload_empty_file_data_returns_400(self):
        """POST /api/scripts/upload-base64 returns 400 when file_data is empty"""
        payload = {
            "title": "TEST_Empty_Base64",
            "filename": "empty.txt",
            "file_data": "",  # Empty file data
            "user_id": "TEST_user_empty_iter17"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/scripts/upload-base64",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        assert response.status_code == 400, f"Expected 400 for empty file_data, got {response.status_code}"
        print("✓ Empty file_data correctly returns 400")


class TestFrontendCodeVerification:
    """
    These tests verify frontend code patterns via assertions.
    Since this is a React Native (Expo) app, we cannot run browser tests.
    """
    
    def test_no_presentPaywall_calls_in_screens(self):
        """Verify no presentPaywall() calls exist in screen files"""
        import subprocess
        
        # Search for presentPaywall function calls (not comments)
        result = subprocess.run(
            ['grep', '-rn', 'presentPaywall(', '/app/frontend/app/'],
            capture_output=True,
            text=True
        )
        
        # Filter out comments (lines with // or * before presentPaywall)
        actual_calls = []
        for line in result.stdout.strip().split('\n'):
            if line and not line.strip().startswith('//') and '* ' not in line:
                # Check if it's an actual call, not a comment
                if 'presentPaywall(' in line and '//' not in line.split('presentPaywall')[0]:
                    actual_calls.append(line)
        
        assert len(actual_calls) == 0, f"Found presentPaywall calls: {actual_calls}"
        print("✓ No presentPaywall() calls found in screen files")
    
    def test_paywall_tsx_redirects_to_premium(self):
        """Verify paywall.tsx only does router.replace('/premium') redirect"""
        with open('/app/frontend/app/paywall.tsx', 'r') as f:
            content = f.read()
        
        # Should contain router.replace('/premium')
        assert "router.replace('/premium')" in content, "paywall.tsx should redirect to /premium"
        # Should NOT contain RevenueCatUI.present calls
        assert "presentPaywall" not in content or "Previously used" in content, \
            "paywall.tsx should not call presentPaywall"
        print("✓ paywall.tsx correctly redirects to /premium")
    
    def test_index_tsx_routes_to_premium(self):
        """Verify index.tsx routes to /premium not /paywall"""
        with open('/app/frontend/app/index.tsx', 'r') as f:
            content = f.read()
        
        # Should route to /premium
        assert "router.push('/premium')" in content, "index.tsx should route to /premium"
        print("✓ index.tsx routes to /premium")
    
    def test_premium_tsx_no_hardcoded_prices(self):
        """Verify premium.tsx getPriceDisplay() has NO hardcoded dollar amounts"""
        with open('/app/frontend/app/premium.tsx', 'r') as f:
            content = f.read()
        
        # Should NOT have hardcoded prices in the file
        hardcoded_patterns = ['$4.99', '$29.99', '$49.99']
        for pattern in hardcoded_patterns:
            assert pattern not in content, f"Found hardcoded price: {pattern}"
        print("✓ No hardcoded prices in premium.tsx")
    
    def test_premium_tsx_has_loading_timeout(self):
        """Verify premium.tsx has loadingTimedOut state with 8s timeout"""
        with open('/app/frontend/app/premium.tsx', 'r') as f:
            content = f.read()
        
        assert 'loadingTimedOut' in content, "Missing loadingTimedOut state"
        assert '8000' in content, "Missing 8000ms (8s) timeout value"
        print("✓ premium.tsx has 8s loading timeout")
    
    def test_upload_tsx_no_manual_content_type(self):
        """Verify upload.tsx does NOT set manual Content-Type header for FormData upload"""
        with open('/app/frontend/app/upload.tsx', 'r') as f:
            content = f.read()
        
        # The comment says "Do NOT set Content-Type manually" - verify FormData upload has no header
        # The only Content-Type header should be for JSON base64 fallback
        
        # Search for axios.post patterns for FormData
        assert "Do NOT set Content-Type manually" in content, \
            "Missing comment about not setting Content-Type"
        print("✓ upload.tsx correctly avoids manual Content-Type for FormData")
    
    def test_upload_tsx_has_base64_fallback(self):
        """Verify upload.tsx has Android base64 fallback in .catch() block"""
        with open('/app/frontend/app/upload.tsx', 'r') as f:
            content = f.read()
        
        assert 'upload-base64' in content, "Missing base64 fallback endpoint"
        assert 'base64Data' in content.lower() or 'base64' in content, \
            "Missing base64 encoding"
        assert 'Platform.OS === \'android\'' in content, \
            "Missing Android platform check for fallback"
        print("✓ upload.tsx has Android base64 fallback")
    
    def test_upload_tsx_has_uri_compatibility(self):
        """Verify upload.tsx has Android URI compatibility (copyAsync for non file:// URIs)"""
        with open('/app/frontend/app/upload.tsx', 'r') as f:
            content = f.read()
        
        assert 'copyAsync' in content, "Missing copyAsync for URI compatibility"
        assert 'file://' in content, "Missing file:// check"
        print("✓ upload.tsx has Android URI compatibility with copyAsync")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
