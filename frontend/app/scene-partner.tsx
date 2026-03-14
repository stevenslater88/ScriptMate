import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useScriptStore } from '../store/scriptStore';

// --- Reader Styles (TTS adjustments) ---
const READER_STYLES = [
  { id: 'neutral', name: 'Neutral', icon: 'person', rate: 1.0, pitch: 1.0 },
  { id: 'calm', name: 'Calm', icon: 'leaf', rate: 0.8, pitch: 0.95 },
  { id: 'serious', name: 'Serious', icon: 'shield', rate: 0.9, pitch: 0.85 },
  { id: 'aggressive', name: 'Aggressive', icon: 'flame', rate: 1.3, pitch: 1.1 },
  { id: 'fast', name: 'Fast Pace', icon: 'flash', rate: 1.6, pitch: 1.0 },
];

// --- Cue Timing Options ---
const CUE_TIMINGS = [
  { id: 'immediate', label: 'Immediate', delay: 0 },
  { id: '1s', label: '1 sec', delay: 1000 },
  { id: '2s', label: '2 sec', delay: 2000 },
  { id: '3s', label: '3 sec', delay: 3000 },
];

// --- Queue Item ---
interface QueueItem {
  character: string;
  text: string;
  isUserLine: boolean;
  lineIndex: number;
}

type Phase = 'setup' | 'rehearsal';
type PlayState = 'playing' | 'paused' | 'waiting_user' | 'finished';

export default function ScenePartnerScreen() {
  const { scriptId } = useLocalSearchParams<{ scriptId: string }>();
  const { scripts, fetchScript } = useScriptStore();
  const script = scripts.find(s => s.id === scriptId);

  // Setup state
  const [phase, setPhase] = useState<Phase>('setup');
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState('neutral');
  const [selectedTiming, setSelectedTiming] = useState('1s');

  // Rehearsal state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playState, setPlayState] = useState<PlayState>('paused');
  const [lastCueIndex, setLastCueIndex] = useState(-1);

  // Refs
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Load script if not in store
  useEffect(() => {
    if (scriptId && !script) {
      fetchScript(scriptId);
    }
  }, [scriptId]);

  // Pulse animation for user line indicator
  useEffect(() => {
    if (playState === 'waiting_user') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [playState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Speech.stop();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Build rehearsal queue from script lines
  const buildQueue = useCallback((): QueueItem[] => {
    if (!script || !selectedCharacter) return [];
    return script.lines
      .filter(l => !l.is_stage_direction && l.character && l.text.trim())
      .map((l, idx) => ({
        character: l.character,
        text: l.text,
        isUserLine: l.character === selectedCharacter,
        lineIndex: idx,
      }));
  }, [script, selectedCharacter]);

  // Get current style settings
  const getStyle = () => READER_STYLES.find(s => s.id === selectedStyle) || READER_STYLES[0];
  const getDelay = () => CUE_TIMINGS.find(t => t.id === selectedTiming)?.delay || 1000;

  // --- Rehearsal Control ---
  const speakLine = useCallback((item: QueueItem, onDone: () => void) => {
    const style = getStyle();
    Speech.speak(item.text, {
      rate: style.rate,
      pitch: style.pitch,
      onDone,
      onError: () => onDone(), // continue on error
    });
  }, [selectedStyle]);

  const advanceTo = useCallback((index: number) => {
    if (index >= queue.length) {
      setPlayState('finished');
      setCurrentIndex(index);
      return;
    }

    setCurrentIndex(index);
    const item = queue[index];

    if (item.isUserLine) {
      setPlayState('waiting_user');
    } else {
      setPlayState('playing');
      setLastCueIndex(index);
      speakLine(item, () => {
        const delay = getDelay();
        if (delay > 0) {
          timerRef.current = setTimeout(() => advanceTo(index + 1), delay);
        } else {
          advanceTo(index + 1);
        }
      });
    }
  }, [queue, speakLine, selectedTiming]);

  const handleStart = () => {
    const q = buildQueue();
    if (q.length === 0) return;
    setQueue(q);
    setCurrentIndex(0);
    setLastCueIndex(-1);
    setPhase('rehearsal');
    // Small delay to let state settle before starting playback
    setTimeout(() => {
      const item = q[0];
      if (item.isUserLine) {
        setPlayState('waiting_user');
      } else {
        setPlayState('playing');
        setLastCueIndex(0);
        const style = getStyle();
        Speech.speak(item.text, {
          rate: style.rate,
          pitch: style.pitch,
          onDone: () => {
            const delay = getDelay();
            timerRef.current = setTimeout(() => advanceTo(1), delay);
          },
          onError: () => advanceTo(1),
        });
      }
    }, 300);
  };

  const handleContinue = () => {
    if (playState === 'waiting_user') {
      const delay = getDelay();
      if (delay > 0) {
        timerRef.current = setTimeout(() => advanceTo(currentIndex + 1), delay);
      } else {
        advanceTo(currentIndex + 1);
      }
    }
  };

  const handlePause = () => {
    Speech.stop();
    if (timerRef.current) clearTimeout(timerRef.current);
    setPlayState('paused');
  };

  const handleResume = () => {
    if (playState === 'paused' && currentIndex < queue.length) {
      advanceTo(currentIndex);
    }
  };

  const handleRestart = () => {
    Speech.stop();
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrentIndex(0);
    setLastCueIndex(-1);
    setTimeout(() => advanceTo(0), 200);
  };

  const handleReplayCue = () => {
    if (lastCueIndex >= 0 && lastCueIndex < queue.length) {
      Speech.stop();
      if (timerRef.current) clearTimeout(timerRef.current);
      const item = queue[lastCueIndex];
      const style = getStyle();
      Speech.speak(item.text, {
        rate: style.rate,
        pitch: style.pitch,
      });
    }
  };

  const handleBackToSetup = () => {
    Speech.stop();
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('setup');
    setPlayState('paused');
    setCurrentIndex(0);
  };

  // --- Loading / Error States ---
  if (!script) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading script...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const dialogueLines = script.lines.filter(l => !l.is_stage_direction && l.character);
  if (dialogueLines.length === 0 || script.characters.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} data-testid="scene-partner-back">
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scene Partner</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color="#f59e0b" />
          <Text style={styles.errorText}>Unable to detect characters in this script. Please check formatting.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ========== SETUP PHASE ==========
  if (phase === 'setup') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} data-testid="scene-partner-back">
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scene Partner</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {/* Script Title */}
          <Text style={styles.scriptTitle}>{script.title}</Text>
          <Text style={styles.subtitle}>{dialogueLines.length} lines across {script.characters.length} characters</Text>

          {/* Character Selection */}
          <Text style={styles.sectionLabel}>My Character</Text>
          <View style={styles.optionGrid}>
            {script.characters.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[styles.charCard, selectedCharacter === c.name && styles.charCardSelected]}
                onPress={() => setSelectedCharacter(c.name)}
                data-testid={`char-select-${c.name}`}
              >
                <Ionicons name="person" size={20} color={selectedCharacter === c.name ? '#fff' : '#6366f1'} />
                <Text style={[styles.charName, selectedCharacter === c.name && styles.charNameSelected]}>{c.name}</Text>
                <Text style={styles.charLines}>{c.line_count} lines</Text>
                {selectedCharacter === c.name && <Ionicons name="checkmark-circle" size={18} color="#fff" style={styles.checkIcon} />}
              </TouchableOpacity>
            ))}
          </View>

          {/* Reader Style */}
          <Text style={styles.sectionLabel}>Reader Style</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
            {READER_STYLES.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.styleChip, selectedStyle === s.id && styles.styleChipSelected]}
                onPress={() => setSelectedStyle(s.id)}
                data-testid={`style-${s.id}`}
              >
                <Ionicons name={s.icon as any} size={16} color={selectedStyle === s.id ? '#fff' : '#9ca3af'} />
                <Text style={[styles.styleChipText, selectedStyle === s.id && styles.styleChipTextSelected]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Cue Timing */}
          <Text style={styles.sectionLabel}>Cue Timing</Text>
          <View style={styles.timingRow}>
            {CUE_TIMINGS.map(t => (
              <TouchableOpacity
                key={t.id}
                style={[styles.timingChip, selectedTiming === t.id && styles.timingChipSelected]}
                onPress={() => setSelectedTiming(t.id)}
                data-testid={`timing-${t.id}`}
              >
                <Text style={[styles.timingText, selectedTiming === t.id && styles.timingTextSelected]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Start Button */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.startBtn, !selectedCharacter && styles.startBtnDisabled]}
            onPress={handleStart}
            disabled={!selectedCharacter}
            data-testid="start-rehearsal-btn"
          >
            <Ionicons name="play-circle" size={22} color="#fff" />
            <Text style={styles.startBtnText}>Start Scene</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ========== REHEARSAL PHASE ==========
  const currentItem = currentIndex < queue.length ? queue[currentIndex] : null;
  const progress = queue.length > 0 ? Math.min(currentIndex / queue.length, 1) : 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Rehearsal Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackToSetup} style={styles.backBtn} data-testid="rehearsal-back">
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{script.title}</Text>
        <Text style={styles.progressText}>{Math.min(currentIndex + 1, queue.length)}/{queue.length}</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Script Lines */}
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.rehearsalContent}>
        {queue.map((item, idx) => {
          const isCurrent = idx === currentIndex;
          const isPast = idx < currentIndex;
          const isFuture = idx > currentIndex;

          return (
            <View
              key={idx}
              style={[
                styles.lineRow,
                isCurrent && styles.lineRowCurrent,
                isPast && styles.lineRowPast,
                isFuture && styles.lineRowFuture,
              ]}
            >
              <View style={[styles.charBadge, item.isUserLine ? styles.charBadgeUser : styles.charBadgeAI]}>
                <Text style={styles.charBadgeText}>{item.character.substring(0, 2)}</Text>
              </View>
              <View style={styles.lineContent}>
                <Text style={[styles.lineCharName, item.isUserLine && styles.lineCharNameUser]}>
                  {item.character} {item.isUserLine ? '(You)' : ''}
                </Text>
                <Text style={[
                  styles.lineText,
                  isCurrent && styles.lineTextCurrent,
                  isPast && styles.lineTextPast,
                  isFuture && styles.lineTextFuture,
                ]}>
                  {item.text}
                </Text>
              </View>
              {isCurrent && (
                <View style={styles.currentIndicator}>
                  {item.isUserLine ? (
                    <Animated.View style={{ opacity: pulseAnim }}>
                      <Ionicons name="mic" size={20} color="#10b981" />
                    </Animated.View>
                  ) : (
                    <Ionicons name="volume-high" size={20} color="#6366f1" />
                  )}
                </View>
              )}
            </View>
          );
        })}

        {playState === 'finished' && (
          <View style={styles.finishedCard}>
            <Ionicons name="checkmark-circle" size={40} color="#10b981" />
            <Text style={styles.finishedText}>Scene Complete</Text>
          </View>
        )}
      </ScrollView>

      {/* Controls */}
      <View style={styles.controlBar}>
        {/* Top row: Replay Cue */}
        {lastCueIndex >= 0 && (
          <TouchableOpacity style={styles.replayCueBtn} onPress={handleReplayCue} data-testid="replay-cue-btn">
            <Ionicons name="refresh" size={16} color="#f59e0b" />
            <Text style={styles.replayCueText}>Replay Cue</Text>
          </TouchableOpacity>
        )}

        {/* Main controls */}
        <View style={styles.controlRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={handleRestart} data-testid="restart-btn">
            <Ionicons name="refresh-circle" size={28} color="#9ca3af" />
          </TouchableOpacity>

          {playState === 'waiting_user' ? (
            <TouchableOpacity style={styles.continueBtn} onPress={handleContinue} data-testid="continue-btn">
              <Text style={styles.continueBtnText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </TouchableOpacity>
          ) : playState === 'playing' ? (
            <TouchableOpacity style={styles.pauseBtn} onPress={handlePause} data-testid="pause-btn">
              <Ionicons name="pause" size={28} color="#fff" />
            </TouchableOpacity>
          ) : playState === 'paused' ? (
            <TouchableOpacity style={styles.playBtn} onPress={handleResume} data-testid="play-btn">
              <Ionicons name="play" size={28} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.playBtn} onPress={handleRestart} data-testid="restart-scene-btn">
              <Ionicons name="refresh" size={28} color="#fff" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.controlBtn} onPress={handleBackToSetup} data-testid="exit-btn">
            <Ionicons name="stop-circle" size={28} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ========== STYLES ==========
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { color: '#6b7280', marginTop: 12, fontSize: 15 },
  errorText: { color: '#e5e7eb', fontSize: 16, textAlign: 'center', marginTop: 16, lineHeight: 22 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  progressText: { color: '#6b7280', fontSize: 13, fontWeight: '500', minWidth: 45, textAlign: 'right' },

  // Progress bar
  progressBar: { height: 3, backgroundColor: '#1f2937', marginHorizontal: 16 },
  progressFill: { height: 3, backgroundColor: '#6366f1', borderRadius: 2 },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 32 },
  rehearsalContent: { padding: 16, paddingBottom: 32 },

  // Setup: title
  scriptTitle: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#6b7280', fontSize: 14, marginTop: 4, marginBottom: 20 },

  // Section label
  sectionLabel: { color: '#e5e7eb', fontSize: 15, fontWeight: '600', marginBottom: 10, marginTop: 20 },

  // Character selection
  optionGrid: { gap: 10 },
  charCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111118',
    borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#1f2937',
  },
  charCardSelected: { borderColor: '#6366f1', backgroundColor: '#1a1a2e' },
  charName: { color: '#e5e7eb', fontSize: 15, fontWeight: '600', marginLeft: 10, flex: 1 },
  charNameSelected: { color: '#fff' },
  charLines: { color: '#6b7280', fontSize: 12, marginRight: 8 },
  checkIcon: { marginLeft: 4 },

  // Reader style chips
  hScroll: { marginBottom: 4 },
  styleChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#111118',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8,
    borderWidth: 1, borderColor: '#1f2937',
  },
  styleChipSelected: { borderColor: '#6366f1', backgroundColor: '#1a1a2e' },
  styleChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '500', marginLeft: 6 },
  styleChipTextSelected: { color: '#fff' },

  // Cue timing
  timingRow: { flexDirection: 'row', gap: 8 },
  timingChip: {
    flex: 1, alignItems: 'center', backgroundColor: '#111118',
    borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: '#1f2937',
  },
  timingChipSelected: { borderColor: '#6366f1', backgroundColor: '#1a1a2e' },
  timingText: { color: '#9ca3af', fontSize: 13, fontWeight: '500' },
  timingTextSelected: { color: '#fff' },

  // Bottom bar
  bottomBar: { padding: 16, borderTopWidth: 1, borderTopColor: '#1f2937' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#6366f1', borderRadius: 14, paddingVertical: 16, gap: 8,
  },
  startBtnDisabled: { opacity: 0.4 },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: '#6366f1', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 20,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Rehearsal: line rows
  lineRow: {
    flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10,
    paddingHorizontal: 12, borderRadius: 10, marginBottom: 6,
  },
  lineRowCurrent: { backgroundColor: '#111128' },
  lineRowPast: { opacity: 0.4 },
  lineRowFuture: { opacity: 0.6 },

  charBadge: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center',
    justifyContent: 'center', marginRight: 10, marginTop: 2,
  },
  charBadgeUser: { backgroundColor: '#064e3b' },
  charBadgeAI: { backgroundColor: '#1e1b4b' },
  charBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  lineContent: { flex: 1 },
  lineCharName: { color: '#6b7280', fontSize: 11, fontWeight: '600', marginBottom: 2, textTransform: 'uppercase' },
  lineCharNameUser: { color: '#10b981' },
  lineText: { color: '#e5e7eb', fontSize: 15, lineHeight: 22 },
  lineTextCurrent: { color: '#fff', fontWeight: '500' },
  lineTextPast: { color: '#6b7280' },
  lineTextFuture: { color: '#9ca3af' },

  currentIndicator: { marginLeft: 8, marginTop: 4 },

  // Finished
  finishedCard: { alignItems: 'center', paddingVertical: 32 },
  finishedText: { color: '#10b981', fontSize: 18, fontWeight: '700', marginTop: 12 },

  // Controls
  controlBar: { padding: 16, borderTopWidth: 1, borderTopColor: '#1f2937', alignItems: 'center' },
  replayCueBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.12)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginBottom: 12, gap: 6,
  },
  replayCueText: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },

  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  controlBtn: { padding: 8 },

  continueBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#10b981',
    borderRadius: 28, paddingHorizontal: 28, paddingVertical: 14, gap: 8,
  },
  continueBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  pauseBtn: {
    backgroundColor: '#ef4444', borderRadius: 28, width: 56, height: 56,
    alignItems: 'center', justifyContent: 'center',
  },
  playBtn: {
    backgroundColor: '#6366f1', borderRadius: 28, width: 56, height: 56,
    alignItems: 'center', justifyContent: 'center',
  },
});
