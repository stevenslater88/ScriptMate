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
 * Difficulty mask is rendered per-line by the pure `tokenizeForMode`
 * helper — no Animated.multiply, no native driver animations, no
 * community slider. Matches the Fabric-safe conventions established by
 * Phase 3.
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
  pauseSession,
  restartSession,
  resumeSession,
  tokenizeForMode,
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
          <ActivityIndicator size="large" color="#22d3ee" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.root} testID="learn-session-none">
        <View style={styles.centerBox}>
          <Ionicons name="close-circle" size={40} color="#ef4444" />
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
          <Ionicons name="checkmark-circle" size={64} color="#10b981" />
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

  const tokens = tokenizeForMode(currentItem.line.text, difficulty);
  const cueWords = deriveCueWords(currentItem.line.text, 3);

  return (
    <SafeAreaView style={styles.root} testID="learn-session">
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleQuit}
          testID="learn-session-quit"
        >
          <Ionicons name="close" size={22} color="#e5e7eb" />
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
          <Ionicons name="refresh" size={22} color="#e5e7eb" />
        </TouchableOpacity>
      </View>

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
            <Text style={styles.lineText} testID="learn-session-masked-text">
              {tokens.map((t, i) =>
                t.kind === 'space' ? t.text : (
                  <Text
                    key={i}
                    style={t.isMasked ? styles.maskedWord : undefined}
                  >
                    {t.masked}
                  </Text>
                ),
              )}
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
              <Ionicons name="pulse" size={12} color="#0a0a0f" />
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
            <Ionicons name="eye" size={22} color="#0a0a0f" />
            <Text style={styles.revealButtonText}>Reveal line</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.assessmentRow}>
            <TouchableOpacity
              style={[styles.assessButton, styles.assessMissed]}
              onPress={() => handleAssessment('missed')}
              testID="learn-session-assess-missed"
            >
              <Ionicons name="close" size={18} color="#fff" />
              <Text style={styles.assessButtonText}>Missed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.assessButton, styles.assessAlmost]}
              onPress={() => handleAssessment('almost')}
              testID="learn-session-assess-almost"
            >
              <Ionicons name="remove" size={18} color="#0a0a0f" />
              <Text style={[styles.assessButtonText, { color: '#0a0a0f' }]}>Almost</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.assessButton, styles.assessGot]}
              onPress={() => handleAssessment('got_it')}
              testID="learn-session-assess-got"
            >
              <Ionicons name="checkmark" size={18} color="#0a0a0f" />
              <Text style={[styles.assessButtonText, { color: '#0a0a0f' }]}>Got it</Text>
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
              color={session.currentIndex === 0 ? '#4b5563' : '#e5e7eb'}
            />
            <Text
              style={[
                styles.navButtonText,
                session.currentIndex === 0 && { color: '#4b5563' },
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
              color="#e5e7eb"
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
                session.currentIndex >= items.length - 1 && { color: '#4b5563' },
              ]}
            >
              Next
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={
                session.currentIndex >= items.length - 1 ? '#4b5563' : '#e5e7eb'
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

function masteryLabel(it: LearnItem): string {
  const m = it.record.masteryLevel;
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function masteryChipStyle(it: LearnItem) {
  const m = it.record.masteryLevel;
  if (m === 'mastered') return { backgroundColor: '#10b981' };
  if (m === 'strong') return { backgroundColor: '#22d3ee' };
  if (m === 'developing') return { backgroundColor: '#a78bfa' };
  if (m === 'learning') return { backgroundColor: '#f59e0b' };
  return { backgroundColor: '#4b5563' };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  progressText: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { height: 3, backgroundColor: '#1f2937' },
  progressFill: { height: 3, backgroundColor: '#22d3ee' },
  body: { padding: 20, gap: 16, paddingBottom: 40 },
  cueCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderLeftWidth: 3,
    borderLeftColor: '#a78bfa',
  },
  cueLabel: { color: '#a78bfa', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  cueText: { color: '#e5e7eb', fontSize: 16, marginTop: 6, lineHeight: 22 },
  cueEmpty: { color: '#9ca3af', fontSize: 14, fontStyle: 'italic' },
  lineCard: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  lineCharacter: { color: '#22d3ee', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  lineText: { color: '#f3f4f6', fontSize: 22, lineHeight: 32, marginTop: 8, fontWeight: '500' },
  maskedWord: { backgroundColor: '#0a0a0f', color: '#0a0a0f', letterSpacing: 1 },
  cueWordsHint: { color: '#9ca3af', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  masteryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  weakChip: { backgroundColor: '#f59e0b' },
  masteryChipText: { color: '#0a0a0f', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  difficultyLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  difficultyRow: { flexDirection: 'row', gap: 8 },
  difficultyPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  difficultyPillActive: { backgroundColor: '#22d3ee', borderColor: '#22d3ee' },
  difficultyPillText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
  difficultyPillTextActive: { color: '#0a0a0f' },
  difficultyHint: { color: '#9ca3af', fontSize: 12, fontStyle: 'italic' },
  footer: {
    padding: 14,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f2937',
  },
  revealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22d3ee',
  },
  revealButtonText: { color: '#0a0a0f', fontSize: 16, fontWeight: '700' },
  assessmentRow: { flexDirection: 'row', gap: 8 },
  assessButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: 10,
  },
  assessMissed: { backgroundColor: '#ef4444' },
  assessAlmost: { backgroundColor: '#f59e0b' },
  assessGot: { backgroundColor: '#10b981' },
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
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  navButtonText: { color: '#e5e7eb', fontSize: 13, fontWeight: '600' },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#22d3ee',
  },
  primaryButtonText: { color: '#0a0a0f', fontSize: 16, fontWeight: '700' },
  emptyTitle: { color: '#e5e7eb', fontSize: 18, fontWeight: '700' },
});
