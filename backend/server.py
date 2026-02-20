from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import json
import base64
import httpx
import PyPDF2
import io
from docx import Document
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Get API key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== SUBSCRIPTION CONSTANTS ====================

FREE_TIER_LIMITS = {
    "max_scripts": 3,
    "max_file_size_mb": 1,
    "max_rehearsals_per_day": 5,
    "available_voices": ["alloy"],  # Only 1 voice
    "available_modes": ["full_read", "cue_only"],  # Limited modes
    "has_performance_mode": False,
    "has_recording": False,
    "has_smart_tracking": False,
    "has_cloud_storage": False,
    "has_director_notes": False,
    "show_ads": True,
}

PREMIUM_TIER_LIMITS = {
    "max_scripts": 999,
    "max_file_size_mb": 50,
    "max_rehearsals_per_day": 999,
    "available_voices": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
    "available_modes": ["full_read", "cue_only", "performance", "missing_words", "first_letter", "loop"],
    "has_performance_mode": True,
    "has_recording": True,
    "has_smart_tracking": True,
    "has_cloud_storage": True,
    "has_director_notes": True,
    "show_ads": False,
}

# Multi-region subscription pricing
SUBSCRIPTION_PLANS_BY_REGION = {
    "US": {
        "currency": "USD",
        "currency_symbol": "$",
        "monthly": {
            "id": "premium_monthly_usd",
            "name": "Premium Monthly",
            "price": 6.49,
            "currency": "USD",
            "period": "month",
            "trial_days": 3,
            "features": [
                "Unlimited scripts",
                "6 AI voice options",
                "All training modes",
                "Performance mode with recording",
                "Smart line tracking",
                "Cloud storage",
                "No ads",
            ]
        },
        "yearly": {
            "id": "premium_yearly_usd",
            "name": "Premium Yearly",
            "price": 54.99,
            "currency": "USD",
            "period": "year",
            "trial_days": 3,
            "savings": "Save 29%",
            "features": [
                "Everything in monthly",
                "Best value",
                "Priority support",
                "Early access to new features",
            ]
        }
    },
    "GB": {
        "currency": "GBP",
        "currency_symbol": "£",
        "monthly": {
            "id": "premium_monthly_gbp",
            "name": "Premium Monthly",
            "price": 5.99,
            "currency": "GBP",
            "period": "month",
            "trial_days": 3,
            "features": [
                "Unlimited scripts",
                "6 AI voice options",
                "All training modes",
                "Performance mode with recording",
                "Smart line tracking",
                "Cloud storage",
                "No ads",
            ]
        },
        "yearly": {
            "id": "premium_yearly_gbp",
            "name": "Premium Yearly",
            "price": 47.99,
            "currency": "GBP",
            "period": "year",
            "trial_days": 3,
            "savings": "Save 33%",
            "features": [
                "Everything in monthly",
                "Best value",
                "Priority support",
                "Early access to new features",
            ]
        }
    },
    "EU": {
        "currency": "EUR",
        "currency_symbol": "€",
        "monthly": {
            "id": "premium_monthly_eur",
            "name": "Premium Monthly",
            "price": 6.99,
            "currency": "EUR",
            "period": "month",
            "trial_days": 3,
            "features": [
                "Unlimited scripts",
                "6 AI voice options",
                "All training modes",
                "Performance mode with recording",
                "Smart line tracking",
                "Cloud storage",
                "No ads",
            ]
        },
        "yearly": {
            "id": "premium_yearly_eur",
            "name": "Premium Yearly",
            "price": 54.99,
            "currency": "EUR",
            "period": "year",
            "trial_days": 3,
            "savings": "Save 34%",
            "features": [
                "Everything in monthly",
                "Best value",
                "Priority support",
                "Early access to new features",
            ]
        }
    }
}

# EU country codes for region detection
EU_COUNTRIES = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", 
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", 
    "PL", "PT", "RO", "SK", "SI", "ES", "SE"
]

# Default to US pricing for backwards compatibility
SUBSCRIPTION_PLANS = SUBSCRIPTION_PLANS_BY_REGION["US"]

# ==================== MODELS ====================

class Character(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    line_count: int = 0
    is_user_character: bool = False

class DialogueLine(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    character: str
    text: str
    is_stage_direction: bool = False
    line_number: int = 0

class Script(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    raw_text: str = ""
    characters: List[Character] = []
    lines: List[DialogueLine] = []
    user_id: str = "default"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class ScriptCreate(BaseModel):
    title: str
    raw_text: str
    user_id: str = "default"

class ScriptUpdate(BaseModel):
    title: Optional[str] = None
    characters: Optional[List[Dict]] = None
    user_character: Optional[str] = None

class RehearsalSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    script_id: str
    user_id: str = "default"
    user_character: str
    current_line_index: int = 0
    completed_lines: List[int] = []
    missed_lines: List[int] = []
    weak_lines: List[int] = []  # Lines user struggled with
    hesitation_times: Dict[str, float] = {}  # Line ID -> hesitation time
    total_lines: int = 0
    mode: str = "full_read"
    voice_type: str = "alloy"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class RehearsalCreate(BaseModel):
    script_id: str
    user_character: str
    mode: str = "full_read"
    voice_type: str = "alloy"
    user_id: str = "default"

class UserProfile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    subscription_tier: str = "free"  # free, premium
    subscription_plan: Optional[str] = None  # monthly, yearly
    subscription_start: Optional[datetime] = None
    subscription_end: Optional[datetime] = None
    trial_used: bool = False
    trial_end: Optional[datetime] = None
    scripts_count: int = 0
    rehearsals_today: int = 0
    last_rehearsal_date: Optional[str] = None
    total_rehearsals: int = 0
    total_lines_practiced: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class UserProfileCreate(BaseModel):
    device_id: str
    email: Optional[str] = None
    name: Optional[str] = None

# ==================== AUTHENTICATION MODELS ====================

class AuthProvider(BaseModel):
    """Authentication provider info (Apple, Google)"""
    provider: str  # "apple", "google", "email"
    provider_user_id: str
    email: Optional[str] = None
    name: Optional[str] = None

class AuthenticatedUser(BaseModel):
    """User with authentication linked"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: Optional[str] = None
    name: Optional[str] = None
    auth_providers: List[Dict] = []  # List of linked auth providers
    device_ids: List[str] = []  # All devices this user has logged in from
    subscription_tier: str = "free"
    subscription_plan: Optional[str] = None
    subscription_start: Optional[datetime] = None
    subscription_end: Optional[datetime] = None
    trial_used: bool = False
    trial_end: Optional[datetime] = None
    total_rehearsals: int = 0
    total_lines_practiced: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class AppleAuthRequest(BaseModel):
    """Apple Sign-In verification request"""
    identity_token: str  # JWT from Apple
    authorization_code: str
    user_identifier: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    device_id: str

class GoogleAuthRequest(BaseModel):
    """Google Sign-In verification request"""
    id_token: str  # JWT from Google
    device_id: str

class AuthResponse(BaseModel):
    """Response after successful authentication"""
    user_id: str
    email: Optional[str] = None
    name: Optional[str] = None
    is_new_user: bool
    subscription_tier: str
    access_token: str  # Simple token for API calls

class SyncDataRequest(BaseModel):
    """Request to sync user data"""
    user_id: str
    director_notes: Optional[List[Dict]] = None
    performance_stats: Optional[Dict] = None
    settings: Optional[Dict] = None
    last_sync: Optional[datetime] = None

class DirectorNote(BaseModel):
    """Director note for a specific line"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    script_id: str
    line_index: int
    note_type: str  # "blocking", "emotion", "cue", "general"
    content: str
    color: Optional[str] = "#f59e0b"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class PerformanceStats(BaseModel):
    """User's performance statistics"""
    user_id: str
    total_rehearsals: int = 0
    total_lines_completed: int = 0
    total_practice_time: int = 0  # seconds
    average_accuracy: float = 0.0
    streak_days: int = 0
    last_practice_date: Optional[str] = None
    script_stats: List[Dict] = []  # Per-script breakdown
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class UserSettings(BaseModel):
    """User's app settings (synced across devices)"""
    user_id: str
    default_voice: str = "alloy"
    default_voice_speed: float = 1.0
    auto_advance_enabled: bool = True
    hide_lines_by_default: bool = False
    theme: str = "dark"
    notifications_enabled: bool = True
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class SubscriptionUpdate(BaseModel):
    plan: str  # monthly, yearly
    receipt: Optional[str] = None  # App store receipt for validation
    transaction_id: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    voice: str = "alloy"

class AnalyzeScriptRequest(BaseModel):
    raw_text: str

# ==================== HELPER FUNCTIONS ====================

def get_tier_limits(tier: str) -> Dict:
    """Get feature limits for a subscription tier"""
    if tier == "premium":
        return PREMIUM_TIER_LIMITS
    return FREE_TIER_LIMITS

async def check_user_limits(user_id: str, action: str) -> Dict[str, Any]:
    """Check if user can perform an action based on their tier"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        user = await db.users.find_one({"device_id": user_id})
    
    tier = "free"
    if user:
        tier = user.get("subscription_tier", "free")
        # Check if premium subscription is still valid
        if tier == "premium" and user.get("subscription_end"):
            if datetime.utcnow() > user["subscription_end"]:
                tier = "free"
                await db.users.update_one(
                    {"id": user["id"]},
                    {"$set": {"subscription_tier": "free"}}
                )
    
    limits = get_tier_limits(tier)
    
    result = {
        "allowed": True,
        "tier": tier,
        "limits": limits,
        "upgrade_reason": None
    }
    
    if action == "create_script" and user:
        scripts_count = await db.scripts.count_documents({"user_id": user["id"]})
        if scripts_count >= limits["max_scripts"]:
            result["allowed"] = False
            result["upgrade_reason"] = f"You've reached the limit of {limits['max_scripts']} scripts. Upgrade to Premium for unlimited scripts!"
    
    elif action == "create_rehearsal" and user:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if user.get("last_rehearsal_date") == today:
            if user.get("rehearsals_today", 0) >= limits["max_rehearsals_per_day"]:
                result["allowed"] = False
                result["upgrade_reason"] = f"You've used all {limits['max_rehearsals_per_day']} rehearsals for today. Upgrade to Premium for unlimited rehearsals!"
    
    return result

async def parse_script_with_ai(raw_text: str) -> Dict[str, Any]:
    """Use OpenAI to analyze and parse script text into structured format"""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"script-parse-{uuid.uuid4()}",
            system_message="""You are a script parser for film/TV/theater scripts. 
            Analyze the provided script text and extract:
            1. All character names (speaking roles only)
            2. Each line of dialogue with the character who speaks it
            3. Stage directions (non-dialogue text)
            
            Return your response as a valid JSON object with this exact structure:
            {
                "characters": ["CHARACTER1", "CHARACTER2", ...],
                "lines": [
                    {"character": "CHARACTER1", "text": "dialogue text", "is_stage_direction": false},
                    {"character": "", "text": "stage direction text", "is_stage_direction": true},
                    ...
                ]
            }
            
            Rules:
            - Character names should be uppercase
            - Stage directions have empty character field and is_stage_direction=true
            - Preserve the order of lines as they appear
            - Combine multi-line dialogue for the same character into one entry
            - Return ONLY valid JSON, no additional text"""
        ).with_model("openai", "gpt-4o")
        
        user_message = UserMessage(text=f"Parse this script:\n\n{raw_text}")
        response = await chat.send_message(user_message)
        
        response_text = response.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        parsed = json.loads(response_text)
        return parsed
    except Exception as e:
        logger.error(f"Error parsing script with AI: {e}")
        return fallback_parse_script(raw_text)

def fallback_parse_script(raw_text: str) -> Dict[str, Any]:
    """Simple fallback parser for scripts"""
    lines_data = []
    characters = set()
    
    lines = raw_text.strip().split('\n')
    current_character = ""
    current_text = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        potential_char = line.replace(':', '').strip()
        if potential_char.isupper() and len(potential_char.split()) <= 3 and len(potential_char) > 1:
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": ' '.join(current_text),
                    "is_stage_direction": False
                })
            current_character = potential_char
            current_text = []
            characters.add(current_character)
        elif line.startswith('(') or line.startswith('['):
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": ' '.join(current_text),
                    "is_stage_direction": False
                })
                current_text = []
            lines_data.append({
                "character": "",
                "text": line,
                "is_stage_direction": True
            })
        else:
            current_text.append(line)
    
    if current_character and current_text:
        lines_data.append({
            "character": current_character,
            "text": ' '.join(current_text),
            "is_stage_direction": False
        })
    
    return {
        "characters": list(characters),
        "lines": lines_data
    }

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF file"""
    try:
        pdf_file = io.BytesIO(pdf_bytes)
        pdf_reader = PyPDF2.PdfReader(pdf_file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
        return text
    except Exception as e:
        logger.error(f"Error extracting PDF text: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")

def extract_text_from_docx(docx_bytes: bytes) -> str:
    """Extract text from Word document (.docx)"""
    try:
        docx_file = io.BytesIO(docx_bytes)
        doc = Document(docx_file)
        text = ""
        for paragraph in doc.paragraphs:
            text += paragraph.text + "\n"
        return text
    except Exception as e:
        logger.error(f"Error extracting DOCX text: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to parse Word document: {str(e)}")

# ==================== API ROUTES ====================

@api_router.get("/")
async def root():
    return {"message": "ScriptMate API - AI Script Learning Partner for Actors"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ==================== USER & SUBSCRIPTION ROUTES ====================

@api_router.post("/users", response_model=UserProfile)
async def create_or_get_user(user_data: UserProfileCreate):
    """Create a new user or get existing user by device ID"""
    existing = await db.users.find_one({"device_id": user_data.device_id})
    if existing:
        return UserProfile(**existing)
    
    user = UserProfile(
        device_id=user_data.device_id,
        email=user_data.email,
        name=user_data.name
    )
    await db.users.insert_one(user.dict())
    return user

@api_router.get("/users/{device_id}", response_model=UserProfile)
async def get_user(device_id: str):
    """Get user profile by device ID"""
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserProfile(**user)

@api_router.get("/users/{device_id}/limits")
async def get_user_limits(device_id: str):
    """Get user's current limits and usage"""
    user = await db.users.find_one({"device_id": device_id})
    
    tier = "free"
    if user:
        tier = user.get("subscription_tier", "free")
        if tier == "premium" and user.get("subscription_end"):
            if datetime.utcnow() > user["subscription_end"]:
                tier = "free"
    
    limits = get_tier_limits(tier)
    
    # Get current usage
    scripts_count = 0
    rehearsals_today = 0
    if user:
        scripts_count = await db.scripts.count_documents({"user_id": user["id"]})
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if user.get("last_rehearsal_date") == today:
            rehearsals_today = user.get("rehearsals_today", 0)
    
    return {
        "tier": tier,
        "limits": limits,
        "usage": {
            "scripts_count": scripts_count,
            "scripts_limit": limits["max_scripts"],
            "rehearsals_today": rehearsals_today,
            "rehearsals_limit": limits["max_rehearsals_per_day"],
        },
        "is_premium": tier == "premium",
        "subscription_end": user.get("subscription_end") if user else None,
    }

@api_router.get("/subscription/plans")
async def get_subscription_plans(region: str = "US"):
    """Get available subscription plans for a specific region"""
    # Determine region plans
    if region == "GB":
        plans = SUBSCRIPTION_PLANS_BY_REGION["GB"]
    elif region in EU_COUNTRIES or region == "EU":
        plans = SUBSCRIPTION_PLANS_BY_REGION["EU"]
    else:
        plans = SUBSCRIPTION_PLANS_BY_REGION["US"]
    
    return {
        "region": region,
        "currency": plans["currency"],
        "currency_symbol": plans["currency_symbol"],
        "plans": {
            "monthly": plans["monthly"],
            "yearly": plans["yearly"]
        },
        "free_features": FREE_TIER_LIMITS,
        "premium_features": PREMIUM_TIER_LIMITS,
    }

@api_router.get("/subscription/regions")
async def get_all_regions():
    """Get pricing for all available regions"""
    return {
        "regions": {
            "US": {
                "name": "United States",
                "currency": "USD",
                "symbol": "$",
                "monthly_price": SUBSCRIPTION_PLANS_BY_REGION["US"]["monthly"]["price"],
                "yearly_price": SUBSCRIPTION_PLANS_BY_REGION["US"]["yearly"]["price"],
            },
            "GB": {
                "name": "United Kingdom",
                "currency": "GBP",
                "symbol": "£",
                "monthly_price": SUBSCRIPTION_PLANS_BY_REGION["GB"]["monthly"]["price"],
                "yearly_price": SUBSCRIPTION_PLANS_BY_REGION["GB"]["yearly"]["price"],
            },
            "EU": {
                "name": "Europe",
                "currency": "EUR",
                "symbol": "€",
                "monthly_price": SUBSCRIPTION_PLANS_BY_REGION["EU"]["monthly"]["price"],
                "yearly_price": SUBSCRIPTION_PLANS_BY_REGION["EU"]["yearly"]["price"],
            }
        }
    }

@api_router.post("/users/{device_id}/subscribe")
async def subscribe_user(device_id: str, subscription: SubscriptionUpdate):
    """Activate or update user subscription"""
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    plan = SUBSCRIPTION_PLANS.get(subscription.plan)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid subscription plan")
    
    # Calculate subscription dates
    now = datetime.utcnow()
    
    # Check for trial
    trial_end = None
    if not user.get("trial_used") and plan.get("trial_days", 0) > 0:
        trial_end = now + timedelta(days=plan["trial_days"])
    
    # Calculate subscription end
    if plan["period"] == "month":
        sub_end = now + timedelta(days=30)
    else:  # yearly
        sub_end = now + timedelta(days=365)
    
    update_data = {
        "subscription_tier": "premium",
        "subscription_plan": subscription.plan,
        "subscription_start": now,
        "subscription_end": sub_end,
        "updated_at": now,
    }
    
    if trial_end:
        update_data["trial_used"] = True
        update_data["trial_end"] = trial_end
    
    await db.users.update_one(
        {"device_id": device_id},
        {"$set": update_data}
    )
    
    updated_user = await db.users.find_one({"device_id": device_id})
    return UserProfile(**updated_user)

@api_router.post("/users/{device_id}/start-trial")
async def start_trial(device_id: str):
    """Start a 3-day premium trial"""
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.get("trial_used"):
        raise HTTPException(status_code=400, detail="Trial already used")
    
    now = datetime.utcnow()
    trial_end = now + timedelta(days=3)
    
    await db.users.update_one(
        {"device_id": device_id},
        {"$set": {
            "subscription_tier": "premium",
            "trial_used": True,
            "trial_end": trial_end,
            "subscription_end": trial_end,
            "updated_at": now,
        }}
    )
    
    updated_user = await db.users.find_one({"device_id": device_id})
    return UserProfile(**updated_user)

@api_router.post("/users/{device_id}/cancel-subscription")
async def cancel_subscription(device_id: str):
    """Cancel user subscription (keeps access until end date)"""
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    await db.users.update_one(
        {"device_id": device_id},
        {"$set": {
            "subscription_plan": None,
            "updated_at": datetime.utcnow(),
        }}
    )
    
    return {"message": "Subscription cancelled. Access continues until end date."}

# ==================== SCRIPT ROUTES ====================

@api_router.post("/scripts", response_model=Script)
async def create_script(script_data: ScriptCreate):
    """Create a new script from raw text"""
    try:
        # Check user limits
        limits_check = await check_user_limits(script_data.user_id, "create_script")
        if not limits_check["allowed"]:
            raise HTTPException(status_code=403, detail=limits_check["upgrade_reason"])
        
        parsed = await parse_script_with_ai(script_data.raw_text)
        
        characters = []
        char_line_counts = {}
        for line in parsed.get("lines", []):
            if line.get("character"):
                char_line_counts[line["character"]] = char_line_counts.get(line["character"], 0) + 1
        
        for char_name in parsed.get("characters", []):
            characters.append(Character(
                name=char_name,
                line_count=char_line_counts.get(char_name, 0)
            ))
        
        lines = []
        for idx, line in enumerate(parsed.get("lines", [])):
            lines.append(DialogueLine(
                character=line.get("character", ""),
                text=line.get("text", ""),
                is_stage_direction=line.get("is_stage_direction", False),
                line_number=idx
            ))
        
        script = Script(
            title=script_data.title,
            raw_text=script_data.raw_text,
            characters=characters,
            lines=lines,
            user_id=script_data.user_id
        )
        
        await db.scripts.insert_one(script.dict())
        
        # Update user script count
        await db.users.update_one(
            {"$or": [{"id": script_data.user_id}, {"device_id": script_data.user_id}]},
            {"$inc": {"scripts_count": 1}}
        )
        
        return script
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating script: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/scripts/upload")
async def upload_script(
    file: UploadFile = File(...),
    title: str = Form(...),
    user_id: str = Form(default="default")
):
    """Upload a PDF, Word document, or text file as a script"""
    try:
        # Check user limits
        limits_check = await check_user_limits(user_id, "create_script")
        if not limits_check["allowed"]:
            raise HTTPException(status_code=403, detail=limits_check["upgrade_reason"])
        
        content = await file.read()
        filename_lower = file.filename.lower()
        
        # Check file size for free tier
        file_size_mb = len(content) / (1024 * 1024)
        max_size = limits_check["limits"]["max_file_size_mb"]
        if file_size_mb > max_size:
            raise HTTPException(
                status_code=403,
                detail=f"File size ({file_size_mb:.1f}MB) exceeds limit ({max_size}MB). Upgrade to Premium for larger files!"
            )
        
        if filename_lower.endswith('.pdf'):
            raw_text = extract_text_from_pdf(content)
        elif filename_lower.endswith(('.docx',)):
            raw_text = extract_text_from_docx(content)
        elif filename_lower.endswith(('.txt', '.text', '.rtf')):
            try:
                raw_text = content.decode('utf-8')
            except UnicodeDecodeError:
                raw_text = content.decode('latin-1')
        else:
            try:
                raw_text = content.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    raw_text = content.decode('latin-1')
                except Exception:
                    raise HTTPException(
                        status_code=400, 
                        detail="Unsupported file type. Use PDF, Word (.docx), or text files (.txt)"
                    )
        
        script_data = ScriptCreate(title=title, raw_text=raw_text, user_id=user_id)
        return await create_script(script_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading script: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/scripts", response_model=List[Script])
async def get_scripts(user_id: str = "default"):
    """Get all scripts for a user"""
    scripts = await db.scripts.find({"user_id": user_id}).sort("created_at", -1).to_list(100)
    return [Script(**s) for s in scripts]

@api_router.get("/scripts/{script_id}", response_model=Script)
async def get_script(script_id: str):
    """Get a specific script by ID"""
    script = await db.scripts.find_one({"id": script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    return Script(**script)

@api_router.put("/scripts/{script_id}")
async def update_script(script_id: str, update_data: ScriptUpdate):
    """Update script settings"""
    script = await db.scripts.find_one({"id": script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    update_dict = {"updated_at": datetime.utcnow()}
    
    if update_data.title:
        update_dict["title"] = update_data.title
    
    if update_data.user_character:
        characters = script.get("characters", [])
        for char in characters:
            char["is_user_character"] = (char["name"] == update_data.user_character)
        update_dict["characters"] = characters
    
    if update_data.characters:
        update_dict["characters"] = update_data.characters
    
    await db.scripts.update_one({"id": script_id}, {"$set": update_dict})
    updated = await db.scripts.find_one({"id": script_id})
    return Script(**updated)

@api_router.delete("/scripts/{script_id}")
async def delete_script(script_id: str):
    """Delete a script"""
    script = await db.scripts.find_one({"id": script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    result = await db.scripts.delete_one({"id": script_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Script not found")
    
    await db.rehearsals.delete_many({"script_id": script_id})
    
    # Update user script count
    if script.get("user_id"):
        await db.users.update_one(
            {"$or": [{"id": script["user_id"]}, {"device_id": script["user_id"]}]},
            {"$inc": {"scripts_count": -1}}
        )
    
    return {"message": "Script deleted successfully"}

# ==================== REHEARSAL ROUTES ====================

@api_router.post("/rehearsals", response_model=RehearsalSession)
async def create_rehearsal(rehearsal_data: RehearsalCreate):
    """Create a new rehearsal session"""
    # Check user limits
    limits_check = await check_user_limits(rehearsal_data.user_id, "create_rehearsal")
    if not limits_check["allowed"]:
        raise HTTPException(status_code=403, detail=limits_check["upgrade_reason"])
    
    # Check if mode is allowed
    if rehearsal_data.mode not in limits_check["limits"]["available_modes"]:
        raise HTTPException(
            status_code=403,
            detail=f"'{rehearsal_data.mode}' mode requires Premium. Upgrade to unlock all training modes!"
        )
    
    # Check if voice is allowed
    if rehearsal_data.voice_type not in limits_check["limits"]["available_voices"]:
        raise HTTPException(
            status_code=403,
            detail=f"'{rehearsal_data.voice_type}' voice requires Premium. Upgrade to unlock all AI voices!"
        )
    
    script = await db.scripts.find_one({"id": rehearsal_data.script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    total_lines = sum(1 for line in script.get("lines", []) 
                     if line.get("character") == rehearsal_data.user_character)
    
    rehearsal = RehearsalSession(
        script_id=rehearsal_data.script_id,
        user_id=rehearsal_data.user_id,
        user_character=rehearsal_data.user_character,
        mode=rehearsal_data.mode,
        voice_type=rehearsal_data.voice_type,
        total_lines=total_lines
    )
    
    await db.rehearsals.insert_one(rehearsal.dict())
    
    # Update user rehearsal count
    today = datetime.utcnow().strftime("%Y-%m-%d")
    user = await db.users.find_one({"$or": [{"id": rehearsal_data.user_id}, {"device_id": rehearsal_data.user_id}]})
    if user:
        if user.get("last_rehearsal_date") == today:
            await db.users.update_one(
                {"_id": user["_id"]},
                {"$inc": {"rehearsals_today": 1, "total_rehearsals": 1}}
            )
        else:
            await db.users.update_one(
                {"_id": user["_id"]},
                {"$set": {"last_rehearsal_date": today, "rehearsals_today": 1}, "$inc": {"total_rehearsals": 1}}
            )
    
    return rehearsal

@api_router.get("/rehearsals", response_model=List[RehearsalSession])
async def get_rehearsals(user_id: str = "default"):
    """Get all rehearsal sessions for a user"""
    rehearsals = await db.rehearsals.find({"user_id": user_id}).sort("created_at", -1).to_list(100)
    return [RehearsalSession(**r) for r in rehearsals]

@api_router.get("/rehearsals/{rehearsal_id}", response_model=RehearsalSession)
async def get_rehearsal(rehearsal_id: str):
    """Get a specific rehearsal session"""
    rehearsal = await db.rehearsals.find_one({"id": rehearsal_id})
    if not rehearsal:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    return RehearsalSession(**rehearsal)

@api_router.put("/rehearsals/{rehearsal_id}")
async def update_rehearsal(rehearsal_id: str, update_data: Dict[str, Any]):
    """Update rehearsal progress"""
    rehearsal = await db.rehearsals.find_one({"id": rehearsal_id})
    if not rehearsal:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    
    update_data["updated_at"] = datetime.utcnow()
    await db.rehearsals.update_one({"id": rehearsal_id}, {"$set": update_data})
    
    # Update total lines practiced
    if "completed_lines" in update_data:
        lines_count = len(update_data["completed_lines"])
        user_id = rehearsal.get("user_id")
        if user_id:
            await db.users.update_one(
                {"$or": [{"id": user_id}, {"device_id": user_id}]},
                {"$inc": {"total_lines_practiced": lines_count}}
            )
    
    updated = await db.rehearsals.find_one({"id": rehearsal_id})
    return RehearsalSession(**updated)

@api_router.delete("/rehearsals/{rehearsal_id}")
async def delete_rehearsal(rehearsal_id: str):
    """Delete a rehearsal session"""
    result = await db.rehearsals.delete_one({"id": rehearsal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    return {"message": "Rehearsal session deleted"}

# ==================== ANALYTICS ROUTES (PREMIUM) ====================

@api_router.get("/users/{device_id}/stats")
async def get_user_stats(device_id: str):
    """Get user statistics (basic for free, detailed for premium)"""
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    tier = user.get("subscription_tier", "free")
    
    # Basic stats for all users
    stats = {
        "total_rehearsals": user.get("total_rehearsals", 0),
        "total_lines_practiced": user.get("total_lines_practiced", 0),
        "scripts_count": user.get("scripts_count", 0),
    }
    
    # Premium stats
    if tier == "premium":
        # Get weak lines analysis
        rehearsals = await db.rehearsals.find({"user_id": user["id"]}).to_list(100)
        weak_lines_count = sum(len(r.get("weak_lines", [])) for r in rehearsals)
        missed_lines_count = sum(len(r.get("missed_lines", [])) for r in rehearsals)
        
        stats["weak_lines_count"] = weak_lines_count
        stats["missed_lines_count"] = missed_lines_count
        stats["accuracy_rate"] = round(
            (stats["total_lines_practiced"] - missed_lines_count) / max(stats["total_lines_practiced"], 1) * 100, 1
        )
        stats["has_detailed_stats"] = True
    else:
        stats["has_detailed_stats"] = False
        stats["upgrade_message"] = "Upgrade to Premium to track weak lines and see detailed analytics!"
    
    return stats

# ==================== ANALYZE ROUTES ====================

@api_router.post("/analyze")
async def analyze_script(request: AnalyzeScriptRequest):
    """Analyze raw script text and return parsed structure"""
    try:
        parsed = await parse_script_with_ai(request.raw_text)
        return parsed
    except Exception as e:
        logger.error(f"Error analyzing script: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== AUTHENTICATION ROUTES ====================

def generate_access_token(user_id: str) -> str:
    """Generate a simple access token for API calls"""
    import hashlib
    import time
    token_data = f"{user_id}:{time.time()}:{uuid.uuid4()}"
    return hashlib.sha256(token_data.encode()).hexdigest()

async def find_or_create_user_by_auth(provider: str, provider_user_id: str, email: str = None, name: str = None, device_id: str = None) -> tuple:
    """Find existing user or create new one based on auth provider"""
    # First, try to find by auth provider
    existing = await db.authenticated_users.find_one({
        "auth_providers": {
            "$elemMatch": {
                "provider": provider,
                "provider_user_id": provider_user_id
            }
        }
    })
    
    if existing:
        # Update device list if new device
        if device_id and device_id not in existing.get("device_ids", []):
            await db.authenticated_users.update_one(
                {"id": existing["id"]},
                {
                    "$addToSet": {"device_ids": device_id},
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )
        return existing, False
    
    # Try to find by email
    if email:
        existing_by_email = await db.authenticated_users.find_one({"email": email})
        if existing_by_email:
            # Link this auth provider to existing account
            await db.authenticated_users.update_one(
                {"id": existing_by_email["id"]},
                {
                    "$addToSet": {
                        "auth_providers": {
                            "provider": provider,
                            "provider_user_id": provider_user_id,
                            "email": email,
                            "name": name
                        },
                        "device_ids": device_id
                    },
                    "$set": {"updated_at": datetime.utcnow()}
                }
            )
            updated = await db.authenticated_users.find_one({"id": existing_by_email["id"]})
            return updated, False
    
    # Check if device has existing data to migrate
    old_user = None
    if device_id:
        old_user = await db.users.find_one({"device_id": device_id})
    
    # Create new authenticated user
    new_user = AuthenticatedUser(
        email=email,
        name=name,
        auth_providers=[{
            "provider": provider,
            "provider_user_id": provider_user_id,
            "email": email,
            "name": name
        }],
        device_ids=[device_id] if device_id else [],
        subscription_tier=old_user.get("subscription_tier", "free") if old_user else "free",
        total_rehearsals=old_user.get("total_rehearsals", 0) if old_user else 0,
        total_lines_practiced=old_user.get("total_lines_practiced", 0) if old_user else 0,
    )
    
    await db.authenticated_users.insert_one(new_user.dict())
    
    # Migrate scripts from old device ID to new user ID
    if device_id:
        await db.scripts.update_many(
            {"user_id": device_id},
            {"$set": {"user_id": new_user.id}}
        )
        await db.rehearsals.update_many(
            {"user_id": device_id},
            {"$set": {"user_id": new_user.id}}
        )
    
    return new_user.dict(), True

@api_router.post("/auth/apple", response_model=AuthResponse)
async def apple_sign_in(request: AppleAuthRequest):
    """Authenticate with Apple Sign-In"""
    try:
        # In production, you'd verify the identity_token with Apple's servers
        # For now, we trust the client-side verification and use the user_identifier
        
        user, is_new = await find_or_create_user_by_auth(
            provider="apple",
            provider_user_id=request.user_identifier,
            email=request.email,
            name=request.full_name,
            device_id=request.device_id
        )
        
        access_token = generate_access_token(user["id"])
        
        # Store the token
        await db.auth_tokens.update_one(
            {"user_id": user["id"]},
            {
                "$set": {
                    "token": access_token,
                    "created_at": datetime.utcnow(),
                    "expires_at": datetime.utcnow() + timedelta(days=30)
                }
            },
            upsert=True
        )
        
        return AuthResponse(
            user_id=user["id"],
            email=user.get("email"),
            name=user.get("name"),
            is_new_user=is_new,
            subscription_tier=user.get("subscription_tier", "free"),
            access_token=access_token
        )
    except Exception as e:
        logger.error(f"Apple Sign-In error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/auth/google", response_model=AuthResponse)
async def google_sign_in(request: GoogleAuthRequest):
    """Authenticate with Google Sign-In"""
    try:
        # Decode the Google ID token to get user info
        # In production, verify with Google's servers
        import base64
        import json
        
        # Decode JWT payload (middle part)
        parts = request.id_token.split('.')
        if len(parts) != 3:
            raise HTTPException(status_code=400, detail="Invalid token format")
        
        # Add padding if needed
        payload = parts[1]
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += '=' * padding
        
        try:
            decoded = json.loads(base64.urlsafe_b64decode(payload))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid token")
        
        google_user_id = decoded.get("sub")
        email = decoded.get("email")
        name = decoded.get("name")
        
        if not google_user_id:
            raise HTTPException(status_code=400, detail="Invalid token: missing user ID")
        
        user, is_new = await find_or_create_user_by_auth(
            provider="google",
            provider_user_id=google_user_id,
            email=email,
            name=name,
            device_id=request.device_id
        )
        
        access_token = generate_access_token(user["id"])
        
        # Store the token
        await db.auth_tokens.update_one(
            {"user_id": user["id"]},
            {
                "$set": {
                    "token": access_token,
                    "created_at": datetime.utcnow(),
                    "expires_at": datetime.utcnow() + timedelta(days=30)
                }
            },
            upsert=True
        )
        
        return AuthResponse(
            user_id=user["id"],
            email=user.get("email"),
            name=user.get("name"),
            is_new_user=is_new,
            subscription_tier=user.get("subscription_tier", "free"),
            access_token=access_token
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Google Sign-In error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/auth/user/{user_id}")
async def get_authenticated_user(user_id: str):
    """Get authenticated user profile"""
    user = await db.authenticated_users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Don't return sensitive auth info
    return {
        "id": user["id"],
        "email": user.get("email"),
        "name": user.get("name"),
        "subscription_tier": user.get("subscription_tier", "free"),
        "total_rehearsals": user.get("total_rehearsals", 0),
        "total_lines_practiced": user.get("total_lines_practiced", 0),
        "devices_count": len(user.get("device_ids", [])),
        "created_at": user.get("created_at"),
    }

@api_router.post("/auth/logout")
async def logout(user_id: str, device_id: str = None):
    """Logout user (optionally from specific device)"""
    if device_id:
        # Just remove this device
        await db.authenticated_users.update_one(
            {"id": user_id},
            {"$pull": {"device_ids": device_id}}
        )
    else:
        # Invalidate all tokens
        await db.auth_tokens.delete_many({"user_id": user_id})
    
    return {"message": "Logged out successfully"}

# ==================== SYNC ROUTES ====================

@api_router.post("/sync/push")
async def push_sync_data(request: SyncDataRequest):
    """Push local data to server for sync"""
    try:
        user = await db.authenticated_users.find_one({"id": request.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Sync director notes
        if request.director_notes:
            for note in request.director_notes:
                note["user_id"] = request.user_id
                await db.director_notes.update_one(
                    {"id": note.get("id")},
                    {"$set": note},
                    upsert=True
                )
        
        # Sync performance stats
        if request.performance_stats:
            request.performance_stats["user_id"] = request.user_id
            request.performance_stats["updated_at"] = datetime.utcnow()
            await db.performance_stats.update_one(
                {"user_id": request.user_id},
                {"$set": request.performance_stats},
                upsert=True
            )
        
        # Sync settings
        if request.settings:
            request.settings["user_id"] = request.user_id
            request.settings["updated_at"] = datetime.utcnow()
            await db.user_settings.update_one(
                {"user_id": request.user_id},
                {"$set": request.settings},
                upsert=True
            )
        
        return {
            "success": True,
            "synced_at": datetime.utcnow().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sync push error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/sync/pull/{user_id}")
async def pull_sync_data(user_id: str, last_sync: str = None):
    """Pull all user data from server"""
    try:
        user = await db.authenticated_users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get all user's scripts
        scripts = await db.scripts.find({"user_id": user_id}).to_list(100)
        
        # Get director notes
        director_notes = await db.director_notes.find({"user_id": user_id}).to_list(500)
        
        # Get performance stats
        performance_stats = await db.performance_stats.find_one({"user_id": user_id})
        
        # Get settings
        settings = await db.user_settings.find_one({"user_id": user_id})
        
        return {
            "user": {
                "id": user["id"],
                "email": user.get("email"),
                "name": user.get("name"),
                "subscription_tier": user.get("subscription_tier", "free"),
            },
            "scripts": scripts,
            "director_notes": director_notes,
            "performance_stats": performance_stats,
            "settings": settings,
            "synced_at": datetime.utcnow().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sync pull error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== DIRECTOR NOTES ROUTES ====================

@api_router.get("/notes/{script_id}")
async def get_script_notes(script_id: str, user_id: str):
    """Get all director notes for a script"""
    notes = await db.director_notes.find({
        "script_id": script_id,
        "user_id": user_id
    }).to_list(500)
    return notes

@api_router.post("/notes")
async def create_note(note: DirectorNote, user_id: str):
    """Create or update a director note"""
    note_dict = note.dict()
    note_dict["user_id"] = user_id
    
    await db.director_notes.update_one(
        {"id": note.id},
        {"$set": note_dict},
        upsert=True
    )
    return note_dict

@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    """Delete a director note"""
    result = await db.director_notes.delete_one({"id": note_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}

# ==================== PERFORMANCE STATS ROUTES ====================

@api_router.get("/stats/{user_id}")
async def get_user_stats(user_id: str):
    """Get user's performance statistics"""
    stats = await db.performance_stats.find_one({"user_id": user_id})
    if not stats:
        # Return default stats
        return {
            "user_id": user_id,
            "total_rehearsals": 0,
            "total_lines_completed": 0,
            "total_practice_time": 0,
            "average_accuracy": 0,
            "streak_days": 0,
            "last_practice_date": None,
            "script_stats": []
        }
    return stats

@api_router.post("/stats/{user_id}/update")
async def update_user_stats(user_id: str, stats_update: Dict[str, Any]):
    """Update user's performance statistics after a rehearsal"""
    current = await db.performance_stats.find_one({"user_id": user_id})
    
    if current:
        # Merge updates
        update_data = {
            "total_rehearsals": current.get("total_rehearsals", 0) + stats_update.get("rehearsals_delta", 0),
            "total_lines_completed": current.get("total_lines_completed", 0) + stats_update.get("lines_delta", 0),
            "total_practice_time": current.get("total_practice_time", 0) + stats_update.get("time_delta", 0),
            "last_practice_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "updated_at": datetime.utcnow()
        }
        
        # Update accuracy (weighted average)
        if stats_update.get("accuracy"):
            old_total = current.get("total_rehearsals", 0)
            old_accuracy = current.get("average_accuracy", 0)
            new_accuracy = stats_update["accuracy"]
            update_data["average_accuracy"] = ((old_accuracy * old_total) + new_accuracy) / (old_total + 1)
        
        # Update streak
        last_date = current.get("last_practice_date")
        today = datetime.utcnow().strftime("%Y-%m-%d")
        yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
        
        if last_date == yesterday:
            update_data["streak_days"] = current.get("streak_days", 0) + 1
        elif last_date != today:
            update_data["streak_days"] = 1
        
        await db.performance_stats.update_one(
            {"user_id": user_id},
            {"$set": update_data}
        )
    else:
        # Create new stats
        new_stats = {
            "user_id": user_id,
            "total_rehearsals": stats_update.get("rehearsals_delta", 1),
            "total_lines_completed": stats_update.get("lines_delta", 0),
            "total_practice_time": stats_update.get("time_delta", 0),
            "average_accuracy": stats_update.get("accuracy", 0),
            "streak_days": 1,
            "last_practice_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "script_stats": [],
            "updated_at": datetime.utcnow()
        }
        await db.performance_stats.insert_one(new_stats)
    
    return {"success": True}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
