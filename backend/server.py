import base64
import html as html_escape
import io
import json
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import PyPDF2
from docx import Document
from dotenv import load_dotenv
from elevenlabs import ElevenLabs
from elevenlabs.types import VoiceSettings
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import HTMLResponse, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from common_english_words import COMMON_ENGLISH_WORDS

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Get API key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', '')

# SEC-003 (Feb 2026): server-side RevenueCat verification is used by
# the subscribe / start-trial routes. Import the client lazily-friendly
# (module-level import, but routes still re-check REVENUECAT_SECRET_KEY
# so tests can monkeypatch the env or the client function itself).
from revenuecat_client import (  # noqa: E402
    RevenueCatUnavailable,
    RevenueCatNotConfigured,
    fetch_premium_entitlement,
)


def _is_production_env() -> bool:
    """SEC-003: Fail-closed QA_PREMIUM when the backend is running in
    production. We treat `ENV` values of "prod"/"production" (case-
    insensitive) as production; everything else (dev, test, staging,
    unset) is non-prod."""
    env = os.environ.get("ENV", "").strip().lower()
    return env in ("prod", "production")


def _qa_premium_enabled() -> bool:
    """SEC-003: Centralised, fail-closed QA_PREMIUM read. Returns True
    only when QA_PREMIUM=true AND ENV is NOT production. In production
    we log an error (loud alert) and treat the flag as disabled."""
    flag = os.environ.get("QA_PREMIUM", "").strip().lower() == "true"
    if flag and _is_production_env():
        logger.error(
            "[SEC-003] QA_PREMIUM=true is set in a PRODUCTION environment; "
            "ignoring the flag. Remove QA_PREMIUM from production .env.",
        )
        return False
    return flag

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

# ─── SEC-002 (2026-02): centralized auth deps ─────────────────────────
# Hoisted from the former inline `get_authenticated_user_id` so every
# protected route gets the SAME identity extraction. Imported here (not
# at the top of the file) because `backend/auth.py` reads `db` lazily
# from this module, and placing the import after `db` is defined keeps
# the resolution order boring and deterministic. See `backend/auth.py`
# for the identity model.
from auth import (
    effective_user_id,
    enforce_user_id_match,
    get_authenticated_user_id,
    get_effective_user_id,
)

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
    # 2026-02: reader-style wiring. Persisted on the RehearsalSession so
    # both the initial create-response and any later fetchRehearsal
    # (device restart, deep-link resume) carry it through to
    # rehearsal/[id].tsx::speakLine, which merges these into the
    # per-voice pitch/rate.  Defaults keep pre-2026-02 behaviour intact.
    reader_style: str = "neutral"     # 'neutral' | 'emotional' | 'aggressive'
    voice_speed: float = 1.0          # multiplier applied to TTS rate
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class RehearsalCreate(BaseModel):
    script_id: str
    user_character: str
    mode: str = "full_read"
    voice_type: str = "alloy"
    user_id: str = "default"
    # Optional — pre-2026-02 clients that don't send these fall back to
    # 'neutral' / 1.0 which is the same behaviour they had before.
    reader_style: str = "neutral"
    voice_speed: float = 1.0

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
    revenuecat_app_user_id: Optional[str] = None  # SEC-003: required for server-side RC verification
    receipt: Optional[str] = None  # App store receipt for validation
    transaction_id: Optional[str] = None


class StartTrialRequest(BaseModel):
    """SEC-003: start-trial now requires server-side RevenueCat entitlement
    verification. The client supplies its RevenueCat app_user_id; the
    backend fetches entitlements from RC and only writes trial state when
    an active Premium (intro/trial) entitlement is confirmed."""
    revenuecat_app_user_id: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    voice: str = "alloy"

class ElevenLabsTTSRequest(BaseModel):
    """Request for ElevenLabs TTS generation"""
    text: str = Field(..., min_length=1, max_length=2000)
    voice_id: str = Field(..., min_length=1, max_length=64)
    stability: float = Field(0.5, ge=0.0, le=1.0)
    similarity_boost: float = Field(0.75, ge=0.0, le=1.0)
    style: float = Field(0.0, ge=0.0, le=1.0)
    use_speaker_boost: bool = True
    # 2026-02 SCRIPT M8: speed reaches the ElevenLabs synthesis
    # request via voice_settings.speed. Clamped server-side to the
    # ElevenLabs supported range 0.7-1.2 before the SDK call.
    speed: float = Field(1.0, ge=0.1, le=5.0)

    class Config:
        extra = "forbid"

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

    # ─── QA BYPASS (isolated, env-gated, fail-closed in production) ─────────
    # Setting QA_PREMIUM=true in the backend .env grants the caller full
    # Premium-tier entitlements for the duration of this request only. It does
    # NOT mutate the user record in Mongo, does NOT touch RevenueCat, and does
    # NOT change the response of any endpoint that reads subscription_tier
    # directly (only endpoints that route through check_user_limits() or
    # GET /users/{id}/limits inherit the override). This flag is DEV/QA-only
    # and MUST remain absent (or "false") in the production environment.
    # SEC-003 (Feb 2026): `_qa_premium_enabled()` additionally fails CLOSED
    # when ENV=production is set, logging an error if someone leaves the
    # flag on in a prod deploy.
    qa_premium = _qa_premium_enabled()
    if qa_premium and tier != "premium":
        logger.warning(
            "[QA_BYPASS] Premium entitlement granted for user_id=%s "
            "(real_tier=%s). Disable QA_PREMIUM in production.",
            user_id, tier,
        )
        tier = "premium"

    limits = get_tier_limits(tier)
    
    result = {
        "allowed": True,
        "tier": tier,
        "limits": limits,
        "upgrade_reason": None
    }
    if qa_premium:
        result["qa_premium_bypass"] = True
    
    if action == "create_script" and user:
        scripts_count = await db.scripts.count_documents({"user_id": user["id"]})
        if scripts_count >= limits["max_scripts"]:
            result["allowed"] = False
            result["upgrade_reason"] = f"You've reached the limit of {limits['max_scripts']} scripts. Upgrade to Premium for unlimited scripts!"
    
    elif action == "create_rehearsal" and user:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if user.get("last_rehearsal_date") == today:
            if user.get("rehearsals_today", 0) >= limits["max_rehearsals_per_day"]:
                # ─── QA BYPASS (isolated, env-gated) ────────────────────────
                # Setting QA_UNLIMITED_REHEARSALS=true in the backend .env allows
                # unlimited rehearsals for repeated Samsung regression testing.
                # This is a DEV/QA-only flag and MUST remain absent (or "false")
                # in the production environment. Production 5-per-day limit is
                # unchanged when the flag is not set.
                if os.environ.get("QA_UNLIMITED_REHEARSALS", "").lower() == "true":
                    logger.warning(
                        "[QA_BYPASS] Rehearsal limit bypassed for user_id=%s "
                        "(rehearsals_today=%s, limit=%s). Disable QA_UNLIMITED_REHEARSALS in production.",
                        user.get("id"), user.get("rehearsals_today"), limits["max_rehearsals_per_day"],
                    )
                    result["qa_bypass"] = True
                else:
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

_DOCX_WHITESPACE_REPLACEMENTS = {
    "\t": " ",       # TAB from <w:tab/>
    "\xa0": " ",     # non-breaking space
    "\u2007": " ",   # figure space
    "\u202f": " ",   # narrow no-break space
    "\u200b": "",    # zero-width space — removed, not spaced
}


def _normalize_docx_whitespace(s: str) -> str:
    """Canonicalise DOCX whitespace variants to regular spaces.

    Word documents can embed a variety of non-newline whitespace
    characters into paragraph run text (verified in-process against
    python-docx==1.2.0):

      - `<w:tab/>` between mid-word runs → paragraph.text contains `\\t`
      - `<w:t xml:space="preserve">isn\\xa0't</w:t>` → NBSP embedded
      - Figure / narrow no-break spaces from copy-pasted content
      - Zero-width spaces from certain plugins / conversions

    Downstream code (`fallback_parse_script`, `_smart_join_dialogue`)
    reasons only about regular ASCII spaces + newlines. This function
    normalises every non-newline whitespace variant to a single
    regular space so downstream logic sees a consistent stream. `\\n`
    is preserved so line-boundary parsing keeps working; `\\u200b`
    is removed (not spaced) because it is a zero-width joiner and
    inserting a space would fabricate a boundary that was never there.
    """
    if not s:
        return s
    for src, dst in _DOCX_WHITESPACE_REPLACEMENTS.items():
        if src in s:
            s = s.replace(src, dst)
    return s


# Rule A — apostrophe / hyphen glue. Matches `letter + spaces + [' or -] +
# optional spaces + letter`. Covers contractions split by a stray space
# (`isn 't`, `don 't`, `we 're`) and spaced hyphens (`mid - way`).
_INTRA_WORD_APOSTROPHE_HYPHEN = re.compile(r"([A-Za-z]) +(['\-]) *([A-Za-z])")

# Rule B — single-letter non-vowel prefix. Matches a lone consonant (or
# semi-vowel) followed by a spaced lowercase word. Deliberately excludes
# `a`, `A`, `I`, `o` so real short words never get merged with the next
# token (`a bike`, `I said`, `o my king`). The left-side boundary is
# strict — start of line or preceded by whitespace — so a contraction
# suffix like `t` in `isn't easy` is NOT eligible.
_INTRA_WORD_SINGLE_LETTER = re.compile(
    r"(?:^|(?<=\s))([b-hj-np-zB-HJ-NP-Z]) +([a-z]{2,})\b"
)

# Rule C — dictionary-aware fragment merge. Two lowercase runs
# separated by a single space are merged only when the joined form is
# a common English word AND at least one fragment is NOT a valid word
# on its own — the classic mid-word split signature (`unde` + `rstand`
# → `understand`). Legitimate word pairs where BOTH sides are real
# words (`look back`, `hard work`, `dear john`) are NEVER merged. See
# `_dict_aware_merge` for the token scan; a regex-based approach fails
# because `re.sub` gobbles the greedy-longest left match and misses
# the shorter merge opportunity later in the same span.

# Rule D — space before terminal punctuation (`disciplinary .` →
# `disciplinary.`). Purely typographic; safe.
_SPACE_BEFORE_PUNCT = re.compile(r"[ \t]+([.,;:!?])")

# Rule E — split a concatenated compound where the DOCX run boundary
# swallowed a space (`nothinghappens` → `nothing happens`). Only fires
# when the whole token is NOT a dictionary word AND exactly one
# split-position yields two dictionary words of ≥4 letters each.
_MIN_SPLIT_LEN = 10   # tokens shorter than this are never split
_MIN_HALF_LEN = 4     # each split half must have ≥ this many chars


def _is_common_word(w: str) -> bool:
    return w.lower() in COMMON_ENGLISH_WORDS


def _repair_intra_word_spaces(text: str) -> str:
    """Repair intra-word whitespace artefacts introduced by DOCX/PDF
    extraction (`isn 't` → `isn't`, `w hat` → `what`,
    `unde rstand` → `understand`, `kno w` → `know`,
    `look lik e` → `look like`, `disciplinary .` → `disciplinary.`).

    Applied per source line inside `fallback_parse_script`, right
    after `.strip()`. Complements `_smart_join_dialogue` which handles
    the newline-split flavour of the same defect and
    `_split_concatenated_words` which handles the missing-space
    counterpart (`nothinghappens` → `nothing happens`).

    The rules are deliberately conservative:
      • Rule A / B are character-class based and never fire in
        contexts where a legitimate short word would be affected.
        Rule B additionally consults the dictionary so it never
        merges a legitimate 1-char suffix (`kno w what` stays as
        two adjacent word pairs, then `kno w` is merged by Rule C).
      • Rule C consults a 10K common-English-word dictionary and only
        merges fragments when the joined form is a real word AND at
        least one fragment alone is NOT a real word. This protects
        common phrases like `look back`, `dear john`, `hard work`
        from over-eager merging.
      • Rule D strips spaces immediately before terminal punctuation
        (`.` `,` `;` `:` `!` `?`) — a pure-typography fix.
    """
    if not text:
        return text
    # Rule A — apostrophe/hyphen glue.
    text = _INTRA_WORD_APOSTROPHE_HYPHEN.sub(r"\1\2\3", text)
    # Rule C first — dictionary-aware fragment merge. Running before
    # Rule B prevents Rule B from misfiring on a legitimate 1-char
    # suffix (`kno w what` — the `w` belongs to `kno`, not to `what`
    # — Rule C merges `kno w` → `know`, then Rule B sees no lone `w`
    # in front of `what`).
    text = _dict_aware_merge(text)
    # Rule B — single-letter non-vowel prefix (e.g. `w ant`), guarded
    # by the dictionary so `wwhat`-style false positives can't occur.
    text = _apply_single_letter_prefix(text)
    # Rule D — space-before-punctuation.
    text = _SPACE_BEFORE_PUNCT.sub(r"\1", text)
    return text


def _apply_single_letter_prefix(text: str) -> str:
    """Rule B — merge `X word` when `X` is a lone non-vowel letter and
    the joined form is a common English word. Never fires on `a`,
    `i`, or `o` (real short words) and never on a merge that isn't a
    dictionary hit (`w what` stays as-is because `wwhat` isn't a word).
    """
    def _repl(m: "re.Match") -> str:
        left, right = m.group(1), m.group(2)
        merged = (left + right).lower()
        if merged in COMMON_ENGLISH_WORDS:
            return left + right
        return m.group(0)
    return _INTRA_WORD_SINGLE_LETTER.sub(_repl, text)


def _dict_aware_merge(text: str) -> str:
    """Apply Rule C repeatedly until no more merges occur.

    Token-based to avoid the greedy-regex trap: `re.sub` on
    `\\b\\w+ \\w+\\b` gobbles the longest left match, so `look lik e`
    would consume `look lik` as one no-op match and never see `lik e`.
    A token scan checks each adjacent pair explicitly and can merge
    right-to-left in the same pass.

    A merge fires only when the joined form is a common English word
    AND at least one side is NOT a common word — the classic mid-word
    split signature. Guards against merging real word pairs like
    `look back`, `hard work`, `run fast`.
    """
    _TRAIL_PUNCT = ".,;:!?)"
    prev = None
    guard = 0
    while text != prev and guard < 8:
        prev = text
        guard += 1
        # Preserve whitespace runs so we can reconstruct exactly.
        parts = re.split(r"(\s+)", text)
        # Merge candidate pairs (parts[i], parts[i+2]) separated by a
        # single space run parts[i+1]. Only single-space separators
        # are eligible — multiple spaces or tabs are treated as
        # paragraph structure and never collapsed.
        i = 0
        out: list[str] = []
        while i < len(parts):
            if (
                i + 2 < len(parts)
                and parts[i + 1] == " "
                and _is_pure_lowercase_word(parts[i])
            ):
                right_raw = parts[i + 2]
                # Split trailing punctuation off the right token so
                # `rstand.` can still match `rstand` for the merge
                # decision but keep its period after merging.
                right_core = right_raw
                trailing = ""
                while right_core and right_core[-1] in _TRAIL_PUNCT:
                    trailing = right_core[-1] + trailing
                    right_core = right_core[:-1]
                if _is_pure_lowercase_word(right_core):
                    left = parts[i]
                    if _should_merge_fragments(left, right_core):
                        out.append(left + right_core + trailing)
                        i += 3
                        continue
            out.append(parts[i])
            i += 1
        text = "".join(out)
    return text


def _is_pure_lowercase_word(s: str) -> bool:
    """True iff `s` is a non-empty run of ASCII lowercase letters."""
    return bool(s) and s.isalpha() and s.islower()


def _should_merge_fragments(left: str, right: str) -> bool:
    """Decide whether `left + right` is a mid-word split needing repair.

    Returns True iff the joined form is a common English word AND at
    least one side is NOT itself a common word (i.e. this is not a
    legitimate two-word phrase).
    """
    if len(left) == 1 and len(right) == 1:
        # Two-single-letter is Rule B territory; never merge here.
        return False
    merged = (left + right).lower()
    if merged not in COMMON_ENGLISH_WORDS:
        return False
    left_is_word = left.lower() in COMMON_ENGLISH_WORDS
    right_is_word = right.lower() in COMMON_ENGLISH_WORDS
    return not (left_is_word and right_is_word)


def _split_concatenated_words(text: str) -> str:
    """Insert a space inside tokens whose runs were concatenated during
    DOCX extraction (`nothinghappens` → `nothing happens`).

    Fires only when ALL of the following hold, keeping the fix
    extremely conservative:
      • Token length ≥ `_MIN_SPLIT_LEN` (10 chars).
      • Token is purely alphabetic (no digits, punctuation, apostrophe).
      • Token is NOT already a common English word.
      • Exactly ONE split position exists where both halves are
        common English words AND each half is ≥ `_MIN_HALF_LEN`
        characters.

    This rules out proper nouns, technical terms, and long real
    English words that aren't in the top-10K list — all of them keep
    a length ≥ 10 shape but fail the "exactly one valid dictionary
    split" test, so the function returns them unchanged.
    """
    if not text:
        return text

    def _fix_token(tok: str) -> str:
        if len(tok) < _MIN_SPLIT_LEN or not tok.isalpha():
            return tok
        lower = tok.lower()
        if lower in COMMON_ENGLISH_WORDS:
            return tok
        found: list[int] = []
        for i in range(_MIN_HALF_LEN, len(tok) - _MIN_HALF_LEN + 1):
            left = lower[:i]
            right = lower[i:]
            if left in COMMON_ENGLISH_WORDS and right in COMMON_ENGLISH_WORDS:
                found.append(i)
                if len(found) > 1:
                    return tok  # ambiguous — do nothing
        if len(found) == 1:
            i = found[0]
            return tok[:i] + " " + tok[i:]
        return tok

    # Split on runs of whitespace but preserve the whitespace itself so
    # we can reconstruct the string exactly (only the tokens change).
    parts = re.split(r"(\s+)", text)
    for idx in range(0, len(parts), 2):
        parts[idx] = _fix_token(parts[idx])
    return "".join(parts)


def _smart_join_dialogue(fragments: list) -> str:
    """Join dialogue fragments split across PDF/DOCX line-wraps.

    Fixes intra-word spacing artefacts introduced when the extractor
    (typically PyPDF2 on tight-kerned screenplay PDFs) breaks a single
    word across a hard newline. When both sides of the break look
    mid-word — the previous fragment ends with a letter, apostrophe or
    hyphen AND the next fragment starts with a lowercase letter or an
    apostrophe — the fragments are concatenated with no separator.
    Otherwise a single space is inserted (normal word boundary).

    Physical examples this closes (Samsung SM-S918B / Android 16, build
    1.0.47):
        ["I don't w", "ant this."]      -> "I don't want this."
        ["unde", "rstand"]              -> "understand"
        ["isn", "'t"]                   -> "isn't"
        ["ne", "ver"]                   -> "never"
        ["y", "ou"]                     -> "you"

    Empty and single-fragment inputs are handled safely.
    """
    if not fragments:
        return ""
    out = fragments[0] or ""
    for nxt in fragments[1:]:
        if not out:
            out = nxt or ""
            continue
        if not nxt:
            continue
        looks_mid_word = (
            (out[-1].isalpha() or out[-1] in "'-")
            and (nxt[0].islower() or nxt[0] == "'")
        )
        out += nxt if looks_mid_word else " " + nxt
    return out


# Screenplay scene-heading / transition / structural-heading detector.
# The Nov-2025 parser classified any uppercase 1-3 token line as a
# character (e.g. `SCENE 1`, `INT. KITCHEN`, `FADE IN:`). This mis-
# classifies scene structure as speaking characters and pollutes the
# character-selection UI on physical devices. The Feb-2026 fix rejects
# lines that match the screenplay conventions below BEFORE the
# character-detection heuristic runs. Non-anchored matches are avoided
# so a legitimate name that merely contains one of these words
# (unlikely, but e.g. an actor called `SCENE`) is not disqualified.
#
# Sourced from the Screenwriter's Bible + WGA Format Guide screenplay
# conventions; extended by matching every scene-header shape observed
# in the Feb-2026 physical DOCX stress test.
_SCENE_HEADING_RE = re.compile(
    r"""^
    (?:\d+[A-Z]?\.?\s+)?         # Optional scene-number prefix:
                                 # `1.`, `10.`, `101A.`, `12 ` etc.
    (?:
        SCENE\b              # SCENE 1, SCENE 2 - X, SCENE ONE
      | ACT\b                # ACT ONE, ACT 1
      | CHAPTER\b
      | PART\b
      | SECTION\b
      | INT[./\s]            # INT. KITCHEN, INT KITCHEN, INT/EXT
      | EXT[./\s]            # EXT. STREET, EXT DAY
      | INT\.?/EXT           # INT./EXT. or INT/EXT
      | EXT\.?/INT
      | I\.?/E\b             # I/E or I./E.
      | E\.?/I\b
      | FADE\s+(?:IN|OUT|TO)\b
      | CUT\s+TO\b
      | DISSOLVE(?:\s+TO)?\b
      | SMASH\s+CUT\b
      | MATCH\s+CUT\b
      | JUMP\s+CUT\b
      | TIME\s+CUT\b
      | HARD\s+CUT\b
      | QUICK\s+CUT\b
      | IRIS\s+(?:IN|OUT)\b
      | FREEZE\s+FRAME\b
      | BACK\s+TO\s+SCENE\b
      | TITLE\s+CARD\b
      | THE\s+END\b
      | END\s+OF\s+(?:SCENE|ACT|EPISODE|PART|SHOW|FILM|MOVIE|SCREENPLAY|STORY|PLAY|CHAPTER|TEASER|COLD\s+OPEN|PILOT)\b
      # Standalone screenplay terminator: `END`, `END.`, `END:`, `END!`
      # on its own line. Anchored with the outer `^` at the start and
      # `$` inside this alt so a character named e.g. `ENDER` (which
      # begins with END but has trailing letters) is NOT disqualified —
      # the `\s*[.:!]?\s*$` requires the line to end right there.
      | END\s*[.:!]?\s*$
      | INTERCUT\b
      | MONTAGE\b
      | FLASH(?:BACK|-BACK|\s+BACK)\b
      | FLASHFORWARD\b
      | PRELAP\b
      | SUPERIMPOSE\b
      | ANGLE\s+ON\b
      | CLOSE\s+ON\b
      | WIDE\s+ON\b
      | POV\b                # e.g. "POV JACK"
    )
    """,
    # Case-sensitive: screenplay convention requires scene / transition
    # headings to be UPPERCASE. Dropping IGNORECASE prevents dialogue
    # like "back to me." or "iris in the eye" from being mis-classified.
    re.VERBOSE,
)

# Trailing character-cue extension parenthetical: `(V.O.)`, `(O.S.)`,
# `(CONT'D)`, `(OS)`, `(VO)`, `(OFF)`, `(INTO PHONE)`, `(PRE-LAP)`.
# When present after the character name we strip it so the character
# set stores just the name (e.g. `JACK`, not `JACK (V.O.)`). This is a
# cosmetic normalization that keeps the character-select UI clean and
# matches how the AI-parsed path already stores names.
_CHAR_CUE_EXTENSION_RE = re.compile(r"\s*\(([^)]*)\)\s*$")


def _looks_like_scene_heading(line: str) -> bool:
    """True iff `line` matches a known screenplay scene / transition /
    structural-heading pattern. Anchored at the start of the line so a
    legitimate character name that happens to contain one of the
    keywords elsewhere is not disqualified.

    Examples that ARE headings:
        SCENE 1                    SCENE 2 - CONTRACTIONS
        INT. KITCHEN               INT. KITCHEN — NIGHT
        EXT. STREET — DAY          INT./EXT. CAR — NIGHT
        FADE IN:                   CUT TO:
        ACT ONE                    ACT 1

    Examples that are NOT headings (must still be recognised as chars):
        JACK           SARAH         DREW           ANG
        HANN AH        MRS. SMITH    POLICE OFFICER
        JACK (V.O.)    SARAH (O.S.)  MARY (CONT'D)
    """
    if not line:
        return False
    return bool(_SCENE_HEADING_RE.match(line.strip()))


def _strip_character_cue_extension(name: str) -> str:
    """Remove a trailing `(V.O.)` / `(O.S.)` / `(CONT'D)` / etc. from
    a character-cue line. Returns the name unchanged if no trailing
    parenthetical is present.
    """
    stripped = _CHAR_CUE_EXTENSION_RE.sub("", name).strip()
    # Guard: if stripping produced an empty string (input was ONLY the
    # parenthetical, e.g. `(V.O.)` on its own), return the original —
    # the caller's stage-direction path already handles bare parens.
    return stripped or name


# Front-matter / cast-list / section-header labels that appear in
# user-authored scripts (stage plays, Fountain-style drafts, "my first
# screenplay" templates). All-uppercase prefixes that must NEVER be
# classified as character cues, even when followed by a colon.
# Routed into the stage-direction/action path by `fallback_parse_script`.
_HEADER_KEYWORDS = frozenset({
    "TITLE",
    "AUTHOR",
    "BY",
    "WRITTEN BY",
    "CHARACTERS",
    "CAST",
    "DRAMATIS PERSONAE",
    "SETTING",
    "TIME",
    "PLACE",
    "SYNOPSIS",
    "LOGLINE",
})

# Inline-cue dialogue (`NAME: dialogue text on the same line`). Common
# in stage plays and Fountain drafts. Captures the cue name (upper /
# digit / dot / apostrophe / hyphen, 1..31 chars) and the dialogue.
# The pre-colon segment is further validated by the existing
# character-cue constraints (<=3 words, not a scene heading, not a
# header keyword) before being accepted — this regex is a shape test,
# not the full decision.
_INLINE_CUE_RE = re.compile(r"^([A-Z][A-Z0-9 .'\-]{0,30}):\s+(.+)$")


def fallback_parse_script(raw_text: str) -> Dict[str, Any]:
    """Simple fallback parser for scripts"""
    lines_data = []
    characters = set()
    
    lines = raw_text.strip().split('\n')
    current_character = ""
    current_text = []
    
    def _repair(t: str) -> str:
        """Full repair pipeline: intra-word space repair, then split any
        run-boundary word concatenations (`nothinghappens`)."""
        return _split_concatenated_words(_repair_intra_word_spaces(t))

    # ─── 2026-02 PHYSICAL BUILD 1.0.66 — TITLE DUPLICATE SUPPRESSION ──
    # PyPDF2 extracts the on-page document title TWICE: once as a
    # standalone large-text line AT THE TOP, and again as part of the
    # author's `TITLE: <value>` metadata header. Example extraction:
    #
    #     THE CALL              ← duplicate, uppercase, 2 words
    #     TITLE: THE CALL       ← authored metadata
    #     AUTHOR: ...
    #     CHARACTERS:
    #     JACK
    #     SARAH
    #
    # Without this hint, the leading `THE CALL` falls through to the
    # character-cue heuristic (uppercase, <=3 words, not a scene
    # heading, no header-keyword prefix) and is wrongly promoted to a
    # speaking character alongside JACK/SARAH.
    #
    # Structural rule (generic, NOT hard-coded to any title):
    #   If an explicit `TITLE: <value>` header exists AND a preceding
    #   standalone line equals that `<value>`, treat the preceding
    #   line as duplicated document-title extraction (stage direction,
    #   not a character). The suppression is INDEX-GATED: duplicates
    #   AFTER the TITLE header are preserved as legitimate character
    #   cues (so a character named identically to the title still
    #   works when they speak later in the script).
    _title_value_upper = ""
    _title_header_idx = -1
    for _i, _ln in enumerate(lines):
        _s = _ln.strip()
        _u = _s.upper()
        if _u.startswith("TITLE:"):
            _title_value_upper = _s[len("TITLE:"):].strip().upper()
            _title_header_idx = _i
            break

    for _idx, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue

        # Suppress standalone duplicate of TITLE metadata value
        # appearing BEFORE the `TITLE: X` header line. See block
        # comment above `fallback_parse_script` loop entry.
        if (
            _title_value_upper
            and _idx < _title_header_idx
            and line.upper() == _title_value_upper
        ):
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": _repair(_smart_join_dialogue(current_text)),
                    "is_stage_direction": False
                })
                current_text = []
            current_character = ""
            lines_data.append({
                "character": "",
                "text": _repair(line),
                "is_stage_direction": True
            })
            continue

        potential_char = line.replace(':', '').strip()
        # Header keyword — front-matter / cast-list labels (TITLE,
        # CHARACTERS, DRAMATIS PERSONAE, etc.) must NEVER be treated as
        # character cues even though they are all-uppercase and short.
        # Route into the stage-direction path, closing any in-progress
        # dialogue block first. Matches either the bare keyword
        # (`CHARACTERS:`) or the keyword followed by content on the
        # same line (`TITLE: THE CALL`, `AUTHOR: Jane Doe`).
        _line_upper = line.upper()
        _is_header_line = False
        for _hk in _HEADER_KEYWORDS:
            if _line_upper == _hk or _line_upper == _hk + ":":
                _is_header_line = True
                break
            # `TITLE: THE CALL` / `WRITTEN BY: Jane Doe` — the keyword
            # starts the line and is terminated by `:` or whitespace.
            if _line_upper.startswith((_hk + ":", _hk + " ")):
                _is_header_line = True
                break
        if _is_header_line:
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": _repair(_smart_join_dialogue(current_text)),
                    "is_stage_direction": False
                })
                current_text = []
            current_character = ""   # header keyword breaks the block
            lines_data.append({
                "character": "",
                "text": _repair(line),
                "is_stage_direction": True
            })
            continue
        # Scene-heading / transition / structural-heading — terminates any
        # in-progress dialogue block and is stored as its own stage-direction
        # line. This prevents Feb-2026 physical bug where SARAH's dialogue
        # absorbed a following `2. INT. KITCHEN — MORNING` + action lines
        # because the scene heading fell through to `current_text.append`.
        if _looks_like_scene_heading(potential_char):
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": _repair(_smart_join_dialogue(current_text)),
                    "is_stage_direction": False
                })
                current_text = []
            current_character = ""   # scene heading breaks the block
            lines_data.append({
                "character": "",
                "text": _repair(line),
                "is_stage_direction": True
            })
            continue
        # Inline-cue dialogue (`NAME: dialogue text`). Common in stage
        # plays and Fountain-style drafts. The cue name must still
        # satisfy the standard character-cue constraints (uppercase,
        # <=3 words, >1 char, not a scene heading, not a header
        # keyword). The right-hand side becomes a single dialogue line
        # attributed to that cue — the "NAME:" prefix is NOT retained.
        _inline_match = _INLINE_CUE_RE.match(line)
        if _inline_match:
            cue_raw = _inline_match.group(1).strip()
            dialogue_text = _inline_match.group(2).strip()
            cue_upper = cue_raw.upper()
            if (
                cue_raw.isupper()
                and len(cue_raw.split()) <= 3
                and len(cue_raw) > 1
                and cue_upper not in _HEADER_KEYWORDS
                and not _looks_like_scene_heading(cue_raw)
                and dialogue_text
            ):
                # Flush any in-progress two-line-style dialogue block.
                if current_character and current_text:
                    lines_data.append({
                        "character": current_character,
                        "text": _repair(_smart_join_dialogue(current_text)),
                        "is_stage_direction": False
                    })
                    current_text = []
                cue_name = _strip_character_cue_extension(cue_raw)
                characters.add(cue_name)
                current_character = cue_name
                lines_data.append({
                    "character": cue_name,
                    "text": _repair(dialogue_text),
                    "is_stage_direction": False
                })
                continue
        # Character-cue detection: uppercase, short, non-empty, and NOT
        # a screenplay scene/transition heading, and NOT a bare
        # parenthetical (which belongs to the stage-direction path).
        # See `_looks_like_scene_heading` for the full list of rejected
        # prefixes.
        if (
            potential_char.isupper()
            and len(potential_char.split()) <= 3
            and len(potential_char) > 1
            and not potential_char.startswith(('(', '['))
            and not _looks_like_scene_heading(potential_char)
        ):
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": _repair(_smart_join_dialogue(current_text)),
                    "is_stage_direction": False
                })
            # Normalise trailing character-cue extensions so the
            # character-select UI shows `JACK`, not `JACK (V.O.)`.
            current_character = _strip_character_cue_extension(potential_char)
            current_text = []
            characters.add(current_character)
        elif line.startswith('(') or line.startswith('['):
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": _repair(_smart_join_dialogue(current_text)),
                    "is_stage_direction": False
                })
                current_text = []
            lines_data.append({
                "character": "",
                "text": _repair(line),
                "is_stage_direction": True
            })
        elif not current_character:
            # Between a scene heading and the next character cue any
            # narrative text is screenplay action, NOT dialogue. Store
            # as a stage-direction line so TTS/rehearsal never reads it
            # as a character speaking. Matches the Feb-2026 physical
            # QA requirement: "Action lines must NEVER enter dialogue".
            lines_data.append({
                "character": "",
                "text": _repair(line),
                "is_stage_direction": True
            })
        else:
            current_text.append(line)
    
    if current_character and current_text:
        lines_data.append({
            "character": current_character,
            "text": _repair(_smart_join_dialogue(current_text)),
            "is_stage_direction": False
        })
    
    return {
        "characters": list(characters),
        "lines": lines_data
    }

def _coalesce_pdf_header_value_splits(text: str) -> str:
    """Repair PyPDF2's habit of splitting `HEADER: value` across two lines.

    PyPDF2 inserts a newline wherever the source PDF's text-run
    positioning jumps between labels and values. For common front-matter
    labels (TITLE, AUTHOR, WRITTEN BY, etc.) this makes the authored
    `TITLE: THE CALL` arrive at the parser as:

        TITLE:
        THE CALL

    which `fallback_parse_script` then correctly interprets as a header
    line followed by an all-uppercase character cue (`THE CALL`). This
    normalizer joins them back onto one line so the authored intent is
    preserved. We ONLY coalesce when:
      * the current line equals a known header keyword followed by `:`
      * the next non-empty line is short (<=60 chars) and is NOT itself
        a header keyword

    `fallback_parse_script` and `/api/scripts` are UNCHANGED by this
    repair — the join happens before any parsing.
    """
    if not text:
        return text
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        cur = lines[i]
        stripped = cur.strip()
        upper = stripped.upper()
        # Match a bare-header line: a known keyword followed only by ":"
        if (upper.endswith(":")
                and upper[:-1] in _HEADER_KEYWORDS):
            # Look ahead to the next non-empty line
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                next_line = lines[j]
                next_stripped = next_line.strip()
                next_upper = next_stripped.upper()
                # Must not itself be another header
                next_is_header = False
                for kw in _HEADER_KEYWORDS:
                    if next_upper == kw or next_upper == kw + ":":
                        next_is_header = True
                        break
                    if next_upper.startswith((kw + ":", kw + " ")):
                        next_is_header = True
                        break
                if (not next_is_header
                        and 0 < len(next_stripped) <= 60):
                    # Preserve leading indentation of the header line.
                    leading_ws = cur[: len(cur) - len(cur.lstrip())]
                    out.append(f"{leading_ws}{stripped} {next_stripped}")
                    i = j + 1
                    continue
        out.append(cur)
        i += 1
    return "\n".join(out)


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF file. Returns extracted text or raises HTTPException with a specific reason."""
    try:
        pdf_file = io.BytesIO(pdf_bytes)
        pdf_reader = PyPDF2.PdfReader(pdf_file)
        # Detect encrypted PDFs — they extract to empty strings which the user
        # would perceive as an "empty script".
        if getattr(pdf_reader, "is_encrypted", False):
            try:
                pdf_reader.decrypt("")
            except Exception:
                pass
            if getattr(pdf_reader, "is_encrypted", False):
                raise HTTPException(
                    status_code=400,
                    detail="This PDF is password-protected. Please remove the password and try again.",
                )
        text_parts = []
        for page in pdf_reader.pages:
            try:
                t = page.extract_text() or ""
            except Exception as page_err:
                logger.warning(f"PDF page extract failed: {page_err}")
                t = ""
            if t:
                text_parts.append(t)
        text = "\n".join(text_parts)
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail="No readable text found in this PDF. It may be a scanned image — try a text-based PDF or export from a word processor.",
            )
        # Repair PyPDF2 header-value splits (e.g. `TITLE:\nTHE CALL`).
        text = _coalesce_pdf_header_value_splits(text)
        return text
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting PDF text: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")

def extract_text_from_docx(docx_bytes: bytes) -> str:
    """Extract text from Word document (.docx). Raises HTTPException with a specific reason on failure.

    Note (2026-02): paragraph.text and cell.text are passed through
    `_normalize_docx_whitespace()` so downstream code sees consistent
    ASCII whitespace. Word can embed <w:tab/>, NBSP (\\xa0), figure
    space (\\u2007), narrow-NBSP (\\u202f), and zero-width space
    (\\u200b) inside run text — all of which surface as visible
    intra-word artefacts (`isn 't`, `unde rstand`, …) unless canonicalised.
    """
    try:
        docx_file = io.BytesIO(docx_bytes)
        doc = Document(docx_file)
        parts = []
        for paragraph in doc.paragraphs:
            if paragraph.text:
                parts.append(_normalize_docx_whitespace(paragraph.text))
        # Also pull text from tables (common in scripts formatted as tables)
        try:
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text:
                            parts.append(_normalize_docx_whitespace(cell.text))
        except Exception as tbl_err:
            logger.warning(f"DOCX table extract failed: {tbl_err}")
        text = "\n".join(parts)
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail="No readable text found in this Word document.",
            )
        return text
    except HTTPException:
        raise
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

# ─── SEC-002 (2026-02): /users/me — identity-from-bearer ───────────────
# A bearer-only endpoint the client can call to resolve "who am I,
# according to the server". Must be declared BEFORE the parameterized
# `/users/{device_id}` route or FastAPI will route `/users/me` into
# that handler with `device_id="me"`. Returns the SAME shape for both
# anonymous device sessions and signed-in users so the mobile UI
# doesn't branch. Only safe/public fields are included — the token
# itself is never echoed back.
@api_router.get("/users/me")
async def get_current_user(
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Return the authenticated identity resolved from the bearer token.

    Response fields:
      * `user_id`            — RAW identity ("device:<id>" or UUID)
      * `effective_user_id`  — the id used for data filters
      * `is_anonymous_device`— True for device-session bearers
      * `email`, `name`, `subscription_tier`, `created_at` — populated
        for signed-in Google/Apple accounts; `None` for anonymous
        device sessions (except `subscription_tier`, which falls back
        to the device-row tier when present, else "free")."""
    is_device = authenticated_user_id.startswith("device:")
    effective = effective_user_id(authenticated_user_id)

    email = None
    name = None
    tier = "free"
    created_at = None

    if is_device:
        urow = await db.users.find_one({"device_id": effective})
        if urow:
            tier = urow.get("subscription_tier", "free")
            created_at = urow.get("created_at")
    else:
        urow = await db.authenticated_users.find_one({"id": effective})
        if urow:
            email = urow.get("email")
            name = urow.get("name")
            tier = urow.get("subscription_tier", "free")
            created_at = urow.get("created_at")

    return {
        "user_id": authenticated_user_id,
        "effective_user_id": effective,
        "is_anonymous_device": is_device,
        "email": email,
        "name": name,
        "subscription_tier": tier,
        "created_at": created_at,
    }

@api_router.get("/users/{device_id}", response_model=UserProfile)
async def get_user(
    device_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user profile by device ID.

    SEC-002 (2026-02): the path `device_id` must match the authenticated
    bearer; cross-user profile reads return 403."""
    enforce_user_id_match(device_id, authenticated_user_id)
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserProfile(**user)

@api_router.get("/users/{device_id}/limits")
async def get_user_limits(
    device_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user's current limits and usage.

    SEC-002 (2026-02): path `device_id` must match authenticated bearer."""
    enforce_user_id_match(device_id, authenticated_user_id)
    user = await db.users.find_one({"device_id": device_id})
    
    tier = "free"
    if user:
        tier = user.get("subscription_tier", "free")
        if tier == "premium" and user.get("subscription_end"):
            if datetime.utcnow() > user["subscription_end"]:
                tier = "free"

    # ─── QA BYPASS (isolated, env-gated, mirrors check_user_limits) ──────────
    # See docstring on check_user_limits() above. When QA_PREMIUM=true the
    # response reports premium entitlements without mutating the user row.
    # Absent flag → identical behaviour to production.
    # SEC-003 (Feb 2026): fail-closed in production via _qa_premium_enabled().
    qa_premium = _qa_premium_enabled()
    qa_override_applied = False
    if qa_premium and tier != "premium":
        logger.warning(
            "[QA_BYPASS] get_user_limits returning premium for device_id=%s "
            "(real_tier=%s). Disable QA_PREMIUM in production.",
            device_id, tier,
        )
        tier = "premium"
        qa_override_applied = True

    limits = get_tier_limits(tier)
    
    # Get current usage
    scripts_count = 0
    rehearsals_today = 0
    if user:
        scripts_count = await db.scripts.count_documents({"user_id": user["id"]})
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if user.get("last_rehearsal_date") == today:
            rehearsals_today = user.get("rehearsals_today", 0)
    
    response = {
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
    if qa_override_applied:
        response["qa_premium_bypass"] = True
    return response

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
async def subscribe_user(
    device_id: str,
    subscription: SubscriptionUpdate,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Activate or update user subscription.

    SEC-002 (2026-02): the path `device_id` must match the authenticated
    bearer so one caller cannot activate premium on another user's
    account (privilege-escalation prevention).

    SEC-003 (2026-02): Premium entitlement is granted ONLY after the
    server independently verifies an active Premium entitlement via the
    RevenueCat REST API (`fetch_premium_entitlement`). The client-supplied
    `plan` is still accepted for metadata, but it CANNOT grant Premium
    on its own. Requests without `revenuecat_app_user_id` → 400.
    Entitlement missing/expired → 402. RevenueCat unreachable → 503."""
    enforce_user_id_match(device_id, authenticated_user_id)
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    plan = SUBSCRIPTION_PLANS.get(subscription.plan)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid subscription plan")

    # SEC-003: require a RevenueCat app_user_id and verify server-side.
    if not subscription.revenuecat_app_user_id:
        raise HTTPException(
            status_code=400,
            detail="revenuecat_app_user_id is required for server-side verification",
        )
    try:
        entitlement = await fetch_premium_entitlement(
            subscription.revenuecat_app_user_id,
        )
    except RevenueCatNotConfigured as exc:
        logger.error("[SEC-003] subscribe: RC not configured: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Subscription verification is temporarily unavailable",
        ) from exc
    except RevenueCatUnavailable as exc:
        logger.warning("[SEC-003] subscribe: RC unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Subscription verification is temporarily unavailable",
        ) from exc

    if not entitlement.active:
        logger.info(
            "[SEC-003] subscribe REJECTED for device_id=%s rc_user=%s "
            "(active=False, expires_at=%s)",
            device_id, subscription.revenuecat_app_user_id, entitlement.expires_at,
        )
        raise HTTPException(
            status_code=402,
            detail="No active Premium entitlement found in RevenueCat",
        )

    # Calculate subscription dates
    now = datetime.utcnow()
    sub_end = entitlement.expires_at
    if sub_end is None:
        # Lifetime entitlement — pick a far-future sentinel so downstream
        # expiry checks (datetime.utcnow() > subscription_end) stay false.
        sub_end = now + timedelta(days=36500)
    else:
        # Convert tz-aware UTC → naive UTC to match the rest of the
        # codebase's `datetime.utcnow()` convention.
        sub_end = sub_end.astimezone(timezone.utc).replace(tzinfo=None)

    update_data = {
        "subscription_tier": "premium",
        "subscription_plan": subscription.plan,
        "subscription_start": now,
        "subscription_end": sub_end,
        "revenuecat_app_user_id": subscription.revenuecat_app_user_id,
        "updated_at": now,
    }

    await db.users.update_one(
        {"device_id": device_id},
        {"$set": update_data}
    )
    
    updated_user = await db.users.find_one({"device_id": device_id})
    return UserProfile(**updated_user)

@api_router.post("/users/{device_id}/start-trial")
async def start_trial(
    device_id: str,
    request: StartTrialRequest | None = None,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Start a 3-day premium trial.

    SEC-002 (2026-02): path `device_id` must match the authenticated
    bearer; prevents trial-grant on another user's account.

    SEC-003 (2026-02): the trial flag is only set after RevenueCat
    confirms an active Premium entitlement (intro/trial counts as
    `active=True` in RC). The server never grants Premium on client
    signal alone. Missing `revenuecat_app_user_id` → 400; no active
    entitlement → 402; RC unreachable → 503."""
    enforce_user_id_match(device_id, authenticated_user_id)
    user = await db.users.find_one({"device_id": device_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.get("trial_used"):
        raise HTTPException(status_code=400, detail="Trial already used")

    # SEC-003: require RC app_user_id + server-side verification.
    rc_app_user_id = request.revenuecat_app_user_id if request else None
    if not rc_app_user_id:
        raise HTTPException(
            status_code=400,
            detail="revenuecat_app_user_id is required for server-side verification",
        )
    try:
        entitlement = await fetch_premium_entitlement(rc_app_user_id)
    except RevenueCatNotConfigured as exc:
        logger.error("[SEC-003] start-trial: RC not configured: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Trial verification is temporarily unavailable",
        ) from exc
    except RevenueCatUnavailable as exc:
        logger.warning("[SEC-003] start-trial: RC unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Trial verification is temporarily unavailable",
        ) from exc

    if not entitlement.active:
        logger.info(
            "[SEC-003] start-trial REJECTED for device_id=%s rc_user=%s "
            "(active=False, expires_at=%s)",
            device_id, rc_app_user_id, entitlement.expires_at,
        )
        raise HTTPException(
            status_code=402,
            detail="No active Premium trial entitlement found in RevenueCat",
        )

    now = datetime.utcnow()
    if entitlement.expires_at is None:
        trial_end = now + timedelta(days=3)
    else:
        trial_end = entitlement.expires_at.astimezone(timezone.utc).replace(tzinfo=None)
    
    await db.users.update_one(
        {"device_id": device_id},
        {"$set": {
            "subscription_tier": "premium",
            "trial_used": True,
            "trial_end": trial_end,
            "subscription_end": trial_end,
            "revenuecat_app_user_id": rc_app_user_id,
            "updated_at": now,
        }}
    )
    
    updated_user = await db.users.find_one({"device_id": device_id})
    return UserProfile(**updated_user)

@api_router.post("/users/{device_id}/cancel-subscription")
async def cancel_subscription(
    device_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Cancel user subscription (keeps access until end date).

    SEC-002 (2026-02): path `device_id` must match authenticated bearer."""
    enforce_user_id_match(device_id, authenticated_user_id)
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
async def create_script(
    script_data: ScriptCreate,
    user_id: str = Depends(get_effective_user_id),
):
    """Create a new script from raw text.

    SEC-002 (2026-02): the effective owner is now the authenticated
    bearer identity. Any `script_data.user_id` the client sends is
    IGNORED — one device/user can no longer plant a script against
    another user's id.

    IMPORT LATENCY FIX (2026-02):
    Previously this handler synchronously called ``parse_script_with_ai``
    (gpt-4o), which typically took 20-40 seconds even for tiny (~2 KB)
    scripts — the Samsung SM-S918B physical timing showed 27.21s for a
    2260-char / 39-line / 3-character script. That is unacceptably slow
    for a "save script" UX and the LLM output was not actually needed
    synchronously: the frontend script-parser screen has already produced
    ``parseResult.parsedLines`` deterministically (client-side) and the
    user has already selected their character from those results before
    tapping Save. The backend ``fallback_parse_script`` is the same
    deterministic parser already trusted as the LLM's safety net.

    We now use ``fallback_parse_script`` directly so ``POST /api/scripts``
    completes in tens of milliseconds. The LLM helper ``parse_script_with_ai``
    remains in place for any future non-blocking enhancement endpoint —
    it is not removed, only no longer called from the save path.

    API contract, model shape, character/scene/dialogue extraction,
    persistence, and user-limit checks are all preserved.
    """
    try:
        # Check user limits
        limits_check = await check_user_limits(user_id, "create_script")
        if not limits_check["allowed"]:
            raise HTTPException(status_code=403, detail=limits_check["upgrade_reason"])

        # Deterministic parse — same output shape as parse_script_with_ai.
        parsed = fallback_parse_script(script_data.raw_text)

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
            user_id=user_id,
        )

        await db.scripts.insert_one(script.dict())

        # Update user script count
        await db.users.update_one(
            {"$or": [{"id": user_id}, {"device_id": user_id}]},
            {"$inc": {"scripts_count": 1}}
        )

        return script
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating script: {e}")
        raise HTTPException(status_code=500, detail="Failed to create script. Please try again.")

@api_router.post("/scripts/upload")
async def upload_script(
    file: UploadFile = File(...),
    title: str = Form(...),
    user_id: str = Depends(get_effective_user_id),
):
    """Extract text from a PDF, Word document, or text file.

    ⚠️ CONTRACT: This endpoint is EXTRACTION-ONLY. It does NOT persist a
    Script row. The frontend is the single owner of persistence and calls
    POST /api/scripts once the user has reviewed the extracted text and
    picked their character (via the script-parser screen).

    SEC-002 (2026-02): the `user_id` form field was previously trusted
    unauthenticated; it is now derived from the bearer and the form
    field is no longer accepted. Returns 401 for unauthenticated callers.

    Returns: { raw_text, filename, title, size_bytes, source: 'multipart' }
    """
    try:
        # Check user limits (extraction still counts against tier limits)
        limits_check = await check_user_limits(user_id, "create_script")
        if not limits_check["allowed"]:
            raise HTTPException(status_code=403, detail=limits_check["upgrade_reason"])

        content = await file.read()
        filename_lower = (file.filename or "file").lower()

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

        if not raw_text or not raw_text.strip():
            raise HTTPException(status_code=400, detail="No readable text found in the file.")

        return {
            "raw_text": raw_text,
            "filename": file.filename,
            "title": title,
            "size_bytes": len(content),
            "source": "multipart",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting script: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract script. Please try again.")


@api_router.post("/scripts/upload-base64")
async def upload_script_base64(
    request: Request,
    user_id: str = Depends(get_effective_user_id),
):
    """Base64 extraction endpoint (Android-safe alternative to multipart).

    ⚠️ CONTRACT: Same as /scripts/upload — EXTRACTION-ONLY. Does NOT persist
    a Script. Frontend is the single owner of persistence.

    SEC-002 (2026-02): any `user_id` key in the JSON body is IGNORED; the
    effective owner is the authenticated bearer identity. Returns 401 for
    unauthenticated callers.

    Returns: { raw_text, filename, title, size_bytes, source: 'base64' }
    """
    try:
        body = await request.json()
        title = body.get("title", "Untitled Script")
        filename = (body.get("filename", "file.txt") or "file.txt").lower()
        file_base64 = body.get("file_data", "")

        if not file_base64:
            raise HTTPException(status_code=400, detail="No file data provided")

        import base64
        content = base64.b64decode(file_base64)

        # Check user limits
        limits_check = await check_user_limits(user_id, "create_script")
        if not limits_check["allowed"]:
            raise HTTPException(status_code=403, detail=limits_check["upgrade_reason"])

        file_size_mb = len(content) / (1024 * 1024)
        max_size = limits_check["limits"]["max_file_size_mb"]
        if file_size_mb > max_size:
            raise HTTPException(
                status_code=403,
                detail=f"File size ({file_size_mb:.1f}MB) exceeds limit ({max_size}MB). Upgrade to Premium!"
            )

        if filename.endswith('.pdf'):
            raw_text = extract_text_from_pdf(content)
        elif filename.endswith(('.docx',)):
            raw_text = extract_text_from_docx(content)
        elif filename.endswith(('.txt', '.text', '.rtf')):
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

        if not raw_text or not raw_text.strip():
            raise HTTPException(status_code=400, detail="No readable text found in the file.")

        return {
            "raw_text": raw_text,
            "filename": body.get("filename") or "file",
            "title": title,
            "size_bytes": len(content),
            "source": "base64",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in base64 upload: {e}")
        raise HTTPException(status_code=500, detail="Failed to extract file. Please try again.")


@api_router.get("/scripts", response_model=List[Script])
async def get_scripts(user_id: str = Depends(get_effective_user_id)):
    """Get all scripts for a user - optimized with projection to exclude large fields.

    SEC-002 (2026-02): the previous `?user_id=` query parameter is now
    IGNORED. The list is always keyed to the authenticated bearer so one
    user cannot enumerate another user's scripts.
    """
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
async def get_script(
    script_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Get a specific script by ID.

    SEC-002 (2026-02): 404 is returned if the script exists but belongs
    to another user — same shape as 'not found' so cross-user existence
    probing is not possible.
    """
    script = await db.scripts.find_one({"id": script_id})
    if not script or script.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Script not found")
    return Script(**script)

@api_router.put("/scripts/{script_id}")
async def update_script(
    script_id: str,
    update_data: ScriptUpdate,
    user_id: str = Depends(get_effective_user_id),
):
    """Update script settings.

    SEC-002 (2026-02): one user cannot mutate another user's scripts.
    Attempts return 404 (indistinguishable from a true miss)."""
    script = await db.scripts.find_one({"id": script_id})
    if not script or script.get("user_id") != user_id:
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
async def delete_script(
    script_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Delete a script.

    SEC-002 (2026-02): one user cannot delete another user's scripts;
    cross-owner attempts return 404 (indistinguishable from a true miss)."""
    script = await db.scripts.find_one({"id": script_id})
    if not script or script.get("user_id") != user_id:
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
async def create_rehearsal(
    rehearsal_data: RehearsalCreate,
    user_id: str = Depends(get_effective_user_id),
):
    """Create a new rehearsal session.

    SEC-002 (2026-02): effective owner is the authenticated bearer;
    any `rehearsal_data.user_id` from the client is IGNORED. Script
    ownership is enforced (cross-user script-id rehearsal returns 404)."""
    # Check user limits (bearer-derived identity)
    limits_check = await check_user_limits(user_id, "create_rehearsal")
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
    if not script or script.get("user_id") != user_id:
        # 404 for both "not found" and "not yours" (don't leak existence).
        raise HTTPException(status_code=404, detail="Script not found")
    
    total_lines = sum(1 for line in script.get("lines", []) 
                     if line.get("character") == rehearsal_data.user_character)
    
    rehearsal = RehearsalSession(
        script_id=rehearsal_data.script_id,
        user_id=user_id,
        user_character=rehearsal_data.user_character,
        mode=rehearsal_data.mode,
        voice_type=rehearsal_data.voice_type,
        # 2026-02 reader-style wiring — forwarded from the client and
        # persisted so both the immediate create-response and any later
        # /rehearsals/{id} GET (e.g. deep-link resume) carry it through
        # to the rehearsal screen's speakLine merger.
        reader_style=rehearsal_data.reader_style,
        voice_speed=rehearsal_data.voice_speed,
        total_lines=total_lines
    )
    
    await db.rehearsals.insert_one(rehearsal.dict())
    
    # Update user rehearsal count
    today = datetime.utcnow().strftime("%Y-%m-%d")
    user = await db.users.find_one({"$or": [{"id": user_id}, {"device_id": user_id}]})
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
async def get_rehearsals(user_id: str = Depends(get_effective_user_id)):
    """Get all rehearsal sessions for a user.

    SEC-002 (2026-02): legacy `?user_id=` query is IGNORED; list is
    keyed to the authenticated bearer."""
    rehearsals = await db.rehearsals.find({"user_id": user_id}).sort("created_at", -1).to_list(100)
    return [RehearsalSession(**r) for r in rehearsals]

@api_router.get("/rehearsals/{rehearsal_id}", response_model=RehearsalSession)
async def get_rehearsal(
    rehearsal_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Get a specific rehearsal session.

    SEC-002 (2026-02): cross-owner reads return 404."""
    rehearsal = await db.rehearsals.find_one({"id": rehearsal_id})
    if not rehearsal or rehearsal.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    return RehearsalSession(**rehearsal)

@api_router.put("/rehearsals/{rehearsal_id}")
async def update_rehearsal(
    rehearsal_id: str,
    update_data: Dict[str, Any],
    user_id: str = Depends(get_effective_user_id),
):
    """Update rehearsal progress.

    SEC-002 (2026-02): cross-owner mutations return 404."""
    rehearsal = await db.rehearsals.find_one({"id": rehearsal_id})
    if not rehearsal or rehearsal.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    
    update_data["updated_at"] = datetime.utcnow()
    # Never let the client overwrite the owner field via arbitrary JSON.
    update_data.pop("user_id", None)
    await db.rehearsals.update_one({"id": rehearsal_id}, {"$set": update_data})
    
    # Update total lines practiced
    if "completed_lines" in update_data:
        lines_count = len(update_data["completed_lines"])
        await db.users.update_one(
            {"$or": [{"id": user_id}, {"device_id": user_id}]},
            {"$inc": {"total_lines_practiced": lines_count}}
        )
    
    updated = await db.rehearsals.find_one({"id": rehearsal_id})
    return RehearsalSession(**updated)

@api_router.delete("/rehearsals/{rehearsal_id}")
async def delete_rehearsal(
    rehearsal_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Delete a rehearsal session.

    SEC-002 (2026-02): cross-owner deletes return 404."""
    rehearsal = await db.rehearsals.find_one({"id": rehearsal_id})
    if not rehearsal or rehearsal.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    result = await db.rehearsals.delete_one({"id": rehearsal_id, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    return {"message": "Rehearsal session deleted"}

# ==================== ANALYTICS ROUTES (PREMIUM) ====================

@api_router.get("/users/{device_id}/stats")
async def get_user_stats(
    device_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user statistics (basic for free, detailed for premium).

    SEC-002 (2026-02): path `device_id` must match authenticated bearer."""
    enforce_user_id_match(device_id, authenticated_user_id)
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
        raise HTTPException(status_code=500, detail="Script analysis failed. Please try again.")

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
    """Authenticate with Apple Sign In.

    SEC-001 remediation (2026-02): the server now cryptographically
    verifies `request.identity_token` against Apple's JWKS, enforces
    `iss`, `aud` (== APPLE_BUNDLE_ID), `exp`, and uses `claims["sub"]`
    as the stable identity. The client-supplied `user_identifier` is
    IGNORED — it was previously trusted and gave any caller a session
    for any Apple account id they supplied.
    """
    from identity_tokens import (
        IdentityProviderNotConfigured,
        IdentityTokenInvalid,
        IdentityTokenUnavailable,
        verify_apple_id_token,
    )
    try:
        claims = verify_apple_id_token(request.identity_token)
    except IdentityProviderNotConfigured:
        logger.error("SEC-001: Apple sign-in attempted but APPLE_BUNDLE_ID is unset")
        raise HTTPException(
            status_code=503,
            detail="Apple Sign-In is not configured on this server",
        )
    except IdentityTokenUnavailable:
        raise HTTPException(
            status_code=503,
            detail="Apple identity provider unreachable; try again",
        )
    except IdentityTokenInvalid:
        # Generic 401 — do not leak which claim failed.
        raise HTTPException(status_code=401, detail="Invalid Apple identity token")

    # Verified. Trust ONLY claims["sub"] as identity. Email is only
    # used as profile metadata if Apple actually included it.
    apple_sub = claims["sub"]
    verified_email = claims.get("email") if isinstance(claims.get("email"), str) else None

    try:
        user, is_new = await find_or_create_user_by_auth(
            provider="apple",
            provider_user_id=apple_sub,
            email=verified_email or request.email,
            name=request.full_name,
            device_id=request.device_id,
        )

        access_token = generate_access_token(user["id"])

        # Store the token
        await db.auth_tokens.update_one(
            {"user_id": user["id"]},
            {
                "$set": {
                    "token": access_token,
                    "created_at": datetime.utcnow(),  # noqa: DTZ003 — matches existing sign-in writes
                    "expires_at": datetime.utcnow() + timedelta(days=30),  # noqa: DTZ003
                }
            },
            upsert=True,
        )

        return AuthResponse(
            user_id=user["id"],
            email=user.get("email"),
            name=user.get("name"),
            is_new_user=is_new,
            subscription_tier=user.get("subscription_tier", "free"),
            access_token=access_token,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apple Sign-In post-verification error: {e}")
        raise HTTPException(status_code=500, detail="Authentication failed. Please try again.")

@api_router.post("/auth/google", response_model=AuthResponse)
async def google_sign_in(request: GoogleAuthRequest):
    """Authenticate with Google Sign-In.

    SEC-001 remediation (2026-02): the server now verifies the JWT
    signature against Google's JWKS, enforces `iss`, `aud` (one of
    GOOGLE_OAUTH_CLIENT_IDS), `exp`, and requires `email_verified`.
    The previous payload-only base64 decode accepted any forged JWT
    with any `sub` and granted a session for that account.
    """
    from identity_tokens import (
        IdentityProviderNotConfigured,
        IdentityTokenInvalid,
        IdentityTokenUnavailable,
        verify_google_id_token,
    )
    try:
        claims = verify_google_id_token(request.id_token)
    except IdentityProviderNotConfigured:
        logger.error(
            "SEC-001: Google sign-in attempted but GOOGLE_OAUTH_CLIENT_IDS is unset"
        )
        raise HTTPException(
            status_code=503,
            detail="Google Sign-In is not configured on this server",
        )
    except IdentityTokenUnavailable:
        raise HTTPException(
            status_code=503,
            detail="Google identity provider unreachable; try again",
        )
    except IdentityTokenInvalid:
        raise HTTPException(status_code=401, detail="Invalid Google identity token")

    google_user_id = claims["sub"]
    email = claims.get("email") if isinstance(claims.get("email"), str) else None
    name = claims.get("name") if isinstance(claims.get("name"), str) else None

    try:
        user, is_new = await find_or_create_user_by_auth(
            provider="google",
            provider_user_id=google_user_id,
            email=email,
            name=name,
            device_id=request.device_id,
        )

        access_token = generate_access_token(user["id"])

        # Store the token
        await db.auth_tokens.update_one(
            {"user_id": user["id"]},
            {
                "$set": {
                    "token": access_token,
                    "created_at": datetime.utcnow(),  # noqa: DTZ003 — matches existing sign-in writes
                    "expires_at": datetime.utcnow() + timedelta(days=30),  # noqa: DTZ003
                }
            },
            upsert=True,
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
        raise HTTPException(status_code=500, detail="Authentication failed. Please try again.")

@api_router.get("/auth/user/{user_id}")
async def get_authenticated_user(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get authenticated user profile.

    SEC-002 (2026-02): the path `user_id` must match the authenticated
    bearer; stops cross-user email/name harvesting."""
    enforce_user_id_match(user_id, authenticated_user_id)
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
async def logout(
    device_id: str = None,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Logout user (optionally from specific device).

    SEC-002 (2026-02): the user to log out is now derived from the
    authenticated bearer; the former `user_id` query parameter is
    IGNORED so one caller cannot invalidate another user's tokens."""
    user_id = authenticated_user_id
    if device_id:
        # Just remove this device from the signed-in profile.
        await db.authenticated_users.update_one(
            {"id": user_id},
            {"$pull": {"device_ids": device_id}}
        )
    else:
        # Invalidate all tokens for THIS authenticated identity.
        await db.auth_tokens.delete_many({"user_id": user_id})
    
    return {"message": "Logged out successfully"}

# ─── 2026-02 SCRIPT M8 — DEVICE SESSION FOR TTS PROXY ─────────────────
# Google/Apple sign-in is currently gated off in the mobile client
# (see frontend/contexts/AuthContext.tsx lines ~97-99 — "TEMPORARILY
# DISABLED: Sign-In will be enabled in future update"). Without a
# sign-in, the device has NO bearer token, and the SEC-004 auth gate
# on POST /api/tts/elevenlabs/generate rejects every rehearsal line
# with 401. That is why on-device voice playback was silently falling
# back to expo-speech despite elevenLabsConfigured=true.
#
# This endpoint mints an anonymous session token bound to the device
# (via the AsyncStorage-stored `@scriptmate_device_id`). It is the
# SMALLEST change that lets the SEC-004-hardened proxy serve the real
# app today while leaving the hardening (bearer required, per-user
# rate limit, 2000-char cap) fully intact.
#
# Security notes:
#   * The token is still a 64-hex sha256 (same `generate_access_token`
#     used by Google/Apple sign-in).
#   * `user_id` is deterministically derived as `device:<device_id>`
#     so repeated calls from the same device upsert the same row,
#     and the TTS per-user rate limit (60/10min) applies per device.
#   * Minting itself is rate-limited: 10 mints / 10 min / device, so
#     a single device cannot churn tokens.
#   * Device ID is bounded to 128 chars and must be non-empty.
#   * When real Google/Apple sign-in is re-enabled, the authenticated
#     session supersedes this anonymous one — nothing here blocks
#     SEC-001 remediation.

class DeviceSessionRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)

    class Config:
        extra = "forbid"


# In-memory rate limit for device-session minting. Keyed by device_id.
import threading as _device_session_thread  # local alias to avoid collision
_device_session_rl_lock = _device_session_thread.Lock()
_device_session_rl_state: dict[str, list] = {}
DEVICE_SESSION_RL_MAX = 10
DEVICE_SESSION_RL_WINDOW_SECONDS = 600


def _device_session_check_rate_limit(device_id: str) -> None:
    import time as _time
    now = _time.monotonic()
    with _device_session_rl_lock:
        bucket = _device_session_rl_state.get(device_id, [])
        cutoff = now - DEVICE_SESSION_RL_WINDOW_SECONDS
        bucket = [t for t in bucket if t > cutoff]
        if len(bucket) >= DEVICE_SESSION_RL_MAX:
            raise HTTPException(
                status_code=429,
                detail="Too many device-session mints; try again later",
            )
        bucket.append(now)
        _device_session_rl_state[device_id] = bucket


@api_router.post("/auth/device-session")
async def mint_device_session(request: DeviceSessionRequest):
    """Mint an anonymous bearer token bound to the mobile device.

    Returns {token, user_id, expires_at}. The token is stored in
    db.auth_tokens exactly like a sign-in session so the SEC-004
    `get_authenticated_user_id` dependency accepts it unchanged.
    """
    device_id = request.device_id.strip()
    if not device_id:
        raise HTTPException(status_code=422, detail="device_id required")
    _device_session_check_rate_limit(device_id)

    user_id = f"device:{device_id}"
    token = generate_access_token(user_id)
    # Naive UTC — matches the sign-in flow writes above so the shared
    # `get_authenticated_user_id` dependency compares correctly.
    now_naive = datetime.utcnow()  # noqa: DTZ003 — matches sign-in writes
    expires_at = now_naive + timedelta(days=30)
    await db.auth_tokens.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "token": token,
                "created_at": now_naive,
                "expires_at": expires_at,
                "device_id": device_id,
                "kind": "device-anonymous",
            }
        },
        upsert=True,
    )
    return {
        "token": token,
        "user_id": user_id,
        "expires_at": expires_at.isoformat() + "Z",
    }

# ==================== SYNC ROUTES ====================

@api_router.post("/sync/push")
async def push_sync_data(
    request: SyncDataRequest,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Push local data to server for sync.

    SEC-002 (2026-02): the owning user_id is derived from the bearer;
    `request.user_id` is IGNORED so one user cannot overwrite another's
    notes/stats/settings."""
    user_id = authenticated_user_id
    try:
        user = await db.authenticated_users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Sync director notes
        if request.director_notes:
            for note in request.director_notes:
                note["user_id"] = user_id
                await db.director_notes.update_one(
                    {"id": note.get("id")},
                    {"$set": note},
                    upsert=True
                )
        
        # Sync performance stats
        if request.performance_stats:
            request.performance_stats["user_id"] = user_id
            request.performance_stats["updated_at"] = datetime.utcnow()
            await db.performance_stats.update_one(
                {"user_id": user_id},
                {"$set": request.performance_stats},
                upsert=True
            )
        
        # Sync settings
        if request.settings:
            request.settings["user_id"] = user_id
            request.settings["updated_at"] = datetime.utcnow()
            await db.user_settings.update_one(
                {"user_id": user_id},
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
        raise HTTPException(status_code=500, detail="Sync failed. Please try again.")

@api_router.get("/sync/pull/{user_id}")
async def pull_sync_data(
    user_id: str,
    last_sync: str = None,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Pull all user data from server.

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
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
        raise HTTPException(status_code=500, detail="Sync failed. Please try again.")

# ==================== DIRECTOR NOTES ROUTES ====================

@api_router.get("/notes/{script_id}")
async def get_script_notes(
    script_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Get all director notes for a script.

    SEC-002 (2026-02): the previous `?user_id=` query parameter is
    IGNORED. Notes are always filtered by the authenticated bearer
    identity so one user cannot read another's notes.
    """
    notes = await db.director_notes.find({
        "script_id": script_id,
        "user_id": user_id
    }, {"_id": 0}).to_list(500)
    return notes

@api_router.post("/notes")
async def create_note(
    note: DirectorNote,
    user_id: str = Depends(get_effective_user_id),
):
    """Create or update a director note.

    SEC-002 (2026-02): the previous `?user_id=` query parameter is
    IGNORED; the stored `user_id` is derived from the bearer so one
    user cannot plant notes against another user's id. If a note with
    the given id already exists against a different owner it is NOT
    overwritten — this prevents stealthy note hijacking by colliding
    the id.
    """
    note_dict = note.dict()
    note_dict["user_id"] = user_id

    # Guard against id collision across owners: only upsert when the
    # existing row (if any) belongs to the same authenticated user.
    existing = await db.director_notes.find_one({"id": note.id})
    if existing and existing.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Note not found")

    await db.director_notes.update_one(
        {"id": note.id},
        {"$set": note_dict},
        upsert=True
    )
    return note_dict

@api_router.delete("/notes/{note_id}")
async def delete_note(
    note_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Delete a director note.

    SEC-002 (2026-02): cross-owner delete attempts return 404
    (indistinguishable from a true miss) so one user cannot delete
    another user's notes."""
    existing = await db.director_notes.find_one({"id": note_id})
    if not existing or existing.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Note not found")
    result = await db.director_notes.delete_one({"id": note_id, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}

# ==================== PERFORMANCE STATS ROUTES ====================

@api_router.get("/stats/{user_id}")
async def get_user_stats(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user's performance statistics.

    SEC-002 (2026-02): the path `user_id` is now validated against the
    authenticated bearer. Mismatches return 403 so one user cannot read
    another user's stats by swapping the URL segment."""
    enforce_user_id_match(user_id, authenticated_user_id)
    effective = effective_user_id(authenticated_user_id)
    stats = await db.performance_stats.find_one({"user_id": effective}, {"_id": 0})
    if not stats:
        # Return default stats
        return {
            "user_id": effective,
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
async def update_user_stats(
    user_id: str,
    stats_update: Dict[str, Any],
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Update user's performance statistics after a rehearsal.

    SEC-002 (2026-02): the path `user_id` is now validated against the
    authenticated bearer. Mismatches return 403 so one user cannot
    tamper with another user's performance history."""
    enforce_user_id_match(user_id, authenticated_user_id)
    effective = effective_user_id(authenticated_user_id)
    current = await db.performance_stats.find_one({"user_id": effective})

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
            {"user_id": effective},
            {"$set": update_data}
        )
    else:
        # Create new stats
        new_stats = {
            "user_id": effective,
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

# ─── 2026-02 SCRIPT M8 — TTS endpoint hardening (SEC-004) ──────────────
# ─── 2026-02 SEC-002   — SAME auth now applied to scripts/notes/stats ──
#
# The authoritative identity extractor was hoisted to `backend/auth.py`
# and imported near the top of this module (see the import block right
# below the APIRouter definition). The TTS proxy below continues to use
# `Depends(get_authenticated_user_id)` unchanged — SEC-002 extends the
# same gate across scripts, notes, stats, daily-drill and `/users/me`.


# In-memory sliding-window rate limiter for the TTS proxy. Keyed by
# the authenticated user_id (NOT by any client-supplied UUID/device_id).
# Window: 60 calls per 10 minutes per user. Rejected with 429 and the
# retry window echoed in headers.
import threading as _tts_rl_thread  # local alias to avoid collision

_tts_rl_lock = _tts_rl_thread.Lock()
_tts_rl_state: dict[str, list] = {}
TTS_RATE_LIMIT_MAX = 60
TTS_RATE_LIMIT_WINDOW_SECONDS = 600  # 10 minutes


def _tts_check_rate_limit(user_id: str) -> None:
    """Raises HTTPException(429) if the authenticated user exceeded
    the sliding window. Side-effect: records the current call."""
    import time as _t
    now = _t.time()
    cutoff = now - TTS_RATE_LIMIT_WINDOW_SECONDS
    with _tts_rl_lock:
        history = _tts_rl_state.get(user_id, [])
        # Drop timestamps outside the window.
        history = [t for t in history if t >= cutoff]
        if len(history) >= TTS_RATE_LIMIT_MAX:
            retry_after = max(1, int(TTS_RATE_LIMIT_WINDOW_SECONDS - (now - history[0])))
            raise HTTPException(
                status_code=429,
                detail=f"TTS rate limit exceeded: {TTS_RATE_LIMIT_MAX} per {TTS_RATE_LIMIT_WINDOW_SECONDS // 60} min",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(TTS_RATE_LIMIT_MAX),
                    "X-RateLimit-Window-Seconds": str(TTS_RATE_LIMIT_WINDOW_SECONDS),
                },
            )
        history.append(now)
        _tts_rl_state[user_id] = history


# ─── Phase P2 (SEC-004): per-tier daily/monthly character budgets + global
#     emergency ceiling. All four knobs are env-driven; absent / empty / "0"
#     means "disabled" so this helper is a no-op by default. When enabled,
#     the check runs AFTER authentication, after Pydantic validation, after
#     the sliding-window rate limit, and BEFORE the ElevenLabs vendor call —
#     so no financial cost is incurred for a rejected budget request.
#
#     Order of enforcement inside this helper:
#       (1) Global emergency ceiling → 503 (operator signal)
#       (2) Premium monthly cap      → 402 (user signal)
#       (3) Per-tier daily cap       → 402 (user signal)
#
#     Reuses the P1 ledger (`db.tts_usage`) read-only. No schema change,
#     no new collection, no new index — see index-verification table in
#     the P2 implementation ticket. Tier resolution reuses the SEC-003
#     fail-closed `_qa_premium_enabled()` helper so QA_PREMIUM remains
#     a dev-only override that does nothing in production.

def _env_int(name: str) -> int:
    """Return the int value of env var `name`, or 0 if unset / empty /
    non-numeric / negative. 0 means 'this lever disabled'."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return 0
    try:
        v = int(raw)
    except ValueError:
        return 0
    return max(0, v)


async def _resolve_tier_for_tts(user_id: str) -> str:
    """Resolve 'free' or 'premium' for a bearer-derived user_id.

    Mirrors the first ~15 lines of `check_user_limits` but strips the
    per-action branches — the budget check only needs the tier string.
    Honours the SEC-003 fail-closed QA_PREMIUM gate via
    `_qa_premium_enabled()`.

    `user_id` arrives in the raw form produced by `get_authenticated_user_id`
    (either "device:<id>" or a UUID for authenticated accounts). We query
    both collections because a device can later be linked to an account."""
    effective = effective_user_id(user_id)
    tier = "free"
    user = await db.users.find_one({"device_id": effective})
    if not user:
        user = await db.authenticated_users.find_one({"id": effective})
    if user:
        tier = user.get("subscription_tier", "free")
        sub_end = user.get("subscription_end")
        if tier == "premium" and sub_end and datetime.now(timezone.utc).replace(tzinfo=None) > sub_end:
            tier = "free"
    if _qa_premium_enabled() and tier != "premium":
        tier = "premium"
    return tier


async def _tts_check_character_budget(user_id: str, requested_chars: int) -> None:
    """SEC-004 / Phase P2 enforcement.

    Raises:
      * 503 — global daily ceiling would be exceeded (operator signal).
      * 402 — per-user monthly or daily cap would be exceeded (user signal).

    Short-circuits with zero DB access when all four env vars are
    disabled (empty / 0), preserving the Phase P1 "observability only"
    behaviour for ops still rolling out levers one at a time."""
    free_daily_cap = _env_int("TTS_FREE_DAILY_CHARS")
    premium_daily_cap = _env_int("TTS_PREMIUM_DAILY_CHARS")
    premium_monthly_cap = _env_int("TTS_PREMIUM_MONTHLY_CHARS")
    global_daily_cap = _env_int("TTS_GLOBAL_DAILY_CEILING_CHARS")

    if not any([free_daily_cap, premium_daily_cap,
                premium_monthly_cap, global_daily_cap]):
        return  # P1 behaviour preserved — nothing enabled.

    now = datetime.now(timezone.utc)
    date_key = now.strftime("%Y-%m-%d")
    month_key = now.strftime("%Y-%m")

    # ── (1) Global emergency ceiling — operator signal (503) ───────────
    # Uses tts_usage_date_chars_desc (date leading key).
    if global_daily_cap:
        global_cursor = db.tts_usage.aggregate([
            {"$match": {"date": date_key}},
            {"$group": {"_id": None, "chars": {"$sum": "$characters"}}},
        ])
        agg = await global_cursor.to_list(length=1)
        global_used = int(agg[0]["chars"]) if agg else 0
        if global_used + requested_chars > global_daily_cap:
            logger.warning(
                "[SEC-004 P2] global ceiling reached: used=%d limit=%d "
                "requested=%d",
                global_used, global_daily_cap, requested_chars,
            )
            # Retry-After points at next UTC midnight — the ceiling
            # is per UTC day, so this is the earliest the day sum
            # resets.
            tomorrow = (now + timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0,
            )
            retry_after = max(1, int((tomorrow - now).total_seconds()))
            raise HTTPException(
                status_code=503,
                detail="TTS temporarily unavailable (daily service ceiling reached)",
                headers={"Retry-After": str(retry_after)},
            )

    # ── (2) and (3) Per-user caps — needs tier.
    #       Resolve tier once; honours SEC-003 fail-closed QA_PREMIUM.
    tier = await _resolve_tier_for_tts(user_id)

    # Per-user DAILY cap. Uses tts_usage_user_date_uniq (point lookup).
    daily_cap = premium_daily_cap if tier == "premium" else free_daily_cap
    user_doc = await db.tts_usage.find_one(
        {"user_id": user_id, "date": date_key},
        projection={"_id": 0, "characters": 1},
    )
    user_daily_used = int(user_doc.get("characters", 0)) if user_doc else 0

    # ── (2) Premium monthly cap (checked before daily so an exhausted
    #       monthly budget reports monthly, not daily). ────────────────
    if tier == "premium" and premium_monthly_cap:
        monthly_cursor = db.tts_usage.aggregate([
            {"$match": {"user_id": user_id, "billing_month": month_key}},
            {"$group": {"_id": None, "chars": {"$sum": "$characters"}}},
        ])
        magg = await monthly_cursor.to_list(length=1)
        monthly_used = int(magg[0]["chars"]) if magg else 0
        if monthly_used + requested_chars > premium_monthly_cap:
            logger.info(
                "[SEC-004 P2] premium monthly cap: user=%s used=%d "
                "limit=%d requested=%d",
                user_id, monthly_used, premium_monthly_cap, requested_chars,
            )
            raise HTTPException(
                status_code=402,
                detail={
                    "tier": "premium",
                    "scope": "monthly",
                    "used": monthly_used,
                    "limit": premium_monthly_cap,
                },
            )

    # ── (3) Per-tier daily cap. ──────────────────────────────────────
    if daily_cap and (user_daily_used + requested_chars > daily_cap):
        logger.info(
            "[SEC-004 P2] %s daily cap: user=%s used=%d limit=%d "
            "requested=%d",
            tier, user_id, user_daily_used, daily_cap, requested_chars,
        )
        raise HTTPException(
            status_code=402,
            detail={
                "tier": tier,
                "scope": "daily",
                "used": user_daily_used,
                "limit": daily_cap,
            },
        )


# ─── Phase P1: Persistent TTS usage ledger (visibility only) ──────────────
#
# Design (see `/app/memory/PRD.md` → Phase P1 TTS Visibility):
#
# Collection: `db.tts_usage`
#   Primary doc shape (one per effective user per UTC date):
#     {
#       user_id:       str,       # as returned by get_authenticated_user_id
#                                 # (e.g. "user:<uuid>" or "device:<id>")
#       date:          str,       # UTC YYYY-MM-DD
#       billing_month: str,       # UTC YYYY-MM
#       characters:    int,       # SUM of len(request.text) for success calls
#       requests:      int,       # count of success calls
#       audio_bytes:   int,       # SUM of len(audio_data) for success calls
#       voices:        {voice_id -> count},
#       models:        {model_id -> count},
#       first_request_at: ISO8601 UTC,
#       last_request_at:  ISO8601 UTC,
#     }
#
#   NO script text, no raw transcripts, no PII payload beyond the user_id
#   and voice/model identifiers. This is a BILLING-RECONCILIATION ledger
#   only — never a content audit log.
#
# Compound unique index: (user_id, date) — enforced lazily on first write.
# Atomic increment via Mongo `$inc` + `$setOnInsert` upsert. Concurrent
# requests on the same (user_id, date) key cannot double-count because
# Mongo serialises the upsert at the storage engine.
#
# This endpoint is PURELY OBSERVATIONAL in Phase P1. It does NOT gate
# any request. Free/Premium enforcement is Phase P2.

_TTS_USAGE_INDEXES_CREATED = False


async def _ensure_tts_usage_indexes() -> None:
    """Create the (user_id, date) unique index on first access.

    Idempotent — safe to call on every request. Avoids a boot-time
    migration script. The flag suppresses the Mongo roundtrip after
    the first successful create."""
    global _TTS_USAGE_INDEXES_CREATED
    if _TTS_USAGE_INDEXES_CREATED:
        return
    try:
        await db.tts_usage.create_index(
            [("user_id", 1), ("date", 1)],
            unique=True,
            name="tts_usage_user_date_uniq",
        )
        await db.tts_usage.create_index(
            [("billing_month", 1)],
            name="tts_usage_billing_month",
        )
        await db.tts_usage.create_index(
            [("date", 1), ("characters", -1)],
            name="tts_usage_date_chars_desc",
        )
        _TTS_USAGE_INDEXES_CREATED = True
    except Exception as idx_err:
        # Index creation races are harmless — another worker may have
        # just created it. Log and move on; the next call retries.
        logger.warning("tts_usage index creation deferred: %s", idx_err)


async def _record_tts_usage(
    user_id: str,
    characters: int,
    audio_bytes: int,
    voice_id: str,
    model_id: str,
) -> None:
    """Atomically record one successful ElevenLabs synthesis.

    Called ONLY after the vendor returned non-empty audio. See
    docstring on the ledger above."""
    await _ensure_tts_usage_indexes()

    now = datetime.utcnow()
    date_key = now.strftime("%Y-%m-%d")
    month_key = now.strftime("%Y-%m")
    now_iso = now.replace(microsecond=0).isoformat() + "Z"

    await db.tts_usage.update_one(
        {"user_id": user_id, "date": date_key},
        {
            "$inc": {
                "characters": int(characters),
                "requests": 1,
                "audio_bytes": int(audio_bytes),
                f"voices.{voice_id}": 1,
                f"models.{model_id}": 1,
            },
            "$set": {"last_request_at": now_iso},
            "$setOnInsert": {
                "billing_month": month_key,
                "first_request_at": now_iso,
            },
        },
        upsert=True,
    )

    # Structured one-liner so operators can `grep tts_usage` on
    # prod logs and reconstruct the ledger even without Mongo access.
    logger.info(
        "tts_usage user=%s chars=%d bytes=%d voice=%s model=%s",
        user_id, int(characters), int(audio_bytes), voice_id, model_id,
    )


def _require_admin_token(x_admin_token: str | None = Header(default=None)) -> None:
    """Shared admin-auth gate for `/api/admin/*` observability routes.

    Reads `ADMIN_TOKEN` from backend/.env at request time (NOT at
    import time) so that rotating the token does not require a
    backend restart. If `ADMIN_TOKEN` is unset or empty, the admin
    surface is DISABLED (every request 503) — fail-closed."""
    expected = os.environ.get("ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Admin surface disabled (ADMIN_TOKEN not configured)",
        )
    if not x_admin_token or x_admin_token != expected:
        raise HTTPException(status_code=401, detail="Admin authentication required")


@api_router.get("/admin/tts/usage")
async def admin_tts_usage(
    _: None = Depends(_require_admin_token),
    date: str | None = None,
    month: str | None = None,
    top: int = 20,
):
    """Aggregated TTS usage ledger for operators.

    Query parameters:
      * `date`  — UTC YYYY-MM-DD. Defaults to today. Returns the
                  day's totals + top N consumers for that day.
      * `month` — UTC YYYY-MM. If supplied, also returns the month
                  total + top N consumers for the billing month.
      * `top`   — number of top consumers to return (clamped 1-100).

    Response is JSON only. Never includes script text, dialogue,
    or any content fields — only (user_id, characters, requests,
    audio_bytes, voices-usage-counts, models-usage-counts)."""
    await _ensure_tts_usage_indexes()

    today = datetime.utcnow().strftime("%Y-%m-%d")
    this_month = datetime.utcnow().strftime("%Y-%m")
    date_key = (date or today).strip()
    month_key = (month or this_month).strip()
    top_n = max(1, min(100, int(top or 20)))

    # Daily aggregation
    day_total_cursor = db.tts_usage.aggregate([
        {"$match": {"date": date_key}},
        {"$group": {
            "_id": None,
            "characters": {"$sum": "$characters"},
            "requests": {"$sum": "$requests"},
            "audio_bytes": {"$sum": "$audio_bytes"},
            "distinct_users": {"$addToSet": "$user_id"},
        }},
    ])
    day_agg = await day_total_cursor.to_list(length=1)
    if day_agg:
        d = day_agg[0]
        daily = {
            "date": date_key,
            "characters": int(d.get("characters", 0)),
            "requests": int(d.get("requests", 0)),
            "audio_bytes": int(d.get("audio_bytes", 0)),
            "distinct_users": len(d.get("distinct_users", [])),
        }
    else:
        daily = {
            "date": date_key, "characters": 0, "requests": 0,
            "audio_bytes": 0, "distinct_users": 0,
        }

    # Monthly aggregation
    month_total_cursor = db.tts_usage.aggregate([
        {"$match": {"billing_month": month_key}},
        {"$group": {
            "_id": None,
            "characters": {"$sum": "$characters"},
            "requests": {"$sum": "$requests"},
            "audio_bytes": {"$sum": "$audio_bytes"},
            "distinct_users": {"$addToSet": "$user_id"},
        }},
    ])
    month_agg = await month_total_cursor.to_list(length=1)
    if month_agg:
        m = month_agg[0]
        monthly = {
            "month": month_key,
            "characters": int(m.get("characters", 0)),
            "requests": int(m.get("requests", 0)),
            "audio_bytes": int(m.get("audio_bytes", 0)),
            "distinct_users": len(m.get("distinct_users", [])),
        }
    else:
        monthly = {
            "month": month_key, "characters": 0, "requests": 0,
            "audio_bytes": 0, "distinct_users": 0,
        }

    # Top consumers for the requested day
    top_cursor = db.tts_usage.find(
        {"date": date_key},
        projection={
            "_id": 0,
            "user_id": 1,
            "characters": 1,
            "requests": 1,
            "audio_bytes": 1,
            "voices": 1,
            "models": 1,
            "last_request_at": 1,
        },
    ).sort("characters", -1).limit(top_n)
    top_daily = await top_cursor.to_list(length=top_n)

    return {
        "generated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "daily": daily,
        "monthly": monthly,
        "top_consumers_day": top_daily,
        # Phase P1 is observability-only. No enforcement thresholds
        # are exposed yet — intentionally omitted so no client can
        # start depending on them.
        "phase": "P1-visibility",
    }


@api_router.get("/tts/elevenlabs/health")
async def elevenlabs_health():
    """Report whether the backend has a usable ElevenLabs credential.

    Returns a BINARY verdict with no credential-derived metadata. The
    pre-Feb-2026 version also echoed `key_length`, which the security
    audit flagged (SEC-004 hardening) as a secret-derived leak — now
    removed. Never logs or echoes the key value, prefix, or length.
    """
    configured = bool(ELEVENLABS_API_KEY) and eleven_client is not None
    if not ELEVENLABS_API_KEY:
        classification = "missing"
    elif not ELEVENLABS_API_KEY.startswith("sk_"):
        classification = "wrong-prefix"
    elif len(ELEVENLABS_API_KEY) < 20:
        classification = "too-short"
    else:
        classification = "valid" if configured else "sdk-unavailable"
    # Binary + category only. Never leaks any portion of the secret.
    return {
        "configured": configured,
        "classification": classification,
    }


@api_router.post("/tts/elevenlabs/generate")
async def generate_elevenlabs_tts(
    request: ElevenLabsTTSRequest,
    user_id: str = Depends(get_authenticated_user_id),
):
    """Generate TTS audio using ElevenLabs (Premium feature).

    2026-02 SCRIPT M8 — SEC-004 hardening:
      * Requires a GENUINE bearer token (`Depends(get_authenticated_user_id)`).
        Anonymous callers and arbitrary user_id/device_id values are
        rejected 401 BEFORE any ElevenLabs cost is incurred.
      * Request text is capped at 2000 chars by the Pydantic model;
        oversized or empty bodies produce a 422.
      * Per-user sliding-window rate limit (60 calls / 10 min).
      * Response is raw MP3 (audio/mpeg) — the client writes the
        bytes directly to a file for Android ExoPlayer playback.
    """
    _tts_check_rate_limit(user_id)
    await _tts_check_character_budget(user_id, len(request.text))

    if not eleven_client:
        raise HTTPException(status_code=503, detail="ElevenLabs service not configured")

    try:
        # Resolve voice_id if a preset key was provided
        voice_id = request.voice_id
        if request.voice_id in PRESET_VOICES:
            voice_id = PRESET_VOICES[request.voice_id]["id"]

        # ElevenLabs supports voice_settings.speed on eleven_multilingual_v2
        # in the 0.7–1.2 range. Clamp defensively so a stale/legacy client
        # value cannot make the SDK reject the request.
        speed = max(0.7, min(1.2, float(request.speed or 1.0)))

        voice_settings = VoiceSettings(
            stability=request.stability,
            similarity_boost=request.similarity_boost,
            style=request.style,
            use_speaker_boost=request.use_speaker_boost,
            speed=speed,
        )

        audio_generator = eleven_client.text_to_speech.convert(
            text=request.text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            voice_settings=voice_settings,
        )

        # Collect audio bytes and stream them back as audio/mpeg.
        audio_data = b""
        for chunk in audio_generator:
            audio_data += chunk

        if not audio_data:
            raise HTTPException(status_code=502, detail="ElevenLabs returned empty audio")

        # ─── Phase P1: persistent TTS usage accounting ──────────────
        # Record on SUCCESS only. Pre-synthesis failures (401 / 422 /
        # 429 / 503) and upstream failures (ElevenLabs returning no
        # audio / raising) deliberately do NOT increment the counter
        # — those requests are not billed by the vendor.
        #
        # Billing-char cost cannot be perfectly reconciled from the
        # SDK's streaming `convert()` surface (vendor response
        # headers are consumed internally). `requested_characters =
        # len(request.text)` is the pre-vendor count ScriptMate
        # authoritatively knows and matches ElevenLabs' documented
        # 1 char = 1 credit billing rule for `eleven_multilingual_v2`.
        # `audio_bytes_returned` is captured as a vendor-side signal
        # that lets us retrospectively detect grossly disproportionate
        # bills (e.g. if ElevenLabs ever changes its billing formula).
        try:
            await _record_tts_usage(
                user_id=user_id,
                characters=len(request.text),
                audio_bytes=len(audio_data),
                voice_id=voice_id,
                model_id="eleven_multilingual_v2",
            )
        except Exception:
            # Accounting failure must never break the user-facing
            # response. The error is logged so we can detect ledger
            # drift during the P1 observation window.
            logger.exception("tts_usage accounting failed")

        # Response headers echo the resolved voice_id + settings for
        # on-device diagnostics. Body is raw MP3 — no base64, no
        # data-URI. Never echoes the API key.
        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={
                "X-ElevenLabs-Voice-Id": voice_id,
                "X-ElevenLabs-Model-Id": "eleven_multilingual_v2",
                "X-ElevenLabs-Stability": str(request.stability),
                "X-ElevenLabs-Style": str(request.style),
                "X-ElevenLabs-Speed": str(speed),
                "X-ElevenLabs-Byte-Length": str(len(audio_data)),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        # Never surface the SDK exception text to the client — it may
        # contain the ElevenLabs key when the SDK echoes the bad
        # Authorization header. Log server-side scrubbed, return a
        # generic client message.
        safe_err = str(e)
        if ELEVENLABS_API_KEY and ELEVENLABS_API_KEY in safe_err:
            safe_err = safe_err.replace(ELEVENLABS_API_KEY, "***REDACTED***")
        logger.error(f"ElevenLabs TTS error: {safe_err}")
        raise HTTPException(status_code=500, detail="Voice generation failed. Please try again.")

@api_router.get("/scripts/{script_id}/voices")
async def get_script_voice_settings(
    script_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Get voice assignments for all characters in a script.

    SEC-002 (2026-02): script ownership is enforced; cross-owner returns 404."""
    script = await db.scripts.find_one({"id": script_id})
    if not script or script.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Script not found")
    settings = await db.script_voice_settings.find_one({"script_id": script_id})
    if not settings:
        return {
            "script_id": script_id,
            "character_voices": [],
            "updated_at": None
        }
    settings.pop("_id", None)
    return settings

@api_router.post("/scripts/{script_id}/voices")
async def save_script_voice_settings(
    script_id: str,
    voice_settings: ScriptVoiceSettings,
    user_id: str = Depends(get_effective_user_id),
):
    """Save voice assignments for characters in a script.

    SEC-002 (2026-02): script ownership is enforced."""
    script = await db.scripts.find_one({"id": script_id})
    if not script or script.get("user_id") != user_id:
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
async def update_character_voice(
    script_id: str,
    character_name: str,
    voice_key: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Update voice assignment for a single character.

    SEC-002 (2026-02): script ownership is enforced."""
    script = await db.scripts.find_one({"id": script_id})
    if not script or script.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Script not found")
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
    user_id: str = Depends(get_effective_user_id),
):
    """
    Analyze user's pronunciation against a target accent.
    Returns pronunciation score, pace assessment, problem words, and tips.

    SEC-002 (2026-02): owner derived from the bearer; the former
    `user_id` form field is IGNORED.
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
        raise HTTPException(status_code=500, detail=json.dumps({"error": "Dialect analysis failed", "message": "Pronunciation analysis encountered an error. Please try again."}))

@api_router.get("/dialect/history/{user_id}")
async def get_dialect_history(
    user_id: str,
    accent_id: Optional[str] = None,
    limit: int = 20,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user's recent dialect practice attempts for tracking improvement.

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
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
async def analyze_acting_performance(
    request: ActingCoachRequest,
    user_id: str = Depends(get_effective_user_id),
):
    """AI-powered acting coach that analyzes emotion, style, and energy choices.

    SEC-002 (2026-02): owner derived from the bearer; any `user_id`
    on the request body is IGNORED when the attempt is stored."""
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
            "user_id": user_id,
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
        logger.error("Acting coach: Failed to parse AI response")
        raise HTTPException(status_code=500, detail=json.dumps({"error": "AI analysis failed", "message": "Could not parse coaching feedback. Please try again."}))
    except Exception as e:
        logger.error(f"Acting coach analysis error: {e}")
        raise HTTPException(status_code=500, detail=json.dumps({"error": "AI analysis failed", "message": "Acting coach analysis encountered an error. Please try again."}))

@api_router.get("/acting-coach/history/{user_id}")
async def get_acting_coach_history(
    user_id: str,
    limit: int = 20,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user's acting coach history.

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
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
async def get_daily_drill(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get today's daily acting drill challenge.

    SEC-002 (2026-02): the path `user_id` is validated against the
    authenticated bearer; mismatches return 403."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
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
async def complete_daily_drill(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Mark today's drill as complete and award XP.

    SEC-002 (2026-02): path `user_id` is validated against the
    authenticated bearer; mismatches return 403."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
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
async def get_streak(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get user's training streak and XP.

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
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
async def record_streak_activity(
    user_id: str,
    activity_type: str = "general",
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Record an activity for streak tracking (acting_coach, dialect_coach, rehearsal, etc).

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
    await record_activity(user_id, activity_type, 10)
    return await get_streak(user_id, authenticated_user_id)


# ==================== PHASE C: DAILY DRILL AI FEEDBACK ====================

class DrillFeedbackRequest(BaseModel):
    drill_prompt: str
    challenge_type: str
    performance_notes: Optional[str] = ""

@api_router.post("/daily-drill/{user_id}/feedback")
async def get_drill_feedback(
    user_id: str,
    request: DrillFeedbackRequest,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get AI performance feedback for a daily drill.

    SEC-002 (2026-02): path `user_id` is validated against the
    authenticated bearer; mismatches return 403."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
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
async def create_share_link(
    request: CreateShareLinkRequest,
    user_id: str = Depends(get_effective_user_id),
):
    """Create a shareable casting link for a self tape.

    SEC-002 (2026-02): owner is derived from the bearer; `request.user_id`
    is IGNORED so one caller cannot plant share-links against another
    user's id."""
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
        "user_id": user_id,
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
    """Get a shared tape for viewing (JSON API)."""
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


@api_router.get("/tape/{actor_slug}/{share_id}", response_class=HTMLResponse)
async def casting_share_page(actor_slug: str, share_id: str, password: Optional[str] = None):
    """Public casting share page — served as HTML for browser viewing."""
    tape = await db.shared_tapes.find_one({"share_id": share_id}, {"_id": 0})
    if not tape:
        return HTMLResponse(content="<html><body style='background:#0a0a0f;color:#6b7280;display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui'><p>This casting link has expired or doesn't exist.</p></body></html>", status_code=404)

    if tape.get("password") and tape.get("password") != password:
        return HTMLResponse(content=f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html_escape.escape(tape['actor_name'])} — Self Tape</title>
<style>*{{margin:0;padding:0;box-sizing:border-box}}body{{background:#0a0a0f;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh}}.card{{text-align:center;padding:40px}}.card h2{{font-size:18px;margin-bottom:8px}}.card p{{color:#6b7280;font-size:14px;margin-bottom:24px}}form{{display:flex;gap:8px;justify-content:center}}input{{background:#1a1a2e;border:1px solid #2a2a3e;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;outline:none}}input:focus{{border-color:#6366f1}}button{{background:#6366f1;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer}}button:hover{{background:#5558e6}}</style>
</head><body><div class="card"><h2>Password Required</h2><p>This self tape is password protected.</p><form method="get"><input name="password" type="password" placeholder="Enter password"><button type="submit">View</button></form></div></body></html>""")

    await db.shared_tapes.update_one({"share_id": share_id}, {"$inc": {"views": 1}})
    views = tape.get("views", 0) + 1

    actor = html_escape.escape(tape["actor_name"])
    role = html_escape.escape(tape.get("role_name", ""))
    project = html_escape.escape(tape.get("project_name", ""))
    duration = tape.get("duration", 0)
    created = html_escape.escape(tape.get("created_at", "")[:10])
    video_uri = html_escape.escape(tape.get("video_uri", ""))
    dur_str = f"{duration // 60}:{duration % 60:02d}" if duration else ""

    subtitle_parts = [p for p in [role, project] if p]
    subtitle = " — ".join(subtitle_parts) if subtitle_parts else ""

    return HTMLResponse(content=f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{actor}{(' — ' + role) if role else ''} | Self Tape</title>
<meta name="description" content="Self tape audition by {actor}{(' for ' + role) if role else ''}">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0a0a0f;color:#e5e7eb;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column}}
.page{{flex:1;display:flex;flex-direction:column;align-items:center;padding:24px 16px 0}}
.player-wrap{{width:100%;max-width:640px;aspect-ratio:9/16;background:#111;border-radius:12px;overflow:hidden;position:relative}}
@media(min-width:768px){{.player-wrap{{aspect-ratio:16/9}}}}
video{{width:100%;height:100%;object-fit:contain;background:#000}}
.info{{max-width:640px;width:100%;margin-top:20px}}
.actor-name{{font-size:20px;font-weight:700;color:#fff}}
.subtitle{{font-size:14px;color:#9ca3af;margin-top:4px}}
.meta-row{{display:flex;gap:16px;margin-top:12px;flex-wrap:wrap}}
.meta-item{{font-size:12px;color:#6b7280}}
.promo{{width:100%;border-top:1px solid #1a1a2e;margin-top:auto;padding:32px 16px 24px;text-align:center}}
.promo-line{{font-size:11px;color:#4b5563;letter-spacing:0.3px}}
.promo-sub{{font-size:10px;color:#374151;margin-top:3px}}
.promo-btn{{display:inline-block;margin-top:12px;font-size:11px;color:#6b7280;text-decoration:none;padding:6px 16px;border:1px solid #2a2a3e;border-radius:20px;transition:all 0.2s}}
.promo-btn:hover{{color:#a5b4fc;border-color:#6366f1}}
</style>
</head>
<body>
<div class="page">
  <div class="player-wrap">
    {"<video controls playsinline preload='metadata'><source src='" + video_uri + "'>Your browser does not support video playback.</video>" if video_uri else "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;font-size:14px'>Video unavailable</div>"}
  </div>
  <div class="info">
    <div class="actor-name">{actor}</div>
    {"<div class='subtitle'>" + subtitle + "</div>" if subtitle else ""}
    <div class="meta-row">
      {f'<span class="meta-item">{dur_str}</span>' if dur_str else ''}
      {f'<span class="meta-item">{created}</span>' if created else ''}
      <span class="meta-item">{views} view{'s' if views != 1 else ''}</span>
    </div>
  </div>
</div>
<footer class="promo">
  <div class="promo-line">Recorded with ScriptM8</div>
  <div class="promo-sub">AI Training Studio for Actors</div>
  <a href="https://scriptm8.app" class="promo-btn" target="_blank" rel="noopener">Try ScriptM8</a>
</footer>
</body>
</html>""")

@api_router.get("/tapes/user/{user_id}")
async def get_user_shared_tapes(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get all shared tapes for a user.

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
    tapes = await db.shared_tapes.find(
        {"user_id": user_id},
        {"_id": 0, "password": 0, "video_uri": 0}
    ).sort("created_at", -1).to_list(50)
    return tapes

@api_router.delete("/tapes/share/{share_id}")
async def delete_share_link(
    share_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Delete a shared tape link.

    SEC-002 (2026-02): cross-owner deletes return 404."""
    tape = await db.shared_tapes.find_one({"share_id": share_id})
    if not tape or tape.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Share link not found")
    result = await db.shared_tapes.delete_one({"share_id": share_id, "user_id": user_id})
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
        raise HTTPException(status_code=500, detail=json.dumps({"error": "Audio processing failed", "message": "Could not process audio file. Please try again."}))


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
        raise HTTPException(status_code=500, detail=json.dumps({"error": "Demo reel build failed", "message": "Could not build demo reel. Please try again."}))


@api_router.post("/voice-studio/takes")
async def save_take_metadata(
    take_name: str = Form(...),
    duration: float = Form(0),
    script_id: str = Form(""),
    user_id: str = Depends(get_effective_user_id),
):
    """Save voice take metadata to the database.

    SEC-002 (2026-02): owner is derived from the bearer; the former
    `user_id` form field is IGNORED."""
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
async def get_user_takes(
    user_id: str,
    authenticated_user_id: str = Depends(get_authenticated_user_id),
):
    """Get all voice takes for a user.

    SEC-002 (2026-02): path `user_id` must match authenticated bearer."""
    enforce_user_id_match(user_id, authenticated_user_id)
    user_id = effective_user_id(authenticated_user_id)
    takes = await db.voice_takes.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"takes": takes, "total": len(takes)}


@api_router.delete("/voice-studio/takes/{take_id}")
async def delete_take_metadata(
    take_id: str,
    user_id: str = Depends(get_effective_user_id),
):
    """Delete a voice take record.

    SEC-002 (2026-02): cross-owner deletes return 404."""
    take = await db.voice_takes.find_one({"id": take_id})
    if not take or take.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Take not found")
    result = await db.voice_takes.delete_one({"id": take_id, "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Take not found")
    return {"message": "Take deleted"}


# ==================== SUPPORT / BUG REPORT ====================

class BugReportCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=5000)
    steps_to_reproduce: Optional[str] = Field(None, max_length=5000)
    notes: Optional[str] = Field(None, max_length=5000)
    diagnostics: Optional[Dict[str, Any]] = None
    debug_log: Optional[str] = Field(None, max_length=200000)
    user_id: Optional[str] = Field(None, max_length=200)
    app_version: Optional[str] = Field(None, max_length=100)
    build_id: Optional[str] = Field(None, max_length=100)
    platform: Optional[str] = Field(None, max_length=50)


# Keys that must never be persisted even if the client sends them (defense-in-depth).
_BUG_REPORT_SENSITIVE_KEYS = {
    "authorization", "auth", "token", "access_token", "id_token", "refresh_token",
    "api_key", "apikey", "secret", "password", "passwd", "cookie", "session",
    "x-api-key", "bearer",
}


def _sanitize_bug_report_dict(value):
    """Recursively drop any key that looks like a credential. Values kept as-is (already redacted client-side)."""
    if isinstance(value, dict):
        return {
            k: _sanitize_bug_report_dict(v)
            for k, v in value.items()
            if k.lower() not in _BUG_REPORT_SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [_sanitize_bug_report_dict(v) for v in value]
    return value


@api_router.post("/support/bug-report")
async def create_bug_report(report: BugReportCreate):
    """Store a user-submitted bug report + non-sensitive diagnostics.

    Returns {id, created_at} on success. No PII/secrets are stored:
    the client is expected to pre-redact, and this endpoint additionally
    strips any keys that look like credentials.
    """
    now = datetime.now(datetime.now().astimezone().tzinfo).astimezone().replace(microsecond=0)
    doc = {
        "id": str(uuid.uuid4()),
        "description": report.description.strip(),
        "steps_to_reproduce": (report.steps_to_reproduce or "").strip() or None,
        "notes": (report.notes or "").strip() or None,
        "diagnostics": _sanitize_bug_report_dict(report.diagnostics or {}),
        "debug_log": report.debug_log or None,
        "user_id": report.user_id,
        "app_version": report.app_version,
        "build_id": report.build_id,
        "platform": report.platform,
        "created_at": now.isoformat(),
        "status": "open",
    }
    await db.bug_reports.insert_one(doc)
    return {"id": doc["id"], "created_at": doc["created_at"], "status": "received"}


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
