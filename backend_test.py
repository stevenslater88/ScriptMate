#!/usr/bin/env python3
"""
Backend API Test Suite for LineCoach - AI Script Learning Partner
Tests all backend endpoints with realistic data
"""

import requests
import json
import time
from typing import Dict, Any, Optional

# Backend URL from frontend .env
BACKEND_URL = "https://linecoach.preview.emergentagent.com/api"

class LineCoachAPITester:
    def __init__(self):
        self.base_url = BACKEND_URL
        self.session = requests.Session()
        self.created_scripts = []
        self.created_rehearsals = []
        
    def log(self, message: str, level: str = "INFO"):
        """Log test messages"""
        print(f"[{level}] {message}")
        
    def test_health_check(self) -> bool:
        """Test GET /api/health endpoint"""
        try:
            self.log("Testing health check endpoint...")
            response = self.session.get(f"{self.base_url}/health", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if "status" in data and data["status"] == "healthy":
                    self.log("✅ Health check passed")
                    return True
                else:
                    self.log(f"❌ Health check failed - unexpected response: {data}", "ERROR")
                    return False
            else:
                self.log(f"❌ Health check failed - status code: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Health check failed - exception: {str(e)}", "ERROR")
            return False
    
    def test_create_script(self) -> Optional[str]:
        """Test POST /api/scripts endpoint with realistic script data"""
        try:
            self.log("Testing script creation with AI parsing...")
            
            # Realistic script content
            script_data = {
                "title": "Romeo and Juliet - Balcony Scene",
                "raw_text": """ROMEO
But soft, what light through yonder window breaks?
It is the east, and Juliet is the sun.

JULIET
O Romeo, Romeo, wherefore art thou Romeo?
Deny thy father and refuse thy name.

(Romeo steps forward)

ROMEO
Call me but love, and I'll be new baptized.
Henceforth I never will be Romeo.

JULIET
What man art thou that, thus bescreened in night,
So stumblest on my counsel?

ROMEO
By a name I know not how to tell thee who I am.
My name, dear saint, is hateful to myself."""
            }
            
            response = self.session.post(
                f"{self.base_url}/scripts",
                json=script_data,
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                script_id = data.get("id")
                
                # Validate response structure
                required_fields = ["id", "title", "raw_text", "characters", "lines", "created_at"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log(f"❌ Script creation failed - missing fields: {missing_fields}", "ERROR")
                    return None
                
                # Check if characters were detected
                characters = data.get("characters", [])
                if len(characters) < 2:
                    self.log(f"❌ Script parsing failed - expected at least 2 characters, got {len(characters)}", "ERROR")
                    return None
                
                # Check if lines were parsed
                lines = data.get("lines", [])
                if len(lines) < 5:
                    self.log(f"❌ Script parsing failed - expected at least 5 lines, got {len(lines)}", "ERROR")
                    return None
                
                # Verify character names
                char_names = [char["name"] for char in characters]
                expected_chars = ["ROMEO", "JULIET"]
                for expected_char in expected_chars:
                    if expected_char not in char_names:
                        self.log(f"❌ Script parsing failed - missing character: {expected_char}", "ERROR")
                        return None
                
                self.created_scripts.append(script_id)
                self.log(f"✅ Script created successfully - ID: {script_id}")
                self.log(f"   Characters detected: {char_names}")
                self.log(f"   Lines parsed: {len(lines)}")
                return script_id
                
            else:
                self.log(f"❌ Script creation failed - status code: {response.status_code}", "ERROR")
                self.log(f"   Response: {response.text}", "ERROR")
                return None
                
        except Exception as e:
            self.log(f"❌ Script creation failed - exception: {str(e)}", "ERROR")
            return None
    
    def test_get_scripts(self) -> bool:
        """Test GET /api/scripts endpoint"""
        try:
            self.log("Testing script listing...")
            response = self.session.get(f"{self.base_url}/scripts", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log(f"✅ Script listing successful - found {len(data)} scripts")
                    return True
                else:
                    self.log(f"❌ Script listing failed - expected list, got {type(data)}", "ERROR")
                    return False
            else:
                self.log(f"❌ Script listing failed - status code: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Script listing failed - exception: {str(e)}", "ERROR")
            return False
    
    def test_get_script_by_id(self, script_id: str) -> bool:
        """Test GET /api/scripts/{id} endpoint"""
        try:
            self.log(f"Testing script retrieval by ID: {script_id}")
            response = self.session.get(f"{self.base_url}/scripts/{script_id}", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("id") == script_id:
                    self.log("✅ Script retrieval by ID successful")
                    return True
                else:
                    self.log(f"❌ Script retrieval failed - ID mismatch", "ERROR")
                    return False
            elif response.status_code == 404:
                self.log(f"❌ Script retrieval failed - script not found", "ERROR")
                return False
            else:
                self.log(f"❌ Script retrieval failed - status code: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Script retrieval failed - exception: {str(e)}", "ERROR")
            return False
    
    def test_update_script(self, script_id: str) -> bool:
        """Test PUT /api/scripts/{id} endpoint"""
        try:
            self.log(f"Testing script update (character assignment): {script_id}")
            
            update_data = {
                "user_character": "ROMEO"
            }
            
            response = self.session.put(
                f"{self.base_url}/scripts/{script_id}",
                json=update_data,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check if user character was assigned
                characters = data.get("characters", [])
                romeo_char = next((char for char in characters if char["name"] == "ROMEO"), None)
                
                if romeo_char and romeo_char.get("is_user_character"):
                    self.log("✅ Script update successful - user character assigned")
                    return True
                else:
                    self.log("❌ Script update failed - user character not properly assigned", "ERROR")
                    return False
            else:
                self.log(f"❌ Script update failed - status code: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Script update failed - exception: {str(e)}", "ERROR")
            return False
    
    def test_create_rehearsal(self, script_id: str) -> Optional[str]:
        """Test POST /api/rehearsals endpoint"""
        try:
            self.log("Testing rehearsal session creation...")
            
            rehearsal_data = {
                "script_id": script_id,
                "user_character": "ROMEO",
                "mode": "full_read",
                "voice_type": "alloy"
            }
            
            response = self.session.post(
                f"{self.base_url}/rehearsals",
                json=rehearsal_data,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                rehearsal_id = data.get("id")
                
                # Validate response structure
                required_fields = ["id", "script_id", "user_character", "mode", "voice_type", "total_lines"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log(f"❌ Rehearsal creation failed - missing fields: {missing_fields}", "ERROR")
                    return None
                
                # Verify data
                if data.get("script_id") != script_id:
                    self.log("❌ Rehearsal creation failed - script_id mismatch", "ERROR")
                    return None
                
                if data.get("user_character") != "ROMEO":
                    self.log("❌ Rehearsal creation failed - user_character mismatch", "ERROR")
                    return None
                
                total_lines = data.get("total_lines", 0)
                if total_lines <= 0:
                    self.log("❌ Rehearsal creation failed - invalid total_lines count", "ERROR")
                    return None
                
                self.created_rehearsals.append(rehearsal_id)
                self.log(f"✅ Rehearsal created successfully - ID: {rehearsal_id}")
                self.log(f"   Total lines for ROMEO: {total_lines}")
                return rehearsal_id
                
            else:
                self.log(f"❌ Rehearsal creation failed - status code: {response.status_code}", "ERROR")
                self.log(f"   Response: {response.text}", "ERROR")
                return None
                
        except Exception as e:
            self.log(f"❌ Rehearsal creation failed - exception: {str(e)}", "ERROR")
            return None
    
    def test_get_rehearsals(self) -> bool:
        """Test GET /api/rehearsals endpoint"""
        try:
            self.log("Testing rehearsal listing...")
            response = self.session.get(f"{self.base_url}/rehearsals", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    self.log(f"✅ Rehearsal listing successful - found {len(data)} rehearsals")
                    return True
                else:
                    self.log(f"❌ Rehearsal listing failed - expected list, got {type(data)}", "ERROR")
                    return False
            else:
                self.log(f"❌ Rehearsal listing failed - status code: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Rehearsal listing failed - exception: {str(e)}", "ERROR")
            return False
    
    def test_get_rehearsal_by_id(self, rehearsal_id: str) -> bool:
        """Test GET /api/rehearsals/{id} endpoint"""
        try:
            self.log(f"Testing rehearsal retrieval by ID: {rehearsal_id}")
            response = self.session.get(f"{self.base_url}/rehearsals/{rehearsal_id}", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("id") == rehearsal_id:
                    self.log("✅ Rehearsal retrieval by ID successful")
                    return True
                else:
                    self.log(f"❌ Rehearsal retrieval failed - ID mismatch", "ERROR")
                    return False
            elif response.status_code == 404:
                self.log(f"❌ Rehearsal retrieval failed - rehearsal not found", "ERROR")
                return False
            else:
                self.log(f"❌ Rehearsal retrieval failed - status code: {response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Rehearsal retrieval failed - exception: {str(e)}", "ERROR")
            return False
    
    def test_delete_script(self) -> bool:
        """Test DELETE /api/scripts/{id} endpoint with a new script"""
        try:
            self.log("Testing script deletion...")
            
            # Create a script specifically for deletion
            delete_script_data = {
                "title": "Test Script for Deletion",
                "raw_text": "ACTOR1\nThis is a test line.\n\nACTOR2\nThis will be deleted."
            }
            
            create_response = self.session.post(
                f"{self.base_url}/scripts",
                json=delete_script_data,
                timeout=30
            )
            
            if create_response.status_code != 200:
                self.log("❌ Script deletion test failed - could not create test script", "ERROR")
                return False
            
            script_id = create_response.json().get("id")
            
            # Now delete it
            delete_response = self.session.delete(f"{self.base_url}/scripts/{script_id}", timeout=10)
            
            if delete_response.status_code == 200:
                # Verify it's actually deleted
                get_response = self.session.get(f"{self.base_url}/scripts/{script_id}", timeout=10)
                if get_response.status_code == 404:
                    self.log("✅ Script deletion successful")
                    return True
                else:
                    self.log("❌ Script deletion failed - script still exists", "ERROR")
                    return False
            else:
                self.log(f"❌ Script deletion failed - status code: {delete_response.status_code}", "ERROR")
                return False
                
        except Exception as e:
            self.log(f"❌ Script deletion failed - exception: {str(e)}", "ERROR")
            return False
    
    def run_all_tests(self) -> Dict[str, bool]:
        """Run all backend API tests"""
        results = {}
        
        self.log("=" * 60)
        self.log("STARTING LINECOACH BACKEND API TESTS")
        self.log(f"Backend URL: {self.base_url}")
        self.log("=" * 60)
        
        # Test 1: Health Check
        results["health_check"] = self.test_health_check()
        
        # Test 2: Create Script
        script_id = self.test_create_script()
        results["create_script"] = script_id is not None
        
        if script_id:
            # Test 3: Get Scripts List
            results["get_scripts"] = self.test_get_scripts()
            
            # Test 4: Get Script by ID
            results["get_script_by_id"] = self.test_get_script_by_id(script_id)
            
            # Test 5: Update Script
            results["update_script"] = self.test_update_script(script_id)
            
            # Test 6: Create Rehearsal
            rehearsal_id = self.test_create_rehearsal(script_id)
            results["create_rehearsal"] = rehearsal_id is not None
            
            if rehearsal_id:
                # Test 7: Get Rehearsals List
                results["get_rehearsals"] = self.test_get_rehearsals()
                
                # Test 8: Get Rehearsal by ID
                results["get_rehearsal_by_id"] = self.test_get_rehearsal_by_id(rehearsal_id)
        
        # Test 9: Delete Script (with new script)
        results["delete_script"] = self.test_delete_script()
        
        # Summary
        self.log("=" * 60)
        self.log("TEST RESULTS SUMMARY")
        self.log("=" * 60)
        
        passed = sum(1 for result in results.values() if result)
        total = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            self.log(f"{test_name}: {status}")
        
        self.log("=" * 60)
        self.log(f"OVERALL: {passed}/{total} tests passed")
        
        if passed == total:
            self.log("🎉 ALL TESTS PASSED!")
        else:
            self.log(f"⚠️  {total - passed} tests failed")
        
        return results

def main():
    """Main test execution"""
    tester = LineCoachAPITester()
    results = tester.run_all_tests()
    
    # Return exit code based on results
    all_passed = all(results.values())
    return 0 if all_passed else 1

if __name__ == "__main__":
    exit(main())