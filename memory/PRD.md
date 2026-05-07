# ScriptM8 — Product Requirements Document

## Status: STABILIZATION MODE (March 17 architecture, post-rollback)

## Goal (Confirmed by user — Feb 2026)
- Stable boot under Expo SDK 54 / Expo Go and EAS Android
- Stable local script saving/loading (AsyncStorage based)
- Working rehearsal flow
- No backend / API dependency for core flows
- Smallest targeted edits — no refactors, no UI redesign

## Original Problem Statement
ScriptM8 is an AI-powered script learning app for actors (Expo SDK 54 / React Native 0.81.5 + FastAPI). Legacy `expo-notifications` startup logic was crashing/warning the app on boot under Expo SDK 54 / Expo Go. The user rolled back to the March 17 architecture and asked for a stabilization-only pass.

## Stabilization Changes Applied (Feb 2026)
1. **`frontend/services/auditionService.ts`** — Removed `import * as Notifications from 'expo-notifications'`. `scheduleFollowUpNotification` is now a no-op returning `undefined`. Audition CRUD continues to work via AsyncStorage.
2. **`frontend/package.json`** — `expo-notifications` dependency fully removed via `yarn remove expo-notifications`. yarn.lock regenerated. No native module is linked into EAS Android builds.
3. **Verified** — `grep` confirms no `expo-notifications` imports or `Notifications.*` API calls remain anywhere in `frontend/` source. App config (`app.json`, `app.config.js`) has no notification plugin or `notification` block.

## Pending — User Device Verification (P0)
User to clear Metro cache and test on Expo Go or fresh EAS Android build:
- App boots cleanly with no `[expo-notifications]` warnings
- Local script save/load works
- Rehearsal flow runs end-to-end

## Known Pending Issues (post-rollback, not yet retested)
- **P1**: File Upload "Unable to reach server" on physical Android device
- **P1**: Daily Drill returns 404 on physical device
(Both require user re-test after stabilization confirms boot works.)

## Upcoming Tasks (P1)
- Stabilize Self-Tape feature (camera init, video recording, saving)

## Future / Backlog (P2)
- Password protection for shared casting links
- Director Mode with on-screen framing guides
- ElevenLabs Scene Partner voices for premium users
- Backend `server.py` modular refactor

## Architecture Notes
- Frontend: Expo SDK 54, React Native 0.81.5, TypeScript, Expo Router, Zustand, AsyncStorage
- Backend: FastAPI + MongoDB (NOT required for core local flows)
- Build: EAS
- Subscriptions: RevenueCat
- 3rd party: OpenAI GPT-4o + Whisper (Emergent LLM Key), Sentry, ElevenLabs

## Strict Rules (User-Mandated)
- No feature additions, no UI redesigns, no broad refactors
- No backend/API dependencies introduced for core flows
- Trust device truth only — simulator passes do not count
- If warnings persist after code removal, clear Metro cache (`npx expo start -c`)
