/**
 * Learn Session — /learn/session?sessionId=…
 *
 * The core actor-training loop:
 *
 *   SEE CUE  →  ATTEMPT RECALL  →  REVEAL  →  ASSESS  →  NEXT
 *
 * The screen is intentionally simple, high-contrast, and touch-friendly.
 * No AI, no speech recognition, no microphone, no typing. All work is
 * pure JS + AsyncStorage.
 *
 * Difficulty mask is rendered per-line by the pure `renderMaskedLine`
 * helper — no Animated.multiply, no native driver animations, no
 * community slider. Rendered as a FLAT single string inside a single
 * <Text> child to avoid Fabric re-parenting on Android 16 (the previous
 * nested <Text>-inside-<Text> pattern crashed on rapid difficulty taps).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useScriptStore } from '../../store/scriptStore';
import {
  advanceSession,
  applyAssessment,
  deriveCueWords,
  extractLearnItems,
  goToNext,
  goToPrevious,
  maskProportionFor,
  pauseSession,
  restartSession,
  resumeSession,
  type DifficultyLevel,
  type LearnItem,
  type LearningSession,
  type SelfAssessment,
} from '../../services/learnEngine';
import {
  appendHistory,
  clearActiveSession,
  loadActiveSession,
  loadAllRecords,
  saveActiveSession,
  saveRecord,
} from '../../services/learnStorage';

export default function LearnSessionScreen() {
  useLocalSearchParams(); // ensure param awareness for future deep-links
  const { scripts } = useScriptStore();

  const [session, setSession] = useState<LearningSession | null>(null);
  const [items, setItems] = useState<LearnItem[]>([]);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(2);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Boot: read active session + rehydrate items.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const s = await loadActiveSession();
      if (!s) {
        if (!cancelled) {
          setLoading(false);
          setSession(null);
        }
        return;
      }
      const script = scripts.find((sc) => sc.id === s.scriptId);
      if (!script) {
        if (!cancelled) {
          setLoading(false);
          setSession(s);
          setItems([]);
        }
        return;
      }
      const records = await loadAllRecords();
      const allItems = extractLearnItems(script, s.characterId, records);
      // Preserve session order — the session pinned itemIds.
      const byId = new Map(allItems.map((it) => [it.id, it]));
      const ordered = s.itemIds
        .map((id) => byId.get(id))
        .filter((it): it is LearnItem => Boolean(it));
      if (!cancelled) {
        setSession(s);
        setItems(ordered);
        // Seed initial difficulty from the current record's suggestion.
        const current = ordered[Math.min(s.currentIndex, ordered.length - 1)];
        if (current) setDifficulty(current.record.difficultyLevel);
        setLoading(false);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [scripts]);

  // Whenever the session advances, refresh difficulty from the next item.
  useEffect(() => {
    if (!session || items.length === 0) return;
    const it = items[session.currentIndex];
    if (it) setDifficulty(it.record.difficultyLevel);
    setRevealed(false);
  }, [session?.currentIndex]);

  const currentItem: LearnItem | null = useMemo(() => {
    if (!session || items.length === 0) return null;
    if (session.currentIndex >= items.length) return null;
    return items[session.currentIndex];
  }, [session?.currentIndex, items]);

  async function persistSession(next: LearningSession) {
    setSession(next);
    if (next.state === 'completed') {
      await appendHistory(next);
      await clearActiveSession();
    } else {
      await saveActiveSession(next);
    }
  }

  async function handleAssessment(result: SelfAssessment) {
    if (!session || !currentItem) return;
    const nowIso = new Date().toISOString();
    const nextRecord = applyAssessment(currentItem.record, result, nowIso);
    await saveRecord(nextRecord);
    // Reflect the record update locally so the mastery chip updates too.
    setItems((prev) =>
      prev.map((it) => (it.id === nextRecord.id ? { ...it, record: nextRecord } : it)),
    );
    const nextSession = advanceSession(session, result, nowIso);
    await persistSession(nextSession);
    if (nextSession.state === 'completed') {
      router.replace('/learn/summary');
    }
  }

  async function handlePauseResume() {
    if (!session) return;
    const next =
      session.state === 'paused' ? resumeSession(session) : pauseSession(session);
    await saveActiveSession(next);
    setSession(next);
  }

  async function handleRestart() {
    if (!session) return;
    const next = restartSession(session, new Date().toISOString());
    await saveActiveSession(next);
    setSession(next);
    setDifficulty(items[0]?.record.difficultyLevel ?? 1);
    setRevealed(false);
  }

  async function handlePrev() {
    if (!session) return;
    const next = goToPrevious(session);
    await saveActiveSession(next);
    setSession(next);
  }

  async function handleNext() {
    if (!session) return;
    const next = goToNext(session);
    await saveActiveSession(next);
    setSession(next);
  }

  async function handleQuit() {
    Alert.alert(
      'Leave session?',
      'Your progress on this line is already saved. You can resume anytime from Learn.',
      [
        { text: 'Keep learning', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            // Preserve the session as paused so the user can resume.
            if (session) {
              const paused = pauseSession({ ...session, state: 'active' });
              await saveActiveSession(paused);
            }
            router.back();
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.root} testID="learn-session-loading">
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#62E0FF" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.root} testID="learn-session-none">
        <View style={styles.centerBox}>
          <Ionicons name="close-circle" size={40} color="#FF5C7A" />
          <Text style={styles.emptyTitle}>No active session</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.back()}
            testID="learn-session-back"
          >
            <Text style={styles.primaryButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (session.state === 'completed' || !currentItem) {
    return (
      <SafeAreaView style={styles.root} testID="learn-session-complete">
        <View style={styles.centerBox}>
          <Ionicons name="checkmark-circle" size={64} color="#34D399" />
          <Text style={styles.emptyTitle}>Session complete</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace('/learn/summary')}
            testID="learn-session-view-summary"
          >
            <Text style={styles.primaryButtonText}>View summary</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const cueWords = deriveCueWords(currentItem.line.text, 3);

  return (
    <SafeAreaView style={styles.root} testID="learn-session">
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleQuit}
          testID="learn-session-quit"
        >
          <Ionicons name="close" size={22} color="#F4F3FF" />
        </TouchableOpacity>
        <Text style={styles.progressText} testID="learn-session-progress">
          Line {session.currentIndex + 1} of {items.length}
        </Text>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleRestart}
          testID="learn-session-restart"
          accessibilityLabel="Restart session"
        >
          <Ionicons name="refresh" size={22} color="#F4F3FF" />
        </TouchableOpacity>
      </View>

      {items.length <= 40 ? (
        // Segmented progress: earlier cards coloured by their last self-assessment.
        <View style={styles.segmentRow} testID="learn-session-segments">
          {items.map((it, i) => (
            <View
              key={it.record.id ?? i}
              style={[
                styles.segment,
                i === session.currentIndex
                  ? styles.segmentCurrent
                  : i < session.currentIndex
                    ? segmentStyle(it.record.lastResult)
                    : null,
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.round(
                  ((session.currentIndex + (revealed ? 1 : 0)) / items.length) * 100,
                )}%`,
              },
            ]}
          />
        </View>
      )}
      <Text style={styles.sessionTally} testID="learn-session-tally">
        {session.successes} got it · {session.misses} missed this session
      </Text>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Cue */}
        <View style={styles.cueCard} testID="learn-session-cue-card">
          {currentItem.cue ? (
            <>
              <Text style={styles.cueLabel}>
                {currentItem.cue.character.toUpperCase()}
              </Text>
              <Text style={styles.cueText}>{currentItem.cue.text}</Text>
            </>
          ) : (
            <Text style={styles.cueEmpty}>You open the scene.</Text>
          )}
        </View>

        {/* Actor's line */}
        <View style={styles.lineCard}>
          <Text style={styles.lineCharacter}>
            {currentItem.line.character.toUpperCase()}
          </Text>
          {revealed ? (
            <Text style={styles.lineText} testID="learn-session-revealed-text">
              {currentItem.line.text}
            </Text>
          ) : (
            // 2026-02 Fabric-safety refactor: render the masked line as a
            // FLAT SINGLE-STRING inside one <Text>. The previous
            // implementation mapped tokens to a mix of bare strings and
            // nested <Text> children inside an outer <Text>, which is a
            // known Fabric re-parenting crash surface on Android 16 when
            // the child list mutates on every difficulty tap. The visual
            // effect is preserved: masked words are rendered as a run of
            // underscores; at difficulty 4 the first letter is kept as a
            // hint (previously invisible because color+bg were both
            // #0B0A1A — fixed by rendering the hint character
            // in-line inside the same Text).
            <Text
              style={styles.lineText}
              testID="learn-session-masked-text"
              accessibilityLabel="Actor line, currently hidden"
            >
              {renderMaskedLine(currentItem.line.text, difficulty)}
            </Text>
          )}
          {!revealed && difficulty >= 3 && cueWords.length > 0 && (
            <Text style={styles.cueWordsHint} testID="learn-session-cue-words">
              Cue words: {cueWords.join(' · ')}
            </Text>
          )}
        </View>

        {/* Mastery chip */}
        <View style={styles.metaRow}>
          <View
            style={[styles.masteryChip, masteryChipStyle(currentItem)]}
            testID="learn-session-mastery"
          >
            <Text style={styles.masteryChipText}>
              {masteryLabel(currentItem)}
            </Text>
          </View>
          {currentItem.record.isWeak ? (
            <View style={[styles.masteryChip, styles.weakChip]} testID="learn-session-weak">
              <Ionicons name="pulse" size={12} color="#0B0A1A" />
              <Text style={styles.masteryChipText}>Weak</Text>
            </View>
          ) : null}
        </View>

        {/* Difficulty segments */}
        <Text style={styles.difficultyLabel}>Difficulty</Text>
        <View style={styles.difficultyRow}>
          {[1, 2, 3, 4, 5].map((d) => (
            <TouchableOpacity
              key={d}
              style={[
                styles.difficultyPill,
                difficulty === d && styles.difficultyPillActive,
              ]}
              onPress={() => setDifficulty(d as DifficultyLevel)}
              testID={`learn-session-difficulty-${d}`}
            >
              <Text
                style={[
                  styles.difficultyPillText,
                  difficulty === d && styles.difficultyPillTextActive,
                ]}
              >
                {d}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.difficultyHint}>{difficultyHint(difficulty)}</Text>
      </ScrollView>

      <View style={styles.footer}>
        {!revealed ? (
          <TouchableOpacity
            style={styles.revealButton}
            onPress={() => setRevealed(true)}
            testID="learn-session-reveal"
          >
            <Ionicons name="eye" size={22} color="#fff" />
            <Text style={styles.revealButtonText}>Reveal line</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.assessmentRow}>
            <TouchableOpacity
              style={[styles.assessButton, styles.assessMissed]}
              onPress={() => handleAssessment('missed')}
              testID="learn-session-assess-missed"
            >
              <Ionicons name="close" size={18} color="#FF8CA2" />
              <Text style={[styles.assessButtonText, { color: '#FF8CA2' }]}>Missed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.assessButton, styles.assessAlmost]}
              onPress={() => handleAssessment('almost')}
              testID="learn-session-assess-almost"
            >
              <Ionicons name="remove" size={18} color="#FFC37A" />
              <Text style={[styles.assessButtonText, { color: '#FFC37A' }]}>Almost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.assessButton, styles.assessGot]}
              onPress={() => handleAssessment('got_it')}
              testID="learn-session-assess-got"
            >
              <Ionicons name="checkmark" size={18} color="#34D399" />
              <Text style={[styles.assessButtonText, { color: '#34D399' }]}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.navRow}>
          <TouchableOpacity
            style={styles.navButton}
            onPress={handlePrev}
            disabled={session.currentIndex === 0}
            testID="learn-session-prev"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={session.currentIndex === 0 ? '#6E6A95' : '#F4F3FF'}
            />
            <Text
              style={[
                styles.navButtonText,
                session.currentIndex === 0 && { color: '#6E6A95' },
              ]}
            >
              Previous
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navButton}
            onPress={handlePauseResume}
            testID="learn-session-pauseresume"
          >
            <Ionicons
              name={session.state === 'paused' ? 'play' : 'pause'}
              size={16}
              color="#F4F3FF"
            />
            <Text style={styles.navButtonText}>
              {session.state === 'paused' ? 'Resume' : 'Pause'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navButton}
            onPress={handleNext}
            disabled={session.currentIndex >= items.length - 1}
            testID="learn-session-next"
          >
            <Text
              style={[
                styles.navButtonText,
                session.currentIndex >= items.length - 1 && { color: '#6E6A95' },
              ]}
            >
              Next
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={
                session.currentIndex >= items.length - 1 ? '#6E6A95' : '#F4F3FF'
              }
            />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function difficultyHint(d: DifficultyLevel): string {
  switch (d) {
    case 1: return 'Supported — the full line is visible.';
    case 2: return 'Cue-assisted — a few words are hidden.';
    case 3: return 'Reduced cues — most of the line is hidden.';
    case 4: return 'Blackout — only first letters remain.';
    case 5: return 'Full recall — line is hidden until you tap Reveal.';
  }
}

/**
 * Render the actor's line for a given difficulty as a FLAT STRING that
 * can be dropped into a single <Text> child. Deterministic word masking:
 * evenly-spaced word indexes are replaced by underscores according to
 * `maskProportionFor(difficulty)`. At difficulty 4 the first letter of
 * each masked word is preserved as a hint.
 *
 * IMPORTANT: this is a Fabric-safety refactor of the previous mixed
 * bare-string + nested <Text> rendering that crashed on Android 16 when
 * the difficulty changed rapidly.
 */
function renderMaskedLine(text: string, difficulty: DifficultyLevel): string {
  if (!text) return '';
  const proportion = maskProportionFor(difficulty);
  const showFirstLetter = difficulty === 4;
  const parts = text.split(/(\s+)/);
  const wordIndexes: number[] = [];
  parts.forEach((p, i) => {
    if (/\S/.test(p)) wordIndexes.push(i);
  });
  const total = wordIndexes.length;
  const target = Math.round(total * proportion);
  const masked = new Set<number>();
  if (target > 0 && total > 0) {
    const step = total / target;
    for (let n = 0; n < target; n++) {
      const w = Math.min(total - 1, Math.floor(n * step + step / 2));
      masked.add(wordIndexes[w]);
    }
  }
  return parts
    .map((p, i) => {
      if (!masked.has(i)) return p;
      if (showFirstLetter && p.length > 1) {
        return p[0] + '_'.repeat(Math.max(1, p.length - 1));
      }
      return '_'.repeat(Math.max(1, p.length));
    })
    .join('');
}

function masteryLabel(it: LearnItem): string {
  const m = it.record.masteryLevel;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function segmentStyle(r: string | null | undefined) {
  if (r === 'got_it') return { backgroundColor: '#34D399' };
  if (r === 'almost') return { backgroundColor: '#FFC37A' };
  if (r === 'missed') return { backgroundColor: '#FF5C7A' };
  return { backgroundColor: '#3A3566' };
}

function masteryChipStyle(it: LearnItem) {
  const m = it.record.masteryLevel;
  if (m === 'mastered') return { backgroundColor: '#34D399' };
  if (m === 'strong') return { backgroundColor: '#62E0FF' };
  if (m === 'developing') return { backgroundColor: '#A993FF' };
  if (m === 'learning') return { backgroundColor: '#FFC37A' };
  return { backgroundColor: '#6E6A95' };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0A1A' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  progressText: { color: '#F4F3FF', fontSize: 14, fontWeight: '700' },
  iconButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#14122A', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  segmentRow: { flexDirection: 'row', gap: 3, paddingHorizontal: 16, marginTop: 4 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#1C1938' },
  segmentCurrent: { backgroundColor: '#7C5CFF' },
  sessionTally: { color: '#A19DC6', fontSize: 11.5, fontWeight: '600', paddingHorizontal: 16, marginTop: 8 },
  progressTrack: { height: 3, backgroundColor: '#1C1938' },
  progressFill: { height: 3, backgroundColor: '#62E0FF' },
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  cueCard: { backgroundColor: '#121A33', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(98,224,255,0.25)' },
  cueLabel: { color: '#62E0FF', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  cueText: { color: '#D6D3F2', fontSize: 16, marginTop: 6, lineHeight: 24 },
  cueEmpty: { color: '#A19DC6', fontSize: 14, fontStyle: 'italic' },
  lineCard: { backgroundColor: '#1A1740', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: 'rgba(124,92,255,0.45)', minHeight: 160 },
  lineCharacter: { color: '#A993FF', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  lineText: { color: '#F4F3FF', fontSize: 22, lineHeight: 33, marginTop: 10, fontWeight: '600' },
  cueWordsHint: { color: '#A19DC6', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  masteryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  weakChip: { backgroundColor: '#FFC37A' },
  masteryChipText: { color: '#0B0A1A', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  difficultyLabel: { color: '#A19DC6', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  difficultyRow: { flexDirection: 'row', gap: 8 },
  difficultyPill: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#14122A', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  difficultyPillActive: { backgroundColor: '#7C5CFF', borderColor: '#7C5CFF' },
  difficultyPillText: { color: '#F4F3FF', fontSize: 15, fontWeight: '700' },
  difficultyPillTextActive: { color: '#fff' },
  difficultyHint: { color: '#A19DC6', fontSize: 12, fontStyle: 'italic' },
  footer: {
    padding: 14,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1C1938',
  },
  revealButton: { height: 54, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#7C5CFF' },
  revealButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  assessmentRow: { flexDirection: 'row', gap: 8 },
  assessButton: { flex: 1, height: 54, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1 },
  assessMissed: { backgroundColor: 'rgba(255,92,122,0.12)', borderColor: 'rgba(255,92,122,0.45)' },
  assessAlmost: { backgroundColor: 'rgba(255,195,122,0.12)', borderColor: 'rgba(255,195,122,0.45)' },
  assessGot: { backgroundColor: 'rgba(52,211,153,0.14)', borderColor: 'rgba(52,211,153,0.5)' },
  assessButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  navRow: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  navButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#14122A',
    borderWidth: 1,
    borderColor: '#1C1938',
  },
  navButtonText: { color: '#F4F3FF', fontSize: 13, fontWeight: '600' },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#7C5CFF',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyTitle: { color: '#F4F3FF', fontSize: 18, fontWeight: '700' },
});
