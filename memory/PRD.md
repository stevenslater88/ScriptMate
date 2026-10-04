# ScriptM8 — V1 Release PRD (Feb 2026)

## Problem Statement (verbatim)
Stabilize Phase 4 (Learn System) and prepare it for V1 physical device
testing. Implement SEC-003 (Premium QA bypass fix) and SEC-004 (Commercial
TTS Character limits P2). Finalize V1 release audit. Specifically, resolve
RevenueCat Premium entitlement sync, fix Daily Drill 403 authentication
failures, fix the "nuclear parser" false character bugs, and address the
"Adaptive Recall loading 0 lines" issue.

## Product Requirements
1. Server-side RevenueCat verification for Premium entitlements.
2. Safe, environment-driven TTS character budgets.
3. Fix catastrophic parser regression for real PDFs (invisible character
   stripping, numbered character cues, implicit titles).
4. Do NOT build APK, deploy, publish, or push to GitHub unless explicitly
   instructed.
5. Do NOT fix pre-existing baseline lint, TS errors, or frozen test failures.

## Stack
- React Native Expo (frontend)
- Python FastAPI + MongoDB (backend)
- PyPDF2 (text extraction)
- Expo Application Services (EAS)
- Centralized Bearer Auth (SEC-002)
- Integrations: OpenAI (Emergent LLM Key), ElevenLabs (user key), RevenueCat (user key)

## Completed (prior sessions)
- SEC-002 bearer identity auth consolidation.
- Daily Drill 403 fix (`get_effective_user_id`).
- RevenueCat entitlement verification + dashboard mapping.
- Nuclear parser fix: digit-token rejection, dialogue heuristics.
- Invisible unicode normalization (ZWSP/NBSP) in parser + wordcount — backend & frontend parity.
- SCRIPTM8 physical acceptance tests.
- EAS APK build verified via Expo GraphQL.

## Completed (this session, Feb 2026)
- **Adaptive Recall `scriptId` guard** — `frontend/app/recall.tsx`:
  - `needsScriptSelection = !scriptId || !script` computed at top.
  - `useEffect` → `router.replace('/scripts')` when guard trips.
  - `loadProgress` effect gated on `!needsScriptSelection`.
  - Early return with dedicated redirect view (`testID="recall-redirect-screen"`),
    preventing transient 0-line Recall sessions.
  - Rules-of-Hooks preserved: all hooks execute before the conditional early return.
- Added `backend/tests/test_recall_scriptid_guard_feb2026.py` (10 tests, all passing).
- Full regression bundle green: 114/114 across Recall guard + invisible-char parser +
  SCRIPTM8 parity + Daily Drill SEC-002 bearer identity.

## In-Progress / Blockers
- **P1 — Google Play AAB signing certificate mismatch** — BLOCKED on platform
  operator (GCS keystore object was overwritten) or user requesting Google
  Play "Upload key reset".
- **P2 — Live secrets config missing in production** — BLOCKED on
  user/operator pasting `REVENUECAT_SECRET_KEY` and `ADMIN_TOKEN` into the
  Live secrets panel.

## Backlog (prioritized)
- **P0** — Physical device verification of the Adaptive Recall guard
  (navigation smoke test on real device).
- **P1** — Phase 5: Learn (line hiding + active recall advanced features).
- **P1** — Phase 6: Physical QA tracking harness.
- **P3** — Phase 8: Progress / Stats.
- **P3** — Phase 9: Premium hardening / SEC-003.
- **P3** — Phases 10–14: AI Line Coach, Rehearsal Partner, ElevenLabs, Dialect Coach.

## Frozen / Do-Not-Touch
- ~70 pre-existing backend test failures and lint warnings — user strictly
  forbids fixing these. They are obsolete/environment-only false alarms.

## Key Files
- `backend/server.py` — Daily Drill SEC-002 endpoints, parser, digit guard.
- `backend/auth.py` — centralized bearer auth.
- `backend/tests/` — regression suites (invisible-char, SCRIPTM8, Daily Drill, Recall guard).
- `frontend/services/smartScriptParser.ts` — frontend parser parity.
- `frontend/app/recall.tsx` — Adaptive Recall + new scriptId guard.
- `frontend/app/index.tsx` — Home-screen tool cards (Recall still routes to `/recall`).
- `frontend/app/scripts.tsx` — library screen (redirect target).
- `frontend/store/scriptStore.ts` — Zustand script store.

## Key API Endpoints
- `POST /api/scripts` — parse and persist.
- `GET /api/daily-drill/{user_id}` — SEC-002 bearer identity.
- `POST /api/daily-drill/{user_id}/feedback`.

## DB Schema
- `scripts`: `characters`, `lines` (authoritative from parser), `scenes?`.
- `daily_drills`: user-tied practice history.
