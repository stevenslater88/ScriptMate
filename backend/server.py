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
import tempfile
from docx import Document
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText
from elevenlabs import ElevenLabs
from elevenlabs.types import VoiceSettings

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Get API key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', '')

# Initialize ElevenLabs client
eleven_client = None
if ELEVENLABS_API_KEY:
    eleven_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

# Preset voices for Multi-Voice feature (ElevenLabs voice IDs)
PRESET_VOICES = {
    "rachel": {
        "id": "21m00Tcm4TlvDq8ikWAM",
        "name": "Rachel",
        "accent": "American",
        "gender": "Female",
        "description": "Calm, young female voice"
    },
    "drew": {
        "id": "29vD33N1CtxCmqQRPOHJ",
        "name": "Drew",
        "accent": "American",
        "gender": "Male",
        "description": "Well-rounded, confident male voice"
    },
    "clyde": {
        "id": "2EiwWnXFnvU5JabPnv8n",
        "name": "Clyde",
        "accent": "American",
        "gender": "Male",
        "description": "War veteran, deep gravelly voice"
    },
    "paul": {
        "id": "5Q0t7uMcjvnagumLfvZi",
        "name": "Paul",
        "accent": "American",
        "gender": "Male",
        "description": "Ground reporter, authoritative"
    },
    "domi": {
        "id": "AZnzlk1XvdvUeBnXmlld",
        "name": "Domi",
        "accent": "American",
        "gender": "Female",
        "description": "Strong, confident female voice"
    },
    "dave": {
        "id": "CYw3kZ02Hs0563khs1Fj",
        "name": "Dave",
        "accent": "British-Essex",
        "gender": "Male",
        "description": "Conversational British male"
    },
    "fin": {
        "id": "D38z5RcWu1voky8WS1ja",
        "name": "Fin",
        "accent": "Irish",
        "gender": "Male",
        "description": "Sailor, older Irish male"
    },
    "sarah": {
        "id": "EXAVITQu4vr4xnSDxMaL",
        "name": "Sarah",
        "accent": "American",
        "gender": "Female",
        "description": "Soft, expressive female"
    },
    "antoni": {
        "id": "ErXwobaYiN019PkySvjV",
        "name": "Antoni",
        "accent": "American",
        "gender": "Male",
        "description": "Well-rounded, crisp male"
    },
    "thomas": {
        "id": "GBv7mTt0atIp3Br8iCZE",
        "name": "Thomas",
        "accent": "American",
        "gender": "Male",
        "description": "Calm, mature male"
    },
    "charlie": {
        "id": "IKne3meq5aSn9XLyUdCD",
        "name": "Charlie",
        "accent": "Australian",
        "gender": "Male",
        "description": "Casual Australian male"
    },
    "emily": {
        "id": "LcfcDJNUP1GQjkzn1xUU",
        "name": "Emily",
        "accent": "American",
        "gender": "Female",
        "description": "Calm, warm female"
    },
    "elli": {
        "id": "MF3mGyEYCl7XYWbV9V6O",
        "name": "Elli",
        "accent": "American",
        "gender": "Female",
        "description": "Emotional, expressive young female"
    },
    "callum": {
        "id": "N2lVS1w4EtoT3dr4eOWO",
        "name": "Callum",
        "accent": "Transatlantic",
        "gender": "Male",
        "description": "Hoarse, intense male"
    },
    "patrick": {
        "id": "ODq5zmih8GrVes37Dizd",
        "name": "Patrick",
        "accent": "American",
        "gender": "Male",
        "description": "Shouty, intense male"
    },
    "harry": {
        "id": "SOYHLrjzK2X1ezoPC6cr",
        "name": "Harry",
        "accent": "American",
        "gender": "Male",
        "description": "Anxious, young male"
    },
    "liam": {
        "id": "TX3LPaxmHKxFdv7VOQHJ",
        "name": "Liam",
        "accent": "American",
        "gender": "Male",
        "description": "Articulate, confident male"
    },
    "dorothy": {
        "id": "ThT5KcBeYPX3keUQqHPh",
        "name": "Dorothy",
        "accent": "British",
        "gender": "Female",
        "description": "Pleasant, British female"
    },
    "josh": {
        "id": "TxGEqnHWrfWFTfGW9XjX",
        "name": "Josh",
        "accent": "American",
        "gender": "Male",
        "description": "Deep, young American male"
    },
    "arnold": {
        "id": "VR6AewLTigWG4xSOukaG",
        "name": "Arnold",
        "accent": "American",
        "gender": "Male",
        "description": "Crisp, older male"
    },
    "charlotte": {
        "id": "XB0fDUnXU5powFXDhCwa",
        "name": "Charlotte",
        "accent": "Swedish",
        "gender": "Female",
        "description": "Seductive, Swedish female"
    },
    "matilda": {
        "id": "XrExE9yKIg1WjnnlVkGX",
        "name": "Matilda",
        "accent": "American",
        "gender": "Female",
        "description": "Warm, friendly female"
    },
    "james": {
        "id": "ZQe5CZNOzWyzPSCn5a3c",
        "name": "James",
        "accent": "Australian",
        "gender": "Male",
        "description": "Deep, calm Australian male"
    },
    "joseph": {
        "id": "Zlb1dXrM653N07WRdFW3",
        "name": "Joseph",
        "accent": "British",
        "gender": "Male",
        "description": "British, articulate male"
    },
    "jeremy": {
        "id": "bVMeCyTHy58xNoL34h3p",
        "name": "Jeremy",
        "accent": "Irish-American",
        "gender": "Male",
        "description": "Irish-American, excited male"
    },
    "michael": {
        "id": "flq6f7yk4E4fJM5XTYuZ",
        "name": "Michael",
        "accent": "American",
        "gender": "Male",
        "description": "Deep, older male"
    },
    "ethan": {
        "id": "g5CIjZEefAph4nQFvHAz",
        "name": "Ethan",
        "accent": "American",
        "gender": "Male",
        "description": "Bright, young male"
    },
    "george": {
        "id": "JBFqnCBsd6RMkjVDRZzb",
        "name": "George",
        "accent": "British",
        "gender": "Male",
        "description": "Warm British male"
    },
    "freya": {
        "id": "jsCqWAovK2LkecY7zXl4",
        "name": "Freya",
        "accent": "American",
        "gender": "Female",
        "description": "Confident, expressive female"
    },
    "gigi": {
        "id": "jBpfuIE2acCO8z3wKNLl",
        "name": "Gigi",
        "accent": "American",
        "gender": "Female",
        "description": "Childish, animated female"
    }
}

# ==================== DIALECT COACH CONFIGURATION ====================

# Supported accents with pronunciation guides
ACCENT_PROFILES = {
    "british_rp": {
        "id": "british_rp",
        "name": "British RP",
        "description": "Received Pronunciation - Standard British English",
        "region": "United Kingdom",
        "key_features": [
            "Non-rhotic (silent R after vowels)",
            "Long vowels (bath, grass, dance)",
            "Clear 'T' pronunciation",
            "Distinct vowel sounds"
        ],
        "common_tips": [
            "Drop the R at the end of words like 'car', 'water'",
            "Use 'ah' sound in words like 'bath', 'grass', 'dance'",
            "Pronounce T clearly, don't tap it",
            "Make vowels longer and more distinct"
        ],
        "example_words": {
            "water": "WAW-tuh (not WAH-ter)",
            "butter": "BUH-tuh (not BUH-ter)",
            "bath": "BAHTH (long A)",
            "can't": "CAHNT (not KANT)"
        }
    },
    "american_general": {
        "id": "american_general",
        "name": "American General",
        "description": "General American - Standard US English",
        "region": "United States",
        "key_features": [
            "Rhotic (R is always pronounced)",
            "Flat vowels",
            "Flapped T (sounds like D)",
            "Reduced vowels in unstressed syllables"
        ],
        "common_tips": [
            "Always pronounce the R sound",
            "Use flapped T between vowels (water = wah-der)",
            "Keep vowels relatively flat",
            "Reduce unstressed vowels to 'uh'"
        ],
        "example_words": {
            "water": "WAH-der (flapped T)",
            "butter": "BUH-der",
            "tomato": "tuh-MAY-toh",
            "schedule": "SKED-jool"
        }
    },
    "australian": {
        "id": "australian",
        "name": "Australian",
        "description": "General Australian English",
        "region": "Australia",
        "key_features": [
            "Rising intonation at end of statements",
            "Vowel shifts (day sounds like 'die')",
            "Non-rhotic like British",
            "Distinctive 'i' sound"
        ],
        "common_tips": [
            "Raise pitch at the end of sentences",
            "Shift 'ay' sounds towards 'eye'",
            "Drop R at end of words",
            "Shorten words where possible"
        ],
        "example_words": {
            "day": "DAI (like 'die')",
            "mate": "MAIT",
            "no": "NAU",
            "today": "tuh-DAI"
        }
    },
    "irish": {
        "id": "irish",
        "name": "Irish",
        "description": "Standard Irish English",
        "region": "Ireland",
        "key_features": [
            "Soft, musical intonation",
            "TH often becomes T or D",
            "Strong R sounds",
            "Distinctive vowel patterns"
        ],
        "common_tips": [
            "Keep a lilting, musical quality",
            "Pronounce TH as T or D ('three' = 'tree')",
            "Roll or tap your Rs",
            "Make vowels more open"
        ],
        "example_words": {
            "three": "TREE",
            "think": "TINK",
            "thirty": "TIRTY",
            "film": "FILL-um"
        }
    },
    "scottish": {
        "id": "scottish",
        "name": "Scottish",
        "description": "Standard Scottish English",
        "region": "Scotland",
        "key_features": [
            "Rolled Rs",
            "Distinct vowel sounds",
            "Glottal stops",
            "WH pronounced with breath"
        ],
        "common_tips": [
            "Roll your Rs strongly",
            "Use glottal stops for T sounds",
            "Pronounce WH with a breath ('which' vs 'witch')",
            "Keep vowels short and clipped"
        ],
        "example_words": {
            "water": "WAH-ter (rolled R)",
            "butter": "BUH-ter",
            "right": "RRRIGHT (rolled)",
            "loch": "LOKH (guttural)"
        }
    },
    "southern_american": {
        "id": "southern_american",
        "name": "Southern American",
        "description": "Southern US English",
        "region": "Southern United States",
        "key_features": [
            "Drawled vowels",
            "Monophthongization (eye becomes ah)",
            "Distinctive 'y'all'",
            "Slower speech pace"
        ],
        "common_tips": [
            "Stretch out vowel sounds",
            "Turn 'I' into 'AH' in some words",
            "Speak at a relaxed pace",
            "Add a slight twang"
        ],
        "example_words": {
            "I": "AH",
            "time": "TAHM",
            "nice": "NAHS",
            "right": "RAHT"
        }
    }
}

# Initialize Whisper STT client
stt_client = None
if EMERGENT_LLM_KEY:
    stt_client = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)

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
            "price": 4.99,
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
            "price": 39.99,
            "currency": "GBP",
            "period": "year",
            "trial_days": 3,
            "savings": "Save 44%",
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

class ElevenLabsTTSRequest(BaseModel):
    """Request for ElevenLabs TTS generation"""
    text: str
    voice_id: str  # ElevenLabs voice ID or preset key
    stability: float = 0.5
    similarity_boost: float = 0.75
    style: float = 0.0
    use_speaker_boost: bool = True

class CharacterVoiceAssignment(BaseModel):
    """Voice assignment for a character in a script"""
    character_name: str
    voice_key: str  # Key from PRESET_VOICES (e.g., "rachel", "drew")
    voice_id: str   # ElevenLabs voice ID

class ScriptVoiceSettings(BaseModel):
    """Voice settings for all characters in a script"""
    script_id: str
    character_voices: List[CharacterVoiceAssignment] = []
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class AnalyzeScriptRequest(BaseModel):
    raw_text: str

# ==================== DIALECT COACH MODELS ====================

class ProblemWord(BaseModel):
    """A word that was mispronounced"""
    word: str
    expected_pronunciation: str
    user_pronunciation: str
    tip: str
    severity: str  # "minor", "moderate", "significant"

class DialectAnalysisResult(BaseModel):
    """Result of dialect/pronunciation analysis"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    accent_id: str
    accent_name: str
    expected_text: str
    transcribed_text: str
    pronunciation_score: int  # 0-100
    pace_assessment: str  # "too_slow", "too_fast", "good"
    pace_wpm: int  # Words per minute
    problem_words: List[ProblemWord] = []
    tips: List[str] = []
    overall_feedback: str
    audio_duration_seconds: float
    created_at: datetime = Field(default_factory=datetime.utcnow)

class DialectAttempt(BaseModel):
    """A user's dialect practice attempt stored for tracking"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    accent_id: str
    expected_text: str
    pronunciation_score: int
    pace_assessment: str
    problem_word_count: int
    created_at: datetime = Field(default_factory=datetime.utcnow)

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
    """Get all scripts for a user - optimized with projection to exclude large fields"""
    # Exclude raw_text from list view for performance (can be fetched in detail view)
    projection = {
        "_id": 0,
        "id": 1,
        "user_id": 1,
        "title": 1,
        "characters": 1,
        "scenes": 1,
        "lines": 1,
        "selected_character": 1,
        "created_at": 1,
        "last_rehearsed": 1,
        "training_mode": 1,
        "mastery_level": 1,
    }
    scripts = await db.scripts.find({"user_id": user_id}, projection).sort("created_at", -1).to_list(100)
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

# ==================== ELEVENLABS TTS ROUTES (PREMIUM) ====================

@api_router.get("/voices/presets")
async def get_preset_voices():
    """Get all available preset voices for Multi-Voice feature"""
    voices_list = []
    for key, voice in PRESET_VOICES.items():
        voices_list.append({
            "key": key,
            "id": voice["id"],
            "name": voice["name"],
            "accent": voice["accent"],
            "gender": voice["gender"],
            "description": voice["description"]
        })
    
    # Group by gender for easier UI selection
    male_voices = [v for v in voices_list if v["gender"] == "Male"]
    female_voices = [v for v in voices_list if v["gender"] == "Female"]
    
    return {
        "voices": voices_list,
        "grouped": {
            "male": male_voices,
            "female": female_voices
        },
        "total": len(voices_list)
    }

@api_router.post("/tts/elevenlabs/generate")
async def generate_elevenlabs_tts(request: ElevenLabsTTSRequest):
    """Generate TTS audio using ElevenLabs (Premium feature)"""
    if not eleven_client:
        raise HTTPException(status_code=503, detail="ElevenLabs service not configured")
    
    try:
        # Resolve voice_id if a preset key was provided
        voice_id = request.voice_id
        if request.voice_id in PRESET_VOICES:
            voice_id = PRESET_VOICES[request.voice_id]["id"]
        
        # Generate audio using ElevenLabs
        voice_settings = VoiceSettings(
            stability=request.stability,
            similarity_boost=request.similarity_boost,
            style=request.style,
            use_speaker_boost=request.use_speaker_boost
        )
        
        audio_generator = eleven_client.text_to_speech.convert(
            text=request.text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            voice_settings=voice_settings
        )
        
        # Collect audio data
        audio_data = b""
        for chunk in audio_generator:
            audio_data += chunk
        
        # Convert to base64 for transfer
        audio_b64 = base64.b64encode(audio_data).decode()
        
        return {
            "audio_base64": audio_b64,
            "audio_url": f"data:audio/mpeg;base64,{audio_b64}",
            "text": request.text,
            "voice_id": voice_id,
            "format": "mp3"
        }
        
    except Exception as e:
        logger.error(f"ElevenLabs TTS error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")

@api_router.get("/scripts/{script_id}/voices")
async def get_script_voice_settings(script_id: str):
    """Get voice assignments for all characters in a script"""
    settings = await db.script_voice_settings.find_one({"script_id": script_id})
    if not settings:
        # Return empty settings
        return {
            "script_id": script_id,
            "character_voices": [],
            "updated_at": None
        }
    
    # Remove MongoDB _id
    settings.pop("_id", None)
    return settings

@api_router.post("/scripts/{script_id}/voices")
async def save_script_voice_settings(script_id: str, voice_settings: ScriptVoiceSettings):
    """Save voice assignments for characters in a script"""
    # Verify script exists
    script = await db.scripts.find_one({"id": script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    settings_dict = voice_settings.dict()
    settings_dict["script_id"] = script_id
    settings_dict["updated_at"] = datetime.utcnow()
    
    await db.script_voice_settings.update_one(
        {"script_id": script_id},
        {"$set": settings_dict},
        upsert=True
    )
    
    return {
        "success": True,
        "script_id": script_id,
        "character_voices": settings_dict["character_voices"]
    }

@api_router.put("/scripts/{script_id}/voices/{character_name}")
async def update_character_voice(script_id: str, character_name: str, voice_key: str):
    """Update voice assignment for a single character"""
    # Verify voice key exists
    if voice_key not in PRESET_VOICES:
        raise HTTPException(status_code=400, detail=f"Invalid voice key: {voice_key}")
    
    voice_info = PRESET_VOICES[voice_key]
    
    # Get existing settings
    settings = await db.script_voice_settings.find_one({"script_id": script_id})
    
    if settings:
        # Update existing character or add new
        character_voices = settings.get("character_voices", [])
        found = False
        for cv in character_voices:
            if cv["character_name"] == character_name:
                cv["voice_key"] = voice_key
                cv["voice_id"] = voice_info["id"]
                found = True
                break
        
        if not found:
            character_voices.append({
                "character_name": character_name,
                "voice_key": voice_key,
                "voice_id": voice_info["id"]
            })
        
        await db.script_voice_settings.update_one(
            {"script_id": script_id},
            {"$set": {
                "character_voices": character_voices,
                "updated_at": datetime.utcnow()
            }}
        )
    else:
        # Create new settings
        await db.script_voice_settings.insert_one({
            "script_id": script_id,
            "character_voices": [{
                "character_name": character_name,
                "voice_key": voice_key,
                "voice_id": voice_info["id"]
            }],
            "updated_at": datetime.utcnow()
        })
    
    return {
        "success": True,
        "character_name": character_name,
        "voice_key": voice_key,
        "voice_id": voice_info["id"],
        "voice_name": voice_info["name"],
        "voice_accent": voice_info["accent"]
    }

# ==================== DIALECT COACH ROUTES (PREMIUM) ====================

@api_router.get("/dialect/accents")
async def get_available_accents():
    """Get all available accent profiles for Dialect Coach"""
    accents = []
    for accent_id, profile in ACCENT_PROFILES.items():
        accents.append({
            "id": profile["id"],
            "name": profile["name"],
            "description": profile["description"],
            "region": profile["region"],
            "key_features": profile["key_features"]
        })
    return {"accents": accents, "total": len(accents)}

@api_router.get("/dialect/accents/{accent_id}")
async def get_accent_profile(accent_id: str):
    """Get detailed information about a specific accent"""
    if accent_id not in ACCENT_PROFILES:
        raise HTTPException(status_code=404, detail="Accent not found")
    return ACCENT_PROFILES[accent_id]

@api_router.post("/dialect/analyze")
async def analyze_dialect(
    audio: UploadFile = File(...),
    expected_text: str = Form(...),
    accent_id: str = Form(...),
    user_id: str = Form(...)
):
    """
    Analyze user's pronunciation against a target accent.
    Returns pronunciation score, pace assessment, problem words, and tips.
    """
    if not stt_client:
        raise HTTPException(status_code=503, detail="Speech-to-text service not configured")
    
    if accent_id not in ACCENT_PROFILES:
        raise HTTPException(status_code=400, detail="Invalid accent ID")
    
    accent_profile = ACCENT_PROFILES[accent_id]
    
    try:
        # Read audio file
        audio_content = await audio.read()
        audio_duration = len(audio_content) / 32000  # Rough estimate for 16kHz audio
        
        # Save to temp file for Whisper
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_file.write(audio_content)
            temp_path = temp_file.name
        
        try:
            # Transcribe with Whisper
            with open(temp_path, "rb") as audio_file:
                transcription = await stt_client.transcribe(
                    file=audio_file,
                    model="whisper-1",
                    response_format="verbose_json",
                    language="en",
                    temperature=0.0
                )
            
            transcribed_text = transcription.text.strip()
            
            # Calculate audio duration from transcription if available
            if hasattr(transcription, 'duration'):
                audio_duration = transcription.duration
            
            # Calculate words per minute
            word_count = len(transcribed_text.split())
            wpm = int((word_count / audio_duration) * 60) if audio_duration > 0 else 0
            
            # Use GPT to analyze pronunciation
            chat = LlmChat(api_key=EMERGENT_LLM_KEY)
            
            analysis_prompt = f"""You are a dialect coach specializing in {accent_profile['name']} ({accent_profile['description']}).

EXPECTED TEXT: "{expected_text}"
USER'S TRANSCRIBED SPEECH: "{transcribed_text}"
TARGET ACCENT: {accent_profile['name']}
SPEAKING PACE: {wpm} words per minute

Key features of {accent_profile['name']}:
{chr(10).join('- ' + f for f in accent_profile['key_features'])}

Analyze the user's pronunciation and provide feedback. Return a JSON object with:
{{
    "pronunciation_score": <0-100 score based on how close they are to the target accent and correct pronunciation>,
    "pace_assessment": "<'too_slow' if below 110 wpm, 'too_fast' if above 160 wpm, 'good' otherwise>",
    "problem_words": [
        {{
            "word": "<word that needs work>",
            "expected_pronunciation": "<how it should sound in {accent_profile['name']}>",
            "user_pronunciation": "<what the user likely said>",
            "tip": "<specific, actionable tip to improve this word>",
            "severity": "<'minor', 'moderate', or 'significant'>"
        }}
    ],
    "tips": ["<2-3 general tips for improving their {accent_profile['name']} accent>"],
    "overall_feedback": "<1-2 sentences of encouraging, constructive feedback>"
}}

Be constructive and encouraging. Focus on the most important improvements first.
If the transcription matches the expected text well, give a high score.
Return ONLY valid JSON, no other text."""

            response = await chat.send_message(
                UserMessage(text=analysis_prompt),
                model="gpt-4o"
            )
            
            # Parse GPT response
            try:
                # Clean the response - remove markdown code blocks if present
                response_text = response.text.strip()
                if response_text.startswith("```"):
                    response_text = response_text.split("```")[1]
                    if response_text.startswith("json"):
                        response_text = response_text[4:]
                response_text = response_text.strip()
                
                analysis = json.loads(response_text)
            except json.JSONDecodeError:
                logger.error(f"Failed to parse GPT response: {response.text}")
                # Provide fallback analysis
                analysis = {
                    "pronunciation_score": 70,
                    "pace_assessment": "good" if 110 <= wpm <= 160 else ("too_slow" if wpm < 110 else "too_fast"),
                    "problem_words": [],
                    "tips": ["Keep practicing with this accent!", "Listen to native speakers and mimic their patterns."],
                    "overall_feedback": "Good effort! Keep practicing to improve your accent."
                }
            
            # Build result
            result = DialectAnalysisResult(
                user_id=user_id,
                accent_id=accent_id,
                accent_name=accent_profile["name"],
                expected_text=expected_text,
                transcribed_text=transcribed_text,
                pronunciation_score=min(100, max(0, analysis.get("pronunciation_score", 70))),
                pace_assessment=analysis.get("pace_assessment", "good"),
                pace_wpm=wpm,
                problem_words=[ProblemWord(**pw) for pw in analysis.get("problem_words", [])[:5]],
                tips=analysis.get("tips", [])[:3],
                overall_feedback=analysis.get("overall_feedback", "Keep practicing!"),
                audio_duration_seconds=audio_duration
            )
            
            # Store attempt for tracking
            attempt = DialectAttempt(
                user_id=user_id,
                accent_id=accent_id,
                expected_text=expected_text,
                pronunciation_score=result.pronunciation_score,
                pace_assessment=result.pace_assessment,
                problem_word_count=len(result.problem_words)
            )
            await db.dialect_attempts.insert_one(attempt.dict())
            
            return result.dict()
            
        finally:
            # Cleanup temp file
            import os
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        logger.error(f"Dialect analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@api_router.get("/dialect/history/{user_id}")
async def get_dialect_history(user_id: str, accent_id: Optional[str] = None, limit: int = 20):
    """Get user's recent dialect practice attempts for tracking improvement"""
    query = {"user_id": user_id}
    if accent_id:
        query["accent_id"] = accent_id
    
    attempts = await db.dialect_attempts.find(
        query,
        {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    
    # Calculate improvement stats
    if len(attempts) >= 2:
        recent_avg = sum(a["pronunciation_score"] for a in attempts[:5]) / min(5, len(attempts))
        older_avg = sum(a["pronunciation_score"] for a in attempts[-5:]) / min(5, len(attempts))
        improvement = recent_avg - older_avg
    else:
        improvement = 0
    
    return {
        "attempts": attempts,
        "total": len(attempts),
        "improvement": round(improvement, 1),
        "best_score": max((a["pronunciation_score"] for a in attempts), default=0),
        "average_score": round(sum(a["pronunciation_score"] for a in attempts) / len(attempts), 1) if attempts else 0
    }

@api_router.get("/dialect/sample-lines")
async def get_sample_lines(accent_id: Optional[str] = None):
    """Get sample dialogue lines for practice"""
    sample_lines = [
        {"text": "To be, or not to be, that is the question.", "source": "Hamlet", "difficulty": "medium"},
        {"text": "All the world's a stage, and all the men and women merely players.", "source": "As You Like It", "difficulty": "medium"},
        {"text": "The rain in Spain stays mainly in the plain.", "source": "My Fair Lady", "difficulty": "easy"},
        {"text": "How kind of you to let me come.", "source": "The Importance of Being Earnest", "difficulty": "easy"},
        {"text": "I could have been a contender. I could have been somebody.", "source": "On the Waterfront", "difficulty": "medium"},
        {"text": "Here's looking at you, kid.", "source": "Casablanca", "difficulty": "easy"},
        {"text": "After all, tomorrow is another day.", "source": "Gone with the Wind", "difficulty": "easy"},
        {"text": "You talkin' to me? Well I'm the only one here.", "source": "Taxi Driver", "difficulty": "hard"},
        {"text": "I'll be back.", "source": "The Terminator", "difficulty": "easy"},
        {"text": "May the Force be with you.", "source": "Star Wars", "difficulty": "easy"},
        {"text": "Elementary, my dear Watson.", "source": "Sherlock Holmes", "difficulty": "easy"},
        {"text": "There's no place like home.", "source": "The Wizard of Oz", "difficulty": "easy"},
        {"text": "Frankly, my dear, I don't give a damn.", "source": "Gone with the Wind", "difficulty": "medium"},
        {"text": "You can't handle the truth!", "source": "A Few Good Men", "difficulty": "medium"},
        {"text": "Life is like a box of chocolates. You never know what you're gonna get.", "source": "Forrest Gump", "difficulty": "hard"},
    ]
    return {"lines": sample_lines}

# ==================== ACTING COACH ROUTES (PREMIUM) ====================

class ActingCoachRequest(BaseModel):
    scene_title: str = Field(..., min_length=1)
    scene_context: str = Field(default="")
    emotion: str = Field(...)
    style: str = Field(...)
    energy: int = Field(..., ge=1, le=10)
    user_id: str = Field(default="anonymous")

@api_router.post("/acting-coach/analyze")
async def analyze_acting_performance(request: ActingCoachRequest):
    """AI-powered acting coach that analyzes emotion, style, and energy choices."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured")

    energy_label = "Low" if request.energy <= 3 else ("Medium" if request.energy <= 6 else "High")

    prompt = f"""You are a supportive, expert acting coach helping a beginner actor prepare for a scene.

SCENE: "{request.scene_title}"
{f'CONTEXT: {request.scene_context}' if request.scene_context else ''}
CHOSEN EMOTION: {request.emotion}
PERFORMANCE STYLE: {request.style}
ENERGY LEVEL: {request.energy}/10 ({energy_label})

Based on these choices, provide detailed, encouraging coaching feedback. Return a JSON object with:
{{
    "performance_score": <1-10 score, be encouraging - minimum 5 for any valid combination>,
    "score_label": "<short encouraging label like 'Great Instinct!' or 'Strong Choice!' or 'Solid Foundation'>",
    "what_works": [
        "<specific praise about their emotion choice for this scene>",
        "<specific praise about style + energy combination>"
    ],
    "improvement_tips": [
        "<actionable tip about deepening the emotion>",
        "<actionable tip about the performance style>",
        "<actionable tip about energy calibration>"
    ],
    "example_delivery": "<A 1-2 sentence example of how to deliver a key moment with these settings. Be specific and vivid.>",
    "director_note": "<A brief, warm 'director note' - as if a supportive director is giving guidance on set>"
}}

IMPORTANT:
- Be warm, supportive, and beginner-friendly
- Never be discouraging
- Give specific, actionable advice they can use immediately
- The example delivery should feel like a real acting direction
- Return ONLY valid JSON, no other text."""

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"acting-coach-{uuid.uuid4()}",
            system_message="You are a supportive, expert acting coach helping beginner actors improve their craft. Always return valid JSON."
        ).with_model("openai", "gpt-4o")

        response = await chat.send_message(
            UserMessage(text=prompt),
        )

        response_text = response.strip()
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(response_text)

        # Store attempt
        attempt = {
            "id": str(uuid.uuid4()),
            "user_id": request.user_id,
            "scene_title": request.scene_title,
            "emotion": request.emotion,
            "style": request.style,
            "energy": request.energy,
            "score": result.get("performance_score", 7),
            "created_at": datetime.utcnow().isoformat(),
        }
        await db.acting_coach_attempts.insert_one(attempt)

        return {
            "success": True,
            "analysis": result,
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logging.error(f"Acting coach analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/acting-coach/history/{user_id}")
async def get_acting_coach_history(user_id: str, limit: int = 20):
    """Get user's acting coach history."""
    attempts = await db.acting_coach_attempts.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(length=limit)
    return {"attempts": attempts, "total": len(attempts)}

SCENE_LIBRARY = [
    {"title": "The Breakup", "context": "You're ending a long relationship. Your partner doesn't see it coming.", "genre": "Drama"},
    {"title": "The Job Interview", "context": "You desperately need this job but must stay composed and confident.", "genre": "Drama"},
    {"title": "The Confession", "context": "You're admitting a secret you've kept for years to your best friend.", "genre": "Drama"},
    {"title": "The Victory Speech", "context": "You just won an award you never expected. The crowd is watching.", "genre": "Drama"},
    {"title": "The Goodbye", "context": "Saying farewell at the airport. You may never see them again.", "genre": "Drama"},
    {"title": "The Confrontation", "context": "Facing someone who betrayed your trust. They don't know you know.", "genre": "Thriller"},
    {"title": "The Proposal", "context": "You're about to ask the most important question of your life.", "genre": "Romance"},
    {"title": "The Bad News", "context": "You have to deliver devastating news to someone you love.", "genre": "Drama"},
    {"title": "The Audition", "context": "Meta: you're auditioning for the role of a lifetime. This is your moment.", "genre": "Drama"},
    {"title": "The Apology", "context": "Making amends for something terrible you did. You're not sure you'll be forgiven.", "genre": "Drama"},
    {"title": "The Stand-Up", "context": "First time on stage at an open mic. The crowd is tough.", "genre": "Comedy"},
    {"title": "The Rescue", "context": "Someone you care about is in danger. Time is running out.", "genre": "Action"},
]

@api_router.get("/acting-coach/scenes")
async def get_acting_coach_scenes():
    """Get the scene library for acting coach practice."""
    return {"scenes": SCENE_LIBRARY}

# Include the router in the main app

# ==================== DAILY DRILL & STREAK SYSTEM ====================

class DailyDrillResponse(BaseModel):
    id: str
    challenge_type: str
    title: str
    description: str
    prompt: str
    duration_seconds: int
    xp_reward: int
    date: str

class StreakResponse(BaseModel):
    current_streak: int
    best_streak: int
    total_xp: int
    today_completed: bool
    activities_today: List[str]

@api_router.get("/daily-drill/{user_id}")
async def get_daily_drill(user_id: str):
    """Get today's daily acting drill challenge."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Check if drill already generated for today
    existing = await db.daily_drills.find_one({"user_id": user_id, "date": today}, {"_id": 0})
    if existing:
        return existing
    
    # Generate new drill using AI
    challenge_types = [
        {"type": "emotion_shift", "title": "Emotion Shift", "desc": "Deliver a line shifting between two emotions"},
        {"type": "cold_read", "title": "Cold Read", "desc": "Perform an unseen monologue with feeling"},
        {"type": "physicality", "title": "Physical Expression", "desc": "Express emotion through movement and voice"},
        {"type": "improv_react", "title": "Improv Reaction", "desc": "React naturally to an unexpected scenario"},
        {"type": "accent_sprint", "title": "Accent Sprint", "desc": "Deliver a line in a specific accent"},
    ]
    
    import random
    challenge = random.choice(challenge_types)
    
    prompt_text = ""
    if EMERGENT_LLM_KEY:
        try:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"daily-drill-{uuid.uuid4()}",
                system_message="You are an acting coach creating short daily challenges for actors. Generate a specific, actionable acting challenge. Return ONLY the challenge prompt text (2-3 sentences). Make it fun and motivating."
            ).with_model("openai", "gpt-4o")
            result = await chat.send_message(
                UserMessage(text=f"Generate a '{challenge['type']}' acting challenge: {challenge['desc']}. The actor should be able to perform it in 10-15 seconds.")
            )
            prompt_text = result.strip() if isinstance(result, str) else result
        except Exception as e:
            logger.error(f"AI drill generation failed: {e}")
    
    if not prompt_text:
        fallback_prompts = {
            "emotion_shift": "Say 'I never thought this day would come' — start with joy, end with grief. Let the shift happen naturally in one breath.",
            "cold_read": "Perform this line as if your life depends on it: 'They told me I had one chance, and I took it without looking back.'",
            "physicality": "Stand up and deliver 'I'm not afraid of you' while physically shrinking, then growing with each word.",
            "improv_react": "You just opened a letter. React as if you got the role of a lifetime — then realize it's for the wrong person.",
            "accent_sprint": "Say 'The rain in Spain falls mainly on the plain' in your best British accent. Commit fully!",
        }
        prompt_text = fallback_prompts.get(challenge["type"], fallback_prompts["cold_read"])
    
    drill = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "challenge_type": challenge["type"],
        "title": challenge["title"],
        "description": challenge["desc"],
        "prompt": prompt_text,
        "duration_seconds": 15,
        "xp_reward": 25,
        "date": today,
        "completed": False,
        "created_at": datetime.utcnow().isoformat(),
    }
    
    await db.daily_drills.insert_one({**drill})
    drill.pop("_id", None)
    return drill

@api_router.post("/daily-drill/{user_id}/complete")
async def complete_daily_drill(user_id: str):
    """Mark today's drill as complete and award XP."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    
    drill = await db.daily_drills.find_one({"user_id": user_id, "date": today})
    if not drill:
        raise HTTPException(status_code=404, detail="No drill found for today")
    
    if drill.get("completed"):
        return {"message": "Already completed", "xp_awarded": 0}
    
    await db.daily_drills.update_one(
        {"user_id": user_id, "date": today},
        {"$set": {"completed": True, "completed_at": datetime.utcnow().isoformat()}}
    )
    
    # Record activity for streak
    await record_activity(user_id, "daily_drill", drill.get("xp_reward", 25))
    
    return {"message": "Drill completed!", "xp_awarded": drill.get("xp_reward", 25)}

async def record_activity(user_id: str, activity_type: str, xp: int = 10):
    """Record an activity and update streak."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    
    # Get or create streak record
    streak = await db.streaks.find_one({"user_id": user_id})
    if not streak:
        streak = {
            "user_id": user_id,
            "current_streak": 0,
            "best_streak": 0,
            "total_xp": 0,
            "last_activity_date": None,
            "activities": {},
        }
        await db.streaks.insert_one({**streak, "_id": user_id})
    
    # Check if this extends the streak
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    last_date = streak.get("last_activity_date")
    
    if last_date == today:
        # Already active today, just add XP and activity
        new_streak = streak.get("current_streak", 1)
    elif last_date == yesterday:
        # Consecutive day — extend streak
        new_streak = streak.get("current_streak", 0) + 1
    else:
        # Streak broken — start fresh
        new_streak = 1
    
    best = max(streak.get("best_streak", 0), new_streak)
    
    # Track today's activities
    today_key = f"activities.{today}"
    
    await db.streaks.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "current_streak": new_streak,
                "best_streak": best,
                "last_activity_date": today,
            },
            "$inc": {"total_xp": xp},
            "$addToSet": {today_key: activity_type},
        }
    )

@api_router.get("/streak/{user_id}")
async def get_streak(user_id: str):
    """Get user's training streak and XP."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    streak = await db.streaks.find_one({"user_id": user_id}, {"_id": 0})
    if not streak:
        return {
            "current_streak": 0,
            "best_streak": 0,
            "total_xp": 0,
            "today_completed": False,
            "activities_today": [],
        }
    
    # Check if streak is still active
    last_date = streak.get("last_activity_date")
    current = streak.get("current_streak", 0)
    if last_date != today and last_date != yesterday:
        current = 0  # Streak broken
    
    activities_today = streak.get("activities", {}).get(today, [])
    
    return {
        "current_streak": current,
        "best_streak": streak.get("best_streak", 0),
        "total_xp": streak.get("total_xp", 0),
        "today_completed": len(activities_today) > 0,
        "activities_today": activities_today,
    }

@api_router.post("/streak/{user_id}/record")
async def record_streak_activity(user_id: str, activity_type: str = "general"):
    """Record an activity for streak tracking (acting_coach, dialect_coach, rehearsal, etc)."""
    await record_activity(user_id, activity_type, 10)
    return await get_streak(user_id)


# ==================== PHASE C: DAILY DRILL AI FEEDBACK ====================

class DrillFeedbackRequest(BaseModel):
    drill_prompt: str
    challenge_type: str
    performance_notes: Optional[str] = ""

@api_router.post("/daily-drill/{user_id}/feedback")
async def get_drill_feedback(user_id: str, request: DrillFeedbackRequest):
    """Get AI performance feedback for a daily drill."""
    feedback = None
    
    if EMERGENT_LLM_KEY:
        try:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"drill-feedback-{uuid.uuid4()}",
                system_message="""You are an acting coach providing feedback on a short acting drill performance.
Analyze the performance based on the drill challenge and return a JSON object with exactly this structure:
{
  "emotion": {"score": 7, "label": "Good", "feedback": "...", "tip": "..."},
  "pacing": {"score": 6, "label": "Needs Work", "feedback": "...", "tip": "..."},
  "delivery": {"score": 8, "label": "Strong", "feedback": "...", "tip": "..."},
  "confidence": {"score": 7, "label": "Good", "feedback": "...", "tip": "..."},
  "overall_note": "Brief encouraging summary"
}
Score from 1-10. Labels: Excellent(9-10), Strong(7-8), Good(5-6), Needs Work(3-4), Keep Practicing(1-2).
Keep feedback and tips under 20 words each. Be encouraging but honest. Return ONLY valid JSON."""
            )
            chat = chat.with_model("openai", "gpt-4o")
            result = await chat.send_message(
                UserMessage(text=f"The actor performed this drill:\nChallenge type: {request.challenge_type}\nPrompt: {request.drill_prompt}\nActor's notes: {request.performance_notes or 'No notes provided'}\n\nProvide feedback as JSON.")
            )
            
            import json as json_module
            text = result if isinstance(result, str) else result.text
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            feedback = json_module.loads(text)
        except Exception as e:
            logger.error(f"Drill feedback AI error: {e}")
    
    if not feedback:
        import random
        scores = {k: random.randint(5, 9) for k in ["emotion", "pacing", "delivery", "confidence"]}
        labels = {1: "Keep Practicing", 3: "Needs Work", 5: "Good", 7: "Strong", 9: "Excellent"}
        def get_label(s):
            for threshold in sorted(labels.keys(), reverse=True):
                if s >= threshold:
                    return labels[threshold]
            return "Good"
        feedback = {
            "emotion": {"score": scores["emotion"], "label": get_label(scores["emotion"]), "feedback": "Your emotional commitment shows through.", "tip": "Try varying intensity within the take."},
            "pacing": {"score": scores["pacing"], "label": get_label(scores["pacing"]), "feedback": "Solid rhythm in your delivery.", "tip": "Experiment with longer pauses for effect."},
            "delivery": {"score": scores["delivery"], "label": get_label(scores["delivery"]), "feedback": "Clear articulation and projection.", "tip": "Ground yourself physically before starting."},
            "confidence": {"score": scores["confidence"], "label": get_label(scores["confidence"]), "feedback": "Good presence and commitment.", "tip": "Own the space — take a breath before you begin."},
            "overall_note": "Solid effort! Keep showing up daily and you'll see real growth."
        }
    
    # Save feedback to drill record
    today = datetime.utcnow().strftime("%Y-%m-%d")
    await db.daily_drills.update_one(
        {"user_id": user_id, "date": today},
        {"$set": {"feedback": feedback}}
    )
    
    return feedback

# ==================== PHASE D: SELF TAPE SHARE LINKS ====================

class CreateShareLinkRequest(BaseModel):
    actor_name: str
    role_name: Optional[str] = ""
    project_name: Optional[str] = ""
    video_uri: str
    script_title: Optional[str] = ""
    duration: Optional[int] = 0
    password: Optional[str] = None
    user_id: Optional[str] = "default"

class ShareLinkResponse(BaseModel):
    share_id: str
    share_url: str
    actor_name: str
    role_name: str
    project_name: str
    created_at: str
    has_password: bool

@api_router.post("/tapes/share")
async def create_share_link(request: CreateShareLinkRequest):
    """Create a shareable casting link for a self tape."""
    share_id = str(uuid.uuid4())[:8]
    actor_slug = request.actor_name.lower().replace(" ", "-").replace("'", "")
    
    share_data = {
        "share_id": share_id,
        "actor_slug": actor_slug,
        "actor_name": request.actor_name,
        "role_name": request.role_name or "",
        "project_name": request.project_name or "",
        "video_uri": request.video_uri,
        "script_title": request.script_title or "",
        "duration": request.duration or 0,
        "password": request.password,
        "user_id": request.user_id or "default",
        "created_at": datetime.utcnow().isoformat(),
        "views": 0,
    }
    
    await db.shared_tapes.insert_one({**share_data, "_id": share_id})
    
    return {
        "share_id": share_id,
        "share_url": f"/tape/{actor_slug}/{share_id}",
        "actor_name": request.actor_name,
        "role_name": request.role_name or "",
        "project_name": request.project_name or "",
        "created_at": share_data["created_at"],
        "has_password": bool(request.password),
    }

@api_router.get("/tapes/share/{share_id}")
async def get_shared_tape(share_id: str, password: Optional[str] = None):
    """Get a shared tape for viewing."""
    tape = await db.shared_tapes.find_one({"share_id": share_id}, {"_id": 0})
    if not tape:
        raise HTTPException(status_code=404, detail="Tape not found or link expired")
    
    if tape.get("password") and tape["password"] != password:
        return {
            "requires_password": True,
            "actor_name": tape["actor_name"],
            "share_id": share_id,
        }
    
    # Increment view count
    await db.shared_tapes.update_one(
        {"share_id": share_id},
        {"$inc": {"views": 1}}
    )
    
    # Return incremented view count
    current_views = tape.get("views", 0) + 1
    
    return {
        "share_id": tape["share_id"],
        "actor_name": tape["actor_name"],
        "role_name": tape.get("role_name", ""),
        "project_name": tape.get("project_name", ""),
        "video_uri": tape["video_uri"],
        "script_title": tape.get("script_title", ""),
        "duration": tape.get("duration", 0),
        "created_at": tape["created_at"],
        "views": current_views,
        "watermark": "Recorded with ScriptM8 \u00b7 AI Training Studio for Actors",
    }

@api_router.get("/tapes/user/{user_id}")
async def get_user_shared_tapes(user_id: str):
    """Get all shared tapes for a user."""
    tapes = await db.shared_tapes.find(
        {"user_id": user_id},
        {"_id": 0, "password": 0, "video_uri": 0}
    ).sort("created_at", -1).to_list(50)
    return tapes

@api_router.delete("/tapes/share/{share_id}")
async def delete_share_link(share_id: str):
    """Delete a shared tape link."""
    result = await db.shared_tapes.delete_one({"share_id": share_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Share link not found")
    return {"message": "Share link deleted"}

# ==================== PHASE E: VOICE ACTOR STUDIO ====================

VOICE_STUDIO_DIR = Path(tempfile.gettempdir()) / "voice_studio"
VOICE_STUDIO_DIR.mkdir(exist_ok=True)

@api_router.post("/voice-studio/process")
async def process_audio(
    audio: UploadFile = File(...),
    operation: str = Form(...),  # "trim", "normalize", "remove_silence", "all"
    trim_start: float = Form(0.0),   # seconds
    trim_end: float = Form(0.0),     # seconds from end to cut
):
    """Process an audio file: trim, normalize volume, remove silence."""
    from pydub import AudioSegment
    from pydub.silence import detect_nonsilent

    try:
        content = await audio.read()
        suffix = ".m4a" if audio.filename and audio.filename.endswith(".m4a") else ".wav"
        
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_in:
            tmp_in.write(content)
            tmp_in_path = tmp_in.name

        try:
            sound = AudioSegment.from_file(tmp_in_path)
            original_duration = len(sound) / 1000.0

            if operation in ("trim", "all"):
                start_ms = int(trim_start * 1000)
                end_ms = len(sound) - int(trim_end * 1000)
                if end_ms > start_ms:
                    sound = sound[start_ms:end_ms]

            if operation in ("remove_silence", "all"):
                chunks = detect_nonsilent(sound, min_silence_len=500, silence_thresh=-40)
                if chunks:
                    non_silent = AudioSegment.empty()
                    for start, end in chunks:
                        non_silent += sound[start:end]
                    sound = non_silent

            if operation in ("normalize", "all"):
                target_dbfs = -20.0
                change = target_dbfs - sound.dBFS
                sound = sound.apply_gain(change)

            out_path = str(VOICE_STUDIO_DIR / f"processed_{uuid.uuid4().hex[:8]}.mp3")
            sound.export(out_path, format="mp3", bitrate="192k")
            new_duration = len(sound) / 1000.0

            with open(out_path, "rb") as f:
                audio_b64 = base64.b64encode(f.read()).decode()

            os.unlink(out_path)

            return {
                "audio_base64": audio_b64,
                "format": "mp3",
                "original_duration": round(original_duration, 2),
                "new_duration": round(new_duration, 2),
                "operation": operation,
            }
        finally:
            if os.path.exists(tmp_in_path):
                os.unlink(tmp_in_path)

    except Exception as e:
        logger.error(f"Audio processing error: {e}")
        raise HTTPException(status_code=500, detail=f"Audio processing failed: {str(e)}")


@api_router.post("/voice-studio/demo-reel")
async def build_demo_reel(
    files: List[UploadFile] = File(...),
    gaps: str = Form("0.5"),  # comma-separated gap durations in seconds between clips
):
    """Build a demo reel by concatenating multiple audio files with optional gaps."""
    from pydub import AudioSegment

    try:
        gap_list = [float(g.strip()) for g in gaps.split(",") if g.strip()]
        segments = []

        for f in files:
            content = await f.read()
            suffix = ".m4a" if f.filename and f.filename.endswith(".m4a") else ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                seg = AudioSegment.from_file(tmp_path)
                # Normalize each segment
                target_dbfs = -20.0
                change = target_dbfs - seg.dBFS
                seg = seg.apply_gain(change)
                segments.append(seg)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        if not segments:
            raise HTTPException(status_code=400, detail="No valid audio files provided")

        reel = segments[0]
        for i, seg in enumerate(segments[1:], 1):
            gap_sec = gap_list[i - 1] if i - 1 < len(gap_list) else 0.5
            gap_ms = int(gap_sec * 1000)
            if gap_ms > 0:
                reel += AudioSegment.silent(duration=gap_ms)
            reel += seg

        out_path = str(VOICE_STUDIO_DIR / f"reel_{uuid.uuid4().hex[:8]}.mp3")
        reel.export(out_path, format="mp3", bitrate="192k")
        duration = len(reel) / 1000.0

        with open(out_path, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode()

        os.unlink(out_path)

        return {
            "audio_base64": audio_b64,
            "format": "mp3",
            "duration": round(duration, 2),
            "segments_count": len(segments),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Demo reel build error: {e}")
        raise HTTPException(status_code=500, detail=f"Demo reel build failed: {str(e)}")


@api_router.post("/voice-studio/takes")
async def save_take_metadata(
    user_id: str = Form(...),
    take_name: str = Form(...),
    duration: float = Form(0),
    script_id: str = Form(""),
):
    """Save voice take metadata to the database."""
    take = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "take_name": take_name,
        "duration": duration,
        "script_id": script_id,
        "created_at": datetime.utcnow().isoformat(),
    }
    await db.voice_takes.insert_one({**take})
    take.pop("_id", None)
    return take


@api_router.get("/voice-studio/takes/{user_id}")
async def get_user_takes(user_id: str):
    """Get all voice takes for a user."""
    takes = await db.voice_takes.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"takes": takes, "total": len(takes)}


@api_router.delete("/voice-studio/takes/{take_id}")
async def delete_take_metadata(take_id: str):
    """Delete a voice take record."""
    result = await db.voice_takes.delete_one({"id": take_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Take not found")
    return {"message": "Take deleted"}


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
