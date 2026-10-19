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

## 2026-02 — Premium Trial purchase-first flow (SCRIPT M8 final)
Trial button now triggers the native RevenueCat purchase (yearlyPackage) when
Google Play has an eligible intro offer configured; otherwise it reports the
configuration gap clearly instead of faking trial activation. No local
Premium grants, no QA bypass; backend SEC-003 verification remains intact.

Also fixed in the same diff:
- `premium.tsx` stale-closure: Alerts now read `useScriptStore.getState().error`
  after `await`, so the real backend detail surfaces instead of
  "Failed to start trial" / "Failed to subscribe".
- `scriptStore.ts::startTrial` + `subscribe` now carry the full DebugLog
  pipeline (functionStart / apiRequest / apiResponse / apiError /
  functionSuccess / functionError) — never logs tokens, RC secrets, or
  payment credentials.

Guarded by `tests/test_premium_trial_purchase_flow_feb2026.py` (16 tests
including live E2E against FastAPI). Full regression (192 passed, 1 skipped)
green. No build/deploy performed — awaiting review.

## 2026-02 — Emily Note20 Android 13 "user_id does not match" fix (SCRIPT M8 Option A)
Two independent AsyncStorage keys were minting the device identity:
- `device_id` (shared, used by scriptStore + _layout + RC appUserID)
- `@scriptmate_device_id` (private to elevenLabsService, used for bearer mint)

The bearer identity therefore never equalled the URL-path identity, and every
protected `/api/users/{deviceId}/*` request failed `enforce_user_id_match`
with 403 "user_id does not match authenticated session" (surfaced on Emily's
Note20 as the Premium tap error; "Failed to start trial" was the same 403
plus a React stale-closure masking the real error text).

Fix (one file, `frontend/services/elevenLabsService.ts`): read/write the
shared `device_id` key, mint with the same safe-charset shape as _layout.tsx.
Zero backend / RC / products / pricing / entitlement / TTS changes.

Guarded by `tests/test_emily_note20_user_id_mismatch_feb2026.py` (10 tests).
Full regression (171 passed, 1 skipped) green. No build/deploy performed.

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

## 2026-06 — SEC-002 RevenueCat identity binding (LAUNCH BLOCKER, code-only)
`server._bind_rc_app_user_id(rc_id, authenticated_user_id, ignore_anonymous=)`
rejects (403 "revenuecat_app_user_id does not match authenticated session")
any RC id != `effective_user_id(session)` BEFORE `fetch_premium_entitlement`.
Applied in: `resolve_authoritative_tier` (limits / rehearsals / TTS — header;
`$RCAnonymousID:` header ignored → Mongo tier, no lookup), stored
`revenuecat_app_user_id` fallback (used only if bound), `/revenuecat/sync`,
`/subscribe`, `/start-trial` (body; anonymous → 403).
Tests: `tests/test_sec002_rc_identity_binding_jun2026.py` (15). Fixtures in 4
existing RC suites updated to use bound ids (they encoded the cross-id shape).
Full suite diff vs pre-change: zero new failures (1 flaky network test).
DEPLOYED to production (https://scriptmate-8.emergent.host, commit c67253b,
backend-only, no mobile build / Play submission / RC config change). Prod
verification (disposable ids, script `/app/tmp/sec002_prod_verify.sh`): attack
on limits/rehearsals/sync/subscribe/start-trial → 403; legit + anon → 200.
Prod Premium recognition not verifiable with disposable ids (needs a real
purchase; QA_PREMIUM fail-closed in prod) — covered by automated tests.
Pending (NOT started, awaiting approval): SEC-001 (P1), SEC-004 (P2), iOS
bundle id decision, RC transfer-behaviour dashboard check.


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

## 2026-10-15 — Rehearsal responsiveness pass (branch `perf/rehearsal-responsiveness`, uncommitted, from `eb84fae`)
- Trial CTA: closed as Google Play account eligibility (no app regression proven). Production VC1150 pending review from `recovery/vc1143-fixes` (app.json 1149).
- Rehearsal: ElevenLabs prefetch of next partner line + in-flight dedupe; fixed waits cut (partner start 500→150ms, post-playback advance 300→50ms, stop-settle 100ms only if audio was playing, mic auto-start 500→250ms); duplicate-advance guard per line; mic start guard + immediate UI ack; stale SR 'end' ignored; `RehearsalTiming` diagnostics (no transcripts).
- Scene Partner: "Immediate" cue timing was 1s (`|| 1000`) → fixed; Continue double-tap no longer double-advances.
- Test branch app.json versionCode 1150 → EAS build 1151. No AAB built (user chose code+tests only).
- Tests: backend/tests/test_rehearsal_responsiveness.py (+ fixtures/elevenlabs_prefetch_harness.js).
- Pending: on-device before/after timing capture; P1 SEC-001 rate limiting; P2 dynamic build labels; P2 SEC-004 share links.
- 2026-10-15 follow-up (uncommitted on top of auto-checkpoint 3db9b65): removed optimistic `setIsListening(true)` (caused 250ms auto-start retry loop when SR fails before 'start'); replaced with bounded `micPendingRef` (3s). Scene Partner Continue now guarded by `continuePendingRef` (Immediate=0ms double-tap). 3 failing backend tests are env/pre-existing: QA_PREMIUM=true in preview backend/.env (iteration26), backend parser drops final line after `[Stage Direction: ...]` (iteration19; server.py unchanged since eb84fae).
- Zero-byte junk file `frontend/\x01\x90\xf8@@\xd0\xc39@8` = artifact of failed x86 hermesc run during `expo export` (mtime matches bundler tmp dir); safe to delete with approval.
- 2026-10-15 parser fix (uncommitted, branch perf/rehearsal-responsiveness @7a3c7de): `_is_header_keyword_line` in server.py — colon header forms any case, bare/space forms only uppercase keyword. Fixes f5c6a5b (2026-10-01) regression dropping dialogue starting "By/Time/Place/Cast/Setting/Author". Tests: tests/test_parser_header_keyword_dialogue_oct2026.py (20). Full suite baseline(HEAD) 79F/9E vs fixed 78F/9E; only diff = iteration19 stage-direction test now passing. Frontend smartScriptParser.ts `isHeaderLine` has the same bug (not changed). Zero-byte hermesc artifact removed. NOT deployed.
- 2026-10-15 frontend parity: smartScriptParser.ts isHeaderLine mirrors backend rule (uncommitted). Tests: tests/test_parser_header_keyword_parity_oct2026.py (19, both parsers). Parser-related suites 393 passed.
- 2026-10-15 stability pass (uncommitted on 9b1ae0b): structural header rule in both parsers (`_is_header_keyword_line` / `isHeaderLine` + name-like value check; sentences ending .!? never no-colon labels) — fixes title-page "Written by Jane Doe" regression and shouted dialogue loss ("TIME IS UP!"). Rehearsal: onUserLineDone ignored while paused (stuck 'waiting' fix). Scene Partner: queueRef fixes stale-queue advance on start (partner-first scenes ended after line 1). Full suite: 78F/9E identical to HEAD baseline. Outstanding: title/cast-list lines appear as zero-line ghost characters (pre-existing).
- 2026-10-15 final stability pass (uncommitted on 783d7a1): Scene Partner Replay Cue resets Continue guard and resumes after interrupting a partner line (fixes stuck turn). Targeted suites 614 passed/2 skipped; tsc 33 baseline; eslint 14 warnings baseline. Release gate: code ready for device test; version code for next build pending Play Console confirmation (branch app.json 1150 -> build 1151).
- 2026-10-16 Premium/pricing pass (uncommitted on bf81a58): devTestMode.ts gated by __DEV__ (release builds can't enable Dev Test Mode), debug.tsx toggle hidden outside dev; premium.tsx false 'Save 50%' badge removed (actual GBP saving ~33%). Backend plan 'savings' strings (29/44/34%) unused by UI, not changed. Prod verified via deployer: QA_PREMIUM=false, ENV=production (SAFE). Tests: tests/test_premium_devmode_and_pricing_oct2026.py (7). Blocker: VC1155/1157 (v1.1.2) built outside this workspace; this branch is v1.1.1/1150 -> would build 1151 (< 1157).
- 2026-10-18 patch for user's local VC1157 source: memory/patches/premium_devmode_pricing_fix_onto_bf81a58.patch (5 files, against bf81a58). Verified applies cleanly to bf81a58 and to simulated bf81a58+v1.1.2+hasFreeTrialOffer edits. Local machine/EAS/Play not accessible from workspace. Next VC: 1158 if VC1157 highest (set app.json versionCode 1157 in local source).

## 2026-06 Rehearsal scoring accuracy (uncommitted, workspace only)
- New frontend/services/rehearsalScoring.ts (normalisation: contractions, digits 0-99, ok/okay, Mr/Mrs/Dr, dashes/ellipses as word breaks; scoreLineAttempt carries text across Android mic sessions). Formula + thresholds unchanged.
- rehearsal/[id].tsx: post-line % match now shown for completed lines too (was only shown for failed ones -> apparent ~60% ceiling).
- Tests: backend/tests/test_rehearsal_scoring_accuracy_jun2026.py (21 pass). Device verification pending. Open: end-summary "Accuracy" is a completion rate, not speech match.
- 2026-06 follow-up: end summary relabelled "Line completion"; new "Speech Match" = mean speechAccuracy of completed, non-missed lines with a score >0 (one per line), else "not available". summarizeSpeechMatch in rehearsalScoring.ts; 31 tests pass.
- 2026-06 branch reconciliation: merged GitHub recovery/vc1143-fixes (2fbbaf7 yarn.lock slider sync, 49bd3ee ElevenLabs audio-focus retry) into perf/rehearsal-responsiveness (merge 3228fad, test pin af28929). app.json 1.1.2 / versionCode 1158 (user-stated; no repo commit ever had >1150). Canonical branch: GitHub perf-rehearsal-responsiveness. Pending: user Save to GitHub (fast-forward from 9fc1592).
- 2026-06 voice-assignment reliability fix (commit see git log): per-line provider verdict, probe retry, await assignment load, stale-load guard, voiceId from voiceKey. Tests: test_voice_assignment_reliability_jun2026.py (11 pass).
- 2026-06 Redesign stage 1 (branch redesign/cinematic-ui from 9b30150): constants/cinematicTheme.ts tokens, components/cinematic.tsx, Home restyled (no nav/logic change). Awaiting user approval before other screens.
- 2026-06 Redesign stage 2: Script Library restyled (delete button kept, testIDs kept). QA preview data: device qa-redesign-device-001, scripts d97e32e9 & 9ce045b8 (preview DB only).
- 2026-06 Redesign stage 3: upload.tsx restyled; added inline error/success banners (Open script). File import untestable on web (expo-file-system). Test script 7721d6a3 in preview DB.
- 2026-06 Redesign stage 4: VoiceAssignment.tsx restyled (renderVoice, testIDs voice-preview-*, character-voice-row-*, voice-picker-close/modal); script/[id].tsx palette remap only. 450 pass / 5 pre-existing fails. Demo used __DEV__ dev-test-mode in web preview to pass premium gate.
- 2026-06 Redesign stage 5: rehearsal/[id].tsx restyle (palette, partner cyan/user violet cards, display-only voice chip rehearsal-voice-indicator, labelled Restart/Pause/Skip with testIDs, "Line X of N"). Rehearsal-related tests 628 pass/19 fail (base 627/20; diff = flaky sec002 route test).
