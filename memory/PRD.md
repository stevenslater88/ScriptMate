# ScriptM8 — Product Requirements Document

## Original Problem Statement
ScriptM8 is an AI-powered script learning app for actors (Expo/React Native + FastAPI). The app is in **stabilization mode** — core features (script upload, save, teleprompter, premium access) are broken on installed Android builds due to environment variables not being compiled into the production EAS build.

## Root Cause (Confirmed)
**Expo SDK 54 known regression** (GitHub #36503, #23812): `process.env.EXPO_PUBLIC_*` variables fail to inline correctly during Metro bundling in production builds. Metro replaces references with broken code like `_env2.env.EXPO_PUBLIC_*` that evaluates to `undefined` at runtime.

Additionally, `Constants.expoConfig.extra` is unreliable — in the web preview it only contains `["eas","router"]` keys, not the custom config values from `app.json`. The Emergent platform may also modify `app.json` during builds (confirmed: package name is platform-generated).

Previous fix attempts using `||` fallback chains (`process.env || Constants.extra || hardcoded`) failed because both `process.env` AND `Constants.extra` returned non-string/empty values that bypassed simple `||` truthiness checks.

## Architecture
- **Frontend**: Expo SDK 54 (React Native 0.81.5), TypeScript, Expo Router, Zustand
- **Backend**: FastAPI, MongoDB
- **Builds**: Expo Application Services (EAS)
- **Subscriptions**: RevenueCat (react-native-purchases ^9.7.6)
- **Crash Reporting**: Sentry
- **TTS**: ElevenLabs

## What's Been Implemented

### Current Session — Config Centralization Fix
**Root cause**: Expo SDK 54 `process.env.EXPO_PUBLIC_*` inlining regression + unreliable `Constants.expoConfig.extra`

**Fix (3-layer defense)**:
1. **`app.config.js` (NEW)** — Runs at build time in Node.js context during `expo prebuild`. Reads real OS env vars (set by EAS `env` block) with hardcoded fallbacks. Embeds values into `Constants.expoConfig.extra` under both full and short key names.
2. **`services/appConfig.ts` (NEW)** — Single source of truth for ALL config. Resolution: `Constants.expoConfig.extra` (most reliable) → `process.env` (unreliable SDK 53+) → hardcoded literal. Uses strict `typeof === 'string'` validation, not `||` truthiness. Fires startup CONFIG AUDIT log showing resolved values and sources.
3. **All 10 consumer files migrated** to use `AppConfig` instead of scattered `process.env` calls.

**Files changed**:
| File | Change |
|------|--------|
| `services/appConfig.ts` | **NEW** — Centralized config with 3-layer resolution |
| `app.config.js` | **NEW** — Build-time config embedding |
| `services/apiConfig.ts` | Delegates to `AppConfig.BACKEND_URL` |
| `contexts/AuthContext.tsx` | Fixed: was missing backend URL fallback entirely |
| `app/_layout.tsx` | Uses `AppConfig.REVENUECAT_API_KEY` and `AppConfig.PREMIUM_ENABLED` |
| `services/revenuecat.ts` | Uses `AppConfig` for RC keys |
| `app/premium.tsx` | Fixed: `SHOW_LIFETIME` was using broken `=== 'true'` check |
| `services/sentryService.ts` | Uses `AppConfig.SENTRY_DSN` |
| `services/elevenLabsService.ts` | Uses `AppConfig.ELEVENLABS_API_KEY` |
| `services/diagnosticsService.ts` | Uses `AppConfig` for flags + RC display, added Config Audit |
| `app/debug.tsx` | Added Config Audit section showing resolution sources |
| `app.json` | Bumped versionCode to 1050 |

## Pending — User Device Verification (P0)
Build from current code → install on Android → verify:
1. Build stamp shows `1050` (confirms new code)
2. Debug screen → Config Audit shows values with `[source]` — none "MISSING"
3. Logcat shows `[AppConfig] ===== CONFIG AUDIT =====` at startup
4. RevenueCat shows `goog_****` (not "Not configured")
5. File upload works
6. Save & Start works

## Upcoming Tasks (P1)
- Stabilize Self-Tape feature (camera init, recording, saving)

## Future / Backlog
- Password protection for shared casting links
- Director Mode with framing guides
- ElevenLabs Scene Partner voices for premium
- Backend server.py modular refactor
