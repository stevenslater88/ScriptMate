#!/usr/bin/env python3
"""
Additional test for script upload functionality (PDF/TXT files)
"""

import requests
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

BACKEND_URL = "https://device-validation.preview.emergentagent.com/api"

def create_test_pdf():
    """Create a test PDF with script content"""
    buffer = io.BytesIO()
    p = canvas.Canvas(buffer, pagesize=letter)
    
    # Add script content to PDF
    script_text = """
    HAMLET
    To be or not to be, that is the question.
    
    OPHELIA
    My lord, how fares your disposition?
    
    (Hamlet turns away)
    
    HAMLET
    I humbly thank you, well, well, well.
    """
    
    y_position = 750
    for line in script_text.strip().split('\n'):
        if line.strip():
            p.drawString(100, y_position, line.strip())
            y_position -= 20
    
    p.showPage()
    p.save()
    buffer.seek(0)
    return buffer.getvalue()

def test_txt_upload():
    """Test TXT file upload"""
    print("Testing TXT file upload...")
    
    txt_content = """MACBETH
Is this a dagger which I see before me,
The handle toward my hand?

LADY MACBETH
Come, come, give me your hand.
What's done cannot be undone.

(Thunder and lightning)

MACBETH
I have done the deed. Didst thou not hear a noise?"""
    
    files = {
        'file': ('test_script.txt', txt_content.encode('utf-8'), 'text/plain')
    }
    data = {
        'title': 'Macbeth Test Scene'
    }
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ TXT upload successful - Script ID: {result.get('id')}")
            print(f"   Characters detected: {[char['name'] for char in result.get('characters', [])]}")
            return True
        else:
            print(f"❌ TXT upload failed - Status: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ TXT upload failed - Exception: {str(e)}")
        return False

def test_pdf_upload():
    """Test PDF file upload"""
    print("Testing PDF file upload...")
    
    try:
        pdf_content = create_test_pdf()
        
        files = {
            'file': ('test_script.pdf', pdf_content, 'application/pdf')
        }
        data = {
            'title': 'Hamlet Test Scene'
        }
        
        response = requests.post(
            f"{BACKEND_URL}/scripts/upload",
            files=files,
            data=data,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ PDF upload successful - Script ID: {result.get('id')}")
            print(f"   Characters detected: {[char['name'] for char in result.get('characters', [])]}")
            return True
        else:
            print(f"❌ PDF upload failed - Status: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ PDF upload failed - Exception: {str(e)}")
        return False

def main():
    """Run upload tests"""
    print("=" * 50)
    print("TESTING SCRIPT UPLOAD FUNCTIONALITY")
    print("=" * 50)
    
    txt_result = test_txt_upload()
    pdf_result = test_pdf_upload()
    
    print("=" * 50)
    print("UPLOAD TEST RESULTS:")
    print(f"TXT Upload: {'✅ PASS' if txt_result else '❌ FAIL'}")
    print(f"PDF Upload: {'✅ PASS' if pdf_result else '❌ FAIL'}")
    
    if txt_result and pdf_result:
        print("🎉 ALL UPLOAD TESTS PASSED!")
        return 0
    else:
        print("⚠️ Some upload tests failed")
        return 1

if __name__ == "__main__":
    exit(main())