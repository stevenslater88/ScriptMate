#!/usr/bin/env python3
"""
Backend API Testing for ScriptMate - Multi-Region Subscription Pricing
Testing the subscription pricing endpoints with different regions and trial functionality.
"""

import requests
import json
import uuid
from datetime import datetime
import sys
import os

# Get backend URL from frontend .env file
def get_backend_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except Exception as e:
        print(f"Error reading frontend .env: {e}")
    return "http://localhost:8001"

BASE_URL = get_backend_url()
API_BASE = f"{BASE_URL}/api"

print(f"Testing backend at: {API_BASE}")

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def add_pass(self, test_name):
        self.passed += 1
        print(f"✅ PASS: {test_name}")
    
    def add_fail(self, test_name, error):
        self.failed += 1
        self.errors.append(f"{test_name}: {error}")
        print(f"❌ FAIL: {test_name} - {error}")
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"TEST SUMMARY: {self.passed}/{total} tests passed")
        if self.errors:
            print(f"\nFAILED TESTS:")
            for error in self.errors:
                print(f"  - {error}")
        print(f"{'='*60}")
        return self.failed == 0

def test_subscription_plans_us_region():
    """Test GET /api/subscription/plans with US region"""
    results = TestResults()
    
    try:
        response = requests.get(f"{API_BASE}/subscription/plans?region=US", timeout=10)
        
        if response.status_code != 200:
            results.add_fail("US Region API Response", f"Status code {response.status_code}")
            return results
        
        data = response.json()
        
        # Check region
        if data.get("region") != "US":
            results.add_fail("US Region Field", f"Expected 'US', got '{data.get('region')}'")
        else:
            results.add_pass("US Region Field")
        
        # Check currency
        if data.get("currency") != "USD":
            results.add_fail("US Currency", f"Expected 'USD', got '{data.get('currency')}'")
        else:
            results.add_pass("US Currency")
        
        # Check currency symbol
        if data.get("currency_symbol") != "$":
            results.add_fail("US Currency Symbol", f"Expected '$', got '{data.get('currency_symbol')}'")
        else:
            results.add_pass("US Currency Symbol")
        
        # Check monthly pricing
        monthly = data.get("plans", {}).get("monthly", {})
        if monthly.get("price") != 9.99:
            results.add_fail("US Monthly Price", f"Expected 9.99, got {monthly.get('price')}")
        else:
            results.add_pass("US Monthly Price ($9.99)")
        
        # Check yearly pricing
        yearly = data.get("plans", {}).get("yearly", {})
        if yearly.get("price") != 79.99:
            results.add_fail("US Yearly Price", f"Expected 79.99, got {yearly.get('price')}")
        else:
            results.add_pass("US Yearly Price ($79.99)")
        
        # Check trial days
        if monthly.get("trial_days") != 3:
            results.add_fail("US Monthly Trial Days", f"Expected 3, got {monthly.get('trial_days')}")
        else:
            results.add_pass("US Monthly Trial Days (3)")
        
        if yearly.get("trial_days") != 3:
            results.add_fail("US Yearly Trial Days", f"Expected 3, got {yearly.get('trial_days')}")
        else:
            results.add_pass("US Yearly Trial Days (3)")
            
    except Exception as e:
        results.add_fail("US Region API Call", str(e))
    
    return results

def test_subscription_plans_gb_region():
    """Test GET /api/subscription/plans with GB region"""
    results = TestResults()
    
    try:
        response = requests.get(f"{API_BASE}/subscription/plans?region=GB", timeout=10)
        
        if response.status_code != 200:
            results.add_fail("GB Region API Response", f"Status code {response.status_code}")
            return results
        
        data = response.json()
        
        # Check region
        if data.get("region") != "GB":
            results.add_fail("GB Region Field", f"Expected 'GB', got '{data.get('region')}'")
        else:
            results.add_pass("GB Region Field")
        
        # Check currency
        if data.get("currency") != "GBP":
            results.add_fail("GB Currency", f"Expected 'GBP', got '{data.get('currency')}'")
        else:
            results.add_pass("GB Currency")
        
        # Check currency symbol
        if data.get("currency_symbol") != "£":
            results.add_fail("GB Currency Symbol", f"Expected '£', got '{data.get('currency_symbol')}'")
        else:
            results.add_pass("GB Currency Symbol")
        
        # Check monthly pricing
        monthly = data.get("plans", {}).get("monthly", {})
        if monthly.get("price") != 4.99:
            results.add_fail("GB Monthly Price", f"Expected 4.99, got {monthly.get('price')}")
        else:
            results.add_pass("GB Monthly Price (£4.99)")
        
        # Check yearly pricing
        yearly = data.get("plans", {}).get("yearly", {})
        if yearly.get("price") != 34.99:
            results.add_fail("GB Yearly Price", f"Expected 34.99, got {yearly.get('price')}")
        else:
            results.add_pass("GB Yearly Price (£34.99)")
        
        # Check trial days
        if monthly.get("trial_days") != 3:
            results.add_fail("GB Monthly Trial Days", f"Expected 3, got {monthly.get('trial_days')}")
        else:
            results.add_pass("GB Monthly Trial Days (3)")
        
        if yearly.get("trial_days") != 3:
            results.add_fail("GB Yearly Trial Days", f"Expected 3, got {yearly.get('trial_days')}")
        else:
            results.add_pass("GB Yearly Trial Days (3)")
            
    except Exception as e:
        results.add_fail("GB Region API Call", str(e))
    
    return results

def test_subscription_plans_eu_region():
    """Test GET /api/subscription/plans with EU region"""
    results = TestResults()
    
    try:
        response = requests.get(f"{API_BASE}/subscription/plans?region=EU", timeout=10)
        
        if response.status_code != 200:
            results.add_fail("EU Region API Response", f"Status code {response.status_code}")
            return results
        
        data = response.json()
        
        # Check region
        if data.get("region") != "EU":
            results.add_fail("EU Region Field", f"Expected 'EU', got '{data.get('region')}'")
        else:
            results.add_pass("EU Region Field")
        
        # Check currency
        if data.get("currency") != "EUR":
            results.add_fail("EU Currency", f"Expected 'EUR', got '{data.get('currency')}'")
        else:
            results.add_pass("EU Currency")
        
        # Check currency symbol
        if data.get("currency_symbol") != "€":
            results.add_fail("EU Currency Symbol", f"Expected '€', got '{data.get('currency_symbol')}'")
        else:
            results.add_pass("EU Currency Symbol")
        
        # Check monthly pricing
        monthly = data.get("plans", {}).get("monthly", {})
        if monthly.get("price") != 6.99:
            results.add_fail("EU Monthly Price", f"Expected 6.99, got {monthly.get('price')}")
        else:
            results.add_pass("EU Monthly Price (€6.99)")
        
        # Check yearly pricing
        yearly = data.get("plans", {}).get("yearly", {})
        if yearly.get("price") != 39.99:
            results.add_fail("EU Yearly Price", f"Expected 39.99, got {yearly.get('price')}")
        else:
            results.add_pass("EU Yearly Price (€39.99)")
        
        # Check trial days
        if monthly.get("trial_days") != 3:
            results.add_fail("EU Monthly Trial Days", f"Expected 3, got {monthly.get('trial_days')}")
        else:
            results.add_pass("EU Monthly Trial Days (3)")
        
        if yearly.get("trial_days") != 3:
            results.add_fail("EU Yearly Trial Days", f"Expected 3, got {yearly.get('trial_days')}")
        else:
            results.add_pass("EU Yearly Trial Days (3)")
            
    except Exception as e:
        results.add_fail("EU Region API Call", str(e))
    
    return results

def test_subscription_regions():
    """Test GET /api/subscription/regions"""
    results = TestResults()
    
    try:
        response = requests.get(f"{API_BASE}/subscription/regions", timeout=10)
        
        if response.status_code != 200:
            results.add_fail("Regions API Response", f"Status code {response.status_code}")
            return results
        
        data = response.json()
        regions = data.get("regions", {})
        
        # Check US region
        us_region = regions.get("US", {})
        if us_region.get("currency") != "USD" or us_region.get("symbol") != "$":
            results.add_fail("US Region in Regions API", f"Currency: {us_region.get('currency')}, Symbol: {us_region.get('symbol')}")
        else:
            results.add_pass("US Region in Regions API")
        
        if us_region.get("monthly_price") != 9.99 or us_region.get("yearly_price") != 79.99:
            results.add_fail("US Pricing in Regions API", f"Monthly: {us_region.get('monthly_price')}, Yearly: {us_region.get('yearly_price')}")
        else:
            results.add_pass("US Pricing in Regions API")
        
        # Check GB region
        gb_region = regions.get("GB", {})
        if gb_region.get("currency") != "GBP" or gb_region.get("symbol") != "£":
            results.add_fail("GB Region in Regions API", f"Currency: {gb_region.get('currency')}, Symbol: {gb_region.get('symbol')}")
        else:
            results.add_pass("GB Region in Regions API")
        
        if gb_region.get("monthly_price") != 4.99 or gb_region.get("yearly_price") != 34.99:
            results.add_fail("GB Pricing in Regions API", f"Monthly: {gb_region.get('monthly_price')}, Yearly: {gb_region.get('yearly_price')}")
        else:
            results.add_pass("GB Pricing in Regions API")
        
        # Check EU region
        eu_region = regions.get("EU", {})
        if eu_region.get("currency") != "EUR" or eu_region.get("symbol") != "€":
            results.add_fail("EU Region in Regions API", f"Currency: {eu_region.get('currency')}, Symbol: {eu_region.get('symbol')}")
        else:
            results.add_pass("EU Region in Regions API")
        
        if eu_region.get("monthly_price") != 6.99 or eu_region.get("yearly_price") != 39.99:
            results.add_fail("EU Pricing in Regions API", f"Monthly: {eu_region.get('monthly_price')}, Yearly: {eu_region.get('yearly_price')}")
        else:
            results.add_pass("EU Pricing in Regions API")
            
    except Exception as e:
        results.add_fail("Regions API Call", str(e))
    
    return results

def test_start_trial():
    """Test POST /api/users/{device_id}/start-trial"""
    results = TestResults()
    
    # Generate unique device ID for testing
    device_id = f"test-device-{uuid.uuid4()}"
    
    try:
        # First create a user
        user_data = {
            "device_id": device_id,
            "email": "test@example.com",
            "name": "Test User"
        }
        
        create_response = requests.post(f"{API_BASE}/users", json=user_data, timeout=10)
        if create_response.status_code != 200:
            results.add_fail("User Creation for Trial Test", f"Status code {create_response.status_code}")
            return results
        
        results.add_pass("User Creation for Trial Test")
        
        # Now start trial
        trial_response = requests.post(f"{API_BASE}/users/{device_id}/start-trial", timeout=10)
        
        if trial_response.status_code != 200:
            results.add_fail("Start Trial API Response", f"Status code {trial_response.status_code}")
            return results
        
        trial_data = trial_response.json()
        
        # Check subscription tier is premium during trial
        if trial_data.get("subscription_tier") != "premium":
            results.add_fail("Trial Subscription Tier", f"Expected 'premium', got '{trial_data.get('subscription_tier')}'")
        else:
            results.add_pass("Trial Subscription Tier (premium)")
        
        # Check trial_used flag
        if not trial_data.get("trial_used"):
            results.add_fail("Trial Used Flag", "Expected trial_used to be True")
        else:
            results.add_pass("Trial Used Flag")
        
        # Check trial end date exists
        if not trial_data.get("trial_end"):
            results.add_fail("Trial End Date", "trial_end field missing")
        else:
            results.add_pass("Trial End Date Set")
        
        # Verify trial period is 3 days by checking subscription_end matches trial_end
        trial_end = trial_data.get("trial_end")
        subscription_end = trial_data.get("subscription_end")
        
        if trial_end != subscription_end:
            results.add_fail("3-Day Trial Period", f"trial_end ({trial_end}) != subscription_end ({subscription_end})")
        else:
            results.add_pass("3-Day Trial Period (trial_end matches subscription_end)")
        
        # Test that trial cannot be used again
        second_trial_response = requests.post(f"{API_BASE}/users/{device_id}/start-trial", timeout=10)
        if second_trial_response.status_code != 400:
            results.add_fail("Trial Already Used Prevention", f"Expected 400, got {second_trial_response.status_code}")
        else:
            results.add_pass("Trial Already Used Prevention")
            
    except Exception as e:
        results.add_fail("Start Trial API Call", str(e))
    
    return results

def main():
    """Run all subscription pricing tests"""
    print("🚀 Starting Multi-Region Subscription Pricing API Tests")
    print(f"Backend URL: {API_BASE}")
    print("="*60)
    
    all_results = TestResults()
    
    # Test US region pricing
    print("\n📍 Testing US Region Pricing...")
    us_results = test_subscription_plans_us_region()
    all_results.passed += us_results.passed
    all_results.failed += us_results.failed
    all_results.errors.extend(us_results.errors)
    
    # Test GB region pricing
    print("\n📍 Testing GB Region Pricing...")
    gb_results = test_subscription_plans_gb_region()
    all_results.passed += gb_results.passed
    all_results.failed += gb_results.failed
    all_results.errors.extend(gb_results.errors)
    
    # Test EU region pricing
    print("\n📍 Testing EU Region Pricing...")
    eu_results = test_subscription_plans_eu_region()
    all_results.passed += eu_results.passed
    all_results.failed += eu_results.failed
    all_results.errors.extend(eu_results.errors)
    
    # Test regions endpoint
    print("\n📍 Testing Regions Endpoint...")
    regions_results = test_subscription_regions()
    all_results.passed += regions_results.passed
    all_results.failed += regions_results.failed
    all_results.errors.extend(regions_results.errors)
    
    # Test trial functionality
    print("\n📍 Testing 3-Day Trial Functionality...")
    trial_results = test_start_trial()
    all_results.passed += trial_results.passed
    all_results.failed += trial_results.failed
    all_results.errors.extend(trial_results.errors)
    
    # Final summary
    success = all_results.summary()
    
    if success:
        print("\n🎉 ALL MULTI-REGION SUBSCRIPTION PRICING TESTS PASSED!")
        return 0
    else:
        print("\n💥 SOME TESTS FAILED - CHECK ERRORS ABOVE")
        return 1

if __name__ == "__main__":
    sys.exit(main())