/**
 * Learn Storage — AsyncStorage-backed persistence for the Learn system.
 *
 * All Phase 4 persistence lives here. Three keys are used, all
 * namespaced under `@scriptmate/learn/`:
 *
 *   /records       — Record<string, LearningRecord>
 *   /session/active — LearningSession | null
 *   /history       — LearningSession[]   (most-recent first, capped at 50)
 *
 * The service:
 *   * NEVER touches saved scripts, Library data, self-tape recordings,
 *     rehearsal state, or any other Phase 3 data.
 *   * NEVER makes network / backend calls.
 *   * NEVER blocks the UI thread — all methods are async.
 *   * IS defensive on read: corrupted JSON returns a safe empty shape.
 *   * Deleting or missing a source script must NOT corrupt unrelated
 *     records: `purgeOrphans(activeScriptIds)` handles that cleanly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  LearningRecord,
  LearningSession,
} from './learnEngine';

const RECORDS_KEY = '@scriptmate/learn/records';
const ACTIVE_SESSION_KEY = '@scriptmate/learn/session/active';
const HISTORY_KEY = '@scriptmate/learn/history';
const HISTORY_MAX = 50;

// ────────────────────────────────────────────────────────────────────────────
// Records
// ────────────────────────────────────────────────────────────────────────────

export async function loadAllRecords(): Promise<Record<string, LearningRecord>> {
  try {
    const raw = await AsyncStorage.getItem(RECORDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, LearningRecord>;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeAllRecords(map: Record<string, LearningRecord>): Promise<void> {
  await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(map));
}

export async function saveRecord(record: LearningRecord): Promise<void> {
  const map = await loadAllRecords();
  map[record.id] = record;
  await writeAllRecords(map);
}

export async function saveRecords(records: LearningRecord[]): Promise<void> {
  if (records.length === 0) return;
  const map = await loadAllRecords();
  for (const r of records) map[r.id] = r;
  await writeAllRecords(map);
}

export async function getRecord(id: string): Promise<LearningRecord | null> {
  const map = await loadAllRecords();
  return map[id] ?? null;
}

/**
 * Remove records whose scriptId is not in `activeScriptIds`. Called on
 * Library refresh so a deleted script does not silently leave orphaned
 * learning data around.
 */
export async function purgeOrphans(activeScriptIds: Set<string>): Promise<number> {
  const map = await loadAllRecords();
  let removed = 0;
  const next: Record<string, LearningRecord> = {};
  for (const [id, r] of Object.entries(map)) {
    if (activeScriptIds.has(r.scriptId)) next[id] = r;
    else removed += 1;
  }
  if (removed > 0) await writeAllRecords(next);
  return removed;
}

export async function clearAllRecords(): Promise<void> {
  await AsyncStorage.removeItem(RECORDS_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// Active session
// ────────────────────────────────────────────────────────────────────────────

export async function loadActiveSession(): Promise<LearningSession | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return parsed as LearningSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveActiveSession(session: LearningSession): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

export async function clearActiveSession(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// History
// ────────────────────────────────────────────────────────────────────────────

export async function loadHistory(): Promise<LearningSession[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LearningSession[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Append a completed session to the head of history, capped at 50.
 * Deduped by session.id.
 */
export async function appendHistory(session: LearningSession): Promise<void> {
  const current = await loadHistory();
  const filtered = current.filter((s) => s.id !== session.id);
  filtered.unshift(session);
  const capped = filtered.slice(0, HISTORY_MAX);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(capped));
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}

// ────────────────────────────────────────────────────────────────────────────
// Debug / test helpers
// ────────────────────────────────────────────────────────────────────────────

export const LearnStorageKeys = {
  RECORDS_KEY,
  ACTIVE_SESSION_KEY,
  HISTORY_KEY,
  HISTORY_MAX,
};
