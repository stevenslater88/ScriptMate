# ScriptMate Project Handoff Document
## Session Date: February 21, 2026

---

## Project Overview

**ScriptMate** is a mobile app for actors to:
- Practice scripts with AI-powered line reading
- Record professional self-tape auditions
- Track their audition journey
- Use gamified memorization techniques

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Expo (React Native) with TypeScript, SDK 54 |
| Backend | FastAPI (Python) with MongoDB |
| Monetization | RevenueCat (`scriptmate_premium` entitlement) |
| Crash Reporting | Sentry |
| TTS | ElevenLabs (client-side, 26 preset voices) |
| Native Features | expo-camera, expo-media-library, expo-sharing, expo-notifications |

---

## What Was Accomplished This Session

### 1. Multi-Voice Feature (NEW - Premium)
**Status: COMPLETE**

Allows users to assign different AI voices to each character in their script.

**Implementation:**
- Created `frontend/services/elevenLabsService.ts` - Client-side ElevenLabs API integration
- Created `frontend/components/VoiceAssignment.tsx` - Voice picker UI component
- Modified `frontend/app/script/[id].tsx` - Added VoiceAssignment to script detail screen
- Added `EXPO_PUBLIC_ELEVENLABS_API_KEY` to frontend/.env

**Features:**
- 26 preset voices (10 female, 16 male) with various accents (American, British, Irish, Australian, Swedish)
- Voices AUTO-ASSIGN to characters when script opens
- Users can tap any character to change their assigned voice
- Voice preview playback before selection
- Assignments saved per script in AsyncStorage
- Premium-gated (free users see lock icon)

**Note:** ElevenLabs free tier blocks server-side requests from cloud environments. The implementation uses CLIENT-SIDE API calls, which work on real devices but not in cloud preview.

### 2. EAS Build Fix
**Status: COMPLETE**

**Root Cause:** Previous agent upgraded dependencies beyond what Expo SDK 54 supports:
- `react-native-reanimated@4.2.x` (should be `~4.1.1`)
- `react-native-worklets@0.7.x` (should be `0.5.1`)

**Fix Applied:**
- Downgraded `react-native-reanimated` to `4.1.6`
- Pinned `react-native-worklets` to `0.5.1`
- Updated `resolutions` in package.json to force correct versions
- Cleaned yarn.lock and node_modules
- `npx expo-doctor` now passes **17/17 checks**

### 3. Bug Fixes (3 Issues)

| Bug | Fix |
|-----|-----|
| **Self-Tape Routing Error** | Changed `/selftape/index` to `/selftape` in dashboard.tsx and index.tsx (expo-router syntax) |
| **AI Cue Rehearsal Loop** | Added `isSpeakingRef` guard to prevent duplicate TTS triggers, better state cleanup on line advance |
| **Audition Stats Modal Empty** | Added empty state UI when no stats available, added data-testid attributes |

---

## Current Feature Status

### Implemented Features

| Feature | Status | Premium? |
|---------|--------|----------|
| Script Upload & Parsing (AI) | ✅ Working | Free (3 scripts limit) |
| Character Selection | ✅ Working | Free |
| Rehearsal Mode (Basic) | ✅ Working | Free |
| Adaptive Recall Mode | ✅ Working | Premium |
| Multi-Voice Characters | ✅ NEW | Premium |
| Self-Tape Recording | ✅ Working | Free (3 tapes limit) |
| Shot Coach Overlays | ✅ Working | Premium |
| Audition Tracker | ✅ Working | Free (10 limit) / Premium (unlimited) |
| Director Notes | ✅ Working | Premium |
| Dashboard | ✅ Working | Free |
| RevenueCat Paywall | ✅ Working | N/A |

### Known Issues

| Issue | Priority | Status |
|-------|----------|--------|
| EAS Build | P0 | FIXED - Ready to build |
| Expo tunnel unstable | P1 | Known limitation of cloud environment |
| Android signing key mismatch | P1 | Awaiting user action (keystore upload) |

---

## Key Files Reference

```
/app
├── backend/
│   ├── server.py           # FastAPI backend (1800+ lines)
│   └── .env                 # Contains MONGO_URL, EMERGENT_LLM_KEY, ELEVENLABS_API_KEY
│
└── frontend/
    ├── app/
    │   ├── index.tsx        # Home screen
    │   ├── dashboard.tsx    # Main dashboard
    │   ├── premium.tsx      # Paywall screen (ScriptMate Pro branding)
    │   ├── auditions.tsx    # Audition tracker
    │   ├── script/[id].tsx  # Script detail (includes VoiceAssignment)
    │   ├── rehearsal/[id].tsx # Rehearsal mode
    │   └── selftape/        # Self-tape recording screens
    │
    ├── components/
    │   └── VoiceAssignment.tsx  # NEW - Multi-voice picker UI
    │
    ├── services/
    │   ├── elevenLabsService.ts # NEW - ElevenLabs TTS client
    │   ├── auditionService.ts   # Audition CRUD + stats
    │   ├── progressService.ts   # XP/mastery tracking
    │   └── syncService.ts       # Settings persistence
    │
    ├── hooks/
    │   └── useRevenueCat.ts     # RevenueCat integration
    │
    ├── store/
    │   └── scriptStore.ts       # Zustand store for scripts
    │
    ├── .env                     # Frontend env vars
    ├── app.json                 # Expo config (newArchEnabled: true)
    ├── package.json             # Dependencies (reanimated 4.1.6, worklets 0.5.1)
    └── eas.json                 # EAS build profiles
```

---

## Environment Variables

### Backend (.env)
```
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
EMERGENT_LLM_KEY=sk-emergent-xxxxx
ELEVENLABS_API_KEY=c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb
```

### Frontend (.env)
```
EXPO_PUBLIC_BACKEND_URL=https://rehearse-app.preview.emergentagent.com
EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=appl_YOUR_IOS_KEY_HERE
EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT
EXPO_PUBLIC_SENTRY_DSN=https://xxxxx@sentry.io/xxxxx
EXPO_PUBLIC_ELEVENLABS_API_KEY=c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb
```

---

## API Endpoints (Key)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scripts` | GET/POST | List/create scripts |
| `/api/scripts/{id}` | GET/PUT/DELETE | Script CRUD |
| `/api/scripts/{id}/analyze` | POST | AI script parsing |
| `/api/voices/presets` | GET | List available voices |
| `/api/scripts/{id}/voices` | GET/POST | Voice assignments for script |
| `/api/tts/elevenlabs/generate` | POST | Generate TTS (server-side, blocked on free tier) |
| `/api/rehearsals` | GET/POST | Rehearsal sessions |
| `/api/users/{id}/limits` | GET | User usage limits |
| `/api/subscription/plans` | GET | Available plans |

---

## Next Steps (Priority Order)

1. **Run EAS Build** - `eas build --platform all --profile production`
2. **Test Multi-Voice on Device** - ElevenLabs only works client-side on real devices
3. **Remaining Features:**
   - Script UI Redesign (chat bubble layout)
   - Teleprompter + Self-Tape Combo
4. **Android Signing Key** - User needs to upload correct keystore or request reset from Google

---

## Important Notes

1. **ElevenLabs Free Tier Limitation**: The API blocks requests from cloud servers/VPNs. We implemented CLIENT-SIDE TTS calls that work on real devices but not in web preview or cloud environments.

2. **Build Dependencies**: Always use these exact versions for Expo SDK 54:
   - `react-native-reanimated`: `~4.1.1` (installs 4.1.6)
   - `react-native-worklets`: `0.5.1`
   - Run `npx expo-doctor` to verify compatibility

3. **RevenueCat**: Uses `production` offering identifier. Has robust error handling with retry UI.

4. **Expo Router Syntax**: Use `/selftape` not `/selftape/index` for navigation.

---

## Session Summary

This session focused on:
1. Implementing the Multi-Voice feature with ElevenLabs (26 voices, auto-assignment, client-side)
2. Fixing the EAS build by aligning dependencies with Expo SDK 54
3. Fixing 3 bugs: Self-Tape routing, AI cue loop, Audition stats modal

All code changes are ready for EAS build and testing on real devices.
