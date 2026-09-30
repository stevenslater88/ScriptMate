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


### 2026-02 — DOCX Script Text Integrity — Final Hardening (Feb 2026)

Physical S23 Ultra QA build still exhibited residual DOCX text corruption after the Nov-2025 intra-word repair pass:
- `kno w` → should be `know`
- `look lik e` → should be `look like`
- `nothinghappens` → should be `nothing happens`
- `disciplinary .` → should be `disciplinary.`

**Root cause (evidence from controlled DOCX reproduction, `backend/tests/test_docx_hardening_feb2026.py`):**
- The Nov-2025 repair used a small stopword-guarded regex ("Rule C"). Because the stopword list was under-sized, the regex greedily merged legitimate short-word pairs (`look back` → `lookback`, `dear john` → `dearjohn`, `hard work` → `hardwork`) — a serious latent regression.
- The Nov-2025 Rule B ("single non-vowel prefix") had NO dictionary check, so it happily produced non-words (`w what` → `wwhat`).
- The parser had no repair for the run-boundary "missing space" case (`nothinghappens`).
- The parser had no repair for a floated punctuation run (`disciplinary .`).

**Fix (evidence-based, minimal scope):**
1. `backend/common_english_words.py` (NEW): frozenset of ~10K common English words, sourced from the public-domain `google-10000-english-usa` list, with:
   - **All 5+ letter entries** kept from top-10K.
   - **1-4 letter entries CURATED** by hand — removes tech/state/country abbreviations (`ne`, `ver`, `pm`, `usa`, `tv`, etc.) that would produce false "is a word" signals.
   - **Curated compound tail** (`goodbye`, `something`, `everyone`, `understand`, `disciplinary`, etc.) to prevent legitimate long words from being split.
2. `backend/server.py`:
   - **Rule C** replaced with `_dict_aware_merge` — a token-based scan (not regex, which greedily gobbles longest match) that merges `left right` iff `left+right` is in the dictionary AND at least one side is NOT (the classic mid-word split signature).
   - **Rule B** now consults the dictionary — never merges to a non-word.
   - **Rule D** (`_SPACE_BEFORE_PUNCT`) strips spaces immediately before terminal `.` `,` `;` `:` `!` `?`.
   - **Rule E** (`_split_concatenated_words`) inserts a space in a token iff the token is ≥ 10 chars, NOT itself a word, and exactly one dictionary-valid split (both halves ≥ 4 chars, both dict words) exists.
3. Rule ordering: A → C → B → D at line level; E applied per token in `fallback_parse_script`.

**Regression coverage (all deterministic, no HTTP):**
- `backend/tests/test_docx_hardening_feb2026.py` — 110 tests: physical failure cases, adversarial legitimate-phrase guards (`look back`, `dear john`, `hard work`, …), contractions, hyphenated words, punctuation, stage directions, character cues, end-to-end synthesised-DOCX round-trip covering every failure signature.
- `backend/tests/test_docx_intra_word_spacing.py` — updated `test_w_anto` to reflect the new dictionary-gated Rule B (`w anto` no longer merges because `wanto` isn't a word — a deliberate improvement over the Nov-2025 behavior).
- `backend/tests/test_script_import_latency_and_prep_teleprompter_removal.py` — updated `_load_fallback_parser` to import directly instead of AST-extracting the old `_INTRA_WORD_STOPWORDS`/`_INTRA_WORD_SHORT_FRAGMENT` constants that no longer exist.

**Final regression totals (post-fix, static guards only, no HTTP):** 478/478 passed across the 19 accumulated static regression suites (test_docx_hardening_feb2026, test_docx_intra_word_spacing, test_smart_join_and_rehearsal_scroll, test_phase3_selftape_regression, test_phase4_learn, test_fabric_safe_slider_migration, test_rehearsal_debug_ui_leak, test_ai_coming_soon_ui, test_learn_practice_mode_tabs, test_learn_resume_ux, test_teleprompter_framing_guides, test_teleprompter_ux_defaults, test_route_b_camera_hardening, test_expo_camera_stabilization_patch, test_script_import_latency_and_prep_teleprompter_removal, test_qa_premium_bypass, test_frontend_entitlement_audit, test_startup_api_diagnostic, test_scripts_create_timeout).

**TypeScript baseline:** unchanged at 37 pre-existing errors (all in files not touched by this fix: `app/upload.tsx`, `app/voice-studio.tsx`, `services/auditionService.ts`, `services/debugLogService.ts`, `services/revenuecat.ts`, `services/voiceStudioStorage.ts`).

**Backend lint baseline:** the 18 pre-existing "blocking" issues (6 potential-ObjectId-serialisation, 1 F811 `get_user_stats` redefinition, 11 E722 bare-except) remain untouched per user directive.

**Scope guarantees:** no changes to Phase 3 selftape, camera lifecycle, FabricSafeSlider, RevenueCat, Sentry, or any frontend rendering code. No dependency changes. No lockfile regeneration. No new external dependencies (the wordlist is a plain-Python module).

## Changelog

### 2026-02 — Home layout reconciliation + Voice Assignment functional lock

Physical QA of APK 1110 (v1.0.59, versionCode 1095) confirmed all prior Feb-2026 code (Reader Style + Voice Speed + Multi-Voice wiring, Voice Studio SDK-54 fix + script picker, DOCX / END-OF-SCREENPLAY parser, Daily Drill UX, Home Upload removal, AI Coming Soon section) shipped correctly — but Voice Studio still appeared under "More" because the Home 3×2 grid change had never been implemented.

**Root cause of the source/build mismatch:** the Home grid promotion of Voice Studio + Auditions was requested but never authored in a previous cycle. Reader Style + Voice Speed + Multi-Voice work committed in earlier prompts was correct and present; only the Home layout piece was missing.

**Files changed (this reconciliation):**
- `frontend/app/index.tsx`:
  - Replaced `<View style={st.grid4}>` (4-tile 2×2) with `<View style={st.grid3x2}>` (6-tile 3×2). Order: `Self Tape · Voice Studio · New Script / My Scripts · Recall · Auditions`.
  - Added `st.grid3x2` style (`width: '31%'` tiles, 10 px gap, same borders/padding as before).
  - Kept `st.grid4` rule for stylistic parity (unreferenced by any JSX site now; a static test asserts this).
  - Shrunk the More section from 4 rows → 2 (Dashboard, Support only). Voice Studio + Auditions promoted out of More; Upload Script stays removed from the previous cleanup.
- `backend/tests/test_ai_coming_soon_ui.py`: `test_home_4_tool_grid_still_has_four_tools` renamed to `test_home_primary_grid_now_has_six_tools` and rewritten to assert the 3×2 shape.
- `backend/tests/test_home_more_upload_removed_feb2026.py`: updated `REQUIRED_HOME_NAV_ENTRIES` to reflect the new grid; `test_more_section_now_contains_exactly_four_navrows` → `_two_navrows`.
- `backend/tests/test_home_layout_reconciliation_feb2026.py` (**new** — 15 tests): full layout contract locker — Quick Rehearse hero, 3×2 grid with exact tile order, Voice Studio + Auditions promoted to `<ToolCard>`, More shrunk, AI Coming Soon rendered with all 5 items, `/upload` deep-link route preserved, Reader Style + Multi-Voice + Voice Studio picker still intact, Scene Partner untouched.
- `backend/tests/test_voice_assignment_functional_feb2026.py` (**new** — 14 tests): locks the Voice Assignment / Change Voice functional contract — UI still lets users change per-character voices, `saveVoiceAssignments` persists to the unchanged `script_voice_settings` AsyncStorage key, preview button still uses `playSpeech`, rehearsal resolves each line's character against the map and calls `playSpeech(text, assignment.voiceId)` (never a hardcoded/global voice), catalogue fields `key/name/voiceId/gender/description` preserved, fallback to `Speech.speak(...)` when ElevenLabs isn't configured or a character has no assignment, and the `useElevenLabs` branch condition requires all three of `elevenLabsAvailable && !!assignment && !!assignment.voiceId`.
- `scripts/prebuild_gate.py`: both new files registered in `STATIC_REGRESSION_TESTS`.

**Zero diff on:** `backend/server.py`, `frontend/app/rehearsal/[id].tsx`, `frontend/app/script/[id].tsx`, `frontend/store/scriptStore.ts`, `frontend/services/elevenLabsService.ts`, `frontend/components/VoiceAssignment.tsx`, `frontend/services/voiceStudioStorage.ts`, `frontend/app/voice-studio.tsx`, `frontend/app/scene-partner.tsx` — the reconciliation is layout-only and leaves every earlier Feb-2026 wiring in place.

**Pre-build gate result:**
```
Tests:             PASS — 745 passed, 0 failed, 0 errors   (+29 vs previous 716)
Runtime smoke:     PASS — 18 ok, 0 fail
TypeScript:        PASS — 31 baseline error(s), 0 new (baseline expects 37)
Lint regression:   PASS (baseline-only) — 327 baseline finding(s), 0 new
Dependencies:      PASS
Overall:           GREEN, exit 0
```

**Confirmation:** all required Home, Voice Studio, Reader Style, Voice Speed, Multi-Voice, Voice Assignment, and Coming Soon changes are present together in the current `main` source. The 18 baseline backend lint issues remain untouched.

### 2026-02 — Reader Style + Multi-Voice wired into Rehearsal playback

Physical QA audit proved two voice controls were UI-only. Fixed both with the minimum-scope wiring described below. Scene Partner Reader Style + Cue Timing (which the audit proved already worked) intentionally untouched.

**A) AI Reader Style — full end-to-end wiring**

- `frontend/app/script/[id].tsx::handleStartRehearsal` — forwards `selectedReaderStyle` + `voiceSpeed` as the 5th/6th args to `createRehearsal(...)`.
- `frontend/store/scriptStore.ts` — extended `createRehearsal` signature and `RehearsalSession` type with optional `readerStyle` / `reader_style` and `voiceSpeed` / `voice_speed` (defaults `'neutral'` / `1.0`; legacy 4-arg callers unchanged).
- `backend/server.py::RehearsalCreate` and `RehearsalSession` — added `reader_style: str = "neutral"` and `voice_speed: float = 1.0`; the POST `/api/rehearsals` route persists them onto the session document.
- `frontend/app/rehearsal/[id].tsx::speakLine` — reads `currentRehearsal?.reader_style / .voice_speed` and passes the speed as a *multiplier* into a reworked `getVoiceSettings(voice, voiceSpeedMultiplier = 1.0)`. The per-voice base `pitch/rate` is preserved and the multiplier composes with `rate` (`base.rate * voiceSpeedMultiplier`). Neutral (1.0) is a no-op, Emotional (0.9) slower, Intense/Aggressive (1.1) faster.

**B) Multi-Voice — per-character ElevenLabs assignments now consumed at playback**

- `frontend/app/rehearsal/[id].tsx`:
  - Imports `loadVoiceAssignments`, `playSpeech`, `isElevenLabsConfigured`, `CharacterVoiceAssignment` from the existing `services/elevenLabsService` (no new dependency).
  - On mount, loads assignments from AsyncStorage into `voiceAssignmentsRef` (`Record<characterName, assignment>`); flags `elevenLabsAvailable`.
  - Inside `speakLine`, resolves the line's character to an assignment. Branch condition `useElevenLabs = elevenLabsAvailable && !!assignment && !!assignment.voiceId`.
  - When true → `playSpeech(text, assignment.voiceId)`; wires `setOnPlaybackStatusUpdate` → `didJustFinish` to the same `safeAdvance()` callback the shared path uses, so line advancement is identical across both engines.
  - **Fallback preserved bit-for-bit:** every other case — ElevenLabs unavailable, no assignment for the character, or a runtime failure inside the ElevenLabs branch — falls through to the pre-fix `Speech.speak(text, { pitch, rate })` call unchanged.
  - Pause and unmount both stop the ElevenLabs sound.

**Live backend verification (against local `POST /api/rehearsals`):**
```
With fields:    reader_style=emotional, voice_speed=0.9   → persisted on RehearsalSession
Without fields: reader_style=neutral,   voice_speed=1.0   → defaults applied (legacy client compatibility)
```

**Tests:**
- `backend/tests/test_voice_controls_fix_feb2026.py` — 20 static assertions (7 for A, 8 for B, 2 Scene Partner guards, 1 xfail-flip proof, 2 fallback preservation guards).
- `backend/tests/test_voice_controls_investigation_feb2026.py` — the 6 strict xfails from the investigation have been **flipped to normal PASSing assertions**. Each now asserts the FIXED contract; any regression that re-breaks the wiring fails loudly.
- Zero `@pytest.mark.xfail` markers remain across the audit contract.
- Both files added to the pre-build gate's `STATIC_REGRESSION_TESTS` allowlist.

**Pre-build gate result:**
```
Tests:             PASS — 716 passed, 0 failed, 0 errors   (+27 vs previous 689)
Runtime smoke:     PASS — 18 ok, 0 fail
TypeScript:        PASS — 31 baseline, 0 new (baseline expects 37)
Lint regression:   PASS (baseline-only) — 327 baseline, 0 new
Dependencies:      PASS
Overall:           GREEN, exit 0
```

**Scope guarantees:** `frontend/app/scene-partner.tsx` and `frontend/app/voice-studio.tsx` unchanged (verified via `git diff --stat`). No dependency change, no `yarn.lock` change, no premium/entitlement change, no refactor. 18 baseline backend lint issues untouched.

**Not yet in an APK.** Wire is complete + backend-verified; physical validation requires the next QA APK.

### 2026-02 — Home / More cleanup: removed redundant "Upload Script" NavRow

The Home screen's More section had a standalone `Upload Script` NavRow (`route="/upload"`) alongside the primary `New Script` tool tile (`route="/script-parser"`) — the two flows overlap for the PDF / DOCX / TXT import journey. The redundant NavRow was removed.

**Preserved (per requirements):**
- `frontend/app/upload.tsx` — kept intact for deep-links and programmatic navigation.
- `/upload` Stack.Screen in `frontend/app/_layout.tsx` — still registered.
- Backend endpoints `POST /api/scripts/upload` and `POST /api/scripts/upload-base64` — unchanged.
- "New Script" tile (`testID="new-script-btn"` → `/script-parser`) remains the primary import entry point.
- "My Scripts" tile (`testID="my-scripts-btn"` → `/scripts`) — unchanged.
- Voice Studio, Auditions, Dashboard, Support NavRows — unchanged.

**Files changed:**
- `frontend/app/index.tsx` — removed the single `<NavRow … testId="upload-row" />` line; added a code comment explaining the cleanup rationale and confirming the underlying flow is preserved.
- `backend/tests/test_home_more_upload_removed_feb2026.py` — new; 11 static regression assertions.
- `scripts/prebuild_gate.py` — new test file registered in `STATIC_REGRESSION_TESTS`.

**Pre-build gate result:**
```
Tests:             PASS — 682 passed, 0 failed, 0 errors (+11 vs previous 671)
Runtime smoke:     PASS — 18 ok, 0 fail
TypeScript:        PASS — 31 baseline, 0 new (baseline expects 37)
Lint regression:   PASS (baseline-only) — 327 baseline, 0 new
Dependencies:      PASS
Overall:           GREEN, exit 0
```

**Scope guarantees:** no changes to Voice Studio, Rehearsal, Recall, Self-Tape, Learn, Daily Drill, Premium, or any backend endpoint. No dependency change; no `yarn.lock` authored by this task. 18 baseline backend lint issues untouched.

### 2026-02 — Voice Studio: SDK 54 legacy-import fix + script-on-screen recording

Physical QA build 1.0.57 reported Voice Studio failing on Android. Trace pinpointed the crash: SDK 54 moved `documentDirectory` and `EncodingType` to `expo-file-system/legacy`; the bare `import * as FileSystem from 'expo-file-system'` returned `undefined`, so `ensureDir()` immediately threw `"documentDirectory is not available"` the moment the actor tried to save any recording. The 5 pre-existing TypeScript baseline errors on `app/voice-studio.tsx:310/378/382` and `services/voiceStudioStorage.ts:4/30` were direct static-analysis evidence of the same regression.

**Root-cause fix (2 files, 1 import change each):**
- `frontend/services/voiceStudioStorage.ts` — `import * as FileSystem from 'expo-file-system'` → `import * as FileSystem from 'expo-file-system/legacy'`. All downstream calls (`documentDirectory`, `getInfoAsync`, `makeDirectoryAsync`, `copyAsync`, `deleteAsync`) present in the legacy module unchanged.
- `frontend/app/voice-studio.tsx` — same import switch.

**New capability — script-on-screen recording** (additive, per your requirements):
- `frontend/app/voice-studio.tsx`:
  - Consumes `useScriptStore` for the user's saved scripts (same source used by Library/Rehearsal — no duplication).
  - On the Record tab: new **"Choose Script"** picker row (`testID=choose-script-btn`) + optional character chip strip (`char-chip-all`, `char-chip-<NAME>`) + on-screen script panel (`voice-studio-script-panel`) with active-line highlight (`active-script-line`) and Prev/Next navigation (`prev-line-btn`, `next-line-btn`).
  - New picker Modal (`script-picker-modal`) listing saved scripts; empty state (`script-picker-empty`) offers a deep link to `/scripts` (Library).
  - `saveTake(uri, name, recDuration, selectedScript?.id, selectedScript?.title)` — the storage API already accepted these optional fields; this UI now wires them in and augments the take name (`Take 3 — Hamlet Act I (JULIET)`).
- Existing recording flow untouched: `start-record-btn`, `stop-record-btn`, `pause-resume-btn`, `play-take-<id>` all preserved.
- **No new audio dependency** — continues to use `expo-av` `Audio.Recording`.
- **No new premium gate** — entitlement is enforced upstream at the Library entry / RevenueCat layer; this screen change is orthogonal.
- Empty script list handled gracefully; a bare voice-over (no script) still works exactly as before.

**Regression tests — `backend/tests/test_voice_studio_script_on_screen_feb2026.py` (23 static assertions):**
- Legacy import present in both files; the broken bare import removed.
- `documentDirectory is not available` guard-rail preserved (any future SDK regression will fail loudly).
- Route registered; mount-time `loadData()` and `fetchScripts()` invoked; error banner + retry present.
- Script picker UI: `script-picker-row`, `choose-script-btn`, `script-picker-modal`, empty-state CTA to `/scripts`.
- `useScriptStore` is the data source; per-character filter excludes stage directions.
- Script panel appears BEFORE the waveform (additive, not replacing recording controls).
- `saveTake` invoked with `selectedScript?.id + selectedScript?.title`; take name includes truncated title + character.
- Entitlement/premium symbols NOT introduced in the screen (no bypass or duplicate gate).
- Storage `VoiceTake` interface retains `scriptId? / scriptTitle?` fields; `saveTake` signature unchanged externally.
- No new audio-recorder / voice-recognition dependency (`react-native-audio*`, `react-native-sound`, `@react-native-community/voice`, etc.); `expo-av` still the recording engine.
- UI consistency check (SafeAreaView + Ionicons matching Rehearsal / Self-Tape).

**Pre-build gate result (post-fix):**
```
Tests:             PASS — 671 passed, 0 failed, 0 errors   (+23 vs previous)
Runtime smoke:     PASS — 18 ok, 0 fail
TypeScript:        PASS — 31 baseline error(s), 0 new (was 37; -6 = the voice-studio ones)
Lint regression:   PASS (baseline-only) — 327 baseline finding(s), 0 new
Dependencies:      PASS
Overall:           GREEN
```

**Scope guarantees:** no changes to Phase 3 / Phase 4 / Rehearsal / Learn / Recall / Daily Drill / RevenueCat / Sentry / DOCX parser. No `package.json` / `requirements.txt` / `yarn.lock` change. 18 baseline backend lint issues untouched.

**APK required for physical validation:** YES — this is a runtime import path change that only takes effect on device after the next APK is installed.

### 2026-02 — "END OF SCREENPLAY" false-character fix (post-QA finding)

Physical S23 Ultra QA reported the character list on `ScriptScreen` contained the terminator `END OF SCREENPLAY` alongside real characters (`JACK`, `DET. HARRIS`). This was a parser-side false positive.

**Root cause:** The Feb-2026 scene-heading regex enumerated `END OF SCENE|ACT|EPISODE|PART|SHOW|FILM|MOVIE` but did NOT list `SCREENPLAY`, `STORY`, `PLAY`, `PILOT`, `TEASER`, `COLD OPEN`. It also had no matcher for a bare `END` / `END.` / `END:` terminator on its own line. Any line that fell through the scene-heading filter and was uppercase became a candidate character — so `END OF SCREENPLAY` was classified as one.

**Trace (evidence):**
1. Raw extracted DOCX text ends with `\n\nFADE OUT.\n\nEND OF SCREENPLAY`.
2. Backend `fallback_parse_script` on unfixed code returned `characters=['END OF SCREENPLAY','JACK','DET. HARRIS']`.
3. That list was persisted to Mongo and returned by `POST /api/scripts`.
4. Frontend `smartScriptParser.parseScript` had the identical missing tokens in its `HEADING_RE`, so had it re-parsed the raw text client-side it would have produced the same list.
5. `ScriptScreen` read `currentScript.characters` verbatim → the diagnostic surfaced `firstThreeCharacters: "JACK, DET. HARRIS, END OF SCREENPLAY"`.

**Fix — narrowest possible regex change, applied to BOTH parsers (parity is contract):**
- `backend/server.py::_SCENE_HEADING_RE`:
  - Extended `END OF (…)` alternation to include `SCREENPLAY | STORY | PLAY | CHAPTER | TEASER | COLD OPEN | PILOT`.
  - Added a new alternative `END\s*[.:!]?\s*$` that matches a standalone `END`, `END.`, `END:`, `END!` — anchored with `$` inside the alternative so a real character named `ENDER` or `ENDANGERED SPECIES` remains detected.
- `frontend/services/smartScriptParser.ts::HEADING_RE`: mirrored the same additions.

**Regression tests (34 new cases in `backend/tests/test_end_of_screenplay_character_feb2026.py`):**
- 18 parametrised terminator cases must be rejected as scene headings: `END OF SCREENPLAY`, `THE END`, `END`, `END.`, `END:`, `END OF SCENE`, `END OF ACT`, `END OF EPISODE`, `END OF SHOW`, `END OF FILM`, `END OF STORY`, `END OF PLAY`, `END OF PILOT`, `END OF TEASER`, `END OF COLD OPEN`, `FADE OUT`, `FADE OUT.`, `CUT TO:`.
- 12 real-character cases must NOT be rejected: `JACK`, `SARAH`, `DET. HARRIS`, `MRS. SMITH`, `POLICE OFFICER`, `JACK (V.O.)`, `SARAH (O.S.)`, `MARY (CONT'D)`, `DREW`, plus adversarial near-misses `ENDER`, `ENDANGERED SPECIES`, `BENDER`, `PENDING`.
- 1 end-to-end DOCX-shaped stress-text test proving the character list from a screenplay ending in `FADE OUT. / END OF SCREENPLAY` is exactly `{JACK, DET. HARRIS, SARAH}` with no terminator leakage.
- 1 dialogue-preservation guard proving `"Back to me."` (the historically problematic dialogue line) is still attributed to `JACK`.
- 1 frontend-parity guard that reads `smartScriptParser.ts` and asserts every terminator token added on the backend side is mirrored — the two parsers cannot silently diverge.

**Scope guarantees:**
- No changes to `daily_drills` / `scripts` / `rehearsals` schema, no dependency changes, no `yarn.lock` change.
- Phase 3 / Phase 4 / RevenueCat / Sentry / Rehearsal / Learn / Recall / Premium / Teleprompter / Self-Tape untouched.
- The 18 baseline backend lint issues remain untouched; the pre-completion checker showed them shift line numbers only (same rules, same anchors).

**Pre-build gate result (post-fix):**
```
Tests:             PASS — 648 passed, 0 failed, 0 errors     (+34 vs previous, was 614)
Runtime smoke:     PASS — 18 ok, 0 fail
TypeScript:        PASS (baseline-only) — 37 baseline, 0 new
Lint regression:   PASS (baseline-only) — 327 baseline, 0 new
Dependencies:      PASS
Overall:           GREEN
```

**APK required for physical validation:** YES — this is a parser regex change affecting DOCX import output. The user must Save-to-GitHub to trigger the gated QA APK build; physical validation on S23 Ultra will confirm `ScriptScreen` no longer shows `END OF SCREENPLAY` in `firstThreeCharacters`.

### 2026-02 — Daily Drill 3-State UX Fix (post-QA-1110 finding)

Physical QA on build 1110 showed the Daily Drill screen jumping straight to "Today's drill complete!" from a single tap of "I Did It! Claim XP" — the tester perceived that the drill never initiated. Root cause investigation confirmed it was NOT a backend bug: the DB row can only reach `completed:true` via `POST /api/daily-drill/{user_id}/complete`, which the old button called on the first tap.

**Fix — smallest UX change; no backend, DB, or dependency changes:**
- `frontend/app/daily-drill.tsx`:
  - Added a component-local `started` boolean (`useState(false)`) — not persisted.
  - Split the single button into a 3-state block:
    1. `available`  → **"Start Drill"** (icon `play-circle`, `testID="start-drill-btn"`). Tap only calls `setStarted(true)` — **no HTTP call**.
    2. `active`     → In-progress indicator card (`testID="drill-active-indicator"`) with the copy *"Drill in progress — perform the challenge above, then tap below."* plus the **"Complete Drill — Claim XP"** button (`testID="complete-drill-btn"`) which calls the existing `completeDrill()` → the existing `POST /complete`.
    3. `completed`  → unchanged **"Today's drill complete!"** banner.
  - Added `styles.activeIndicator` and `styles.activeIndicatorText`. No new dependencies, no new imports.
  - `started` is deliberately not persisted so navigating away resets to available (no XP has been awarded — no data loss).
- `backend/tests/test_daily_drill_ux_three_state_feb2026.py` — 12 new static regression guards asserting the UX contract and that no backend / schema / dependency change slipped in.
- `scripts/prebuild_gate.py` — new test file added to STATIC_REGRESSION_TESTS allowlist. Gate count is now 614 / 614 GREEN.

**Live backend verification (fresh device_id, https://scriptmate-8.emergent.host):**
1. Fresh GET → `completed:false`. ✅
2. GET again after "Start Drill" tap → `completed:false` (no /complete call). ✅
3. POST /complete → `xp_awarded:25`. ✅
4. GET → `completed:true`, `completed_at` set. ✅
5. Streak → `current_streak:1`, `total_xp:25`, `today_completed:true`, `activities_today:['daily_drill']`. ✅
6. Double POST /complete → `xp_awarded:0` (idempotent, no double XP). ✅

**Scope guarantees:** no changes to `backend/server.py`, `daily_drills` schema, XP/streak logic, or any other feature (Rehearsal / Import / Library / Teleprompter / Self-Tape / Premium untouched). No dependency or `yarn.lock` change (the pre-existing `yarn.lock` diff for `@miblanchard/react-native-slider@2.6.0` predates this task and was not authored here). No APK / AAB build.

### 2026-02 — ScriptMate Pre-Build Quality Gate

Added a reusable, baseline-aware pre-build gate that blocks the QA APK / production AAB build unless every regression check is GREEN. Infrastructure only — no product code touched.

**Files added / changed:**
- `scripts/prebuild_gate.py` (NEW) — single entry point.
- `scripts/prebuild_gate_baselines/ruff_baseline.json` (NEW) — snapshot of the 327 current ruff findings (which include the 18 pre-existing "blocking" backend lint issues kept intentionally per user directive).
- `scripts/prebuild_gate_baselines/ts_baseline.json` (NEW) — snapshot of the 37 pre-existing TypeScript errors.
- `scripts/README.md` (NEW) — usage docs.
- `frontend/.eas/workflows/qa-apk.yml` — added a `prebuild_gate` job; `build_android_qa_apk` now `needs: [prebuild_gate]`, so EAS Workflows refuse to start the APK build when the gate exits non-zero.

**Checks performed by the gate:**
1. **Backend regression tests** — 602 static pytest cases (allowlist of the 21 hermetic suites documented in the parser-hardening changelog).
2. **Runtime smoke** — `scripts/learn_engine_smoketest.js` (18 pure-Node assertions covering the learn engine).
3. **TypeScript check** — `npx tsc --noEmit` diffed per (file, rule) against `ts_baseline.json`. PASS if the current error set is a subset of baseline; FAIL if any new (file, rule) pair appears or a count grows.
4. **Lint regression (ruff)** — same diff-vs-baseline mechanism for `ruff check backend/`. The 18 known "blocking" issues remain untouched and are recognised as baseline.
5. **Dependencies / config sanity** — required files exist (`server.py`, `common_english_words.py`, `smartScriptParser.ts`, `learnEngine.ts`, `package.json`, `yarn.lock`, `tsconfig.json`, `qa-apk.yml`, smoke script); `requirements.txt` parses; `package.json` parses; `server.py` still imports `common_english_words`.

**Baseline-aware:** the gate cannot be tricked into a false-green because the diff is *count-per-(file, rule)*, and it cannot false-red on unrelated line shifts because line numbers are ignored.

**Build blocking:** wired into `frontend/.eas/workflows/qa-apk.yml` via `needs: [prebuild_gate]`. The gate is also invocable locally by any developer with `python3 scripts/prebuild_gate.py`.

**Self-verification results (2026-02):**
- Known-good source → `Overall: GREEN`, exit 0.
- Synthetic failing test injected into `test_ai_coming_soon_ui.py` → gate reported `Tests: FAIL — 602 passed, 1 failed` and `Overall: RED / Build blocked`, exit 1. Reverted.
- Synthetic new bare-except (E722) appended to `test_learn_practice_mode_tabs.py` → gate reported `Lint regression: FAIL — 1 NEW ruff finding(s) beyond baseline (total 328)` and `Overall: RED / Build blocked`, exit 1. Reverted.
- Post-restoration re-run → `Overall: GREEN`, exit 0.

**Invocation:**
```bash
python3 scripts/prebuild_gate.py
```

**Scope guarantees:** no changes to Phase 3 / Phase 4 code, camera lifecycle, RevenueCat, Sentry, DOCX parser, Rehearsal, Learn/Recall, or Premium logic. No dependency or lockfile changes. No APK / AAB built, no `eas` invocation, no GitHub push performed by this task.


### 2026-02 — Restore + P0 stabilization
- Restored branch `conflict_170326_0314` via git clone → rsync (preserving `.git` and `.emergent`).
- `yarn install` clean.
- **Startup fixes reapplied:**
  - `app.json` → `updates.enabled: false` added.
  - `eas.json` → `channel: "production"` removed from production build profile.

### 2026-02 — Scene-Heading / Character-Detection Hardening (Feb 2026)

Physical DOCX maximum-stress-test surfaced a NEW parser defect after the word-boundary fix landed. Screenplay section headings (`SCENE 1`, `SCENE 2—CONTRACTIONS`, `INT. KITCHEN`, `FADE IN:`, `ACT ONE`, etc.) were being classified as speaking characters and polluting the character-select UI.

**Root cause (evidence in `backend/tests/test_scene_heading_detection_feb2026.py`):** the fallback parser's character heuristic was `line.replace(':','').strip().isupper() and len(split()) <= 3 and len > 1`. This is TRUE for `SCENE 1`, `INT. KITCHEN`, `FADE IN`, `CUT TO`, `ACT ONE`, `SCENE 2—CONTRACTIONS`, etc. The heuristic had no awareness of screenplay structural elements. Additionally the multi-word form `SCENE 2 — CONTRACTIONS` (with spaces around em-dash) escaped detection only because it had 4 tokens — a fragile guarantee that broke when DOCX runs collapsed the surrounding whitespace on device.

**Fix (evidence-based, minimum scope):**
- `backend/server.py`: added `_looks_like_scene_heading()` — an anchored, IGNORECASE, VERBOSE regex that matches screenplay conventions: `SCENE|ACT|CHAPTER|PART|SECTION`, sluglines (`INT.|EXT.|INT./EXT.|I/E`), transitions (`FADE IN|FADE OUT|CUT TO|DISSOLVE|SMASH CUT|MATCH CUT|JUMP CUT|TIME CUT|IRIS IN|IRIS OUT|FREEZE FRAME`), and editorial markers (`MONTAGE|FLASHBACK|INTERCUT|ANGLE ON|CLOSE ON|TITLE CARD|THE END|BACK TO SCENE|PRELAP|SUPER(IMPOSE)`). The character heuristic in `fallback_parse_script` now also rejects `startswith('(', '[')` and any line matching `_looks_like_scene_heading`.
- Added `_strip_character_cue_extension()` which strips `(V.O.)`, `(O.S.)`, `(CONT'D)`, `(OFF SCREEN)`, `(INTO PHONE)`, `(PRE-LAP)`, etc. from character-cue lines so the stored character name is just `JACK` (not `JACK (V.O.)`). Guarded so a bare `(V.O.)` line is not eaten to empty string — routed to the stage-direction path instead.

**Retained functionality:** The Feb-2026 DOCX word-boundary hardening (`kno w`, `look lik e`, `nothinghappens`, `disciplinary .`) is still in place; a combined-fix invariant test proves both fixes work together on the same stress-shape document.

**Regression coverage:** `backend/tests/test_scene_heading_detection_feb2026.py` — 89 tests: scene-heading positive detection (48 cases: SCENE / INT. / EXT. / FADE / CUT / DISSOLVE / ACT / MONTAGE / FLASHBACK / etc.), legit-character negative guards (16 cases: JACK, SARAH, DREW, ANG, `HANN AH`, MRS. SMITH, `JACK (V.O.)`, `SARAH (O.S.)`, `MARY (CONT'D)`, `POLICE OFFICER`, `OLD MAN`, …), extension-stripping unit tests, end-to-end string parsing (compact-hyphen variant, transitions-only, sluglines-only, ACT headings, extension collapse, bare-parenthetical routing, all-legit-names preservation), and synthesised-DOCX round-trip through `extract_text_from_docx` + `fallback_parse_script`.

**Full static-guard totals:** 567/567 passed across 20 accumulated regression suites.

**TypeScript baseline:** unchanged at 37 pre-existing errors (frontend not touched by this fix).

**Backend lint baseline:** the 18 pre-existing "blocking" issues untouched; ruff total 327 (below the 328 pre-Feb-hardening baseline).

**Scope guarantees:** no changes to Phase 3 selftape, camera lifecycle, FabricSafeSlider, RevenueCat, Sentry, frontend, dependencies, lockfile, backend URL, or any other passing functionality. Extension of the two-phase Feb-2026 DOCX hardening — no rewrite, no refactor.

  - `registerRootComponent` NOT needed — branch uses `"main": "expo-router/entry"` which handles registration natively.
- **Env restored:** `/app/frontend/.env` (Expo tunnel vars + `EXPO_PUBLIC_BACKEND_URL=save-script-verify.preview.emergentagent.com`) and `/app/backend/.env` (`MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`).
- **Backend URL fix (P0):** replaced hardcoded `script-recovery-1.preview.emergentagent.com` in two places with `process.env.EXPO_PUBLIC_BACKEND_URL || 'https://scriptmate-8.emergent.host'`:
  - `services/apiConfig.ts` line 9
  - `app.config.js` line 10
- **Metro cache flush:** removed stale `.expo/types/` cache that caused phantom `ENOENT app/diagnostics.tsx` errors during web bundling.

### 2026-02 — Numbered Scene Headings — Follow-up Hardening (Feb 2026)

Physical S23 QA build's *character-select* screen still surfaced numbered screenplay scene headings (`1. INT. APARTMENT — NIGHT`, `2. INT. KITCHEN — MORNING`, `3. EXT. STREET — DAY`, `5. INT. OFFICE — NIGHT`, `6. INT. INTERROGATION ROOM`, `101A. EXT. STREET — DAY`, …) as speaking characters — the on-device build listed 12 "characters" when only 3 (JACK, SARAH, DET. HARRIS) exist in the source screenplay.

**Root cause (traced in `frontend/services/smartScriptParser.ts`):**
- The physical "Detected Characters" screen (`app/script-parser.tsx`) uses the on-device parser `smartScriptParser.ts::parseScript`, NOT the backend `fallback_parse_script` I hardened in the previous step. The backend fix was necessary but insufficient.
- The on-device `HEADING_RE` was `/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i` — it recognised bare sluglines only. It did NOT recognise:
  - Numbered scene prefixes (`1. INT. …`, `10. INT. …`, `101A. EXT. …`, `12 INT. …`).
  - `SCENE N` block headings.
  - Transitions (`FADE IN:`, `CUT TO:`, `DISSOLVE TO:`, etc.).
  - Structural headings (`ACT ONE`, `CHAPTER 3`).
  - Editorial markers (`MONTAGE`, `FLASHBACK`, `INTERCUT`).
- Result: `isHeading()` returned false for `1. INT. APARTMENT — NIGHT`, so `isLikelyCharacterName()` ran, saw all-caps text ≤ 3 words after the caps-ratio calc, promoted it to a character with high confidence.

**Fix (evidence-based, minimum scope):**
- `frontend/services/smartScriptParser.ts::HEADING_RE` extended to a single regex mirroring the backend `_SCENE_HEADING_RE`:
  - Optional numeric/alphanumeric prefix `(?:\d+[A-Z]?\.?\s+)?`
  - Slugs: `INT.?(?:\/EXT.?)?`, `EXT.?(?:\/INT.?)?`, `I.?\/E.?`, `E.?\/I.?`
  - Blocks: `SCENE`, `ACT`, `CHAPTER`, `PART`, `SECTION`
  - Transitions: `FADE IN|OUT|TO`, `CUT TO`, `DISSOLVE (TO)?`, `SMASH/MATCH/JUMP/TIME/HARD/QUICK CUT`, `IRIS IN|OUT`, `FREEZE FRAME`
  - Editorial: `BACK TO (SCENE)?`, `TITLE CARD`, `END OF`, `THE END`, `INTERCUT`, `MONTAGE`, `FLASH(BACK|-BACK| BACK)`, `FLASHFORWARD`, `PRELAP`, `SUPER(IMPOSE)?`, `ANGLE ON`, `CLOSE ON`, `WIDE ON`, `POV`
  - Anchored `^`, IGNORECASE.
- `backend/server.py::_SCENE_HEADING_RE` extended to include the same numeric/alphanumeric prefix (`(?:\d+[A-Z]?\.?\s+)?`) — keeps both parsers in lockstep.

**Retained functionality:** `DET. HARRIS`, `MRS. SMITH`, `MR. JONES`, `DR. HOUSE`, `GUARD 1`, `NPC 2`, `SOLDIER 3` — every user-called-out legitimate character name — is still detected. Character extensions (`JACK (V.O.)`, `SARAH (O.S.)`, `MARY (CONT'D)`) still work. Word-boundary repair (`kno w`, `nothinghappens`, `disciplinary .`) still holds.

**Regression coverage added to `backend/tests/test_scene_heading_detection_feb2026.py`:**
- 20 new numbered-scene-heading positive cases (`1. INT. …`, `101A. EXT. …`, `12 INT. …`).

### 2026-02 — Dialogue Boundary Hardening (Feb 2026)

Physical S23 QA build reported: SARAH's TTS/Rehearsal dialogue leaked adjacent scene heading + action prose. Exact failing shape:
```
SARAH
You're not listening. We're running out of time, and I'll tell you exactly what happened.

2. INT. KITCHEN — MORNING

A kettle clicks off. Sarah enters carrying two mugs. Jack looks at the clock.
```
SARAH's stored `text` became `"You're not listening. … what happened. 2. INT. KITCHEN — MORNING A kettle clicks off. Sarah enters carrying two mugs. Jack looks at the clock."`, and the TTS therefore spoke the scene heading and the action prose as her dialogue.

**Root cause (traced in `backend/server.py::fallback_parse_script`):**
- The prior scene-heading fix correctly REJECTED scene headings from character-cue classification, but the fall-through `else: current_text.append(line)` branch then absorbed the heading (and any following action lines) into the accumulator for the previous character's dialogue.
- The frontend `smartScriptParser` already handled this correctly (it explicitly resets `inDialogueBlock` and `currentCharacter` on `HEADING`), but the on-device build uses the frontend parser for the DISPLAY on the Script Parser screen only — Rehearsal/TTS reads the stored `Script.lines` produced by the backend `fallback_parse_script` (see `POST /api/scripts` handler which stores via `fallback_parse_script`).

**Fix (evidence-based, minimum scope):**
- `backend/server.py::fallback_parse_script`: added an explicit scene-heading branch BEFORE the character-cue branch that
  - finalises the in-progress dialogue block,
  - stores the heading itself as an `is_stage_direction=True` line with `character=""`,
  - resets `current_character` to `""` so subsequent narrative lines don't attach to the previous character.
- Added a new `elif not current_character:` branch that routes free-text lines between a scene heading and the next character cue to the stage-direction path (`character=""`, `is_stage_direction=True`), fulfilling the invariant "Action lines must NEVER enter dialogue".

**Secondary fix — false-positive elimination:**
- Both `_SCENE_HEADING_RE` (backend) and `HEADING_RE` (`frontend/services/smartScriptParser.ts`) were IGNORECASE, which caused legitimate dialogue like `"Back to me."` and `"Iris in the eye"` to be classified as scene headings. Screenplay convention REQUIRES scene / transition headings to be UPPERCASE, so both regexes are now CASE-SENSITIVE (Python removed `re.IGNORECASE`; JS dropped the `/i` flag). Additionally removed the over-broad `BACK\s+TO\b` and `END\s+OF\b` alternatives (kept only `BACK TO SCENE` and `END OF (SCENE|ACT|EPISODE|PART|SHOW|FILM|MOVIE)`).

**Retained functionality:**
- Feb-2026 DOCX word-boundary repair (`kno w`, `look lik e`, `nothinghappens`, `disciplinary .`) — validated via combined-invariant test `test_regression_word_boundary_repair_still_holds`.
- Character cue extension stripping (`JACK (V.O.)` → `JACK`).
- All previously-detected legitimate characters (JACK, SARAH, DET. HARRIS, DREW, ANG, HANN AH, MRS. SMITH, GUARD 1, NPC 2, SOLDIER 3).
- Numbered scene-heading rejection (`1. INT.`, `101A. EXT.`, `12 INT.`).

**Regression coverage — `backend/tests/test_dialogue_boundary_feb2026.py`** (16 tests):
- Physical-shape assertion: `test_physical_stress_sarah_dialogue_is_only_dialogue` — asserts SARAH's dialogue contains no `INT.`, `EXT.`, `kettle`, `carrying two mugs`, `clock`.
- Symmetric JACK assertion.
- Scene headings stored as stage direction with empty character.
- Action prose stored as stage direction.
- 9 parametrised boundary-invariant cases: numbered scene, unnumbered scene, INT/EXT slug, transition (CUT TO), action-after-scene, parenthetical-between-dialogue, consecutive dialogue, multi-paragraph dialogue, FADE OUT terminates.
- End-to-end synthesised-DOCX round-trip (`test_e2e_docx_dialogue_boundary_holds_after_extraction`).
- TTS-payload invariant (`test_tts_payload_dialogue_is_pure_dialogue`).
- Combined-invariant guard with the word-boundary fix.

**Pre-build gate — GREEN:**
- Feb-2026 dialogue-boundary suite: **16 / 16 passed**
- Feb-2026 scene-heading suite: 108 / 108 passed
- Feb-2026 word-boundary hardening suite: 110 / 110 passed
- Full accumulated static regression (21 suites): **602 / 602 passed**
- Runtime smoke (`GET /api/health`): healthy
- Frontend TypeScript: **37 errors — unchanged baseline** (no new TS errors introduced)
- Backend ruff: **327 errors** — below the 328 pre-Feb baseline; the 18 pre-existing blocking issues untouched
- No dependency changes, no lockfile regeneration, no camera/slider/RevenueCat/Sentry/Phase 3/Phase 4 functional changes, no backend URL change.

- 3 new legit-numbered-character negative guards (`GUARD 1`, `NPC 2`, `SOLDIER 3`).
- 1 new titled-character guard (`DET. HARRIS`).
- End-to-end `NUMBERED_STRESS_TEXT` scene + DOCX round-trip test.
- `test_frontend_smart_script_parser_heading_regex_covers_numbered` — cross-parser parity guard that reads `frontend/services/smartScriptParser.ts` and asserts every required alternative (`\d+[A-Z]?`, `SCENE`, `INT`, `EXT`, `FADE`, `CUT`, `DISSOLVE`, `ACT`, `CHAPTER`, `MONTAGE`, `FLASH`) is present in the source `HEADING_RE`. This prevents a future frontend regex simplification from silently regressing the fix.

**Full static-guard totals:** 586/586 passed across 20 accumulated regression suites.

**TypeScript baseline:** unchanged at 37 pre-existing errors (only regex literal replaced in `smartScriptParser.ts`; no new TS errors — verified).

**Backend lint baseline:** the 18 pre-existing "blocking" issues untouched; ruff total 327 (below the 328 pre-Feb-hardening baseline).

**Scope guarantees:** no dependency changes, no lockfile regeneration, no camera/slider/RevenueCat/Sentry/Phase 3/Phase 4 functional changes, no backend URL change.


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


---

## 2026-02 · Phase 4 — Rehearsal debug UI leak + cold-start crash triage

### Physical evidence in this round
Samsung S23 Ultra / SM-S918B / Android 16 / ScriptMate 1.0.46 /
VersionCode 1069 / Build 1110.

**Cold-reopen intermittent crash — 5 attempts:**
- Attempt 1: crash
- Attempt 2: crash
- Attempt 3: normal
- Attempt 4: crash
- Attempt 5: normal

Every successful reopen showed the same diagnostic sequence:
`ScriptScreen opened → script-1.docx → 3 characters → 33 lines →
createRehearsal ok → rehearsal navigation`. Persistence and the
happy-path are confirmed functional. The crash is intermittent and has
no adb / logcat / tombstone / Android bugreport / Sentry evidence
available in the preview container.

**Debug UI leak — visible in the rehearsal screen on-device.** The
diagnostic screenshot showed `[DEBUG] SR current state: inactive` and
`SR:Y | Auto:N | Listen:N | State:idle` rendered directly to the user.

### Fix — Rehearsal debug UI leak
- `frontend/app/rehearsal/[id].tsx` — wrap the visible debug banner in
  `{__DEV__ && ( ... )}`. Metro strips `__DEV__` branches from release
  APKs so the banner cannot render for production users.
- Internal `debugLog()` (`console.log('[Rehearsal-Debug] ...')` +
  `setDebugInfo(msg)`) is preserved so QA logcat capture still works.
- New testID `rehearsal-debug-banner` for future QA toggling.
- No changes to speech recognition, auto-advance, state machine,
  permissions, animation, or navigation.

### Cold-start / reopen crash
**NOT fixed in this pass. Investigation only.** No native evidence
available in this environment. Working hypotheses (all source-level,
none proven) previously logged: community `Slider` on Fabric,
RevenueCat init/configure race, always-mounted `<Modal>` + Slider,
`VoiceAssignment` mount-time AsyncStorage storm. None of them were
converted into code per user directive: "Do not create a speculative
fix merely to make the issue disappear."

### Files changed
- `frontend/app/rehearsal/[id].tsx` — one JSX block gated behind `__DEV__`.
- `backend/tests/test_rehearsal_debug_ui_leak.py` — NEW, 10 guards.

### Tests
- **NEW:** `test_rehearsal_debug_ui_leak.py` — **10 / 10 pass**.
- Full guard regression: **226 / 226 pass** (previous 216 + 10 new).
- Entitlement/premium: **34 / 34 pass** (subset of the 226).
- Runtime engine smoke `scripts/learn_engine_smoketest.js`:
  **22 / 22 pass** (unchanged baseline).
- TypeScript on `app/rehearsal/[id].tsx`: 1 pre-existing error at
  line 586 (`Type 'number' is not assignable to type 'Timeout'`) —
  **not touched by this fix**. No new TS errors introduced.
- 18 pre-existing backend lint issues: untouched per user directive.

### Not changed
`services/learnEngine.ts`, `services/learnStorage.ts`, `app/learn/*`,
scriptStore, parser, Phase 3 self-tape files,
`patches/expo-camera+17.0.10.patch`, self-tape storage, Script Library
storage, speech-recognition wiring, auto-advance, permissions.

### Network Error
`AxiosError: Network Error` in the diagnostic remains unrelated to the
crash and to the rehearsal happy-path — the same session shows
successful `/api/scripts/{id}` (200), `createRehearsal` (200), and
rehearsal navigation. Most probable source is a transient failure on
`initializeUser` / `fetchUserLimits` / `fetchSubscriptionPlans`
(background, wrapped in try/catch, fail-soft). No networking rewrite
performed.

### APK
Not built. No EAS trigger. No GitHub push. Per user directive.


---

## 2026-02 · Phase 4 — Fabric-safe Slider migration (Option A)

### Physical trigger
Samsung S23 Ultra / SM-S918B / Android 16 / build 1.0.47 (VC 1070) —
deterministic native crash ("ScriptMate Pro closed because this app
has a bug") on tapping the Home "Recall" tile. Same underlying cause
as the intermittent Library → ScriptScreen cold-reopen crash.

### Root cause (source-supported)
`@react-native-community/slider@4.5.5` × `newArchEnabled: true` × Android 16.
The 4.x community slider has incomplete Fabric interop and aborts
during native-view attach on this exact device/OS combination.
Learn/Session uses pill `TouchableOpacity` selectors — no slider —
which is why Phase 4 physically passed while Recall (2 sliders on
mount) crashed deterministically.

### Fix — Option A (per user directive)
Swap the community slider for a pure-JS wrapper on
`@miblanchard/react-native-slider@2.6.0`. No native module, no
codegen, no Fabric interop → the exact native surface that crashes
cannot be reached. Same visual output. Callers keep their `number`
value + `(number) => void` callback signatures unchanged; the wrapper
handles the underlying library's `number[]` shape.

### Files changed
- **NEW:** `frontend/components/FabricSafeSlider.tsx` — thin adapter,
  drop-in default-exported `Slider` component preserving the community
  slider's exact prop signature.
- `frontend/app/recall.tsx` — import swap (2 sliders unchanged).
- `frontend/app/script/[id].tsx` — import swap (2 sliders unchanged).
- `frontend/app/acting-coach.tsx` — import swap (1 slider unchanged).
- `frontend/app/selftape/prep.tsx` — import swap (1 slider unchanged).
- `frontend/package.json`:
  - **Removed:** `@react-native-community/slider@^4.5.5` from
    `dependencies` and from `resolutions`.
  - **Removed:** `expo.install.exclude` entry for the community slider.
  - **Added:** `@miblanchard/react-native-slider@2.6.0` in
    `dependencies`.
- `frontend/yarn.lock` — regenerated via `yarn expo install`.
- **NEW:** `backend/tests/test_fabric_safe_slider_migration.py` — 22
  guards locking the migration.

### Not changed
Learn engine, Learn storage, Learn Hub, Learn session (already
slider-free), Learn summary, Phase 3 record.tsx, teleprompter.tsx,
selfTapeStorage.ts, expo-camera patch, scriptStore, script parser,
Script Library storage. No behaviour or UX change anywhere — same
`<Slider ... />` JSX at every existing call site, just a different
import target.

### Tests
- **NEW:** `test_fabric_safe_slider_migration.py` — **22 / 22 pass**.
- Full guard regression: **248 / 248 pass** (226 previous + 22 new).
- Entitlement/premium: **34 / 34 pass** (subset).
- Runtime engine smoke `scripts/learn_engine_smoketest.js`:
  **22 / 22 pass**.
- TypeScript: **0 new errors**. The migration actually resolved 4
  pre-existing "Cannot find module" errors that appeared once the
  community-slider dependency was removed. All remaining TS errors in
  the four caller files are pre-existing (untouched per user
  directive).
- 18 pre-existing backend lint issues: untouched per user directive.

### APK
Not built. No EAS trigger. No GitHub push. Per user directive.

### Native crash status
Recall crash + intermittent ScriptScreen cold-reopen crash: root
cause addressed source-side. Physical verification pending the next
build. No native evidence was needed for this fix because the source
evidence (Fabric flag + slider version + call-site count on each
crashing screen) is deterministic.


---

## 2026-02 · ScriptMate AI · Coming Soon (UI-only) + Slider migration confirmed

### Task 1 — Fabric-safe Slider (already applied in the prior pass)
Confirmed still applied on this pass. No community-slider imports
remain in `recall.tsx`, `script/[id].tsx`, `acting-coach.tsx`, or
`selftape/prep.tsx`. `@miblanchard/react-native-slider` present in
`dependencies`. Wrapper `components/FabricSafeSlider.tsx` intact.
Locked by 22 pytest guards.

### Task 2 — AI Coming Soon
Purely UI presentation. Zero AI functionality, API calls, backend,
dependencies, or paywall changes. Five features rendered in a
dedicated roadmap section:

  1. AI Rehearsal Partner
  2. AI Line Coach
  3. AI Scene Coach
  4. AI Script Assistant
  5. World-Class Dialect Coach

Each card carries a "COMING SOON" badge. Cards are decorative — no
TouchableOpacity, no router calls, no onPress. Section reused
verbatim on both Home and Dashboard.

### Files changed (Task 2)
- **NEW:** `frontend/components/AIComingSoonSection.tsx` — the
  reusable roadmap section. Exports `AIComingSoonSection` (default)
  and `AI_ROADMAP` (frozen readonly list for tests).
- `frontend/app/index.tsx`:
  - Removed "Acting Coach" and "Dialect Coach" from the 4-tool grid.
  - Grid now: Self Tape · New Script · Recall · My Scripts.
  - Removed the redundant "Recall + My Scripts" dualRow (folded up
    into the grid).
  - Added `<AIComingSoonSection />` before the "More" section.
- `frontend/app/dashboard.tsx`:
  - Removed the "Dialect Coach" and "Acting Coach" Quick Action
    tiles (routed to `/dialect-coach` and `/acting-coach`).
  - Added `<AIComingSoonSection />` under Quick Actions.
- **NEW:** `backend/tests/test_ai_coming_soon_ui.py` — 18 guards.

### Not changed (Task 2)
Underlying route files `app/acting-coach.tsx`, `app/dialect-coach.tsx`,
`app/scene-partner.tsx` remain intact so deeplinks and share URLs
still resolve. This is a UI demotion, not a feature removal.
Learn Hub / Session / Summary, Learn engine + storage, Phase 3
self-tape files, expo-camera patch, scriptStore, script parser,
Script Library storage, paywall, RevenueCat, ElevenLabs, Sentry —
all untouched.

### Tests
- **NEW:** `test_ai_coming_soon_ui.py` — **18 / 18 pass**.
- **NEW (prior pass):** `test_fabric_safe_slider_migration.py` —
  **22 / 22 pass**.
- Full guard regression: **266 / 266 pass** (248 previous + 18 new).
- Entitlement/premium: **34 / 34 pass** (subset).
- Runtime engine smoke: **22 / 22 pass**.
- TypeScript: **0 new errors** introduced. Verified via `git stash`
  diff — the two remaining errors in `index.tsx` and `dashboard.tsx`
  are pre-existing (only line numbers shifted by ±1 due to added
  imports).
- 18 pre-existing backend lint issues: untouched.

### APK
Not built. No EAS trigger. No GitHub push. Per user directive.


---

## 2026-02 · Two physical QA defect fixes (Rehearsal scroll + intra-word spacing)

### Physical trigger
Samsung SM-S918B / Android 16 / build 1.0.47:
- Rehearse advanced state correctly but the ScrollView did not follow
  the highlighted line, so the "current line" drifted off-screen.
- Imported script text showed intra-word spaces (`w ant`,
  `unde rstand`, `isn 't`, `ne ver`, `y ou`).

### Fix 1 — Rehearsal auto-scroll uses measured y (JS-only)
`frontend/app/rehearsal/[id].tsx`:
- Added `lineYRef = useRef<Record<number, number>>({})` next to
  `scrollViewRef`.
- Added `onLayout` to the mapped script-line `<View>` writing
  `e.nativeEvent.layout.y` into `lineYRef.current[index]`.
- Auto-scroll effect now reads `lineYRef.current[currentLineIndex]`,
  bails safely if that y is not yet a number, and scrolls to
  `Math.max(0, y - 80)` while preserving `animated: true` and the
  100 ms deferral.
- Removed the hardcoded `currentLineIndex * 80` scroll math.

### Fix 2 — Smart-join dialogue fragments (backend Python only)
`backend/server.py`:
- Added helper `_smart_join_dialogue(fragments)` — concatenates when
  the previous fragment ends in a letter/apostrophe/hyphen AND the
  next starts lowercase or apostrophe; otherwise inserts one space.
  Handles empty/single fragments safely.
- Replaced all three `' '.join(current_text)` sites inside
  `fallback_parse_script` (previous lines 973, 983, 998) with
  `_smart_join_dialogue(current_text)`.
- PyPDF2 not replaced yet, no pdfplumber added (per user directive).

### Files changed
- `frontend/app/rehearsal/[id].tsx`
- `backend/server.py`
- `backend/tests/test_smart_join_and_rehearsal_scroll.py` (**NEW**, 28
  guards)
- `backend/tests/test_script_import_latency_and_prep_teleprompter_removal.py`
  (minor test-helper update: AST-isolated exec now also loads
  `_smart_join_dialogue` so the existing latency guard still exercises
  the parser)

### Not changed
Phase 3 self-tape / camera / expo-camera patch, Phase 4 Learn engine
+ storage + Hub + session + summary, FabricSafeSlider wrapper, AI
Coming Soon section, `parse_script_with_ai`, extractors, script
schema, RevenueCat, ElevenLabs, Sentry, paywall.

### Tests
- **NEW:** `test_smart_join_and_rehearsal_scroll.py` — **28 / 28
  pass** covering:
  - 5 observed intra-word fixtures (`w ant`, `unde rstand`, `isn 't`,
    `ne ver`, `y ou`)
  - normal word boundaries preserved (period, comma, uppercase-new-
    sentence, hyphen-continuation)
  - empty and single-fragment safety
  - `fallback_parse_script` end-to-end with synthetic mid-word
    newlines
  - rehearsal source guards for hardcoded-stride removal, `lineYRef`
    declaration, `onLayout` population, measured-y read, animated
    preservation, no-measurement safe bail
  - deterministic synthetic mixed-height scroll targets (validity,
    monotonicity, contentSize bounds; sanity-checks the old drift)
- `test_script_import_latency_and_prep_teleprompter_removal.py` —
  still **passing** (2 previously-failing tests fixed via the test-
  helper update).
- Full guard aggregate: **294 / 294 pass** (266 previous + 28 new).
- Runtime engine smoke: **22 / 22 pass**.
- TypeScript on `app/rehearsal/[id].tsx`: **0 new errors**. The 1
  pre-existing `Timeout` error line-shifted by +13 (matches the new
  `lineYRef` declaration + doc comment) but is otherwise unchanged.
- 18 pre-existing backend lint issues (7 of which trigger on
  server.py post-edit): untouched per user directive.

### Ship vectors
- **Backend intra-word spacing fix (`backend/server.py`)**:
  **Ready for the Emergent Docker backend deploy lane.** Already-
  installed APK (1.0.47) will consume the cleaned extraction on the
  next script import via `/api/scripts/upload-base64` +
  `/api/scripts`. **No mobile rebuild required.** Previously-imported
  scripts stay unchanged (no migration triggered).
- **Rehearsal scroll fix (`frontend/app/rehearsal/[id].tsx`)**:
  **Ready for the next single QA APK.** Because `expo-updates` is
  not linked into the 1.0.47 build (`app.json` has
  `updates.enabled: false` and `expo-updates` is absent from
  dependencies), this JS-only change cannot reach the S23 Ultra via
  OTA. The QA APK from `eas.json` profile `preview` is sufficient —
  no production AAB needed yet.

### APK / EAS / GitHub
None triggered.


---

## 2026-02 · DOCX intra-word spacing fix (two-layer, backend only)

### Physical trigger
S23 Ultra QA screenshot on build 1.0.47 showed `isn 't`, `w anto`,
`unde rstand`, `w hat` in `script-1.docx` after the previous
`_smart_join_dialogue` fix landed. Investigation traced the artefact
to DOCX-side embedded whitespace variants surviving as intra-line
characters that `_smart_join_dialogue` could not see because it only
merges newline-split fragments.

### Fix
Two composable helpers in `backend/server.py`:

**Layer 1 — `_normalize_docx_whitespace(s)`**: canonicalises DOCX
whitespace variants to a single regular space. Called on each
`paragraph.text` and `cell.text` inside `extract_text_from_docx` so
downstream code sees a consistent stream:
- `\t` (from `<w:tab/>`) → ` `
- `\xa0` (NBSP) → ` `
- `\u2007` (figure space) → ` `
- `\u202f` (narrow NBSP) → ` `
- `\u200b` (zero-width space) → removed
- `\n` preserved

**Layer 2 — `_repair_intra_word_spaces(text)`**: applied to the
FINAL joined dialogue text (immediately after
`_smart_join_dialogue(current_text)`) and to stage-direction bodies
inside `fallback_parse_script`. Three deterministic rules with strict
boundaries to prevent false positives on legitimate dialogue:

- **Rule A — apostrophe / hyphen glue.**
  `re.sub(r"([A-Za-z]) +(['\-]) *([A-Za-z])", r"\1\2\3", text)`
  Repairs `isn 't`, `don 't`, `we 're`, `mid - way`.
- **Rule B — single-letter non-vowel prefix, strict left boundary.**
  `re.sub(r"(?:^|(?<=\s))([b-hj-np-zB-HJ-NP-Z]) +([a-z]{2,})\b", r"\1\2", text)`
  Repairs `w hat`, `w ant`, `w anto`, `y ou`. Excludes `a`, `A`,
  `I`, `o` so `a bike`, `I said`, `o my king` stay intact. Strict
  `(?:^|(?<=\s))` left boundary prevents matching the `t` in
  `isn't easy`.
- **Rule C — short-fragment merge with stopword guard.**
  `re.sub(r"\b([a-z]{2,4}) +([a-z]{2,})\b", …)` — merges only when
  neither side is in a curated 92-word English stopword frozenset
  (`the`, `and`, `did`, `you`, `not`, `now`, `too`, `who`, `why`,
  `let`, `has`, `was`, `did`, `can`, `never`, …). Repairs
  `unde rstand`, `ne ver`. Leaves `the man`, `did not`, `you know`,
  `say hello`, `how are` untouched.

### Wiring / composition
The Layer 2 repair is applied AFTER `_smart_join_dialogue` (not before)
so it never fires inside a fragment still awaiting a newline-boundary
merge. That composition means PDF (newline-split) and DOCX (intra-line
space) defects are both repaired without either helper interfering
with the other.

### Files changed
- `backend/server.py`:
  - `import re` added to the module imports.
  - New module constants `_DOCX_WHITESPACE_REPLACEMENTS`,
    `_INTRA_WORD_STOPWORDS`, `_INTRA_WORD_APOSTROPHE_HYPHEN`,
    `_INTRA_WORD_SINGLE_LETTER`, `_INTRA_WORD_SHORT_FRAGMENT`.
  - New helpers `_normalize_docx_whitespace(s)` and
    `_repair_intra_word_spaces(text)`.
  - `extract_text_from_docx` now normalises whitespace on each
    `paragraph.text` / `cell.text`.
  - `fallback_parse_script` now wraps every
    `_smart_join_dialogue(current_text)` and every stage-direction
    body with `_repair_intra_word_spaces(...)`.
- `backend/tests/test_script_import_latency_and_prep_teleprompter_removal.py`:
  - `_load_fallback_parser` extended to AST-load
    `_repair_intra_word_spaces` + its module constants into the
    isolated namespace so the existing latency guard keeps working.
- **NEW** `backend/tests/test_docx_intra_word_spacing.py` — 63
  focused guards.

### Not changed
No frontend change. No new dependency. No pdfplumber. No stored-
scripts migration. No native code. No Phase 3 / Phase 4 touch.

### Tests
- **NEW** `test_docx_intra_word_spacing.py` — **63 / 63 pass**.
  Covers: whitespace variants (9), apostrophe/hyphen glue (5),
  single-letter prefix + negatives (8), short-fragment + 17 stopword
  negatives (19), stage-direction / character-cue pass-through (8),
  in-memory DOCX fixtures for shapes A/B/D/G end-to-end (4),
  sentence-level artefacts vs legitimate dialogue (2),
  `_smart_join_dialogue` regression (6), stage-direction end-to-end
  (1).
- `test_smart_join_and_rehearsal_scroll.py` — **28 / 28 pass** (both
  previous failures resolved by moving repair to post-smart-join).
- `test_script_import_latency_and_prep_teleprompter_removal.py` —
  passing.
- **Full guard aggregate: 357 / 357 pass** (294 previous + 63 new).
- Runtime engine smoke: **22 / 22 pass**.
- Entitlement / premium subset: **34 / 34 pass**.
- TypeScript: no frontend change — unchanged baseline; the single
  pre-existing `Timeout` error at `app/rehearsal/[id].tsx:599`
  remains untouched.
- 18 pre-existing backend lint issues: untouched per user directive.

### Live proof against deployed backend
`POST /api/users` + `POST /api/scripts` on
`save-script-verify.preview.emergentagent.com`:
- `"I don 't w ant this and you unde rstand isn 't easy."` →
  `"I don't want this and you understand isn't easy."` ✅
- `"Y ou w hat? I ne ver said that."` →
  `"You what? I never said that."` ✅
- `"Try the mid - way path."` → `"Try the mid-way path."` ✅
- `"The man did not know you. Say hello. How are you? I said a bike."` →
  unchanged ✅

### Ship vector
**Ready for one controlled Emergent Docker backend deployment.** No
mobile rebuild needed for this fix to reach the S23 Ultra — the
installed 1.0.47 APK consumes the cleaned extraction on the next
script import. Previously-imported scripts (including the current
`script-1.docx`) remain in Mongo with the old artefacts baked in;
retroactive cleanup would need a separate one-off migration task
(not part of this fix).

