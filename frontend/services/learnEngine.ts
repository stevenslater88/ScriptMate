/**
 * Learn Engine — pure, deterministic, offline, local-first.
 *
 * Phase 4 (Learn) foundation. This module contains ONLY pure functions
 * over the ScriptMate script model and the LearningRecord/LearningSession
 * types. No I/O, no AsyncStorage, no network, no LLM. All storage lives
 * in `services/learnStorage.ts`; all screens live under `app/learn/`.
 *
 * Design goals:
 *   * Local-first / offline-capable — no backend calls.
 *   * Deterministic — same input → same output.
 *   * Stable IDs — records are keyed by `${scriptId}:${characterId}:${lineId}`
 *     (never by array index), so record identity survives line reorder,
 *     insertion, or renaming.
 *   * Reuses the existing Script / DialogueLine / Character model from
 *     `store/scriptStore.ts`; does NOT create a duplicate script model.
 *   * AI-boundary safe — nothing in the core loop reaches for an LLM.
 *     Future AI Line Coach / AI Rehearsal Partner / ElevenLabs voice
 *     integrations can consume LearningRecord/LearningSession without
 *     rewriting anything here.
 *
 * Difficulty levels (Phase 4E):
 *   1 — Supported     (full line visible)
 *   2 — Cue-assisted  (~30% words blacked out)
 *   3 — Reduced cues  (~55% words blacked out)
 *   4 — Blackout      (~80% words blacked out, first letters visible)
 *   5 — Full recall   (actor line fully hidden until Reveal)
 *
 * Mastery states (Phase 4E):
 *   new → learning → developing → strong → mastered
 *   (reversible; a recent miss can drop mastery per deterministic rules)
 */

import type { Script, Character, DialogueLine } from '../store/scriptStore';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type SelfAssessment = 'got_it' | 'almost' | 'missed';

export type MasteryLevel =
  | 'new'
  | 'learning'
  | 'developing'
  | 'strong'
  | 'mastered';

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type SessionState = 'ready' | 'active' | 'paused' | 'completed';

export type SessionType = 'full' | 'scene' | 'weak' | 'custom';

/**
 * The stable, persisted per-line learning record. Keyed by
 * `${scriptId}:${characterId}:${lineId}` — never by array index.
 */
export interface LearningRecord {
  id: string;
  scriptId: string;
  characterId: string;
  lineId: string;
  attempts: number;
  successes: number;
  misses: number;
  /** Most recent self-assessment, or null if never attempted. */
  lastResult: SelfAssessment | null;
  /** Consecutive 'got_it' streak. Resets on 'almost' or 'missed'. */
  consecutiveSuccesses: number;
  /** ISO string of the most recent attempt, or null. */
  lastPracticedAt: string | null;
  /** Deterministic weak-line flag (see classifyWeak). */
  isWeak: boolean;
  masteryLevel: MasteryLevel;
  /** Suggested difficulty for the next attempt on this line (Phase 4E). */
  difficultyLevel: DifficultyLevel;
}

/**
 * The active/paused/completed session state. Persisted so the actor
 * can leave the screen and come back without losing progress.
 */
export interface LearningSession {
  id: string;
  scriptId: string;
  characterId: string;
  type: SessionType;
  /**
   * Filter that produced `itemIds`. `null` means the full script.
   * For 'scene' this carries the 1-based scene number extracted from
   * the parser (deterministic — see extractLearnItems).
   */
  sceneNumber: number | null;
  /** Ordered stable record IDs. */
  itemIds: string[];
  currentIndex: number;
  state: SessionState;
  startedAt: string;
  completedAt: string | null;
  attempts: number;
  successes: number;
  misses: number;
}

/**
 * Ephemeral view model produced by `extractLearnItems`. Combines the
 * script's dialogue + the immediately-preceding cue with the persisted
 * LearningRecord for the same line. Never persisted — recomputed on
 * every session start / reload.
 */
export interface LearnItem {
  id: string;
  lineId: string;
  lineNumber: number;
  /** The immediately-preceding non-stage-direction line spoken by
   *  someone OTHER than the actor character. null on the very first
   *  actor line of the script/scene. */
  cue: { character: string; text: string } | null;
  line: { character: string; text: string };
  /** Which scene block this line belongs to (1-based, deterministic;
   *  incremented by every stage direction whose text starts with a
   *  scene-header token). */
  sceneNumber: number;
  record: LearningRecord;
}

// ────────────────────────────────────────────────────────────────────────────
// Stable ID helpers
// ────────────────────────────────────────────────────────────────────────────

export function makeRecordId(
  scriptId: string,
  characterId: string,
  lineId: string,
): string {
  return `${scriptId}:${characterId}:${lineId}`;
}

export function makeSessionId(scriptId: string, characterId: string): string {
  // Timestamped — a new session is a new run.
  return `learn:${scriptId}:${characterId}:${Date.now()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Scene numbering (deterministic, parser-free)
// ────────────────────────────────────────────────────────────────────────────

const SCENE_HEADER_RE = /^\s*(?:INT\.?|EXT\.?|SCENE\b|ACT\b)\b/i;

function isSceneHeader(line: DialogueLine): boolean {
  if (!line.is_stage_direction) return false;
  return SCENE_HEADER_RE.test(line.text ?? '');
}

// ────────────────────────────────────────────────────────────────────────────
// Item extraction (Phase 4A.2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the actor's LearnItems from a parsed Script.
 *
 * Deterministic. For each actor line we attach the most recent
 * non-stage-direction line spoken by anybody else as the cue, and the
 * running scene number derived from stage-direction scene headers.
 *
 * Missing character → returns []. Empty scripts → returns [].
 */
export function extractLearnItems(
  script: Script,
  characterId: string,
  existingRecords: Record<string, LearningRecord>,
): LearnItem[] {
  if (!script || !Array.isArray(script.lines) || script.lines.length === 0) {
    return [];
  }
  const character: Character | undefined = (script.characters || []).find(
    (c) => c.id === characterId,
  );
  if (!character) return [];

  const items: LearnItem[] = [];
  let lastNonActorNonDirection: DialogueLine | null = null;
  let sceneNumber = 1;

  for (const line of script.lines) {
    if (isSceneHeader(line)) {
      sceneNumber += 1;
      continue;
    }
    if (line.is_stage_direction) continue;
    if (line.character !== character.name) {
      lastNonActorNonDirection = line;
      continue;
    }
    // This is an actor line.
    const recordId = makeRecordId(script.id, character.id, line.id);
    const record: LearningRecord =
      existingRecords[recordId] ?? newLearningRecord(script.id, character.id, line.id);
    items.push({
      id: recordId,
      lineId: line.id,
      lineNumber: line.line_number,
      cue:
        lastNonActorNonDirection != null
          ? {
              character: lastNonActorNonDirection.character,
              text: lastNonActorNonDirection.text,
            }
          : null,
      line: { character: line.character, text: line.text },
      sceneNumber,
      record,
    });
  }
  return items;
}

export function newLearningRecord(
  scriptId: string,
  characterId: string,
  lineId: string,
): LearningRecord {
  return {
    id: makeRecordId(scriptId, characterId, lineId),
    scriptId,
    characterId,
    lineId,
    attempts: 0,
    successes: 0,
    misses: 0,
    lastResult: null,
    consecutiveSuccesses: 0,
    lastPracticedAt: null,
    isWeak: false,
    masteryLevel: 'new',
    difficultyLevel: 1,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Cue-word derivation (Phase 4B.2) — deterministic, no LLM
// ────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
  'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me',
  'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the',
  'their', 'them', 'they', 'this', 'to', 'too', 'us', 'was', 'we', 'were',
  'will', 'with', 'you', 'your', 'yours', 'do', 'does', 'did', 'am', 'are',
  'been', 'being', 'had', 'having', 'would', 'could', 'should',
]);

/**
 * Deterministic cue-word extraction. Returns up to `count` distinct
 * content words from the actor's line, in original order, excluding
 * stop words and words shorter than 3 characters.
 *
 * The architecture is intentionally simple so a future AI cue extractor
 * can drop in as a replacement without changing consumers.
 */
export function deriveCueWords(text: string, count = 3): string[] {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ') // strip parentheticals
    .split(/[^A-Za-z0-9']+/)
    .filter(Boolean);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (STOP_WORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    picked.push(t);
    if (picked.length >= count) break;
  }
  return picked;
}

// ────────────────────────────────────────────────────────────────────────────
// Blackout / recall mode rendering (Phase 4B.3, 4E.1)
// ────────────────────────────────────────────────────────────────────────────

export type Token =
  | { kind: 'word'; original: string; masked: string; isMasked: boolean }
  | { kind: 'space'; text: string };

/**
 * Deterministic mask-per-word rendering used by every recall mode.
 * The mask proportion (0..1) is derived from the difficulty level:
 *
 *   1 → 0.00   (nothing hidden)
 *   2 → 0.30
 *   3 → 0.55
 *   4 → 0.80   (with first-letter hint)
 *   5 → 1.00   (all hidden until Reveal)
 *
 * The choice of which specific tokens to mask is deterministic (based on
 * word index) so tests can assert exact output.
 */
export function tokenizeForMode(
  text: string,
  difficulty: DifficultyLevel,
): Token[] {
  const proportion = maskProportionFor(difficulty);
  const showFirstLetter = difficulty === 4;
  const parts = (text ?? '').split(/(\s+)/);
  const wordIndexes: number[] = [];
  parts.forEach((p, i) => {
    if (/\S/.test(p)) wordIndexes.push(i);
  });
  const total = wordIndexes.length;
  // Deterministic mask set — evenly-spaced word indexes at the chosen ratio.
  const target = Math.round(total * proportion);
  const masked = new Set<number>();
  if (target > 0 && total > 0) {
    const step = total / target;
    for (let n = 0; n < target; n++) {
      const w = Math.min(total - 1, Math.floor(n * step + step / 2));
      masked.add(wordIndexes[w]);
    }
  }
  return parts.map((p, i) => {
    if (!/\S/.test(p)) return { kind: 'space' as const, text: p };
    const isMasked = masked.has(i);
    let mask: string;
    if (!isMasked) mask = p;
    else if (showFirstLetter && p.length > 1) {
      mask = p[0] + '_'.repeat(Math.max(1, p.length - 1));
    } else {
      mask = '_'.repeat(Math.max(1, p.length));
    }
    return { kind: 'word' as const, original: p, masked: mask, isMasked };
  });
}

export function maskProportionFor(difficulty: DifficultyLevel): number {
  switch (difficulty) {
    case 1: return 0.0;
    case 2: return 0.3;
    case 3: return 0.55;
    case 4: return 0.8;
    case 5: return 1.0;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Self-assessment → LearningRecord update (Phase 4C.2, 4E.3, 4E.4)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply a self-assessment to a LearningRecord. Pure function — returns
 * a NEW record; caller persists.
 *
 * Deterministic rules:
 *   * attempts++ always
 *   * 'got_it'   → successes++, consecutiveSuccesses++, lastResult
 *   * 'almost'   → attempts only, consecutiveSuccesses = 0, lastResult
 *   * 'missed'   → misses++, consecutiveSuccesses = 0, lastResult
 *   * isWeak    ← classifyWeak(record after)
 *   * masteryLevel ← classifyMastery(record after) — reversible.
 *   * difficultyLevel adjusts up on strong runs, down on misses (capped).
 *   * lastPracticedAt ← nowIso
 */
export function applyAssessment(
  record: LearningRecord,
  result: SelfAssessment,
  nowIso: string,
): LearningRecord {
  const next: LearningRecord = { ...record };
  next.attempts += 1;
  next.lastResult = result;
  next.lastPracticedAt = nowIso;
  if (result === 'got_it') {
    next.successes += 1;
    next.consecutiveSuccesses += 1;
  } else if (result === 'missed') {
    next.misses += 1;
    next.consecutiveSuccesses = 0;
  } else {
    // 'almost' — no success/miss increment, streak resets
    next.consecutiveSuccesses = 0;
  }
  next.isWeak = classifyWeak(next);
  next.masteryLevel = classifyMastery(next);
  next.difficultyLevel = suggestDifficulty(next);
  return next;
}

/**
 * Deterministic weak-line classifier.
 *
 *   isWeak = true iff (misses >= 2) AND (misses / max(attempts,1) >= 0.4)
 *              AND consecutiveSuccesses < 2
 *   isWeak = false if consecutiveSuccesses >= 3 (recovery)
 *
 * The recovery clause guarantees an actor can *clear* the weak flag by
 * getting the line right three times in a row.
 */
export function classifyWeak(r: LearningRecord): boolean {
  if (r.consecutiveSuccesses >= 3) return false;
  if (r.misses < 2) return false;
  const missRate = r.misses / Math.max(r.attempts, 1);
  return missRate >= 0.4;
}

/**
 * Deterministic mastery classifier (reversible).
 *
 *   'new'         attempts == 0
 *   'learning'    attempts >= 1 and successes < 2
 *   'developing'  successes >= 2 and consecutiveSuccesses < 3
 *   'strong'      consecutiveSuccesses >= 3 and successes < 5
 *   'mastered'    consecutiveSuccesses >= 3 and successes >= 5
 *
 * A recent miss drops the streak to 0, so a mastered line that starts
 * being missed will regress to 'developing' or 'learning' automatically.
 */
export function classifyMastery(r: LearningRecord): MasteryLevel {
  if (r.attempts === 0) return 'new';
  if (r.successes < 2) return 'learning';
  if (r.consecutiveSuccesses < 3) return 'developing';
  if (r.successes < 5) return 'strong';
  return 'mastered';
}

/**
 * Suggest the next-attempt difficulty for this record. Bounded [1..5],
 * moves up on strong streaks, down on recent miss.
 */
export function suggestDifficulty(r: LearningRecord): DifficultyLevel {
  let d: number = r.difficultyLevel || 1;
  if (r.lastResult === 'missed') d = Math.max(1, d - 1);
  else if (r.lastResult === 'got_it' && r.consecutiveSuccesses >= 2) {
    d = Math.min(5, d + 1);
  }
  return d as DifficultyLevel;
}

// ────────────────────────────────────────────────────────────────────────────
// Session lifecycle (Phase 4A.3, 4D)
// ────────────────────────────────────────────────────────────────────────────

export interface CreateSessionArgs {
  scriptId: string;
  characterId: string;
  type: SessionType;
  itemIds: string[];
  sceneNumber?: number | null;
  nowIso: string;
}

export function createSession(args: CreateSessionArgs): LearningSession {
  return {
    id: makeSessionId(args.scriptId, args.characterId),
    scriptId: args.scriptId,
    characterId: args.characterId,
    type: args.type,
    sceneNumber: args.sceneNumber ?? null,
    itemIds: [...args.itemIds],
    currentIndex: 0,
    state: args.itemIds.length === 0 ? 'completed' : 'ready',
    startedAt: args.nowIso,
    completedAt: args.itemIds.length === 0 ? args.nowIso : null,
    attempts: 0,
    successes: 0,
    misses: 0,
  };
}

export function advanceSession(
  session: LearningSession,
  result: SelfAssessment,
  nowIso: string,
): LearningSession {
  if (session.state === 'completed') return session;
  const next: LearningSession = { ...session };
  next.attempts += 1;
  if (result === 'got_it') next.successes += 1;
  else if (result === 'missed') next.misses += 1;
  next.state = 'active';
  if (next.currentIndex + 1 >= next.itemIds.length) {
    next.currentIndex = next.itemIds.length; // past end
    next.state = 'completed';
    next.completedAt = nowIso;
  } else {
    next.currentIndex += 1;
  }
  return next;
}

export function goToPrevious(session: LearningSession): LearningSession {
  if (session.currentIndex <= 0) return session;
  return {
    ...session,
    currentIndex: session.currentIndex - 1,
    state: 'active',
    completedAt: null,
  };
}

export function goToNext(session: LearningSession): LearningSession {
  if (session.currentIndex + 1 >= session.itemIds.length) return session;
  return { ...session, currentIndex: session.currentIndex + 1, state: 'active' };
}

export function pauseSession(session: LearningSession): LearningSession {
  if (session.state !== 'active') return session;
  return { ...session, state: 'paused' };
}

export function resumeSession(session: LearningSession): LearningSession {
  if (session.state !== 'paused') return session;
  return { ...session, state: 'active' };
}

export function restartSession(
  session: LearningSession,
  nowIso: string,
): LearningSession {
  return {
    ...session,
    id: `${session.id}#r${Date.now()}`,
    currentIndex: 0,
    state: session.itemIds.length === 0 ? 'completed' : 'ready',
    startedAt: nowIso,
    completedAt: session.itemIds.length === 0 ? nowIso : null,
    attempts: 0,
    successes: 0,
    misses: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregate progress (Phase 4F)
// ────────────────────────────────────────────────────────────────────────────

export interface AggregateProgress {
  totalItems: number;
  practiced: number;
  strongOrMastered: number;
  weak: number;
  attempts: number;
  successes: number;
  misses: number;
  masteryCounts: Record<MasteryLevel, number>;
  successRate: number; // 0..1
}

export function aggregateProgress(items: LearnItem[]): AggregateProgress {
  const masteryCounts: Record<MasteryLevel, number> = {
    new: 0,
    learning: 0,
    developing: 0,
    strong: 0,
    mastered: 0,
  };
  let practiced = 0;
  let attempts = 0;
  let successes = 0;
  let misses = 0;
  let weak = 0;
  let strongOrMastered = 0;
  for (const it of items) {
    const r = it.record;
    masteryCounts[r.masteryLevel] += 1;
    if (r.attempts > 0) practiced += 1;
    if (r.isWeak) weak += 1;
    if (r.masteryLevel === 'strong' || r.masteryLevel === 'mastered') {
      strongOrMastered += 1;
    }
    attempts += r.attempts;
    successes += r.successes;
    misses += r.misses;
  }
  return {
    totalItems: items.length,
    practiced,
    strongOrMastered,
    weak,
    attempts,
    successes,
    misses,
    masteryCounts,
    successRate: attempts === 0 ? 0 : successes / attempts,
  };
}
