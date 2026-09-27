# ScriptM8 — Product Requirements

## Baseline
- **Source of truth branch:** `conflict_170326_0314` (github.com/stevenslater88/ScriptMate) — feature-rich March 17 architecture, restored 2026-02.
- **Directive:** Stabilize and ship. Do NOT rebuild from scratch. Do NOT remove working features.
- **Target:** Android Google Play release. Version code >1110.

## Architecture (as of March 17 restored branch)
- **Frontend:** React Native 0.81.5 / Expo SDK 54 / expo-router (typed routes) / Zustand / TypeScript
- **Backend:** FastAPI (`backend/server.py`) + MongoDB, extensive endpoint surface (users, scripts, rehearsals, auditions, daily-drill, streak, subscription, elevenlabs proxy, etc.)
- **Auth:** Device-ID based (AsyncStorage `device_id`)
- **TTS:** expo-speech (built-in) + ElevenLabs proxy through backend
- **Payments:** RevenueCat (react-native-purchases)
- **Crash:** Sentry
- **Scripts persist on the BACKEND** — no offline/AsyncStorage fallback in this architecture. App requires network.

## Screens present (routes in `app/`)
`index`, `dashboard`, `scripts`, `script/[id]`, `rehearsal/[id]`, `selftape/{index,library,prep,record,review,teleprompter}`, `auditions`, `daily-drill`, `recall`, `scene-partner`, `acting-coach`, `acting-feedback`, `dialect-coach`, `voice-studio`, `premium`, `paywall`, `profile`, `signin`, `onboarding`, `debug`, `support`, `terms`, `privacy`, `stats`, `upload`, `script-parser`, `_layout`. Total: 34 route files.

## Changelog

### 2026-02 — Restore + P0 stabilization
- Restored branch `conflict_170326_0314` via git clone → rsync (preserving `.git` and `.emergent`).
- `yarn install` clean.
- **Startup fixes reapplied:**
  - `app.json` → `updates.enabled: false` added.
  - `eas.json` → `channel: "production"` removed from production build profile.
  - `registerRootComponent` NOT needed — branch uses `"main": "expo-router/entry"` which handles registration natively.
- **Env restored:** `/app/frontend/.env` (Expo tunnel vars + `EXPO_PUBLIC_BACKEND_URL=save-script-verify.preview.emergentagent.com`) and `/app/backend/.env` (`MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`).
- **Backend URL fix (P0):** replaced hardcoded `script-recovery-1.preview.emergentagent.com` in two places with `process.env.EXPO_PUBLIC_BACKEND_URL || 'https://scriptmate-8.emergent.host'`:
  - `services/apiConfig.ts` line 9
  - `app.config.js` line 10
- **Metro cache flush:** removed stale `.expo/types/` cache that caused phantom `ENOENT app/diagnostics.tsx` errors during web bundling.

### 2026-02 — Main rehearsal journey verified (testing_agent iteration_25)
All 12 rehearsal-journey steps PASS. See `/app/test_reports/iteration_25.json`.

## Known non-blocker findings (do NOT fix without approval)
- 🟡 `expo-av` deprecated in SDK 54 — plan migration to `expo-audio`/`expo-video` later.
- 🟡 `rehearsal/[id].tsx` is 1300+ lines — refactor candidate, not now.
- 🟡 RevenueCat Apple key is placeholder (`appl_YOUR_IOS_KEY_HERE`) — iOS IAP won't work until set.
- 🟡 ElevenLabs API key committed in `eas.json` — should move to secret store.
- 🟡 `expo-notifications` still installed (user flagged as risk); no auto-registration observed in `_layout.tsx`, safe to leave.
- 🟡 Rehearsal free-tier gating: `POST /api/rehearsals` 403s if voice≠`alloy` or mode∉{`full_read`,`cue_only`} for non-premium users. Frontend must default correctly.

## Backlog (parked until user requests)
- P2 Full feature audit — classify every route (selftape, auditions, daily-drill, acting-coach, dialect-coach, voice-studio, scene-partner, recall, upload, script-parser, etc.) as KEEP/FIX/PARK based on live testing.
- P2 Move secrets from `eas.json` to EAS secrets.
- P2 Bump Android `versionCode` above 1110 before next production build.
- P3 Remove `[BUILD_ID/CORRECT_DOMAIN]` diagnostic console spam for production builds.

## Rules for future agents
1. **Do NOT remove working features** — every route in `app/` and every file in `services/`, `components/`, `store/`, `contexts/`, `hooks/` must remain until a specific user directive says otherwise.
2. **Do NOT rebuild or refactor** — this is a stabilization project.
3. **One issue at a time** — user has explicitly requested single-issue passes.
4. **Backend is required** — script/user/rehearsal ops go through FastAPI. Do not add offline fallbacks without direction.
5. **Save to GitHub before EAS build** — user must click "Save to GitHub" in Emergent UI; the deploy pipeline pulls source from GitHub.
