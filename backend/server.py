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
from datetime import datetime
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
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class ScriptCreate(BaseModel):
    title: str
    raw_text: str

class ScriptUpdate(BaseModel):
    title: Optional[str] = None
    characters: Optional[List[Dict]] = None
    user_character: Optional[str] = None

class RehearsalSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    script_id: str
    user_character: str
    current_line_index: int = 0
    completed_lines: List[int] = []
    missed_lines: List[int] = []
    total_lines: int = 0
    mode: str = "full_read"  # full_read, cue_only, performance
    voice_type: str = "alloy"  # alloy, echo, fable, onyx, nova, shimmer
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class RehearsalCreate(BaseModel):
    script_id: str
    user_character: str
    mode: str = "full_read"
    voice_type: str = "alloy"

class TTSRequest(BaseModel):
    text: str
    voice: str = "alloy"  # alloy, echo, fable, onyx, nova, shimmer

class AnalyzeScriptRequest(BaseModel):
    raw_text: str

# ==================== HELPER FUNCTIONS ====================

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
        
        # Clean up response - extract JSON from response
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
        # Fallback: simple parsing
        return fallback_parse_script(raw_text)

def fallback_parse_script(raw_text: str) -> Dict[str, Any]:
    """Simple fallback parser for scripts"""
    lines_data = []
    characters = set()
    
    lines = raw_text.strip().split('\n')
    current_character = ""
    current_text = []
    line_num = 0
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Check if this is a character name (all caps, possibly followed by colon)
        potential_char = line.replace(':', '').strip()
        if potential_char.isupper() and len(potential_char.split()) <= 3 and len(potential_char) > 1:
            # Save previous dialogue
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": ' '.join(current_text),
                    "is_stage_direction": False
                })
                line_num += 1
            current_character = potential_char
            current_text = []
            characters.add(current_character)
        # Check if stage direction (in parentheses or brackets)
        elif line.startswith('(') or line.startswith('['):
            if current_character and current_text:
                lines_data.append({
                    "character": current_character,
                    "text": ' '.join(current_text),
                    "is_stage_direction": False
                })
                current_text = []
                line_num += 1
            lines_data.append({
                "character": "",
                "text": line,
                "is_stage_direction": True
            })
            line_num += 1
        else:
            # Regular dialogue
            current_text.append(line)
    
    # Don't forget the last line
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

# ==================== API ROUTES ====================

@api_router.get("/")
async def root():
    return {"message": "LineCoach API - AI Script Learning Partner"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ==================== SCRIPT ROUTES ====================

@api_router.post("/scripts", response_model=Script)
async def create_script(script_data: ScriptCreate):
    """Create a new script from raw text"""
    try:
        # Parse the script with AI
        parsed = await parse_script_with_ai(script_data.raw_text)
        
        # Create character objects
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
        
        # Create line objects
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
            lines=lines
        )
        
        await db.scripts.insert_one(script.dict())
        return script
    except Exception as e:
        logger.error(f"Error creating script: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/scripts/upload")
async def upload_script(
    file: UploadFile = File(...),
    title: str = Form(...)
):
    """Upload a PDF or text file as a script"""
    try:
        content = await file.read()
        
        if file.filename.lower().endswith('.pdf'):
            raw_text = extract_text_from_pdf(content)
        elif file.filename.lower().endswith(('.txt', '.text')):
            raw_text = content.decode('utf-8')
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF or TXT.")
        
        # Create script using the parsed text
        script_data = ScriptCreate(title=title, raw_text=raw_text)
        return await create_script(script_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading script: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/scripts", response_model=List[Script])
async def get_scripts():
    """Get all scripts"""
    scripts = await db.scripts.find().sort("created_at", -1).to_list(100)
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
    """Update script settings (like user character assignment)"""
    script = await db.scripts.find_one({"id": script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    update_dict = {"updated_at": datetime.utcnow()}
    
    if update_data.title:
        update_dict["title"] = update_data.title
    
    if update_data.user_character:
        # Update character flags
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
    result = await db.scripts.delete_one({"id": script_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Script not found")
    # Also delete related rehearsals
    await db.rehearsals.delete_many({"script_id": script_id})
    return {"message": "Script deleted successfully"}

# ==================== REHEARSAL ROUTES ====================

@api_router.post("/rehearsals", response_model=RehearsalSession)
async def create_rehearsal(rehearsal_data: RehearsalCreate):
    """Create a new rehearsal session"""
    # Verify script exists
    script = await db.scripts.find_one({"id": rehearsal_data.script_id})
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    # Count total lines for user
    total_lines = sum(1 for line in script.get("lines", []) 
                     if line.get("character") == rehearsal_data.user_character)
    
    rehearsal = RehearsalSession(
        script_id=rehearsal_data.script_id,
        user_character=rehearsal_data.user_character,
        mode=rehearsal_data.mode,
        voice_type=rehearsal_data.voice_type,
        total_lines=total_lines
    )
    
    await db.rehearsals.insert_one(rehearsal.dict())
    return rehearsal

@api_router.get("/rehearsals", response_model=List[RehearsalSession])
async def get_rehearsals():
    """Get all rehearsal sessions"""
    rehearsals = await db.rehearsals.find().sort("created_at", -1).to_list(100)
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
    updated = await db.rehearsals.find_one({"id": rehearsal_id})
    return RehearsalSession(**updated)

@api_router.delete("/rehearsals/{rehearsal_id}")
async def delete_rehearsal(rehearsal_id: str):
    """Delete a rehearsal session"""
    result = await db.rehearsals.delete_one({"id": rehearsal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rehearsal session not found")
    return {"message": "Rehearsal session deleted"}

# ==================== TTS ROUTES ====================

@api_router.post("/tts")
async def generate_tts(request: TTSRequest):
    """Generate text-to-speech audio using OpenAI TTS"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {EMERGENT_LLM_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "tts-1",
                    "input": request.text,
                    "voice": request.voice,
                    "response_format": "mp3"
                },
                timeout=30.0
            )
            
            if response.status_code != 200:
                logger.error(f"TTS API error: {response.status_code} - {response.text}")
                raise HTTPException(status_code=response.status_code, detail="TTS generation failed")
            
            # Return audio as base64
            audio_base64 = base64.b64encode(response.content).decode('utf-8')
            return {"audio": audio_base64, "format": "mp3"}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="TTS request timed out")
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== ANALYZE ROUTES ====================

@api_router.post("/analyze")
async def analyze_script(request: AnalyzeScriptRequest):
    """Analyze raw script text and return parsed structure (preview before save)"""
    try:
        parsed = await parse_script_with_ai(request.raw_text)
        return parsed
    except Exception as e:
        logger.error(f"Error analyzing script: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
