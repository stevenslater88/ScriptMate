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
