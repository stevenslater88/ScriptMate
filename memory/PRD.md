# ScriptM8 — Product Requirements Document

## Original Problem Statement
ScriptM8 is an AI-powered script learning app for actors (Expo/React Native + FastAPI). The app is in **stabilization mode** — core features (script upload, save, teleprompter, premium access) are broken on installed Android builds due to environment variables not being compiled into the production EAS build.

## Core Requirements (Stabilization Mode)
1. Fix core user journey on Android: Upload → Save → Library → Teleprompter
2. Fix RevenueCat API key injection for in-app purchases
3. Fix backend URL injection for all API calls
4. Add build stamp for version verification
5. Add diagnostics view for config presence auditing

## Architecture
- **Frontend**: Expo (React Native), TypeScript, Expo Router, Zustand
- **Backend**: FastAPI, MongoDB
- **Builds**: Expo Application Services (EAS)
- **Subscriptions**: RevenueCat
- **Crash Reporting**: Sentry
- **TTS**: ElevenLabs

## What's Been Implemented

### Feb 2026 — Config Centralization Fix (Current Session)
- **Created `services/appConfig.ts`** — Single source of truth for ALL config with 3-tier resolution: `process.env` → `Constants.expoConfig.extra` → hardcoded production fallback
- **Created `app.config.js`** — Dynamic Expo config that reads env vars at build time with hardcoded fallbacks, embedded into app via `Constants.expoConfig.extra`
- **Migrated ALL consumers** off scattered `process.env.EXPO_PUBLIC_*` reads to centralized `AppConfig`:
  - `apiConfig.ts` — Backend URL
  - `AuthContext.tsx` — Backend URL (was missing fallback entirely!)
  - `_layout.tsx` — RevenueCat keys + feature flags
  - `revenuecat.ts` — RevenueCat keys
  - `premium.tsx` — SHOW_LIFETIME flag (was using broken `=== 'true'` check)
  - `sentryService.ts` — Sentry DSN
  - `elevenLabsService.ts` — ElevenLabs API key
  - `diagnosticsService.ts` — Feature flags + RC key display
- **Added Config Audit** to debug/diagnostics screen showing resolution source for each config value
- **Bumped versionCode** to 1050 for build identification

### Previous Sessions
- Teleprompter blank screen fix
- Upload/Save error handling + user-visible alerts
- User ID race condition fix
- Build stamp on Profile screen
- `eas.json` env blocks for preview/production profiles

## Bugs Found & Fixed This Session
| Bug | Root Cause | Fix |
|-----|-----------|-----|
| AuthContext backend URL empty in prod | No hardcoded fallback (fell to `''`) | Migrated to `AppConfig.BACKEND_URL` |
| Premium SHOW_LIFETIME always false in prod | `process.env.X === 'true'` → `undefined === 'true'` = false | Migrated to `AppConfig.SHOW_LIFETIME` (boolean) |
| Diagnostics shows "Not configured" even when key IS available | Separate resolution logic without hardcoded fallback | Now uses same `AppConfig.REVENUECAT_API_KEY` |
| All env vars undefined in prod build | No `app.config.js` for build-time embedding | Created `app.config.js` with fallbacks |

## Pending — User Device Verification (P0)
Build from current code → install on Android → verify:
1. Build stamp shows `1050`
2. Debug screen Config Audit shows all values with source
3. RevenueCat initializes (API Key shows `goog_****`)
4. File upload works
5. Save & Start works
6. Premium screen loads

## Upcoming Tasks (P1)
- Stabilize Self-Tape feature (camera init, recording, saving)

## Future / Backlog
- Password protection for shared casting links
- Director Mode with framing guides
- ElevenLabs Scene Partner voices for premium
- Backend server.py modular refactor

## Key Files
| File | Purpose |
|------|---------|
| `frontend/services/appConfig.ts` | **NEW** Centralized config with hardcoded fallbacks |
| `frontend/app.config.js` | **NEW** Build-time dynamic config |
| `frontend/services/apiConfig.ts` | API URL + timeout (delegates to appConfig) |
| `frontend/app/_layout.tsx` | RevenueCat init (uses AppConfig) |
| `frontend/services/revenuecat.ts` | RC SDK wrapper (uses AppConfig) |
| `frontend/services/diagnosticsService.ts` | Config audit + diagnostics |
| `frontend/app/debug.tsx` | Debug screen with Config Audit UI |
| `frontend/eas.json` | EAS build profiles with env blocks |
| `frontend/app.json` | Static app config (versionCode 1050) |
