# ScriptM8 — Product Requirements Document

## Status: STABILIZATION MODE

## Original Problem Statement
ScriptM8 is an AI-powered script learning app for actors (Expo SDK 54 / React Native 0.81.5 + FastAPI). Core features are broken on installed Android builds because environment variables are not being compiled into the production build.

## Root Cause (Confirmed)
1. **Expo SDK 54 `process.env.EXPO_PUBLIC_*` regression** (GitHub #36503): Metro bundler fails to inline env vars in production builds.
2. **`Constants.expoConfig.extra` delivery broken**: Config generated correctly at build time (verified via `getConfig()`), but at runtime only `["eas","router"]` keys are present — custom keys are stripped during delivery.
3. **Previous `||` fallback chains with hardcoded defaults**: Should have worked but 3 builds (1046, 1047, 1056) all still failed. Build fingerprint was added to definitively prove whether new code is in the build.

## Current Fix (Build fingerprint SM8-FIX-0315A, versionCode 1060)
**Approach**: Zero abstraction. All critical config values are literal strings in source files. No `process.env`, no `Constants.expoConfig`, no resolve functions, no import chains for the critical path.

**Files changed**:
- `app/_layout.tsx` — RC key is inline string `'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT'`, build fingerprint `SM8-FIX-0315A`
- `services/apiConfig.ts` — Backend URL is inline string, no imports
- `contexts/AuthContext.tsx` — Backend URL is inline string, no imports  
- `services/diagnosticsService.ts` — Build fingerprint, hardcoded RC key display
- `app/debug.tsx` — Shows build fingerprint prominently
- `metro.config.js` — Removed persistent FileStore cache
- `app.json` — versionCode 1060

## Pending — User Device Verification (P0)
Build from current code and check:
1. Debug screen shows `Build Fingerprint: SM8-FIX-0315A`
2. If fingerprint is present → code IS in the build
3. If fingerprint is absent → code is NOT in the build (build pipeline issue)
4. If fingerprint present AND RC still fails → runtime issue beyond config injection

## Upcoming Tasks (P1)
- Stabilize Self-Tape feature

## Future / Backlog
- Password protection for shared casting links
- Director Mode with framing guides
- ElevenLabs Scene Partner voices for premium
- Backend server.py modular refactor
