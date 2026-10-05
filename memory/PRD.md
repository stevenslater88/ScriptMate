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
- SEC-002 bearer identity consolidation.
- Daily Drill 403 fix (`get_effective_user_id`).
- RevenueCat entitlement verification + dashboard mapping.
- Nuclear parser fix: digit-token rejection, dialogue heuristics.
- Invisible unicode normalization (ZWSP/NBSP) in parser + wordcount.
- Adaptive Recall `scriptId` guard with redirect to script library.
- Script picker return-path (`returnTo=recall`) → Adaptive Recall configuration.
- ElevenLabs available-voices catalogue endpoint, structured 422 for `voice_unavailable`.

## Completed (this session, Feb 2026)

### Nuclear Premium entitlement fix (V1 release blocker)
- **Root cause** (confirmed from build 1110 physical evidence):
  Every backend premium gate (`check_user_limits` rehearsal gate,
  `_resolve_tier_for_tts` TTS gate, `get_user_limits` endpoint) read
  `user.subscription_tier` from the Mongo `users` row. The one-shot
  startup `POST /users/{deviceId}/revenuecat/sync` was fire-and-forget
  (racy with the user's first tap) and silently 503'd when
  `REVENUECAT_SECRET_KEY` was unset in prod — leaving the Mongo row
  stuck at `free` while the RevenueCat `ScriptMate Pro` entitlement
  remained active forever. Result: performance+loop modes 403'd and
  ElevenLabs 402'd `{tier:'free', scope:'daily', used:494, limit:500}`.
- **Fix** (`backend/server.py`):
  - New canonical `resolve_authoritative_tier(user_id, rc_app_user_id)`
    helper. Mongo-premium short-circuits with ZERO vendor calls. If the
    Mongo row says free AND the client supplied `X-RC-App-User-Id`
    (header) OR the row has a persisted `revenuecat_app_user_id`,
    verifies live via `fetch_premium_entitlement`. If active, lifts the
    Mongo row to premium (SEC-003 verified write) and returns premium.
    60-second in-process cache keyed on rcid prevents vendor hammering.
  - `check_user_limits`, `_resolve_tier_for_tts` and `get_user_limits`
    all delegate to the resolver — no more split-brain.
  - `create_rehearsal`, `generate_elevenlabs_tts` and `/users/{id}/limits`
    accept the `X-RC-App-User-Id` header via FastAPI dependency.
  - All existing SEC-004 budget contracts, SEC-003 QA_PREMIUM fail-closed
    semantics, 503 global ceiling + Retry-After, and 2 000/day restricted
    key fuse preserved verbatim.
- **Fix** (`frontend/services/authClient.ts`):
  `getAuthHeader()` now attaches `X-RC-App-User-Id` from the RevenueCat
  SDK on every authenticated axios/fetch request.
- **Fix** (`frontend/services/elevenLabsService.ts`):
  Both the initial `/generate` fetch and the 401-retry attach the RC
  header through a shared `buildHeaders` helper.
- **Security guarantees preserved:** client NEVER declares its own tier;
  it only identifies which RC subscriber the server should verify.
  Server performs vendor verification with its own secret. RC unreachable
  / secret missing → fail-safe to Mongo decision (never weakens the gate).

### Tests
- `backend/tests/test_premium_entitlement_pipeline_feb2026.py` — 30 new
  tests (resolver outcomes, physical scenario reproduction, cache dedupe,
  stored-rcid fallback, free-user regression, SEC-004 budget contract,
  frontend header attachment, security contract). 30/30 PASS.
- Full regression bundle 367/367 PASS (1 skipped) across Premium pipeline
  + Recall guard + Recall picker + ElevenLabs voice pipeline + invisible-
  char parser + SCRIPTM8 parity + Daily Drill SEC-002 bearer + voice/TTS
  hardening + SEC-003 revenuecat server verification + SEC-004 TTS budget
  + QA premium bypass audit.
- Pre-existing frozen `test_qa_premium_flag_off_still_gates_premium_features`
  failure untouched (verified failing before my change via `git stash`).

## In-Progress / Blockers
- **P1 — Google Play AAB signing certificate mismatch** — BLOCKED on
  platform operator (GCS keystore object was overwritten) or user
  requesting Google Play "Upload key reset".
- **P2 — Live secrets config in production** — the dev-pod `.env` had an
  empty `REVENUECAT_SECRET_KEY` which is exactly the trigger the fix
  self-heals against. For permanent correctness the operator should also
  paste the real `REVENUECAT_SECRET_KEY` and `ADMIN_TOKEN` into the Live
  secrets panel; the self-heal path removes the race, but the `/sync`
  endpoint still needs the secret for the explicit sync route.

## Backlog (prioritized)
- **P0** — Physical-device verification of the entitlement self-heal
  (Home → Scripts → pick → Performance/Loop → start → ElevenLabs plays
  with premium budget).
- **P1** — Phase 5: Learn (line hiding + advanced active recall).
- **P1** — Phase 6: Physical QA tracking harness.
- **P3** — Phase 8: Progress / Stats.
- **P3** — Phase 9: Premium hardening / SEC-003 Phase P3.
- **P3** — Phases 10–14: AI Line Coach, Rehearsal Partner, ElevenLabs,
  Dialect Coach.

## Frozen / Do-Not-Touch
- Pre-existing backend lint warnings and test failures:
  `test_qa_premium_bypass::test_qa_premium_flag_off_still_gates_premium_features`
  (environment-dependent), `test_sec004_tts_hardening::test_tts_valid_bearer_passes_auth_gate`
  (ElevenLabs dev key quota exhausted).

## Key Files
- `backend/server.py` — new `resolve_authoritative_tier`, canonical
  resolver consumed by every premium gate, structured 422 for
  `voice_unavailable`, `GET /tts/elevenlabs/available-voices`, Daily
  Drill SEC-002 endpoints, parser, digit guard.
- `backend/revenuecat_client.py` — authoritative RC REST client
  (`DEFAULT_ENTITLEMENT_ID = "ScriptMate Pro"`).
- `backend/auth.py` — centralized bearer auth.
- `backend/tests/` — regression suites (new premium pipeline, Recall
  guard, Recall picker, ElevenLabs catalogue, invisible-char, SCRIPTM8,
  Daily Drill, SEC-003 verification, SEC-004 budgets).
- `frontend/services/authClient.ts` — bearer + RC header attachment.
- `frontend/services/elevenLabsService.ts` — TTS /generate carries RC
  header on initial + 401 retry; `fetchAvailableVoices` catalogue cache.
- `frontend/services/smartScriptParser.ts` — frontend parser parity.
- `frontend/app/recall.tsx` — Adaptive Recall + scriptId guard +
  returnTo redirect.
- `frontend/app/scripts.tsx` — library screen w/ Recall-return mode.
- `frontend/app/index.tsx` — Home-screen tool cards.
- `frontend/components/VoiceAssignment.tsx` — picker + auto-assign
  filtered by account-available voices.
- `frontend/store/scriptStore.ts` — Zustand script store.

## 2026-02 — Device B "Missing bearer token" fix (SCRIPT M8)
Three axios calls in `frontend/store/scriptStore.ts` hit SEC-002-protected
endpoints without `getAuthHeader()`, producing 401 "Missing bearer token"
on cold-cache devices (Device B repro). Attached `headers: await
getAuthHeader()` to all three:
- `fetchUserLimits` → `GET /api/users/{deviceId}/limits`
- `startTrial` → `POST /api/users/{deviceId}/start-trial`
- `subscribe` → `POST /api/users/{deviceId}/subscribe`

Guarded by `tests/test_scriptstore_premium_auth_headers_feb2026.py`
(5 tests). Full Premium/RC regression (74 tests) green. No build/deploy
performed — awaiting review.

## Key API Endpoints
- `POST /api/scripts` — parse and persist.
- `GET /api/users/{device_id}/limits` — now RC-authoritative via header.
- `POST /api/rehearsals` — now RC-authoritative via header.
- `POST /api/tts/elevenlabs/generate` — now RC-authoritative via header.
- `GET /api/daily-drill/{user_id}` — SEC-002 bearer identity.
- `GET /api/tts/elevenlabs/health` — binary config verdict.
- `GET /api/tts/elevenlabs/available-voices` — authoritative catalogue.
- `POST /api/users/{device_id}/revenuecat/sync` — explicit sync (still
  available; now mostly redundant with the self-heal path).

## DB Schema
- `scripts`: `characters`, `lines` (authoritative from parser), `scenes?`.
- `daily_drills`: user-tied practice history.
- `users`: now includes `revenuecat_app_user_id` persisted by any
  successful self-heal or explicit sync.
