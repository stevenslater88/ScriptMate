# ScriptMate - Product Requirements Document

## Overview
ScriptMate is a mobile app for actors to practice scripts and record professional self-tape auditions. The app features AI-powered line reading, script parsing, and a comprehensive Self Tape recording studio.

## Tech Stack
- **Frontend**: Expo (React Native) with TypeScript
- **Backend**: FastAPI (Python) with MongoDB
- **Monetization**: RevenueCat (scriptmate_premium entitlement)
- **Crash Reporting**: Sentry
- **Native Features**: expo-camera, expo-media-library, expo-sharing

---

## Feature: Self Tape Mode (PRO)

### Status: MVP Complete

### Description
A professional, minimal tool for actors to record auditions with split-screen script overlay and instant sharing capabilities.

### User Flow
1. Select Script/Scene from Self Tape Hub
2. Configure settings on Prep screen (font size, character, teleprompter)
3. Record with camera preview + script overlay
4. Post-recording action sheet: Share Now, Save, Retake, or Review
5. Review screen with playback and branded watermark

### Key Features Implemented

#### Recording Screen (`/app/selftape/record.tsx`)
- [x] Split-screen UI: 40% script overlay, 60% camera preview
- [x] Camera controls (flip camera, record/stop)
- [x] 3-second countdown before recording
- [x] Recording duration timer
- [x] Face guide oval overlay
- [x] Post-record action sheet with "Share Now", "Save", "Retake"
- [x] Instant share via native OS share sheet

#### Enhanced Teleprompter Controls
- [x] Play/Pause button for auto-scroll
- [x] Speed slider (1-5x speeds, large thumb-friendly control)
- [x] Font size +/- buttons
- [x] Line highlight toggle
- [x] Controls auto-hide during recording, reappear on tap
- [x] Manual scroll when teleprompter paused

#### Premium Gating
- [x] Self Tape Hub gated behind `scriptmate_premium`
- [x] Script detail page Self Tape button shows lock icon for free users
- [x] Paywall triggered on access attempt

#### Watermark (MVP - Visual Overlay)
- [x] "Sent from ScriptMate" text overlay in review screen
- Note: Full video watermarking would require FFmpeg integration

#### Supporting Screens
- [x] Self Tape Hub (`/app/selftape/index.tsx`) - Script selection & recent takes
- [x] Prep Screen (`/app/selftape/prep.tsx`) - Recording settings
- [x] Review Screen (`/app/selftape/review.tsx`) - Playback with watermark
- [x] Library Screen (`/app/selftape/library.tsx`) - Saved recordings

#### Entry Points
- [x] Home screen "Self Tape" button
- [x] Script detail page dual-button layout (Self Tape + Rehearse)

---

## Completed Work (This Session)

### December 2025
- Implemented enhanced teleprompter controls (play/pause, speed slider, font +/-, highlight toggle)
- Added auto-hide controls during recording with tap-to-show
- Added "Self Tape" button to script detail page with premium gating
- Implemented visual watermark overlay in review screen
- Wired up analytics tracking for all Self Tape events

---

## Backlog / Future Tasks

### P0 (Critical)
- None currently blocking

### P1 (High Priority)
- [ ] FFmpeg-based video watermarking (burn watermark into exported video)
- [ ] Multiple takes management (take 1, take 2, etc.)

### P2 (Medium Priority)
- [ ] Fix ESLint/TypeScript parsing errors (recurring technical debt)
- [ ] Thumbnail generation for saved recordings
- [ ] Cloud backup for recordings

### P3 (Low Priority)
- [ ] Recording analytics dashboard
- [ ] Export to specific social platforms (TikTok, Instagram)
- [ ] Collaborative review (share with coach)

---

## Technical Notes

### Known Issues
1. ESLint shows TypeScript parsing errors - config needs update for TypeScript support
2. Package version warnings for @react-native-community/slider and @sentry/react-native

### Environment
- Expo Tunnel: `exp://instant-share-video.exp.direct`
- Backend: Running on port 8001
- MongoDB: Connected

### Dependencies Added
- expo-camera, expo-media-library, expo-sharing
- expo-video-thumbnails
- @sentry/react-native

### File Structure
```
/app/frontend/app/selftape/
├── _layout.tsx
├── index.tsx      # Self Tape Hub
├── library.tsx    # Saved recordings
├── prep.tsx       # Recording settings
├── record.tsx     # Recording screen (MAIN)
└── review.tsx     # Playback/review
```
