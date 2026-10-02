// ─── Voice Gender Inference Smoke Test ───────────────────────────────
// Exercises the pure helper `inferGenderFromScriptPure` used by the
// VoiceAssignment component to pick a gender-matched voice pool. The
// helper is 100% deterministic and depends on no platform APIs, so
// this test compiles the pure module with tsc and requires it the
// same way `voice_pipeline_smoketest.js` does.
//
// 2026-02 Physical QA Blocker 2 — proves:
//   1. Honorific tokens in the character name pin gender immediately.
//   2. Pronoun ratios in stage directions decide gender when the name
//      itself is neutral.
//   3. Pronoun ratios in OTHER characters' dialogue decide gender
//      when stage directions are sparse.
//   4. Common first names in the allowlist are a last-resort signal.
//   5. Conflicting / absent signals resolve to 'unknown' so the caller
//      can safely fall back to the mixed-gender rotation.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'voice_gender_inference_build');
fs.mkdirSync(outDir, { recursive: true });

try {
  execSync(
    `npx tsc --outDir ${outDir} --target ES2019 --module commonjs --esModuleInterop --skipLibCheck --moduleResolution node --isolatedModules --noEmit false frontend/services/elevenLabsPure.ts`,
    { stdio: 'pipe', cwd: ROOT },
  );
} catch (_e) {
  // tsc may exit non-zero due to unrelated errors in the wider tree.
  // We only care that our target file was emitted; check below.
}

const outFile = path.join(outDir, 'elevenLabsPure.js');
if (!fs.existsSync(outFile)) {
  console.error(`Compiled pure module not found at ${outFile}`);
  process.exit(1);
}

const pure = require(outFile);
const { inferGenderFromScriptPure } = pure;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertTrue(v, msg) { if (!v) throw new Error(msg); }

console.log('voice_gender_inference_smoketest');

// ─── HONORIFIC TOKEN TESTS ──────────────────────────────────────────
t('honorific MR. => male', () => {
  const r = inferGenderFromScriptPure('MR. SMITH', []);
  assertEq(r.gender, 'male', 'MR. gender');
  assertTrue(r.confidence >= 0.9, 'MR. confidence');
});

t('honorific MRS. => female', () => {
  const r = inferGenderFromScriptPure('MRS. JONES', []);
  assertEq(r.gender, 'female', 'MRS. gender');
  assertTrue(r.confidence >= 0.9, 'MRS. confidence');
});

t('honorific MISS => female', () => {
  const r = inferGenderFromScriptPure('MISS HAVISHAM', []);
  assertEq(r.gender, 'female', 'MISS gender');
});

t('honorific WAITRESS => female', () => {
  const r = inferGenderFromScriptPure('WAITRESS', []);
  assertEq(r.gender, 'female', 'WAITRESS gender');
});

t('honorific WAITER => male', () => {
  const r = inferGenderFromScriptPure('WAITER', []);
  assertEq(r.gender, 'male', 'WAITER gender');
});

t('honorific KING => male', () => {
  const r = inferGenderFromScriptPure('KING ARTHUR', []);
  assertEq(r.gender, 'male', 'KING gender');
});

t('honorific QUEEN => female', () => {
  const r = inferGenderFromScriptPure('QUEEN GUINEVERE', []);
  assertEq(r.gender, 'female', 'QUEEN gender');
});

t('role word GIRL => female', () => {
  const r = inferGenderFromScriptPure('YOUNG GIRL', []);
  assertEq(r.gender, 'female', 'GIRL gender');
});

t('role word BOY => male', () => {
  const r = inferGenderFromScriptPure('THE BOY', []);
  assertEq(r.gender, 'male', 'BOY gender');
});

t('role token prefixed with detective rank => uses honorific', () => {
  // "DET. MR. HARRIS" — the "DET." isn't gendered but the "MR." is.
  const r = inferGenderFromScriptPure('DET. MR. HARRIS', []);
  assertEq(r.gender, 'male', 'DET MR gender');
});

// ─── STAGE DIRECTION PRONOUN TESTS ──────────────────────────────────
t('stage directions pin male when name is neutral', () => {
  const lines = [
    { character: '', is_stage_direction: true, text: 'ALEX enters the room. He wipes his brow and surveys the scene.' },
    { character: '', is_stage_direction: true, text: 'ALEX picks up a letter. His hand trembles.' },
    { character: 'JANE', is_stage_direction: false, text: 'Hello Alex.' },
  ];
  const r = inferGenderFromScriptPure('ALEX', lines);
  assertEq(r.gender, 'male', 'ALEX stage-dir male');
  assertTrue(r.confidence >= 0.8, 'ALEX confidence');
});

t('stage directions pin female when name is neutral', () => {
  const lines = [
    { character: '', is_stage_direction: true, text: 'TAYLOR enters. She removes her coat.' },
    { character: '', is_stage_direction: true, text: 'TAYLOR looks at the door. Her face falls.' },
  ];
  const r = inferGenderFromScriptPure('TAYLOR', lines);
  assertEq(r.gender, 'female', 'TAYLOR stage-dir female');
});

t('single ambiguous stage direction stays unknown', () => {
  const lines = [
    { character: '', is_stage_direction: true, text: 'JORDAN enters.' },
  ];
  const r = inferGenderFromScriptPure('JORDAN', lines);
  // Only one pronoun-free mention — no evidence, unknown.
  assertEq(r.gender, 'unknown', 'JORDAN unknown');
});

// ─── OTHER-CHARACTER DIALOGUE PRONOUN TESTS ─────────────────────────
t('other characters pronoun ratio pins male', () => {
  const lines = [
    { character: 'MARIA', is_stage_direction: false, text: 'Where is Casey? He said he would meet us.' },
    { character: 'MARIA', is_stage_direction: false, text: 'I called Casey yesterday. His phone was off.' },
    { character: 'MARIA', is_stage_direction: false, text: 'He always does this when it comes to Casey.' },
    { character: 'CASEY', is_stage_direction: false, text: 'I am here.' },
  ];
  const r = inferGenderFromScriptPure('CASEY', lines);
  assertEq(r.gender, 'male', 'CASEY dialogue male');
});

t('other characters pronoun ratio pins female', () => {
  const lines = [
    { character: 'JOHN', is_stage_direction: false, text: 'Where is Casey? She said she would meet us.' },
    { character: 'JOHN', is_stage_direction: false, text: 'I called Casey yesterday. Her phone was off.' },
    { character: 'JOHN', is_stage_direction: false, text: 'She always does this when it comes to Casey.' },
  ];
  const r = inferGenderFromScriptPure('CASEY', lines);
  assertEq(r.gender, 'female', 'CASEY dialogue female');
});

t('pronouns NOT in a sentence mentioning the character are ignored', () => {
  // Another character has lots of "he/his" but never near our name.
  const lines = [
    { character: 'TOM', is_stage_direction: false, text: 'He went to the store. His car broke down. He walked home.' },
    { character: 'TOM', is_stage_direction: false, text: 'Have you seen Riley lately?' },
  ];
  const r = inferGenderFromScriptPure('RILEY', lines);
  assertEq(r.gender, 'unknown', 'RILEY unknown (pronouns not near name)');
});

// ─── FIRST-NAME ALLOWLIST TESTS ─────────────────────────────────────
t('first-name allowlist pins male when name token matches', () => {
  const r = inferGenderFromScriptPure('JOHN', []);
  assertEq(r.gender, 'male', 'JOHN male');
});

t('first-name allowlist pins female when name token matches', () => {
  const r = inferGenderFromScriptPure('EMILY', []);
  assertEq(r.gender, 'female', 'EMILY female');
});

t('ambiguous name NOT on allowlist stays unknown', () => {
  const r = inferGenderFromScriptPure('ZEEBO', []);
  assertEq(r.gender, 'unknown', 'ZEEBO unknown');
});

// ─── SIGNAL PRIORITY TESTS ──────────────────────────────────────────
t('honorific wins over conflicting pronouns', () => {
  // Weird edge: a MRS. where the stage direction uses "he" (typo).
  // Honorific wins because it is the highest-confidence signal.
  const lines = [
    { character: '', is_stage_direction: true, text: 'MRS. SMITH enters. He waves.' },
    { character: '', is_stage_direction: true, text: 'MRS. SMITH turns. His coat is on.' },
  ];
  const r = inferGenderFromScriptPure('MRS. SMITH', lines);
  assertEq(r.gender, 'female', 'MRS wins over pronoun typo');
});

t('stage dir evidence wins over first-name allowlist', () => {
  // 'EMILY' is in the female allowlist but every stage direction
  // overwhelmingly uses 'he/his' for them — should go male.
  const lines = [
    { character: '', is_stage_direction: true, text: 'EMILY enters. He adjusts his tie.' },
    { character: '', is_stage_direction: true, text: 'EMILY frowns. He checks his watch.' },
    { character: '', is_stage_direction: true, text: 'He turns to EMILY. His face is grave.' },
  ];
  const r = inferGenderFromScriptPure('EMILY', lines);
  assertEq(r.gender, 'male', 'stage-dir overrides first-name');
});

// ─── EDGE CASES ─────────────────────────────────────────────────────
t('empty character name is unknown', () => {
  const r = inferGenderFromScriptPure('', []);
  assertEq(r.gender, 'unknown', 'empty name');
});

t('empty lines + unknown name is unknown', () => {
  const r = inferGenderFromScriptPure('ZORG', []);
  assertEq(r.gender, 'unknown', 'ZORG unknown');
});

t('equal male/female pronouns stay unknown (no 3x ratio)', () => {
  const lines = [
    { character: '', is_stage_direction: true, text: 'PAT enters. He is tired. She is tired.' },
    { character: '', is_stage_direction: true, text: 'PAT sighs. His coat drops. Her bag drops.' },
  ];
  const r = inferGenderFromScriptPure('PAT', lines);
  assertEq(r.gender, 'unknown', 'PAT ambiguous unknown');
});

t('does not crash on undefined-text lines', () => {
  const lines = [
    { character: '', is_stage_direction: true, text: undefined },
    { character: '', is_stage_direction: false, text: null },
    { character: '', is_stage_direction: true, text: 'JOHN enters. He waves. He waves again.' },
  ];
  // JOHN is in the allowlist, so even without pronoun scanning this
  // returns male — but the undefined/null lines must NOT throw.
  const r = inferGenderFromScriptPure('JOHN', lines);
  assertEq(r.gender, 'male', 'JOHN with bad lines');
});

t('honorific result includes diagnostic signal', () => {
  const r = inferGenderFromScriptPure('MR. SMITH', []);
  assertTrue(Array.isArray(r.signals), 'signals array');
  assertTrue(r.signals.some(s => s.startsWith('honorific:')), 'honorific signal present');
});

t('unknown result includes diagnostic signal', () => {
  const r = inferGenderFromScriptPure('ZORG', []);
  assertTrue(r.signals.includes('no-signal'), 'no-signal diag');
});

// ─── SUMMARY ────────────────────────────────────────────────────────
console.log(`\nvoice_gender_inference_smoketest: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
