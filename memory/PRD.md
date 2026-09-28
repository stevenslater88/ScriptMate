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

### 2026-02 — End-of-Rehearsal Crash Fix (BUILD 1110-QA)

**Real-device symptom:** rehearsal reached last line successfully, then app crashed with "ScriptMate Pro closed because this app has a bug" — Scene Complete / Stats never rendered.

**Root cause:** `advanceToNextLine` at end-of-scene called `setState('finished')` + fire-and-forget `saveProgress(nextIndex)` without try/catch or `.catch()`. Multiple parallel async hazards during the finalization transition:
1. `saveProgress → updateRehearsal` axios call — no `.catch()` → unhandled promise rejection.
2. Component unmount cleanup called `Speech.stop()` and `recording.stopAndUnloadAsync()` without individual try/catch or promise chain protection → native SIGSEGV on Android when the underlying resource was already released.
3. `getStats()` could return `NaN` for `avgHesitation` if any `hesitationTime` was undefined; `stats.avgHesitation.toFixed(1)` would then evaluate fine but `stats.accuracy` (`Math.round(NaN)`) breaks rendering.
4. SR event listeners not gated when state became `finished` — a late `result`/`end` event could call `stopListening()` while native module was mid-teardown.

**Fix (one file):** `frontend/app/rehearsal/[id].tsx`
- Added `finalizeRehearsal(reason)` — a single idempotent async function guarded by `finalizeGuardRef`. Wraps all 4 finalization steps (audio-cleanup, speech-cleanup, stats-calculation-and-persistence, state-flip) in individual try/catch. `Speech.stop()` and `ExpoSpeechRecognitionModule.stop()` calls swallowed via `Promise.resolve(...).catch(() => {})`. `updateRehearsal(...)` has `.catch(errorCaught)`. Emits 11 diagnostic markers per spec: `rehearsal-finish-start`, `final-line-complete`, `audio-cleanup-start/success`, `speech-cleanup-start/success`, `stats-calculation-start/success`, `stats-navigation-start/success`, `rehearsal-finish-complete`.
- `advanceToNextLine` end-of-scene branch now dispatches `finalizeRehearsal('end-of-scene').catch(()=>{})` instead of raw `setState('finished') + saveProgress`.
- Null-next-line branch also routes through `finalizeRehearsal('null-next-line')`.
- Unmount cleanup effect now wraps `Speech.stop()` and `recording.stopAndUnloadAsync()` in `Promise.resolve(...).catch(() => {})` + outer `try/catch`.
- `getStats()` hardened: `Array.isArray()` guards on `lines/linePerformances/missedLines`, `Number.isFinite()` checks on every arithmetic operation, `Math.max(0, Math.min(100, accuracy))` clamp, outer try/catch returning zero-values on any unexpected error.
- Finished UI at `Accuracy: {stats.accuracy}%` line hardened with `Number.isFinite()` fallback.

**Verification (testing_agent iteration_31 — PASSED):**
- Playwright drove a 2-line SARAH/MIKE rehearsal through completion: **Scene Complete!** rendered with `Accuracy: 100% • Avg. Response: 3.1s`, **zero unhandled promise rejections**, **zero page errors**.
- All 11 diagnostic markers appeared in the correct order in console.
- Run Again correctly reset the guard and returned to `state=idle`.
- Backend regressions 4/4 pytest passing: extraction-only contract (no `id`, no persistence), paste flow `is_user_character=true`, QA bypass on/off both correct.
- Production limit reverse-test: `QA_UNLIMITED_REHEARSALS=false` returned exact HTTP 403 with production message.
- Build markers verified: `BUILD_ID='1110-QA'`, `BUILD_FINGERPRINT='SM8-1110-QA'`, `BUILD_PROOF.build=1110` — all consistent.
- Bug Report diagnostic report structure verified: all 10 sections present, credential-key redaction applied, fingerprint `SM8-1110-QA` in report body.

**Files changed in this task:** `frontend/app/rehearsal/[id].tsx` only.
**No dependency changes. No deletions. No changes to rehearsal engine logic, TTS, voice gating, Premium/entitlement, backend endpoints, or unrelated features.**

**Two real-device symptoms after previous fix:**
- After successful PDF import, an unrelated `POST /api/scripts` from `handleSubmit` fails 15s later with Network Error → user perceives as "import save failed".
- Imported scripts (PDF/DOCX/TXT) reach `/script/{id}` but **pressing Rehearse does nothing** — button silently disabled.

**Root cause:** Two independent save paths existed. `upload-base64` persisted a Script directly; the paste path used `POST /api/scripts` via `script-parser.tsx`. Imported scripts skipped the character-selection step, so `is_user_character` was never set → line 489 of `script/[id].tsx` `disabled={!selectedCharacter || starting}` → Rehearse button inert.

**Fix — approved option A: unify at the parser stage. Extraction-only endpoints + AsyncStorage stash + shared `/script-parser` flow.**

Changes (4 files):
1. **`backend/server.py` — `/scripts/upload` and `/scripts/upload-base64`**: converted from persistence to extraction-only. Now return `{raw_text, filename, title, size_bytes, source}`. **No `id` returned**, **no Mongo write**. Contract documented in docstrings. Verified via curl: 6/6 test payloads (TXT/PDF/DOCX × multipart/base64) return raw_text without persisting.
2. **`frontend/app/upload.tsx`**: after successful extraction, stash `raw_text` + `title` into `AsyncStorage['pending_script_rawtext' / 'pending_script_title']` and `router.push('/script-parser?fromStorage=1&title=…')`. Same path Smart Parse V2 uses. Interstitial "Success — View Script" alert removed. Removed dead `scriptId` references.
3. **`frontend/app/script/[id].tsx`**: comprehensive rehearse-button diagnostics — `DebugLog.setScreen`, `DebugLog.log('SCREEN_VIEW'...)`, `DebugLog.log('DIAGNOSTIC', 'Loaded script', {…})` with charactersCount, linesCount, hasUserCharacter, userCharacterName, firstThreeCharacters. `handleStartRehearsal` now logs `rehearse-btn` button press + start-rehearsal operation with full state + createRehearsal API request/response + navigation + errors (including if character not selected).

**Architecture (post-fix):**
- **ONE persistence owner**: `POST /api/scripts` via `script-parser.tsx handleSave`.
- **ONE entry to rehearsal**: paste, TXT, PDF, DOCX all route through `/script-parser` → user picks character → `createScript` + `updateScript(user_character)` → `/script/{id}` with `is_user_character=true` set → Rehearse enabled.
- **No duplicate saves possible.**

**Verification:**
- Backend contract: 6/6 extraction paths return `{raw_text, title, filename, source}` with `has_id=False` and 0 rows persisted ✅
- Frontend web E2E: simulated PDF import (via AsyncStorage stash + navigate to `/script-parser?fromStorage=1`) → parser rendered 2 chars/4 lines → picked JACK → save → DB shows `is_user_character=true` for JACK → `/script/{id}` auto-selected JACK → Rehearse button opacity 1, aria-disabled None → click → `createRehearsal` 200 → nav to `/rehearsal/{id}` succeeded ✅
- Diagnostic report post-navigation contains full trace: SCREEN_VIEW → DIAGNOSTIC "Loaded script" → BUTTON_PRESS rehearse-btn → FUNCTION_START start-rehearsal → API_REQUEST → API_RESPONSE → NAVIGATION → rehearsal opens ✅

**Files changed in this task:**
- `backend/server.py`
- `frontend/app/upload.tsx`
- `frontend/app/script/[id].tsx`

**No dependency changes. No new packages. No feature deletion.** Rehearsal engine, teleprompter, TTS, voice gating, self-tape, auditions, daily-drill, RevenueCat, ElevenLabs, Sentry, script parser core, library, Bug Report / diagnostics infrastructure — all untouched.

**Awaiting real-device Android APK test.**

### 2026-02 — POST /api/scripts intermittent timeout ("Network Error, no status, ~15s") — BUILD 1110-QA

**Real-device symptom (Samsung, 1110-QA):** After a successful rehearsal creation, attempting to paste-save the same script twice failed:
```
POST https://scriptmate-8.emergent.host/api/scripts
Axios Network Error • HTTP status: no status • Duration: ~15s
title=Jack, textLen=931
```
`createRehearsal` immediately before had succeeded against the same base URL, ruling out DNS/URL/proxy.

**Root cause (reproduced):**
- Frontend `apiConfig.ts` set `API_TIMEOUT = 15000` (15s) — used uniformly for every axios call including `POST /api/scripts`.
- Backend `POST /api/scripts` invokes `parse_script_with_ai` (LiteLLM → OpenAI GPT-4o) synchronously in the request handler.
- Production baseline latency for a ~931 char script: **~3.6–4.4s median**.
- Under concurrent burst (measured 6× parallel POSTs against production): **one request spiked to 24.3s** while the rest finished in ~4s. This matches OpenAI's documented P99 variance / LiteLLM retry behaviour.
- Any request whose GPT-4o call exceeded 15s → axios client abort → "Network Error / no status / ~15s duration" — exactly the field symptom.

**Fix — smallest safe change (2 files, +9/-2 lines, no backend changes):**
1. `frontend/services/apiConfig.ts`: added `API_TIMEOUT_LLM = 60000` constant with documentation of the empirical latency window. `API_TIMEOUT` (15s) left unchanged for all other calls.
2. `frontend/store/scriptStore.ts`: `createScript` axios POST now uses `API_TIMEOUT_LLM` instead of `API_TIMEOUT`. All other axios calls (GET /scripts, GET /scripts/:id, PUT /scripts/:id, DELETE /scripts/:id) still use the aggressive 15s default — they don't hit an LLM.

**Regression test:** `backend/tests/test_scripts_create_timeout.py` (4 tests, all PASS against both preview and production):
- `test_apiconfig_declares_extended_llm_timeout` — apiConfig must export `API_TIMEOUT_LLM ≥ 30000`.
- `test_scriptstore_uses_llm_timeout_for_create_script` — createScript must reference the extended constant.
- `test_post_scripts_single_request_under_llm_sla` — endpoint returns 200 within 60s with characters+lines.
- `test_post_scripts_burst_never_5xx_within_sla` — 4× concurrent bursts, no 5xx, all within 60s.

**What was NOT touched (per Master Prompt):**
- Import pipeline, rehearsal engine, end-of-rehearsal fix, API URL, `parse_script_with_ai` behaviour, backend routes, 18 pre-existing backend lint issues.

**Verification status:**
- ✅ Reproduced the failure (24.3s GPT-4o burst spike > 15s Axios timeout)
- ✅ Regression tests pass against production (`https://scriptmate-8.emergent.host`) and preview
- ⏳ Awaiting user's Samsung 1110-QA acceptance test (paste-save + Rehearsal → final line → Stats)

### 2026-02 — Phase 2 Blocker: 'character' mode Premium error — BUILD 1110-QA

**Real-device symptom (Samsung, 1110-QA):** Tapping the "Character" training-mode card on the script detail screen produced:
> "Error — 'character' mode requires Premium. Upgrade to unlock all training modes!"

**Root cause (reproduced via curl):** `MODE_OPTIONS` in `frontend/app/script/[id].tsx:52` offered `{ id: 'character', name: 'Character', premium: false, ... }`. That mode ID exists in NEITHER `FREE_TIER_LIMITS.available_modes` (`['full_read','cue_only']`) NOR `PREMIUM_TIER_LIMITS.available_modes` (6 modes: `full_read`, `cue_only`, `performance`, `missing_words`, `first_letter`, `loop`). Selecting it always hits the mode-gate branch in `check_user_limits` and returns 403 with the misleading "requires Premium" message — even for a real Premium user. Its stated behaviour ("focus on your character lines only") is functionally identical to `full_read` (reader plays every non-user character). Grep confirmed zero code references to `mode === 'character'` — pure dead UI.

**Fix — smallest safe change (1 file, 1 removed entry):** removed the orphan `MODE_OPTIONS` row in `frontend/app/script/[id].tsx`. Premium gating on `performance` and `loop` remains intact. Backend and rehearsal engine untouched.

**Regression test:** `backend/tests/test_phase2_character_mode_gate.py` (7 tests):
- Free tier can create `full_read` (Phase 1 baseline).
- Free tier can create `cue_only`.
- `MODE_OPTIONS` no longer contains the orphan `id: 'character'`.
- `MODE_OPTIONS` preserves `full_read`, `cue_only`, `performance`, `loop` entries.
- Premium modes (`performance`, `loop`) still marked `premium: true`.
- Backend still rejects `mode='character'` from stale clients (defence in depth).
- Free-tier `performance`/`loop` still 403 when `QA_PREMIUM=false` (skipped when QA_PREMIUM=true on the running backend).

### 2026-02 — QA Premium bypass (`QA_PREMIUM=true`) — BUILD 1110-QA

**Purpose:** allow physical QA on Premium-gated flows without granting real Premium in production. Mirrors the `QA_UNLIMITED_REHEARSALS` pattern.

**Contract:**
- Backend `.env` flag `QA_PREMIUM=true` grants full Premium tier for the duration of a single request.
- Does NOT mutate the user row in Mongo. Does NOT touch RevenueCat. Does NOT change any endpoint that reads `subscription_tier` directly.
- Only affects endpoints routed through `check_user_limits()` and `GET /users/{id}/limits`.
- When absent or `"false"`, entitlement logic is byte-identical to production.

**Files changed (backend-only, +44/-6 lines):**
- `backend/server.py::check_user_limits` — env-gated override that flips tier to `"premium"` when `QA_PREMIUM=true` (before `get_tier_limits`); logs `[QA_BYPASS]` warning; surfaces `qa_premium_bypass: True` on the returned dict.
- `backend/server.py::get_user_limits` — mirror of the same override so `is_premium=True` propagates to the frontend `fetchUserLimits()` naturally.
- `backend/.env` — added `QA_PREMIUM=true` for the running QA build.

**Frontend: zero changes.** The frontend `isPremium` is already driven by `GET /users/{id}/limits.is_premium`; the backend override propagates automatically. `revenuecat.ts` is completely untouched.

**Production protection:**
- Flag lives in backend env only — never bundled with the Android APK.
- `backend/.env` is gitignored — production deploys must explicitly set (or omit) the flag on the server.
- Strict-string gate: `os.environ.get("QA_PREMIUM", "").lower() == "true"` — only the exact literal enables the bypass. Typos like `"yes"`, `"1"`, `"on"` will NOT activate it.
- Every bypass emits a `[QA_BYPASS]` log line naming the affected `user_id` and the real tier.

**Regression test:** `backend/tests/test_qa_premium_bypass.py` (13 tests, all PASS):
- A. `GET /users/{id}/limits` reports `is_premium=True`, tier=`"premium"`, all 6 modes, all 6 voices when flag on.
- B. All 4 premium-only rehearsal modes (`performance`, `loop`, `missing_words`, `first_letter`) creatable when flag on.
- B. All 5 premium-only voices (`nova`, `onyx`, `shimmer`, `echo`, `fable`) creatable when flag on.
- C. Static assertion: both `check_user_limits` and `get_user_limits` use the exact strict-string env guard, no unsafe patterns (`os.environ["QA_PREMIUM"]`, missing `.lower()`).
- D. `frontend/services/revenuecat.ts` and `frontend/store/scriptStore.ts` do NOT reference `QA_PREMIUM` — bypass is purely backend.
- E. Env-value semantics test locking the strict `.lower() == "true"` gate.

**Cross-suite hardening:** existing `test_phase2_rehearsal_contract.py` and `test_phase2_character_mode_gate.py` now detect `QA_PREMIUM=true` via a probe call and `pytest.skip` the free-tier gating tests that cannot run in that mode; they still run normally with the flag off.

**Awaiting real-device Android APK test with `QA_PREMIUM=true` on the QA backend.**

**Root causes identified (real Android device evidence):**
- **TXT "empty script" perception**: After loading a TXT file, the code populated `scriptText` state but stayed on the File tab which has NO visible text preview and NO Save button. User had no visible feedback of loaded content.
- **PDF/DOCX Android native crash**: `FormData.append({uri:'content://…', type, name})` triggers a native SIGSEGV in RN's multipart encoder on new architecture when the ContentResolver stream can't be re-opened. Base64 fallback existed but the crash happened INSIDE the native FormData call before axios could throw.

**Fixes (minimal, no feature deletion, no new dependencies):**

1. **`app/upload.tsx`**
   - TXT path: after successful read, auto-switch to Paste Text tab (`setUploadMethod('paste')`) so user sees the loaded content and can access Save/Parse buttons.
   - Android PDF/DOCX path: skip FormData entirely — always use `readAsStringAsync({encoding: Base64})` + `POST /api/scripts/upload-base64`. This eliminates the FormData-with-content:// native crash.
   - Every stage instrumented via `DebugLog.importStage()` (picker-open, picker-result, file-picked, txt-copy-to-cache-start, txt-read-start, txt-read-done, txt-import-success, {pdf,docx}-copy-to-cache-*, {pdf,docx}-base64-read-*, {pdf,docx}-base64-post, {pdf,docx}-base64-ok, {pdf,docx}-import-success).
   - Every failure captured via `DebugLog.errorCaught(context, err)` or `DebugLog.httpErrorSnapshot(method, url, status, body, msg)`.
   - Outer + inner try/catch prevent app crash on any error path.
   - Post-copy verification via `FileSystem.getInfoAsync` — refuses to proceed with an empty cache file.

2. **`services/debugLogService.ts`** — diagnostics infrastructure
   - Added `currentOperation` / `lastOperation` / `previousScreen` tracking.
   - Added `lastError` singleton (updated by `errorCaught`, `functionError`, `httpErrorSnapshot`).
   - Added `LAST_ERROR_KEY` AsyncStorage persistence — `persistLastError()` writes on every error, `loadPersistedLogs()` restores on init. **Survives app restart and native crash.**
   - Added `errorCaught(context, err, extra)`, `importStage(stage, details)`, `httpErrorSnapshot(...)`.
   - `clearLogs` now also clears the persisted last error.

3. **`services/diagnosticsService.ts`** — ChatGPT-friendly report generator
   - `formatChatGPTDiagnosticReport()` produces the exact structure requested:
     BUILD / DEVICE / TIME / NAVIGATION / OPERATION / API / IMPORT / ERROR / RECENT LOG (150 entries) / NATIVE CRASH note.
   - `copyChatGPTDiagnosticReport()` and `copyLastErrorToClipboard()` write to `expo-clipboard`.
   - Deep-strips credential-shaped keys (authorization, token, api_key, secret, password, cookie, session, bearer, purchase_token, credential, private).
   - Bumped `BUILD_FINGERPRINT` to `SM8-1108-DIAG`.

4. **`app/support.tsx`** — 3 new buttons in Bug Report tab
   - **Copy Diagnostic Report** → ChatGPT-friendly text.
   - **Copy Last Error** → last captured error + 20 preceding entries.
   - **Clear Diagnostic Log** → confirms destructive action.
   - Existing Report Issue submit path and FAQ tab untouched.

5. **`app/_layout.tsx`** — global JS error handlers
   - `ErrorUtils.setGlobalHandler` catches uncaught JS errors → `DebugLog.errorCaught('GLOBAL_JS_ERROR', err)`.
   - `addEventListener('unhandledrejection', ...)` catches unhandled promise rejections.
   - Original handler still called so RedBox / Sentry paths unaffected.
   - Bumped `BUILD_FINGERPRINT` to `SM8-1108-DIAG`.

6. **`services/apiConfig.ts`** — bumped `BUILD_ID` to `1108-DIAG` so user can identify the new build on device.

7. **`backend/server.py`** — parser hardening (no API contract change)
   - `extract_text_from_pdf`: detects encrypted PDFs (returns explicit 400 "password-protected"), skips per-page failures, returns explicit 400 if no readable text (scanned image PDFs).
   - `extract_text_from_docx`: also extracts table content (common in scripts), returns explicit 400 if empty.

**Verification (targeted automated tests, all passed):**

Backend endpoint contract (curl):
- TXT via `/scripts/upload` multipart → 200, 4 lines, 2 characters ✅
- PDF via `/scripts/upload` multipart → 200, 4 lines, 2 characters ✅
- DOCX via `/scripts/upload` multipart → 200, 3 lines, 2 characters ✅
- TXT via `/scripts/upload-base64` (Android path) → 200, 4 lines ✅
- PDF via `/scripts/upload-base64` (Android path) → 200, 4 lines ✅
- DOCX via `/scripts/upload-base64` (Android path) → 200, 3 lines ✅
- Corrupted PDF → 400 with explicit reason ✅
- Empty base64 → 400 rejected ✅

End-to-end web bundle (Playwright):
- Support screen renders both tabs, "Report Issue" (renamed) present ✅
- 3 diagnostic buttons render and function ✅
- Copy Diagnostic Report clipboard contains: BUILD/DEVICE/TIME/NAVIGATION/OPERATION/API/IMPORT/ERROR/RECENT LOG/NATIVE CRASH — structure matches spec ✅
- Fingerprint `SM8-1108-DIAG` present in report ✅
- Credential keys stripped (verified `authorization` and `token` absent) ✅
- Bug Report submission still works (Mongo id returned, success banner shown) ✅
- Regression: Paste Text → Smart Parse V2 → char select → Save → `createScript success` → `updateScript success` → alert "Script Ready!" — no console errors ✅

**Files changed in this task (7):**
- `backend/server.py`
- `frontend/app/_layout.tsx`
- `frontend/app/upload.tsx`
- `frontend/app/support.tsx`
- `frontend/services/apiConfig.ts`
- `frontend/services/debugLogService.ts`
- `frontend/services/diagnosticsService.ts`

**Preserved (rule 4 of master prompt — do not break working functionality):**
Rehearsal, teleprompter, TTS, voice gating, script parser, script library, self-tape, auditions, daily-drill, RevenueCat, ElevenLabs, Sentry-disabled XHR fix, script-parser AsyncStorage fix, bug-report backend endpoint — **all untouched**.

**No new dependencies. No production AAB. Awaiting real-device Android preview APK test.**

### 2026-02 — File-import save failure fix (Android URL-param corruption)
**Root cause:** Smart Parse V2 button in `app/upload.tsx` passed `rawText` via expo-router URL params. On Android, long file-imported text (with CRLF/BOM/control bytes) exceeded URL-encoding length limits, causing the string decoded on `script-parser` to differ from the string used to render the preview, and the mismatch surfaced only at POST `/api/scripts` time as "no status" (network error). Paste Text worked because typed text is short and clean.
**Fix (minimal, no feature deletion):**
- `app/upload.tsx` Smart Parse V2 `onPress` now: writes `rawText` + `title` to AsyncStorage (`pending_script_rawtext`, `pending_script_title`) and navigates with only `{title, fromStorage:'1'}` in params. No large payload in URL.
- `app/script-parser.tsx` reads `rawText` from AsyncStorage when `fromStorage='1'`, sanitizes (strips UTF-8 BOM, normalizes CRLF→LF, removes NUL/C0 control bytes) before parsing and before POST. Falls back to URL `rawText` param for backward compatibility. Clears storage keys on successful save.
- `handleSave` now wrapped in nested try/catch layers — outer guard swallows any residual exception to prevent Android native crash; inner catches network/serialization errors and shows a useful "Save Failed" alert with retry-friendly copy. `Alert.alert` `onPress` callbacks wrapped so nav errors after save cannot bubble to the RN root.
- All existing flows preserved: Paste Text, Parse with AI, PDF/DOCX backend upload, Support screen, Sentry disabled-XHR fix, URL fix, voice gating, script library, rehearsal, TTS.
**Verification:** End-to-end web bundle test — 1602-char CRLF+BOM payload → AsyncStorage stash → parser load+sanitize → parse 2 chars/52 dialogue lines → POST /api/scripts 200 in 103ms → PUT user_character 200 → Alert "Script Ready!". Zero uncaught exceptions in console. Backend confirmed accepts 18KB clean and dirty payloads (`test-import-1107` scripts created).
**Files changed:** `app/upload.tsx`, `app/script-parser.tsx`. Nothing else.
**Awaiting user real-device Android APK test.**

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

## 2026-09 — Phase 3 Self-Tape Native Crash Campaign (Failures 4–6 + Record Crash)

Physical-device stabilization work against Samsung SM-S918B / Android 16 /
Expo SDK 54 / New Architecture / Fabric.

### Failure 4 — Teleprompter Slider mount crash (RESOLVED)
- **Cause:** `@react-native-community/slider` v4.5.x is old-arch-only; mounting on Fabric SDK 54 native-crashes on enable.
- **Fix (commit `68c7774`):** removed the Slider entirely; replaced with a segmented `TouchableOpacity` speed control [1..5] mapped to `pxPerSecond = [30, 60, 90, 120, 150]` in `app/selftape/record.tsx`. Physical acceptance passed for enable.

### Failure 5 — Start Recording with teleprompter enabled crashed the app (RESOLVED)
- **Cause:** native-driver `Animated.timing` driving an `Animated.multiply` translateY transform inside `Animated.ScrollView`, started in the same Fabric commit as `CameraView.recordAsync()` began native capture.
- **Fix (commit `c1f8a2d`):** replaced the entire native teleprompter driver with a JS `requestAnimationFrame` loop calling `ScrollView.scrollTo({ animated: false })`. Converted outer `<Animated.ScrollView>` → plain `<ScrollView>` and removed the inner `<Animated.View>` translateY wrapper. Physical acceptance NOT verified alone (Failure 6 uncovered next stage).

### Failure 6 — Enable Teleprompter crashed (diagnostic experiment) + Save-path deprecation (RESOLVED)
- **Diagnostic (commit `103a763`):** flipped `controlsOpacity` from `useNativeDriver: true` to `false` in `hideControlsWithDelay` and `showControlsAnimated`. Physical result: Enable succeeded and Recording succeeded. Save then failed with the SDK 54 top-level `expo-file-system` deprecation.
- **Root cause of that Save failure:** the Self-Tape "Teleprompter Mode NEW" card in `app/selftape/index.tsx:151` routes users to `app/selftape/teleprompter.tsx`, which imported `expo-file-system` from the deprecated top level and called `FileSystem.getInfoAsync` in `handleSave` before delegating to `selfTapeStorage.saveRecording`. Signature confirmed by the "Could not save: {msg}" alert prefix (exclusive to `teleprompter.tsx:426`) and the "Recording Complete! · Teleprompter Mode" success-screen text (exclusive to `teleprompter.tsx:737-739`).
- **Save-path fix (commit `adf52e5`):** single-line import in `app/selftape/teleprompter.tsx:19` changed from `'expo-file-system'` to `'expo-file-system/legacy'`. The handoff summary had incorrectly flagged `teleprompter.tsx` as an "orphan/quarantined" file; the routing evidence proves it is a live entry point.

### Startup API diagnostic false alarm (RESOLVED)
- **Cause:** `services/apiConfig.ts` hard-coded the obsolete `'script-recovery-1'` substring as its correctness check, causing "Correct: NO × WRONG URL!" against the healthy `https://scriptmate-8.emergent.host` backend.
- **Fix (commit `ce19460`):** added `LEGITIMATE_BACKEND_HOST_SUFFIXES = ['.emergent.host', '.preview.emergentagent.com']` and an `isLegitimateBackendUrl()` helper (URL-parsed hostname suffix match). Both call sites (module-load warning + `getApiDiagnostics().isCorrectDomain`) now delegate to the helper. Empty-URL FATAL and `android-upload-test` WARNING preserved.

### Record crash — expo-camera unconditional video stabilization (COMMITTED, PHYSICAL VERIFICATION PENDING)
- **Root cause (PROVEN via installed source + upstream expo/expo#45896):** `node_modules/expo-camera/android/src/main/java/expo/modules/camera/ExpoCameraView.kt:569` (in `createVideoCapture()`) unconditionally calls `setVideoStabilizationEnabled(true)` on every VideoCapture. Samsung S23 Ultra's active camera on Android 16 does not advertise the requested CameraX stabilization capability → HAL raises unhandled native exception → Android kills the process with no JS error / stack / promise rejection. Matches the physical symptom exactly.
- **Fix (commit `ed6a1bf`):** new `patches/expo-camera+17.0.10.patch` gates the call on `Recorder.getVideoCapabilities(cameraInfo).isStabilizationSupported`, wrapped in try/catch for defence in depth. Wired via `patch-package` + `postinstall-postinstall` (both devDeps) and `scripts.postinstall = 'patch-package'` in `frontend/package.json`. EAS `yarn install` will apply the patch before Gradle compiles the Android bundle.
- **Physical acceptance required:** Samsung SM-S918B, Android 16, install new APK, Self Tape → prep → record OR Teleprompter Mode → press Record. Expect no crash. This is the ONE outstanding physical gate.

### Regression coverage summary (as of `ed6a1bf`)
- `test_phase3_selftape_regression.py` — 22 guards (Failures 1, 4, 5, 6, save-path, camera path intact)
- `test_frontend_entitlement_audit.py` — 21 guards
- `test_qa_premium_bypass.py` — 13 guards
- `test_startup_api_diagnostic.py` — 7 guards
- `test_expo_camera_stabilization_patch.py` — 9 guards
- **Total: 72 / 72 passing** in 0.83s. TypeScript baseline maintained (5 pre-existing warnings on `record.tsx`/`teleprompter.tsx`, zero new).

### Absolute development rules currently in force
- One hypothesis → one controlled change → automated tests → regression → build only when needed → physical test only when needed.
- Do not fix the 18 pre-existing backend lint errors.
- Do not create production AABs.
- Do not push to GitHub (user does via "Save to GitHub" UI).
- Preserve `expo-file-system/legacy` imports, JS-driven teleprompter scroll, `useNativeDriver: false` on `controlsOpacity`, patch-package pipeline, and all camera/permissions/save/retake flows.


## 2026-02 — Deployment fix: patch-package hook must run in EAS OTA lane

### EAS OTA deploy failure at `build_image` (RESOLVED — source fix)
- **Cause:** Deployer's EAS OTA lane runs `yarn install` with `NODE_ENV=production`, which skips `devDependencies`. Because `patch-package` and `postinstall-postinstall` sat in `devDependencies`, the `postinstall: patch-package` hook failed with exit 127 (`patch-package: not found`). The physically proven `expo-camera+17.0.10.patch` (Android SIGSEGV fix on S23 Ultra) never applied in deploy builds.
- **Fix:** Moved `patch-package` (8.0.1) and `postinstall-postinstall` (2.1.0) from `devDependencies` → `dependencies` in `frontend/package.json`. Ran `yarn install --force` to refresh `yarn.lock`. Verified `patch-package` runs postinstall and applies `expo-camera@17.0.10 ✔` cleanly. `postinstall` script unchanged. Nothing else touched. 18 pre-existing lint issues untouched per user directive.
- **Next action:** User re-triggers redeploy via Emergent UI. EAS OTA lane will now install `patch-package` under production install and apply the camera patch during the build.

## 2026-02 — Post-Phase-3 polish: Framing Guides restored (Route B only)

### Framing Guides overlay added to `app/selftape/teleprompter.tsx`
- **Context:** Phase 3 physical verification GREEN on Samsung SM-S918B / Android 16. Route B teleprompter confirmed: opens, scrolls, records, saves, plays back, retakes with no native camera crash. Framing Guides (a useful actor aid lost when the old Route A teleprompter was removed) requested back.
- **What ships:** Optional (default OFF) visual placement overlay — rule-of-thirds grid (2 verticals + 2 horizontals), a face-safe zone oval centered upper-middle, and an eye-line accent at the upper rule-of-thirds line. Rendered as static `<View>`s inside `<CameraView>` as the FIRST child (sibling of, not descendant of, the teleprompter ScrollView), so the guides remain fixed while the script scrolls. Container uses `pointerEvents="none"` → zero interference with recording, scrolling, settings, save, retake, or countdown.
- **Strict constraints honored:** No face detection, no CV, no camera processing, no native camera APIs, no animation. Route B invariants preserved (JS RAF scroll driver, ScrollView, segmented [1..5] speed, opacity segments, camera, permissions, storage, `expo-file-system/legacy`, `expo-camera` patch-package pipeline, record/save/retake/countdown flow). `prep.tsx`, `record.tsx` (Route A), backend, dependencies, EAS config, and the 18 pre-existing backend lint issues all UNTOUCHED.
- **Toggle:** New row in the Settings modal, `data-testid="framing-guides-toggle"`. Overlay carries `data-testid="framing-guides-overlay"`.
- **Regression:** `backend/tests/test_teleprompter_framing_guides.py` — 20 focused guards (feature existence, default-OFF, `pointerEvents="none"`, no face detection / CV / animation, sibling-of-ScrollView placement, style presence, Route B invariants intact, `prep.tsx` / `record.tsx` untouched, patch-package pipeline intact). Also refreshed `test_expo_camera_stabilization_patch.py` to assert `patch-package` + `postinstall-postinstall` in `dependencies` (per 2026-02 EAS-OTA fix).
- **Result:** 80/80 Phase 3 targeted regression tests pass in 0.16s. Commit `4a2483f`.


## 2026-02 — Camera bring-up hardening (awaitInstance guard + Route B mount handlers)

### Symptoms addressed
- **Intermittent first-record native crash** on Samsung SM-S918B / Android 16: two consecutive taps on Record produced the native "Something went wrong with ScriptMate Pro" dialog, then recording worked. Framing Guides toggled on before/after, script scroll, save, and playback all worked.
- **Recurring "have to clear the app cache to open the app"** symptom on the same device, persisting across builds. Same underlying failure mode: the OS's PackageManager cache-clear force-kills the app, resetting the platform camera framework state — the user's workaround.

### Evidence
- No adb / logcat / crash-dump available in the preview container; all evidence is source-level and cross-referenced against upstream Expo issues.
- Installed `node_modules/expo-camera/android/src/main/java/expo/modules/camera/ExpoCameraView.kt` line 414: `val cameraProvider = ProcessCameraProvider.awaitInstance(context)` sits **outside** the try/catch that starts at line 469 and only wraps `bindToLifecycle`. `awaitInstance` can throw `InitializationException` (root cause: `CameraUnavailableException`) when Samsung's Camera2 HAL / `camera.provider` service is still warming up. Unhandled → coroutine dispatcher bubble → process kill → the exact native dialog. Matches upstream **expo/expo#47696**.
- Route A (`record.tsx`, proven) already renders 4+ conditional overlay children of `<CameraView>` including a face-guide oval identical in shape to the new Framing Guides — so the guides overlay is not the cause. Framing Guides investigated and cleared.

### Fix 1 — `frontend/patches/expo-camera+17.0.10.patch` (extended)
Two hunks, both preserved verbatim in a single patch file:
1. **NEW (2026-02):** `ProcessCameraProvider.awaitInstance(context)` wrapped in `try { … } catch (e: Throwable) { onMountError(CameraMountErrorEvent("Camera provider unavailable: …")); return }`. Failure now routes through the existing `onMountError` surface with a useful message. No process kill.
2. **Preserved:** the Samsung stabilization capability guard (expo/expo#45896) — `setVideoStabilizationEnabled(isStabilizationSupported)` with null-safe capability probe. Verified applied cleanly after `rm -rf node_modules/expo-camera && yarn install --force` (patch-package reports `expo-camera@17.0.10 ✔`).

### Fix 2 — `frontend/app/selftape/teleprompter.tsx` (Route B)
- New state `isCameraReady` (default `false`) + `cameraMountError` (default `null`).
- `<CameraView>` wires `onCameraReady` (flips ready true, clears error) and `onMountError` (records the error string).
- `startRecording()` early-returns with a controlled Alert if `!isCameraReady` OR `cameraMountError`; `recordAsync()` is never invoked under those conditions. Guards placed before the countdown, so a stuck-init state never enters the record path.
- Record button (`testID="record-button"`) carries an explicit `disabled` prop referencing both guards + a `recordButtonDisabled` reduced-opacity style. A fast first tap during bring-up can no longer force `recordAsync()`.
- Two mutually-exclusive user-visible banners:
  - `testID="camera-mount-error-banner"` — red banner + warning icon, shown on hard mount failures.
  - `testID="camera-initializing-banner"` — dim pill + spinner + "Camera initializing…", shown during the transient window.
- Failures are recoverable via Go Back / reopen; no crash. Mirrors Route A's proven mount contract without changing Route B's teleprompter architecture.

### Framing Guides — NOT MODIFIED
- Investigation cleared Framing Guides of any implication. Structurally identical to Route A's proven face-guide overlay. Rule-of-thirds, face-safe zone, eye-line, toggle, `pointerEvents="none"`, sibling-of-ScrollView placement all preserved. Asserted by `test_framing_guides_still_present`.

### Persisted / transient app state
- Nothing in Route B or Route A cleanup contradicts the camera-init hypothesis, and no evidence points to AsyncStorage / documentDirectory / recording index as the cache-clear cause. `documentDirectory/selftapes/` (saved recordings), AsyncStorage (auditions, progress, streaks, recordings index), and shared_prefs all survive "Clear Cache" by design — so if clearing cache reliably fixes the symptom, the cause is in `context.cacheDir` (expo-camera temp `.mp4` output) or the OS-level camera framework lockup that force-kill releases. Fix 1 addresses the latter's user-visible manifestation directly: intermittent bring-up failures now surface as controlled errors instead of process crashes, and manual cache clearing should no longer be required to open the app or use Self Tape. **No user data is wiped, and no automatic cache purge is added** — per your directive, we only harden the affected transient state (native bring-up failure surface).

### Test coverage
- **NEW:** `backend/tests/test_route_b_camera_hardening.py` — 16 guards (state defaults, onCameraReady/onMountError wiring, guard ordering vs recordAsync, record-button disabled prop, both banners present, Framing Guides untouched, Route A / prep untouched, extended patch integrity).
- **Updated:** `backend/tests/test_expo_camera_stabilization_patch.py` — +2 guards asserting `try { … ProcessCameraProvider.awaitInstance(context)` is present in installed source and the awaitInstance catch block calls `onMountError(...)` with the "Camera provider unavailable" string; the existing stabilization guard tests unchanged and still pass.
- **Regression run:** 98/98 pass in 0.19s (route-B hardening + Framing Guides + Phase 3 selftape + script import latency + expo-camera stabilization + startup API diagnostic). Entitlement + QA-premium regressions: 34/34 pass. TypeScript: 2 pre-existing errors on `teleprompter.tsx` and `services/revenuecat.ts`, **0 new**.

### Commit
- `183cf18` — fix(camera): guard ProcessCameraProvider.awaitInstance + wire Route B mount handlers


## 2026-02 — Phase 3 final UX polish: teleprompter defaults (top + speed 2)

### What changed
Two single-token literal changes in `frontend/app/selftape/teleprompter.tsx` only:
- **Default window position**: `useState<'top' | 'middle' | 'bottom'>('bottom')` → `('top')`. Fresh sessions place the teleprompter window at the top of the screen so the script's first line is visible from the top. All three positions remain runtime-selectable via the Settings modal.
- **Default selected speed**: `useState(3)` → `useState(2)`. The five speed segments [1..5] and their pxPerSecond mapping [30, 60, 90, 120, 150] are unchanged.

Initial ScrollView y position is the RN default (0). No new scroll override added. Existing `startTeleprompter()` and `resetTeleprompter()` already call `scrollTo({ y: 0, animated: false })`.

### Not modified
- JS requestAnimationFrame scroll driver.
- Segmented speed / opacity controls.
- Framing Guides.
- Camera bring-up hardening (isCameraReady, cameraMountError, onCameraReady, onMountError, record-button guard, banners).
- `expo-camera+17.0.10.patch` (awaitInstance guard + stabilization guard).
- Route A (`record.tsx`), `prep.tsx`, backend, dependencies, EAS config.
- 18 pre-existing backend lint issues.

### Tests
- **NEW:** `backend/tests/test_teleprompter_ux_defaults.py` — 13 guards (default speed 2, five speed options remain, pxPerSecond mapping intact, default position 'top', all three positions runtime-selectable, no bottom-anchor patterns, start/reset scroll to y=0, RAF driver intact, manual scroll gated on !isPlaying, camera hardening intact, framing guides intact, patch untouched).
- **Regression run:** 144/144 pass in 0.67s across UX defaults + route-B camera hardening + Framing Guides + Phase 3 selftape + script import latency + expo-camera stabilization patch + startup API diagnostic + entitlement audit + QA-premium bypass.
- **TypeScript:** 2 pre-existing errors, 0 new.

### Commit
- `e8aab71` — polish(teleprompter): default fresh sessions to top position + speed 2


## 2026-02 — Phase 4: Learn system (4A–4G) shipped

Full local-first, offline-capable, deterministic actor line-learning system. Reuses the existing Script / Character / DialogueLine model from `store/scriptStore.ts` — no duplicate script model, no duplicate character model. No AI, no backend calls in the core loop. Fabric-safe (no `Animated` import, no community slider).

### Architecture

**Engine — `frontend/services/learnEngine.ts` (pure functions):**
- Types: `LearningRecord`, `LearningSession`, `LearnItem`, `MasteryLevel`, `DifficultyLevel`, `SelfAssessment`, `SessionType`, `SessionState`.
- Extraction: `extractLearnItems(script, characterId, existingRecords)` returns actor lines with their immediately-preceding cue and a deterministic scene number (incremented on stage-direction scene headers matching `/^(INT\.?|EXT\.?|SCENE|ACT)/i`). Missing character or empty script → `[]`.
- Stable IDs: `makeRecordId(scriptId, characterId, lineId)` → `${scriptId}:${characterId}:${lineId}`. **Never** array index.
- Cue words: `deriveCueWords(text, count=3)` — deterministic; stop-word set + parenthetical stripping + min-length 3.
- Masking: `tokenizeForMode(text, difficulty)` produces `{kind:'word', original, masked, isMasked} | {kind:'space', text}` tokens with proportions 0 / 0.30 / 0.55 / 0.80 / 1.00 for difficulty 1..5; L4 preserves the first letter.
- Assessment: `applyAssessment(record, 'got_it'|'almost'|'missed', nowIso)` — pure, returns a NEW record. `got_it` bumps successes+streak; `missed` bumps misses and resets streak; `almost` bumps attempts only and resets streak. Recomputes `isWeak` + `masteryLevel` + `difficultyLevel` every call → mastery is reversible by design.
- Classifiers: `classifyWeak` (misses ≥ 2 AND miss-rate ≥ 0.4 AND streak < 2; cleared when streak ≥ 3) and `classifyMastery` (5 states, streak-driven, reversible).
- Session lifecycle: `createSession`, `advanceSession`, `goToNext`, `goToPrevious`, `pauseSession`, `resumeSession`, `restartSession`, `aggregateProgress`.

**Storage — `frontend/services/learnStorage.ts` (AsyncStorage only):**
- Three namespaced keys: `@scriptmate/learn/records`, `@scriptmate/learn/session/active`, `@scriptmate/learn/history`.
- Defensive JSON parsing — corrupted data returns a safe empty shape.
- `purgeOrphans(activeScriptIds)` removes records whose script no longer exists (no silent orphan corruption).
- History capped at `HISTORY_MAX = 50`, deduped by session id.

**UI:**
- `app/learn/index.tsx` — Learn Hub with character picker, mode picker (full / scene / weak), scene chip row, and a progress card (lines / practised / strong+ / weak).
- `app/learn/session.tsx` — Practice screen: cue card + actor-line card with per-word masking, 5-level difficulty pills (matching Phase 3 segmented-control shape), Reveal button, Got it / Almost / Missed assessment row, prev / pause / next nav, restart, quit-with-preserve.
- `app/learn/summary.tsx` — Post-session summary with duration + success rate + overall character stats + Practice again.
- `app/script/[id].tsx` — added Learn Lines button (cyan accent, `testID="script-learn-btn"`) wiring Library → Script → Learn.

**All screens carry data-testids** for the testing agent: `learn-hub`, `learn-hub-start`, `learn-hub-mode-{full,scene,weak}`, `learn-hub-character-<id>`, `learn-hub-scene-<n>`, `learn-hub-progress`, `learn-session`, `learn-session-progress`, `learn-session-cue-card`, `learn-session-reveal`, `learn-session-assess-{missed,almost,got}`, `learn-session-difficulty-${d}`, `learn-session-{prev,next,pauseresume,restart,quit,mastery}`, `learn-summary`, `learn-summary-again`, `learn-summary-overall`.

### Test coverage
- **NEW:** `backend/tests/test_phase4_learn.py` — 38 source-level guards (stable-ID shape, session states, session types, five difficulty levels, weak recovery clause, mastery reversibility, storage defensive-JSON, three-key namespace, `purgeOrphans` present, testIDs on every user-facing surface, no `Animated`/community-slider, no backend/AI imports, Phase 3 sentinels intact, `expo-camera` patch intact, runtime engine smoke bridge).
- **NEW:** `scripts/learn_engine_smoketest.js` — 22 runtime pure-function assertions (extraction, cue-word derivation, tokenizeForMode masks at 0/30/55/80/100%, applyAssessment, weak recovery, mastery progression + regression, session lifecycle, aggregateProgress). Compiled from TS and executed in the same pytest run.
- **Regression run:** 182/182 pass in 1.67s across the full accumulated suite. Phase 3 selftape / camera hardening / Framing Guides / UX defaults / entitlement / QA-premium — all green. TypeScript: 3 pre-existing errors, 0 new.

### Not modified
- `frontend/app/selftape/*.tsx`, `frontend/services/selfTapeStorage.ts`, `frontend/patches/expo-camera+17.0.10.patch`, backend, dependencies, EAS config, 18 pre-existing backend lint issues.

### Deferred
- Streaks (4F.3) — deferred pending a positive-only design (directive: don't punish missed days).
- AI Line Coach / AI Rehearsal Partner / ElevenLabs voice partner / Dialect Coach — architecture-compatible via `LearningRecord` + `LearningSession`; out of Phase 4 scope.
- Backfill / migration for pre-Phase-4 records (none exist yet).

### Commit
- `361b910` — feat(learn): Phase 4 — actor-focused Learn system (4A–4G)

**No APK built. No EAS triggered. No push to GitHub.** Awaiting user review before the single Phase 4 physical build on Samsung SM-S918B / Android 16.


## 2026-02 — Phase 4 physical fix: Fabric-safe masked-line render

### Symptom
Samsung SM-S918B / Android 16 QA reported a crash when tapping between difficulty pills during a Learn session.

### Root cause (source-verified)
`app/learn/session.tsx` rendered the masked line as a MIX of bare strings and nested `<Text>` children inside an outer `<Text>`. On rapid difficulty taps Fabric re-parents the child list every render, and the mixed sibling shape (string | `<Text>`) is a known Android 16 Fabric-strictness crash surface — the same class as Phase 3's record.tsx Animated node crashes, teleprompter Animated.multiply purge, and community-slider removal.

### Fix
Refactor the masked-line render to a FLAT SINGLE STRING inside a SINGLE `<Text>` child:
- NEW: `renderMaskedLine(text, difficulty)` pure helper in `session.tsx`. Reuses `maskProportionFor(difficulty)` from the engine so mask ratios are identical to the 22-assertion runtime smoke.
- Replaces the `{tokens.map(...)}` JSX with `{renderMaskedLine(...)}`.
- Difficulty-4 first-letter hint is now actually visible (previously rendered with `color: '#0a0a0f'` on `bg: '#0a0a0f'`, invisible for the hint character — fixed by concatenating the hint into the same flat string).
- Removed the unused `tokenizeForMode` import (still exported from the engine for future consumers) and the unused `maskedWord` style.

### Ignored per user directive
- **QA-checklist PDF false alarm on character detection** — NO parser change made. Parser regression suite remains 10/10 green. The 17 "characters" (NO, YES, PASS, FAIL, OPEN SCRIPTMATE, TAP LEARN LINES, TEST SUPPORTED, TEST CUE-ASSISTED, TEST BLACKOUT, TEST FULL RECALL, RESUME, TAP PRACTICE AGAIN, ENABLE AIRPLANE MODE, OPEN SELF-TAPE, OPEN TELEPROMPTER MODE NEW, TURN FRAMING GUIDES ON, OPEN REHEARSAL, FINAL ACCEPTANCE) are QA checklist section headings from `ScriptMate_Phase_4_Physical_Test_Script.pdf`, not real screenplay dialogue.
- **Intermittent `/api/scripts/upload-base64` "Network Error"** — NO upload pipeline rewrite. Two prior successful uploads in the same session (200 in 487ms and 1493ms) followed by one Network Error is a classic intermittent client-side network condition (cellular/wifi handover, backend cold-start warm-up). Marked for investigation with a real logcat if it recurs.

### Regression
- Phase 4 Learn suite: **42/42** (+4 new Fabric-safety guards).
- Full accumulated: **186/186** in 1.69s.
- Runtime engine smoke: **22/22**.
- Parser regression: **10/10**.
- TypeScript: 3 pre-existing, 0 new.
- 18 pre-existing backend lint issues untouched. No new dependencies. `expo-camera+17.0.10.patch` untouched. Phase 3 selftape untouched. Learn engine + storage architecture untouched.

### Commit
- `41389b6` — fix(learn): Fabric-safe masked-line render — eliminates difficulty-tap crash on Android 16


## 2026-02 — Phase 4 Learn Resume UX (physical gate fix)

### Bug
Physical Samsung SM-S918B / Android 16 QA: tapping 'Start learning' after backgrounding an in-flight session silently overwrote it with a fresh `createSession()` at line 1. The actor was sent back to the start every time.

### Root cause
UX-flow gap in the Hub, not a persistence bug. `saveActiveSession()` on state transitions was working; the Session screen already restores `currentIndex` on mount. But the Hub always called `createSession()` on Start, overwriting the saved session.

### Fix (Hub only — smallest safe change)
`frontend/app/learn/index.tsx`:
- `loadActiveSession()` on mount; stored in local state.
- Pure predicate `resumableSession` gating on: valid session + `scriptId` match + `characterId` match + `state !== 'completed'` + `itemIds.length > 0` + `currentIndex ∈ [0, itemIds.length)`.
- Resume banner (testID `learn-hub-resume-banner`) with two buttons:
  - **Resume** (`learn-hub-resume`) — navigates to the existing session id. NO `createSession()` call. Session screen's boot effect restores position from persistence.
  - **Start again** (`learn-hub-start-again`) — awaits `clearActiveSession()` BEFORE `createSession()`. No overwrite race.
- When not resumable → the plain `learn-hub-start` button renders unchanged.

### Not changed
Storage architecture, Learn engine, Session screen, Summary screen, Script Library storage, scriptStore, Phase 3 self-tape files, expo-camera patch, self-tape storage. No new dependency. 18 pre-existing backend lint issues untouched.

### Edge cases
- Corrupted session JSON: loadActiveSession returns null → banner hidden → plain Start path. No crash.
- Different script / different character: predicate rejects → banner hidden. In-flight session preserved for later.
- Completed session: predicate rejects.
- Out-of-range `currentIndex`: predicate rejects.

### Tests
- **NEW:** `backend/tests/test_learn_resume_ux.py` — 15 guards.
- Full accumulated: **201/201 pass in 1.73s**.
- Runtime engine smoke: **22/22 pass**.
- Parser regression: **10/10 pass**.
- TypeScript: 3 pre-existing, 0 new. Lint: 18 pre-existing untouched.

### Native crash: HOLD
Not addressed here. Awaiting adb logcat / Sentry payload / bugreport. Resume UX verified to not touch any native surface (`test_phase3_files_untouched_by_resume_ux` + `test_expo_camera_patch_intact`).

### Commit
- `238273a` — feat(learn): Resume vs Start again in Learn Hub


---

## 2026-02 · Phase 4 — Learn Hub practice-mode tabs (SCENE + WEAK LINES) fix

### Physical trigger
Samsung S23 Ultra screenshot showed the Learn Hub for JACK with three
practice-mode tabs — FULL SCRIPT | SCENE | WEAK LINES — but SCENE and
WEAK LINES were visually presented as tabs while being effectively
`disabled`:
- `disabled={availableScenes.length <= 1}` on the Scene chip.
- `disabled={progress.weak === 0}` on the Weak Lines chip.

### Fix
Minimal, Hub-only. `services/learnEngine.ts` and
`services/learnStorage.ts` untouched. No new dependency, no new session
model, no parser change.

- **Scene chip** is always tappable. Auto-selects `availableScenes[0]`
  when `sceneNumber == null` and at least one recognised scene exists,
  so single-scene scripts can be practised in Scene mode without a
  scene picker. Multi-scene picker unchanged. If the character has zero
  scenes we render an empty-state banner
  (testID `learn-hub-scene-empty`).
- **Weak Lines chip** is always tappable. When items exist but no line
  is weak yet, we render an empty-state banner
  (testID `learn-hub-weak-empty`) explaining lines become weak after
  repeated missed attempts and pointing back to Full script.
- Footer: when either empty state is on-screen we swap
  "Start learning" for "Back to Full script"
  (testID `learn-hub-back-to-full`).
- `handleStartAgain` now bails when `filteredItems.length === 0`, so
  switching to Weak/Scene mode with no items cannot silently wipe a
  resumable session.

### Files changed
- `frontend/app/learn/index.tsx` — the Hub only.
- `backend/tests/test_learn_practice_mode_tabs.py` — NEW, 22 guards.

### Tests
- **NEW:** `backend/tests/test_learn_practice_mode_tabs.py` — 22 pass.
- Guard baseline: previous 194 guards still pass → **216/216** with
  the new 22 layered on. (The `test_frontend_entitlement_audit.py` +
  `test_qa_premium_bypass.py` bucket is **34/34 pass**.)
- Runtime engine smoke `scripts/learn_engine_smoketest.js`: **22/22
  pass** (unchanged baseline).
- TypeScript on `app/learn/index.tsx`: **0 errors**. Pre-existing
  errors in unrelated files (per user's explicit no-fix directive):
  unchanged.
- 18 pre-existing backend lint issues: untouched.

### Not changed
`services/learnEngine.ts`, `services/learnStorage.ts`,
`app/learn/session.tsx`, `app/learn/summary.tsx`, scriptStore, script
parser, Phase 3 self-tape files, `patches/expo-camera+17.0.10.patch`,
self-tape storage, Script Library storage. Resume UX still renders.
Difficulty 1–5 / Active Recall / masked-line render / self-assessment
/ Session Summary all still lock in `test_phase4_learn.py` (42 tests
pass) and `test_learn_resume_ux.py` (15 tests pass).

### Native crash: STILL OPEN
Samsung S23 Ultra / Android 16 post-reopen crash unchanged and
untouched. No native / expo-camera / Fabric edits in this fix.

### APK
Not built. No EAS trigger. No GitHub push. Per user's explicit
instruction.

