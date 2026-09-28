// Runtime engine smoke test — pure Node, no RN, no AsyncStorage.
// Verifies deterministic behaviour of learnEngine.
const path = require('path');
const { execSync } = require('child_process');

const outDir = path.join(__dirname, 'learn_engine_smoke_build');
require('fs').mkdirSync(outDir, { recursive: true });
try {
  execSync(
    `npx tsc --outDir ${outDir} --target ES2019 --module commonjs --esModuleInterop --skipLibCheck --moduleResolution node --noResolve false --isolatedModules --noEmit false frontend/services/learnEngine.ts`,
    { stdio: 'pipe', cwd: path.join(__dirname, '..') },
  );
} catch (e) {
  // tsc may exit non-zero due to unrelated errors in other files that get
  // pulled in by import resolution. We only care that our target file was
  // emitted; verify below.
}
const outFile = path.join(outDir, 'services/learnEngine.js');
if (!require('fs').existsSync(outFile)) {
  console.error(`compiled engine not found at ${outFile}`);
  process.exit(1);
}

const engine = require(outFile);
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

// ─── Fixture ────────────────────────────────────────────────────────────
const script = {
  id: 'sc1', title: 'Test', raw_text: '', user_id: 'u', created_at: '', updated_at: '',
  characters: [
    { id: 'ch-A', name: 'ALICE', line_count: 3, is_user_character: true },
    { id: 'ch-B', name: 'BOB', line_count: 2, is_user_character: false },
  ],
  lines: [
    { id: 'l1', character: 'DIRECTION', text: 'INT. KITCHEN - DAY', is_stage_direction: true, line_number: 1 },
    { id: 'l2', character: 'BOB', text: 'Where were you last night?', is_stage_direction: false, line_number: 2 },
    { id: 'l3', character: 'ALICE', text: 'I was at the library, studying.', is_stage_direction: false, line_number: 3 },
    { id: 'l4', character: 'BOB', text: 'Really? All night?', is_stage_direction: false, line_number: 4 },
    { id: 'l5', character: 'ALICE', text: 'Yes, really. Working on the thesis.', is_stage_direction: false, line_number: 5 },
    { id: 'l6', character: 'DIRECTION', text: 'INT. BEDROOM - LATER', is_stage_direction: true, line_number: 6 },
    { id: 'l7', character: 'ALICE', text: 'What difference does it make?', is_stage_direction: false, line_number: 7 },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────
t('extractLearnItems returns 3 items for ALICE', () => {
  const items = engine.extractLearnItems(script, 'ch-A', {});
  if (items.length !== 3) throw new Error(`expected 3, got ${items.length}`);
});

t('extractLearnItems attaches cue from immediately preceding non-actor line', () => {
  const items = engine.extractLearnItems(script, 'ch-A', {});
  if (items[0].cue?.text !== 'Where were you last night?') throw new Error(`cue mismatch: ${JSON.stringify(items[0].cue)}`);
  if (items[1].cue?.text !== 'Really? All night?') throw new Error(`cue2 mismatch`);
});

t('extractLearnItems increments scene number on stage-direction scene headers', () => {
  const items = engine.extractLearnItems(script, 'ch-A', {});
  if (items[0].sceneNumber !== 2) throw new Error(`first item scene ${items[0].sceneNumber} (expected 2 — starts at 1 then hits INT. header)`);
  if (items[2].sceneNumber !== 3) throw new Error(`third item scene ${items[2].sceneNumber} (expected 3)`);
});

t('extractLearnItems returns [] for missing character', () => {
  const items = engine.extractLearnItems(script, 'ch-ZZZ', {});
  if (items.length !== 0) throw new Error(`expected 0, got ${items.length}`);
});

t('extractLearnItems returns [] for empty script', () => {
  const items = engine.extractLearnItems({ ...script, lines: [] }, 'ch-A', {});
  if (items.length !== 0) throw new Error(`expected 0`);
});

t('makeRecordId is stable and formatted', () => {
  const id = engine.makeRecordId('s', 'c', 'l');
  if (id !== 's:c:l') throw new Error(id);
});

t('deriveCueWords picks content words, skips stops and short', () => {
  const w = engine.deriveCueWords('I was at the library, studying.', 3);
  if (JSON.stringify(w) !== JSON.stringify(['library', 'studying'])) {
    throw new Error(JSON.stringify(w));
  }
});

t('deriveCueWords strips parentheticals', () => {
  const w = engine.deriveCueWords('(quietly) The truth is complicated.', 3);
  if (!w.includes('truth')) throw new Error(JSON.stringify(w));
  if (w.includes('quietly')) throw new Error('parenthetical leaked');
});

t('tokenizeForMode difficulty 1 masks nothing', () => {
  const toks = engine.tokenizeForMode('hello beautiful world', 1);
  if (toks.some(t => t.kind === 'word' && t.isMasked)) throw new Error('leak');
});

t('tokenizeForMode difficulty 5 masks all words', () => {
  const toks = engine.tokenizeForMode('hello beautiful world', 5);
  const wordTokens = toks.filter(t => t.kind === 'word');
  if (wordTokens.length !== 3) throw new Error(`words=${wordTokens.length}`);
  if (wordTokens.some(t => !t.isMasked)) throw new Error('should all be masked');
});

t('tokenizeForMode difficulty 4 keeps first letter', () => {
  const toks = engine.tokenizeForMode('hello beautiful world', 4);
  const w = toks.filter(t => t.kind === 'word' && t.isMasked);
  if (w.length === 0) throw new Error('nothing masked');
  if (!/^[a-z]/.test(w[0].masked)) throw new Error(`first letter missing: ${w[0].masked}`);
});

t('applyAssessment got_it increments successes + streak', () => {
  let r = engine.newLearningRecord('s', 'c', 'l');
  r = engine.applyAssessment(r, 'got_it', '2026-02-01T00:00:00Z');
  if (r.successes !== 1 || r.consecutiveSuccesses !== 1) throw new Error(JSON.stringify(r));
});

t('applyAssessment missed increments misses and resets streak', () => {
  let r = engine.newLearningRecord('s', 'c', 'l');
  r = engine.applyAssessment(r, 'got_it', 't1');
  r = engine.applyAssessment(r, 'missed', 't2');
  if (r.misses !== 1 || r.consecutiveSuccesses !== 0) throw new Error(JSON.stringify(r));
});

t('classifyWeak flags line after 2 misses at 40%+ rate', () => {
  let r = engine.newLearningRecord('s', 'c', 'l');
  r = engine.applyAssessment(r, 'missed', 't1');
  r = engine.applyAssessment(r, 'missed', 't2');
  if (!r.isWeak) throw new Error('should be weak');
});

t('classifyWeak clears after 3 consecutive successes (recovery)', () => {
  let r = engine.newLearningRecord('s', 'c', 'l');
  r = engine.applyAssessment(r, 'missed', 't1');
  r = engine.applyAssessment(r, 'missed', 't2');
  if (!r.isWeak) throw new Error('not weak yet');
  r = engine.applyAssessment(r, 'got_it', 't3');
  r = engine.applyAssessment(r, 'got_it', 't4');
  r = engine.applyAssessment(r, 'got_it', 't5');
  if (r.isWeak) throw new Error('should have recovered');
});

t('classifyMastery progresses new → learning → developing → strong → mastered', () => {
  let r = engine.newLearningRecord('s', 'c', 'l');
  if (r.masteryLevel !== 'new') throw new Error('should start new');
  r = engine.applyAssessment(r, 'got_it', 't1');
  if (r.masteryLevel !== 'learning') throw new Error(`got ${r.masteryLevel}`);
  r = engine.applyAssessment(r, 'got_it', 't2');
  if (r.masteryLevel !== 'developing') throw new Error(`got ${r.masteryLevel}`);
  r = engine.applyAssessment(r, 'got_it', 't3');
  if (r.masteryLevel !== 'strong') throw new Error(`got ${r.masteryLevel}`);
  r = engine.applyAssessment(r, 'got_it', 't4');
  r = engine.applyAssessment(r, 'got_it', 't5');
  if (r.masteryLevel !== 'mastered') throw new Error(`got ${r.masteryLevel}`);
});

t('mastery regresses on a miss', () => {
  let r = engine.newLearningRecord('s', 'c', 'l');
  for (let i = 0; i < 5; i++) r = engine.applyAssessment(r, 'got_it', `t${i}`);
  if (r.masteryLevel !== 'mastered') throw new Error('not mastered');
  r = engine.applyAssessment(r, 'missed', 't-miss');
  if (r.masteryLevel === 'mastered') throw new Error('should regress');
  if (r.consecutiveSuccesses !== 0) throw new Error('streak not reset');
});

t('createSession returns ready state for non-empty', () => {
  const s = engine.createSession({ scriptId: 's', characterId: 'c', type: 'full', itemIds: ['a', 'b'], nowIso: 't' });
  if (s.state !== 'ready' || s.currentIndex !== 0) throw new Error(JSON.stringify(s));
});

t('createSession returns completed for empty itemIds', () => {
  const s = engine.createSession({ scriptId: 's', characterId: 'c', type: 'full', itemIds: [], nowIso: 't' });
  if (s.state !== 'completed') throw new Error(JSON.stringify(s));
});

t('advanceSession increments and completes on last item', () => {
  let s = engine.createSession({ scriptId: 's', characterId: 'c', type: 'full', itemIds: ['a', 'b'], nowIso: 't' });
  s = engine.advanceSession(s, 'got_it', 't2');
  if (s.currentIndex !== 1 || s.state !== 'active') throw new Error(JSON.stringify(s));
  s = engine.advanceSession(s, 'got_it', 't3');
  if (s.state !== 'completed') throw new Error(`state=${s.state}`);
});

t('pause/resume/restart cycle works', () => {
  let s = engine.createSession({ scriptId: 's', characterId: 'c', type: 'full', itemIds: ['a', 'b'], nowIso: 't' });
  s = engine.advanceSession(s, 'got_it', 't2');
  s = engine.pauseSession(s);
  if (s.state !== 'paused') throw new Error('not paused');
  s = engine.resumeSession(s);
  if (s.state !== 'active') throw new Error('not active');
  s = engine.restartSession(s, 't3');
  if (s.currentIndex !== 0 || s.attempts !== 0) throw new Error('restart failed');
});

t('aggregateProgress counts weak, practised, mastery buckets', () => {
  const items = [
    { id: '1', record: { attempts: 0, isWeak: false, masteryLevel: 'new', successes: 0, misses: 0 } },
    { id: '2', record: { attempts: 5, isWeak: true, masteryLevel: 'learning', successes: 1, misses: 3 } },
    { id: '3', record: { attempts: 6, isWeak: false, masteryLevel: 'mastered', successes: 6, misses: 0 } },
  ];
  const agg = engine.aggregateProgress(items);
  if (agg.totalItems !== 3) throw new Error();
  if (agg.practiced !== 2) throw new Error(`practiced=${agg.practiced}`);
  if (agg.weak !== 1) throw new Error(`weak=${agg.weak}`);
  if (agg.strongOrMastered !== 1) throw new Error();
  if (agg.masteryCounts.mastered !== 1) throw new Error();
});

// ─── Report ────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
try { require('fs').rmSync(path.join(__dirname, 'learn_engine_smoke_build'), { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
