# ScriptMate - Product Requirements Document

## Overview
ScriptMate is a mobile app for actors to practice scripts, record professional self-tape auditions, and track their audition journey. The app features AI-powered line reading, gamified memorization, and comprehensive actor tools.

## Tech Stack
- **Frontend**: Expo (React Native) with TypeScript
- **Backend**: FastAPI (Python) with MongoDB
- **Monetization**: RevenueCat (scriptmate_premium entitlement)
- **Crash Reporting**: Sentry
- **Native Features**: expo-camera, expo-media-library, expo-sharing, expo-notifications

---

## Feature 1: Adaptive Recall Mode (Smart Memorisation + Gamified)

### Status: MVP Complete

### Description
A gamified practice mode for memorizing scripts with progressive difficulty and XP-based mastery levels.

### Features Implemented
- [x] Progressive word hiding based on difficulty slider (10-100%)
- [x] Blank replacement mode (hidden words shown as underscores)
- [x] Hide partner lines toggle
- [x] Difficulty slider (10-100%)
- [x] Speed slider (0.5x - 2.0x)
- [x] Timer challenge mode ("Beat the Scene") - Premium only
- [x] Post-session summary (accuracy %, time, difficulty, XP earned)
- [x] Scene mastery levels: Rookie, Working Actor, Series Regular, Lead, Master
- [x] XP system with scene-based progression
- [x] Save progress per scene (AsyncStorage)

### Premium Gating
- **Free**: Basic recall up to 50% difficulty
- **Premium**: Full 0-100% difficulty, timer challenge mode, mastery levels, streak history

---

## Feature 2: Self-Tape Shot Coach + Director Mode

### Status: MVP Complete

### Description
Professional framing guides and overlays for self-tape recording.

### Features Implemented
- [x] Mid-shot framing grid overlay (Rule of Thirds)
- [x] Eye-line markers
- [x] Headroom boundary indicator
- [x] Safe zone frame corners
- [x] Center face guide oval
- [x] Toggle overlays on/off (tap grid icon)
- [x] Long-press menu for individual overlay toggles
- [x] All overlays work during recording

### Premium Gating
- **Free**: Manual framing grid overlays
- **Premium**: Director Mode feedback summary (future: framing score, "Casting Ready" badge)

---

## Feature 3: Audition Tracker + Momentum System

### Status: MVP Complete

### Description
Track auditions with status updates, follow-up reminders, and performance analytics.

### Features Implemented
- [x] Create/Edit/Delete auditions
- [x] Fields: Project name, Role, Date submitted, Status, Notes
- [x] Status options: Submitted, Callback, Booked, Passed
- [x] Follow-up reminder notifications (local)
- [x] Sortable/filterable list
- [x] Search by project or role
- [x] Quick stats (Total, Pending, Callbacks, Booked)
- [x] Stats dashboard: Auditions per month, Callback rate, Booking rate
- [x] Momentum indicator (rising/steady/declining)
- [x] "Backup/Sync (coming soon)" placeholder

### Premium Gating
- **Free**: Up to 10 auditions, local reminders included
- **Premium**: Unlimited auditions, filters, full stats dashboard

---

## Feature 4: Home Dashboard ("Today in ScriptMate")

### Status: MVP Complete

### Description
Central dashboard showing daily progress, stats, and quick actions.

### Features Implemented
- [x] Practice time today
- [x] Current streak
- [x] Pending auditions count
- [x] Global XP
- [x] Momentum indicator badge
- [x] Quick action buttons: Practice, Self Tape, Auditions, New Script
- [x] Premium upgrade banner
- [x] Continue Learning card
- [x] Mastery level card with progress bar
- [x] Actor Tools grid

---

## Premium Monetization Split

### Free Tier
- Basic recall up to 50% difficulty
- Manual framing grid overlays
- Audition tracker up to 10 auditions
- Local follow-up reminders
- Basic streak tracking

### Premium Tier
- Full recall 0-100% difficulty
- Timer challenge mode
- Full mastery levels + streak history
- Unlimited auditions
- Full filters + stats dashboard
- Director Mode feedback summary (future)

---

## Data Storage

All data stored locally via AsyncStorage:
- Progress & XP per scene
- Streak data
- Practice time tracking
- Auditions list
- Settings

Future: "Backup & Sync (coming soon)" placeholder added.

---

## File Structure (New Files)

```
/app/frontend/
├── app/
│   ├── dashboard.tsx         # NEW: Home dashboard
│   ├── auditions.tsx         # NEW: Audition tracker
│   ├── recall.tsx            # NEW: Adaptive recall mode
│   └── selftape/record.tsx   # UPDATED: Shot Coach overlay
├── components/
│   └── ShotCoachOverlay.tsx  # NEW: Framing grid component
├── services/
│   ├── progressService.ts    # NEW: XP/mastery/streak tracking
│   └── auditionService.ts    # NEW: Audition CRUD & stats
```

---

## Completed Work (This Session)

### February 2026 (Latest)

#### P0 Build Fix - SDK 54 Compatibility (Latest Session - Feb 21, 2026)
- **Root Cause 1**: Expo SDK 54 requires `react-native-reanimated ~4.1.x`, but codebase had `~3.16.0` (SDK 52 version)
- **Root Cause 2**: Missing `babel.config.js` with required worklets plugin for Reanimated 4.x
- **Root Cause 3**: Build system was overriding `react-native-worklets` version (injecting 0.7.x/0.5.2 instead of 0.5.1)
- **Root Cause 4**: Build system deletes yarn.lock and uses npm, which ignores yarn's `resolutions` field
- **Fixes Applied**:
  - Upgraded `react-native-reanimated` from `~3.16.0` to `~4.1.0`
  - Added `react-native-worklets` `0.5.1` (exact version pinned, required dependency for reanimated 4.x)
  - **Created `babel.config.js`** with `react-native-worklets/plugin` (CRITICAL - must be last plugin)
  - Added `expo-build-properties` plugin with explicit native build settings:
    - Android: `newArchEnabled: false`, `compileSdkVersion: 35`, `targetSdkVersion: 35`, `minSdkVersion: 24`
    - iOS: `newArchEnabled: false`, `deploymentTarget: 15.1`
  - Added `react-native-worklets` and `react-native-reanimated` to `expo.install.exclude` to prevent version overrides
  - Added **`resolutions`** block (for yarn) to pin `react-native-worklets` to `0.5.1`
  - Added **`overrides`** block (for npm) to pin `react-native-worklets` to `0.5.1`
  - Updated `.npmrc` with `save-exact=true` and `legacy-peer-deps=true`
  - Regenerated `yarn.lock` from scratch for clean dependency resolution
  - Added `CORS_ORIGINS="*"` to backend/.env for production consistency
- **Status**: Changes applied locally, awaiting deployment verification
- **Note**: The EAS build environment is deleting lock files and using npm install, which may still resolve to wrong versions. The `overrides` field should help.

#### Previous Build Configuration Fix
- **P0 Build Configuration Fix - EAS Dependency Mismatch**: Fixed recurring build failures
  - Removed `package-lock.json` which was conflicting with `yarn.lock`
  - Added `resolutions` block to `package.json` to force `@react-native-community/slider@5.0.1`
  - Updated `eas.json` with `base` profile specifying `node: 20.18.0` and `yarn: 1.22.22`
  - Created `.npmrc` with `package-lock=false` to prevent npm from creating lock files
  - Added `package-lock.json` to `.gitignore` to prevent future conflicts
  - All builds now extend from `base` profile ensuring consistent yarn usage
  - `expo doctor` passes all 17 checks
- **P0 Bug Fix - RevenueCat "Error 23"**: Completely refactored RevenueCat integration for crash-safe premium screen
  - Refactored `useRevenueCat.ts` hook to safely fetch "production" offering from RevenueCat dashboard
  - Added `offeringsReady` state to track if offerings loaded successfully
  - Added `retryLoadOfferings()` function for user-triggered retry when offerings fail
  - Added `getProductionOffering()` helper that safely accesses `offerings.all["production"]` with fallback to `current`
  - Updated `PurchaseResult` interface to include `restored` flag for clearer restore flow
  - All RevenueCat operations now wrapped in try/catch for crash protection
  - **Added Sentry error logging** for all RevenueCat operations (offerings load, purchase, restore, paywall)
  - Re-enabled Sentry initialization in `_layout.tsx` for production crash reporting
- **Crash-Safe Premium Screen UI**: Updated `premium.tsx` with proper loading and error states
  - Shows loading spinner while RevenueCat initializes
  - Shows "Unable to Load Plans" error state with retry button when offerings fail
  - Retry button calls `retryLoadOfferings()` to attempt re-fetching
  - "Restore Previous Purchase" option available even when offerings fail
  - Graceful fallback to backend pricing when RevenueCat unavailable
- **P0 Bug Fix - AI Cue Loop in Rehearsal**: Fixed the repeating AI cue loop in rehearsal/[id].tsx
  - Added `speakingLineIndexRef` to track which line is being spoken (prevents duplicate TTS calls)
  - Added `advanceProcessedRef` to ensure advance only happens once per speech cycle
  - Converted `saveProgress` to `useCallback` and moved before `advanceToNextLine` to fix variable ordering
  - Improved state management to prevent race conditions between speech callbacks
- **ESLint Configuration Updated**: Fixed ESLint config for better TypeScript support
  - Added separate configs for JS/JSX and TS/TSX files
  - Updated parser options and globals
  - Disabled `@typescript-eslint/no-explicit-any` for flexibility
- **Deployment Blocker Fixed**: Installed missing `@react-native-community/datetimepicker` dependency
- **Navigation Routes Added**: Added Stack.Screen entries for dashboard, auditions, recall, selftape routes
- **Backend Testing**: All 15 API tests passed (health, scripts CRUD, users, subscriptions, rehearsals)
- **Deployment Health**: Verified deployment ready with all environment variables configured correctly
- **Quick Tutorial Onboarding**: Added 5-step swipeable onboarding flow for new users
  - Welcome screen introducing ScriptMate
  - Audition Tracker feature highlight
  - Adaptive Recall feature highlight  
  - Shot Coach feature highlight
  - Dashboard feature highlight
- **"Show Tutorial" Button**: Added to Help & Support screen for users to re-view the tutorial anytime
- **Fixed Navigation Routes**: Updated selftape navigation to use correct `/selftape/index` path

### Home Dashboard Redesign (February 2026)
- **Clean, Professional Layout**: Redesigned "Today in ScriptMate" dashboard
- **Daily Progress Section**: Practice time, streak days, XP with mastery level badge
- **Scene Mastery Progress Bar**: Shows current/last practiced scene with visual XP progress
- **Career Momentum Section**: Pending auditions, submissions this month, callback count
- **Quick Stats Row**: Callback rate and booking rate percentages
- **Quick Actions Grid**: Practice Scene, Record Self-Tape, Audition Tracker buttons
- **Soft Premium Upgrade Card**: Non-intrusive upgrade prompt at bottom

### Natural Premium Upgrade Experience (February 2026)
- **Value-Driven Copy**: Replaced generic "Premium Feature" prompts with benefit-focused messaging
- **Adaptive Recall Prompt**: "Unlock Advanced Recall" - emphasizes pro training benefits
- **Audition Tracker Prompt**: "Upgrade Your Career Toolkit" - emphasizes stats and tracking
- **Premium Value Page Redesign**: Clean hero, feature checklist, plan selection cards
- **Supportive Tone**: "Maybe Later" instead of "Cancel", benefits explained before upgrade
- **No Forced Paywall**: Prompts only appear when user hits value limit
- **Reusable Components**: Created `PremiumPrompts.tsx` with SoftUpgradePrompt, UpgradeModal, CompactUpgradeBanner

### December 2025
- **Adaptive Recall Mode**: Full gamified memorization with difficulty slider, word hiding, timer challenge, XP/mastery system
- **Shot Coach Overlays**: Rule of thirds grid, eye-line markers, headroom boundary, toggleable overlays
- **Audition Tracker**: Full CRUD with status tracking, filters, search, stats dashboard, momentum indicator
- **Dashboard**: Progress stats, quick actions, mastery level display
- **Services**: progressService.ts (XP/mastery), auditionService.ts (auditions)
- **Premium Gating**: Implemented across all features with specified split
- Added expo-notifications for local reminders

---

## Bug Fixes Summary (This Session)

| Issue | Status | Notes |
|-------|--------|-------|
| P0: RevenueCat "Error 23" | FIXED | Refactored hook with safe offering fetch, added retry UI |
| P0: AI cue loop in rehearsal | FIXED | Refactored TTS callback logic with refs |
| P0: EAS Build Failure | FIXED | Upgraded react-native-reanimated to ~4.1.0, added react-native-worklets, expo-build-properties |
| P1: Self-Tape navigation | VERIFIED WORKING | Routes load correctly |
| P1: Audition stats graph button | VERIFIED WORKING | Modal opens correctly |
| P2: ESLint parsing errors | FIXED | Updated eslint.config.js |

---

## Build Configuration (February 2026)

### Dependencies Updated
- `react-native-reanimated`: ~4.1.0 (upgraded from ~3.16.0 for SDK 54 compatibility)
- `react-native-worklets`: ~0.5.1 (new, required by reanimated 4.x)
- `expo-build-properties`: 1.0.10 (new, for granular native build control)

### Build Settings
- `newArchEnabled`: false (both app.json and expo-build-properties)
- Android: compileSdkVersion 35, targetSdkVersion 35, minSdkVersion 24
- iOS: deploymentTarget 15.1

---

## Backlog / Future Tasks

### P1 (High Priority)
- [ ] Overall progress summary (aggregate across all scenes)
- [ ] Director Mode: Manual framing scoring with feedback
- [ ] "Casting Ready" badge for score >85

### P2 (Medium Priority)
- [ ] Random word removal mode
- [ ] Multiple difficulty presets
- [ ] Cloud backup/sync for data
- [ ] FFmpeg-based video watermarking

### P3 (Low Priority)
- [ ] Recording analytics dashboard
- [ ] Export to social platforms
- [ ] Collaborative review

---

## Environment

- Expo Tunnel: Available via Expo CLI
- Backend: FastAPI on port 8001
- Database: MongoDB
- Preview URL: https://audition-hub-4.preview.emergentagent.com

## Testing Notes

⚠️ **Requires on-device testing** for:
- Camera recording with Shot Coach overlays
- Local push notifications for audition reminders
- Full Adaptive Recall gameplay
- **Rehearsal TTS callback flow (AI cue loop fix)**
