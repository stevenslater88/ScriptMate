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

### December 2025
- **Adaptive Recall Mode**: Full gamified memorization with difficulty slider, word hiding, timer challenge, XP/mastery system
- **Shot Coach Overlays**: Rule of thirds grid, eye-line markers, headroom boundary, toggleable overlays
- **Audition Tracker**: Full CRUD with status tracking, filters, search, stats dashboard, momentum indicator
- **Dashboard**: Progress stats, quick actions, mastery level display
- **Services**: progressService.ts (XP/mastery), auditionService.ts (auditions)
- **Premium Gating**: Implemented across all features with specified split
- Added expo-notifications for local reminders

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
- [ ] Fix ESLint/TypeScript parsing errors
- [ ] Recording analytics dashboard
- [ ] Export to social platforms
- [ ] Collaborative review

---

## Environment

- Expo Tunnel: `exp://instant-share-video.exp.direct`
- Backend: FastAPI on port 8001
- Database: MongoDB

## Testing Notes

⚠️ **Requires on-device testing** for:
- Camera recording with Shot Coach overlays
- Local push notifications for audition reminders
- Full Adaptive Recall gameplay
