# ScriptM8 — Product Requirements

## Original Problem Statement
Build a fully offline, single-file React Native (Expo) app for actors/performers to memorize and rehearse scripts. After multiple stabilization rounds, the user explicitly mandated **TRUE MINIMAL MODE**:
- Single-file architecture (`App.tsx`)
- No backend, no API calls, no `expo-router`, no complex navigation
- Local storage only via `AsyncStorage`
- Text-to-Speech via `expo-speech`
- Teleprompter mode (auto-scroll, tap-to-position) and Scene Partner mode (line-by-line playback with natural pauses)

## Architecture
```
/app
└── frontend/
    ├── App.tsx          # SINGLE SOURCE OF TRUTH (all UI + logic, ~1000 LOC)
    ├── package.json     # Minimal deps only
    ├── app.json         # Minimal Expo config
    ├── eas.json         # Build profiles (preview, production)
    ├── babel.config.js  # babel-preset-expo only
    ├── android/         # Native Android project for EAS builds
    └── assets/          # Icons & splash
```

Backend (FastAPI/MongoDB) is **NOT USED** by the app but is still running as a service (legacy artifact; safe to ignore).

## Tech Stack
- **Frontend**: React Native 0.81.5, Expo SDK ~54.0.34, TypeScript
- **Storage**: `@react-native-async-storage/async-storage@2.2.0` (key: `"scripts"`)
- **TTS**: `expo-speech` (local, on-device)
- **Build**: EAS (CI uses Node 22.13.0, Yarn 1.22.22)

## Data Model (AsyncStorage)
```
key: "scripts"
value: [{ id: number, title: string, content: string }]
```

## Completed Work

### 2026-02 (Current Session) — EAS iOS Deploy Fix (expo-router plugin)
- EAS production build was failing at `expo prebuild` with: `Failed to resolve plugin for module "expo-router"`. Root cause: Emergent's native deploy script's "Normalizing app.json" step auto-injects `expo-router` into the plugins array (it assumes a standard Emergent Expo template).
- Fix: Added `expo-router@~6.0.22` plus its required SDK 54 peer deps as no-op dependencies (we don't import or use the router; `"main": "App.tsx"` keeps App.tsx as the entry):
  - expo-router, expo-constants, expo-linking, expo-status-bar
  - react-native-safe-area-context, react-native-screens (peer deps of expo-router)
- Verified locally: `npx expo-doctor` 17/17 checks pass, `npx expo prebuild --platform ios` generates `ios/Podfile` successfully.
- App.tsx remains untouched (still single-file offline; only imports react, react-native, AsyncStorage, expo-speech).

### 2026-02 (Current Session) — Deployment Stabilization
- Deleted all orphaned legacy folders: `services/`, `store/`, `hooks/`, `components/`, `contexts/`, `scripts/`, `test_parser.ts`, `eslint.config.js`
- Slimmed `package.json` to only required deps (react, react-native, expo, expo-speech, expo-status-bar, async-storage)
- Removed `resolutions` block that caused EAS `EOVERRIDE` conflicts
- Cleaned `.env` of unused `EXPO_PUBLIC_*` keys (RevenueCat, Sentry, ElevenLabs)
- Cleaned `eas.json` (removed obsolete env blocks for unused integrations)
- Simplified `app.json` (removed `expo-web-browser` plugin reference)
- Verified `yarn install` runs cleanly; supervisor expo service RUNNING
- Deployment agent re-validation: **READY TO DEPLOY** (no blockers)

### Prior Sessions
- Rebuilt entire app into single-file `App.tsx` offline architecture
- Implemented local script CRUD with AsyncStorage
- Added Teleprompter (auto-scroll, tap-to-position) and Scene Partner modes
- Added natural punctuation pauses for `expo-speech`
- Removed `expo-router`, `zustand`, all backend/API logic, `expo-notifications`

## Backlog / Future
- **P2** — Optional voice picker (let user choose `expo-speech` voice from device list)
- **P2** — Optional script export/import (share via clipboard or `expo-sharing` if reintroduced)
- **P2** — Optional dark/light theme toggle

## Critical Rules for Future Agents
1. **DO NOT reintroduce a backend, API calls, `expo-router`, or complex navigation.** User explicitly ordered single-file offline app.
2. **DO NOT bloat `package.json`.** Only add a dep if `App.tsx` actually imports it.
3. **REMIND USER to "Save to GitHub"** before they trigger any EAS build (EAS pulls from GitHub, not preview env). This was a recurring blocker in past sessions.
4. **Ngrok tunnel errors** in `expo.err.log` are intermittent ngrok flakiness — not a code issue. Ignore unless they prevent the service from staying RUNNING.
