import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { useScriptStore } from '../../store/scriptStore';
import { DebugLog } from '../../services/debugLogService';
// 2026-02: multi-voice + reader-style wiring. All three imports were
// previously present only in components/VoiceAssignment.tsx (for the
// preview button). The rehearsal path now consults the persisted
// per-character voice map on mount and — if ElevenLabs is configured
// AND a character has an explicit assignment — routes their line
// through playSpeech() instead of the shared expo-speech fallback.
// Every other character (and every scenario where ElevenLabs isn't
// configured, or a character has no assignment) continues to use the
// unchanged Speech.speak(...) code path below.
import {
  loadVoiceAssignments,
  playSpeech,
  isElevenLabsConfigured,
  type CharacterVoiceAssignment,
} from '../../services/elevenLabsService';

// Safely import speech recognition - it may not be available on all devices
let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: (event: string, handler: (data: any) => void) => void = () => {};
let speechRecognitionImported = false;

try {
  const speechRecognition = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = speechRecognition.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = speechRecognition.useSpeechRecognitionEvent;
  speechRecognitionImported = true;
} catch (e) {
  console.log('[Rehearsal] Speech recognition module not available');
}

type RehearsalState = 'idle' | 'ai_speaking' | 'user_turn' | 'waiting' | 'finished';

interface LinePerformance {
  lineIndex: number;
  hesitationTime: number;
  attempts: number;
  hintUsed: boolean;
  speechAccuracy?: number;
}

// Normalize text for comparison
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
};

// Calculate Levenshtein distance for fuzzy matching
const levenshteinDistance = (str1: string, str2: string): number => {
  const m = str1.length;
  const n = str2.length;
  
  if (m === 0) return n;
  if (n === 0) return m;
  
  // Use two rows instead of full matrix for memory efficiency
  let prevRow = Array(n + 1).fill(0).map((_, i) => i);
  let currRow = Array(n + 1).fill(0);
  
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  
  return prevRow[n];
};

// Calculate similarity score combining multiple methods
const calculateSimilarity = (spoken: string, expected: string): number => {
  const s1 = normalizeText(spoken);
  const s2 = normalizeText(expected);
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  // Method 1: Word overlap (order-independent)
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  
  let wordMatchCount = 0;
  const usedIndices = new Set<number>();
  
  for (const word1 of words1) {
    // Find best matching word in expected text
    let bestMatch = -1;
    let bestScore = 0;
    
    for (let i = 0; i < words2.length; i++) {
      if (usedIndices.has(i)) continue;
      
      const word2 = words2[i];
      // Exact match
      if (word1 === word2) {
        bestMatch = i;
        bestScore = 1;
        break;
      }
      // Fuzzy match for longer words
      if (word1.length > 3 && word2.length > 3) {
        const dist = levenshteinDistance(word1, word2);
        const maxLen = Math.max(word1.length, word2.length);
        const similarity = 1 - (dist / maxLen);
        if (similarity > 0.7 && similarity > bestScore) {
          bestMatch = i;
          bestScore = similarity;
        }
      }
    }
    
    if (bestMatch >= 0) {
      wordMatchCount += bestScore;
      usedIndices.add(bestMatch);
    }
  }
  
  const wordOverlapScore = wordMatchCount / Math.max(words1.length, words2.length);
  
  // Method 2: Character-level similarity (catches partial words)
  const maxLen = Math.max(s1.length, s2.length);
  const charScore = 1 - (levenshteinDistance(s1, s2) / maxLen);
  
  // Method 3: Sequence matching (checks if spoken text contains key phrases)
  const sequenceScore = s2.split(' ').filter(word => 
    word.length > 2 && s1.includes(word)
  ).length / words2.length;
  
  // Weighted combination
  return (wordOverlapScore * 0.5) + (charScore * 0.3) + (sequenceScore * 0.2);
};

// Get accuracy color based on score
const getAccuracyColor = (accuracy: number): string => {
  if (accuracy >= 0.8) return '#10b981'; // Green - Excellent
  if (accuracy >= 0.6) return '#f59e0b'; // Yellow - Good
  if (accuracy >= 0.4) return '#f97316'; // Orange - Partial
  return '#ef4444'; // Red - Poor
};

// Get accuracy label
const getAccuracyLabel = (accuracy: number): string => {
  if (accuracy >= 0.8) return 'Excellent!';
  if (accuracy >= 0.6) return 'Good';
  if (accuracy >= 0.4) return 'Partial';
  return 'Keep trying';
};

export default function RehearsalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentRehearsal, currentScript, fetchRehearsal, fetchScript, updateRehearsal, isPremium } =
    useScriptStore();

  const [state, setState] = useState<RehearsalState>('idle');
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [userLineVisible, setUserLineVisible] = useState(true);
  const [completedLines, setCompletedLines] = useState<number[]>([]);
  const [missedLines, setMissedLines] = useState<number[]>([]);
  const [weakLines, setWeakLines] = useState<number[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  
  // Performance tracking
  const [lineStartTime, setLineStartTime] = useState<number>(0);
  const [linePerformances, setLinePerformances] = useState<LinePerformance[]>([]);
  const [showStatsModal, setShowStatsModal] = useState(false);

  // Speech recognition state
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] = useState(false);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true);
  const [currentAccuracy, setCurrentAccuracy] = useState(0);
  const [showAccuracyFeedback, setShowAccuracyFeedback] = useState(false);
  
  // Diagnostic state for debugging speech recognition flow
  const [debugInfo, setDebugInfo] = useState<string>('Init');
  const debugLog = (msg: string) => {
    console.log(`[Rehearsal-Debug] ${msg}`);
    setDebugInfo(msg);
  };
  
  // Animation refs
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const scrollViewRef = useRef<ScrollView>(null);

  /**
   * Measured y-offset per rendered script line, populated lazily by
   * each `<View onLayout>` in the ScrollView below. Replaces the old
   * hardcoded `currentLineIndex * 80` scroll math which assumed a
   * fixed 80 px per row — rendered lines are actually variable height
   * (short single-line dialogue ≈ 51 px, long wrapped dialogue ≈ 83+
   * px, stage direction ≈ 36 px), so the fixed-stride assumption
   * cumulatively drifted the highlight off-screen after a handful of
   * advances on the Samsung S23 Ultra QA runs. Measured y is the
   * ground truth.
   */
  const lineYRef = useRef<Record<number, number>>({});

  // Pulse animation for listening indicator
  useEffect(() => {
    if (isListening) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isListening, pulseAnim]);

  // Check speech recognition availability
  useEffect(() => {
    const checkAvailability = async () => {
      debugLog('Checking SR availability...');
      if (!ExpoSpeechRecognitionModule) {
        debugLog('SR Module not imported');
        setSpeechRecognitionAvailable(false);
        return;
      }
      
      // If the module is imported, consider it available
      // The actual start() call will handle permissions
      debugLog('SR Module imported successfully');
      setSpeechRecognitionAvailable(true);
      
      // Try to get current state for logging only
      try {
        const status = await ExpoSpeechRecognitionModule.getStateAsync();
        debugLog(`SR current state: ${status}`);
      } catch (err: any) {
        debugLog(`SR state check skipped: ${err?.message || 'ok'}`);
      }
    };
    checkAvailability();
  }, []);

  // Speech recognition event handlers (safely wrapped)
  useSpeechRecognitionEvent('start', () => {
    if (!speechRecognitionImported) return;
    debugLog('SR Event: start');
    setIsListening(true);
    setCurrentAccuracy(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  });

  useSpeechRecognitionEvent('end', () => {
    if (!speechRecognitionImported) return;
    debugLog('SR Event: end');
    setIsListening(false);
    // Show accuracy feedback briefly after listening ends
    if (currentAccuracy > 0) {
      setShowAccuracyFeedback(true);
      setTimeout(() => setShowAccuracyFeedback(false), 2000);
    }
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    if (!speechRecognitionImported) return;
    
    try {
      // Safely extract transcript with multiple fallbacks
      const transcript = event?.results?.[0]?.transcript || event?.results?.[0] || '';
      const safeTranscript = typeof transcript === 'string' ? transcript : String(transcript || '');
      
      // Check if this is a final result (not interim/partial)
      const isFinal = event?.isFinal || event?.results?.[0]?.isFinal || false;
      
      debugLog(`SR: "${safeTranscript.substring(0, 25)}..." final=${isFinal}`);
      setRecognizedText(safeTranscript);
      
      // Calculate and update accuracy in real-time
      if (state === 'user_turn' && safeTranscript.length > 0) {
        const lines = currentScript?.lines || [];
        const currentLine = lines[currentLineIndex];
        const expectedText = currentLine?.text || '';
        const expectedLength = expectedText.length;
        
        const similarity = calculateSimilarity(safeTranscript, expectedText);
        setCurrentAccuracy(similarity);
        
        // Calculate how much of the line has been spoken (by length)
        const spokenRatio = expectedLength > 0 ? safeTranscript.length / expectedLength : 0;
        
        debugLog(`SR: acc=${(similarity * 100).toFixed(0)}% ratio=${(spokenRatio * 100).toFixed(0)}% final=${isFinal}`);
        
        // Auto-advance ONLY when:
        // 1. Auto-advance is enabled
        // 2. This is a FINAL result (not interim), OR similarity is very high (>85%)
        // 3. Similarity is good enough (>65%)
        // 4. User has spoken at least 60% of the expected line length
        // 5. Transcript is reasonably long (>10 chars or >50% of expected)
        const minLengthMet = safeTranscript.length > 10 || spokenRatio > 0.5;
        const similarityThresholdMet = similarity >= 0.65;
        const completenessThresholdMet = spokenRatio >= 0.6;
        const shouldAdvance = autoAdvanceEnabled && 
                             similarityThresholdMet && 
                             minLengthMet &&
                             completenessThresholdMet &&
                             (isFinal || similarity >= 0.85);
        
        if (shouldAdvance) {
          debugLog('SR: Auto-advancing - line complete!');
          try {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (hapticErr) {
            console.log('[Rehearsal] Haptic feedback unavailable');
          }
          stopListening();
          onUserLineDone(false, similarity);
        }
      }
    } catch (err: any) {
      console.error('[Rehearsal] SR result handler error:', err?.message || err);
      debugLog(`SR Error: ${err?.message || 'unknown'}`);
    }
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    if (!speechRecognitionImported) return;
    try {
      const errorMsg = event?.error || 'unknown error';
      debugLog(`SR Event: error - ${errorMsg}`);
      setIsListening(false);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch (hapticErr) {
        // Haptics may not be available
      }
    } catch (err: any) {
      console.error('[Rehearsal] SR error handler crashed:', err?.message || err);
    }
  });

  // Start listening for user's line
  // In-memory cache of the granted state within this app session, so we don't
  // even call the native getPermissionsAsync bridge more than once per session
  // once we know permission is granted. Persisted native state on Android/iOS
  // survives app restarts, so this cache is a defence-in-depth optimisation.
  const speechPermissionGrantedRef = useRef(false);
  const audioPermissionGrantedRef = useRef(false);

  /**
   * Ensure microphone/speech-recognition permission is granted BEFORE calling
   * requestPermissionsAsync. We only request when the native state is
   * NOT_DETERMINED / undetermined. If ALREADY GRANTED we skip. If DENIED we
   * surface the existing explanation flow and do not re-prompt automatically.
   * Returns true when the caller may proceed.
   */
  const ensureSpeechPermission = async (): Promise<boolean> => {
    if (speechPermissionGrantedRef.current) return true;
    try {
      const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (current.granted) {
        speechPermissionGrantedRef.current = true;
        debugLog('ensureSpeechPermission: already granted, skipping request');
        return true;
      }
      // Only prompt on the very first (undetermined) request. If the native
      // state says the user previously denied and we can no longer request,
      // point them at Settings instead of silently re-prompting.
      if (current.canAskAgain === false) {
        debugLog('ensureSpeechPermission: previously denied, canAskAgain=false');
        Alert.alert(
          'Microphone Access Needed',
          'Speech recognition needs microphone access. Please enable it in Settings → Apps → ScriptM8 → Permissions.',
        );
        return false;
      }
      debugLog('ensureSpeechPermission: requesting (undetermined)');
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (result.granted) {
        speechPermissionGrantedRef.current = true;
        return true;
      }
      Alert.alert('Permission Required', 'Please grant microphone permission for speech recognition.');
      return false;
    } catch (e: any) {
      debugLog(`ensureSpeechPermission: error - ${e?.message || 'unknown'}`);
      return false;
    }
  };

  const startListening = async () => {
    debugLog('startListening called');
    if (!speechRecognitionAvailable) {
      debugLog('startListening: SR not available');
      Alert.alert('Not Available', 'Speech recognition is not available on this device.');
      return;
    }

    try {
      const ok = await ensureSpeechPermission();
      if (!ok) return;

      setRecognizedText('');
      debugLog('startListening: Starting SR module...');
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
      debugLog('startListening: SR module started');
    } catch (error: any) {
      debugLog(`startListening: Error - ${error?.message || 'unknown'}`);
      console.error('Failed to start speech recognition:', error);
    }
  };

  // Stop listening
  const stopListening = () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      console.error('Failed to stop speech recognition:', error);
    }
    setIsListening(false);
  };

  // Load rehearsal and script data
  useEffect(() => {
    const loadData = async () => {
      try {
        console.log('[Rehearsal] Loading data for id:', id);
        if (id) {
          const rehearsal = await fetchRehearsal(id);
          console.log('[Rehearsal] Fetched rehearsal:', rehearsal ? 'found' : 'null');
          if (rehearsal) {
            const script = await fetchScript(rehearsal.script_id);
            console.log('[Rehearsal] Fetched script:', script ? 'found' : 'null');
            console.log('[Rehearsal] Script lines count:', script?.lines?.length || 0);
            setCurrentLineIndex(rehearsal.current_line_index || 0);
            setCompletedLines(rehearsal.completed_lines || []);
            setMissedLines(rehearsal.missed_lines || []);
            setWeakLines(rehearsal.weak_lines || []);
          } else {
            console.error('[Rehearsal] Rehearsal not found:', id);
            Alert.alert('Error', 'Rehearsal not found. Please try again.');
            router.back();
            return;
          }
        }
      } catch (error) {
        console.error('[Rehearsal] Error loading data:', error);
        Alert.alert('Error', 'Failed to load rehearsal. Please try again.');
        router.back();
        return;
      }
      setLoading(false);
    };
    loadData();

    return () => {
      // Crash-safe unmount cleanup — each native module call individually
      // guarded so a double-teardown or already-stopped state can never
      // escalate to an unhandled promise rejection / native SIGSEGV.
      try { Promise.resolve(Speech.stop()).catch(() => {}); } catch { /* ignore */ }
      // 2026-02 — also tear down any ElevenLabs Audio.Sound in flight so
      // it can't outlive the screen.
      try {
        const s = activeElevenLabsSoundRef.current;
        activeElevenLabsSoundRef.current = null;
        if (s) {
          Promise.resolve(s.stopAsync()).catch(() => {});
          Promise.resolve(s.unloadAsync()).catch(() => {});
        }
      } catch { /* ignore */ }
      isSpeakingRef.current = false;
      speakingLineIndexRef.current = null;
      if (speechTimeoutRef.current) {
        try { clearTimeout(speechTimeoutRef.current); } catch { /* ignore */ }
      }
      if (recording) {
        try {
          Promise.resolve(recording.stopAndUnloadAsync()).catch(() => {});
        } catch { /* ignore */ }
      }
    };
  }, [id]);

  // Configure audio for recording
  useEffect(() => {
    const configureAudio = async () => {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
    };
    if (isPremium) {
      configureAudio();
    }
  }, [isPremium]);

  const lines = currentScript?.lines || [];
  const userCharacter = currentRehearsal?.user_character || '';
  const voiceType = currentRehearsal?.voice_type || 'alloy';
  const mode = currentRehearsal?.mode || 'full_read';
  // 2026-02 reader-style wiring. Persisted server-side; fetched via
  // currentRehearsal. Fallbacks preserve pre-2026-02 behaviour bit-
  // for-bit for legacy rehearsals that were saved without them.
  const readerStyle = currentRehearsal?.reader_style || 'neutral';
  const readerVoiceSpeed = currentRehearsal?.voice_speed ?? 1.0;

  const currentLine = lines[currentLineIndex];
  const isUserLine = currentLine?.character === userCharacter;

  // Voice settings based on voice type.
  // 2026-02: `voiceSpeedMultiplier` composes with the per-voice `rate`
  // rather than replacing it — Neutral (1.0) is a no-op, Emotional
  // (0.9) is slightly slower, Intense/Aggressive (1.1) is slightly
  // faster. This keeps the existing per-voice character intact while
  // letting the reader style modulate pace.
  const getVoiceSettings = useCallback((voice: string, voiceSpeedMultiplier: number = 1.0) => {
    let base: { pitch: number; rate: number };
    switch (voice) {
      case 'echo': base = { pitch: 0.85, rate: 0.9 }; break;
      case 'onyx': base = { pitch: 0.75, rate: 0.85 }; break;
      case 'nova': base = { pitch: 1.15, rate: 1.0 }; break;
      case 'shimmer': base = { pitch: 1.2, rate: 0.95 }; break;
      case 'fable': base = { pitch: 1.0, rate: 0.95 }; break;
      default: base = { pitch: 1.0, rate: 0.95 };
    }
    return { pitch: base.pitch, rate: base.rate * voiceSpeedMultiplier };
  }, []);

  // 2026-02 multi-voice wiring. Persistent map is loaded once on mount
  // (see effect below) and read synchronously inside speakLine via a
  // ref so we never re-render on every line.
  const voiceAssignmentsRef = useRef<Record<string, CharacterVoiceAssignment>>({});
  const elevenLabsAvailable = useRef<boolean>(false);
  const activeElevenLabsSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    // Load once per script — the picker persists to AsyncStorage
    // keyed by scriptId, so a fresh read is authoritative.
    const scriptId = currentScript?.id || currentRehearsal?.script_id;
    if (!scriptId) return;
    elevenLabsAvailable.current = isElevenLabsConfigured();
    (async () => {
      try {
        const list = await loadVoiceAssignments(scriptId);
        const map: Record<string, CharacterVoiceAssignment> = {};
        // 2026-02 voice-pipeline hardening. Store BOTH exact and
        // upper-cased keys. Screenplay parsers emit character names in
        // upper case ("DET. HARRIS"), but the picker may persist them
        // in the parsed form ("Det. Harris") depending on the source
        // metadata. Case-insensitive lookup guards against that drift
        // without changing the storage format.
        for (const a of list) {
          if (a && a.characterName) {
            map[a.characterName] = a;
            map[a.characterName.toUpperCase()] = a;
          }
        }
        voiceAssignmentsRef.current = map;
        DebugLog.log('DIAGNOSTIC', 'Rehearsal', 'REHEARSAL_VOICE_ASSIGNMENTS', {
          scriptId,
          count: list.length,
          elevenLabsConfigured: elevenLabsAvailable.current,
          // Per-character breakdown makes it impossible to claim the
          // voice is working "because elevenLabsConfigured=true".
          assignments: list.map(a => ({
            character: a.characterName,
            provider: 'elevenlabs',
            voiceKey: a.voiceKey,
            voiceId: a.voiceId,
          })),
        });
      } catch (e: any) {
        // Non-fatal: fall through to the shared expo-speech path.
        DebugLog.errorCaught('voice-assignments-load', e, { scriptId });
        voiceAssignmentsRef.current = {};
      }
    })();
  }, [currentScript?.id, currentRehearsal?.script_id]);

  // Helper: safely tear down any active ElevenLabs sound. Called from
  // pause/stop paths and before every new speakLine invocation.
  const stopElevenLabsSound = useCallback(async () => {
    const s = activeElevenLabsSoundRef.current;
    activeElevenLabsSoundRef.current = null;
    if (s) {
      try { await s.stopAsync(); } catch { /* already stopped */ }
      try { await s.unloadAsync(); } catch { /* already unloaded */ }
    }
  }, []);

  // Track if speech is in progress to prevent multiple calls
  const isSpeakingRef = useRef(false);
  const speechTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentLineIndexRef = useRef(currentLineIndex);
  // Track if we've already processed an advance for this speech cycle
  const advanceProcessedRef = useRef(false);
  // Track the line index we're currently speaking to prevent duplicate advances
  const speakingLineIndexRef = useRef<number | null>(null);
  // Ref to hold advanceToNextLine to avoid circular dependency
  const advanceToNextLineRef = useRef<() => void>(() => {});

  // Keep line index ref updated
  useEffect(() => {
    currentLineIndexRef.current = currentLineIndex;
  }, [currentLineIndex]);

  // Speak a line using device TTS (with crash protection)
  const speakLine = useCallback(
    async (text: string, lineIndex?: number) => {
      // Use the passed lineIndex or fall back to current ref
      const targetLineIndex = lineIndex ?? currentLineIndexRef.current;
      
      if (!text || isPaused) return;
      
      // Prevent multiple simultaneous speech calls for the same line
      if (isSpeakingRef.current) {
        console.log('[Rehearsal] Speech already in progress, skipping');
        return;
      }
      
      // Prevent speaking the same line twice
      if (speakingLineIndexRef.current === targetLineIndex) {
        console.log('[Rehearsal] Already spoke/speaking this line, skipping');
        return;
      }

      console.log('[Rehearsal] Speaking line:', targetLineIndex, text.substring(0, 30));
      isSpeakingRef.current = true;
      speakingLineIndexRef.current = targetLineIndex;
      advanceProcessedRef.current = false;
      setSpeaking(true);
      setState('ai_speaking');

      // Compose the reader style speed multiplier into the base voice
      // settings. See getVoiceSettings above.
      const voiceSettings = getVoiceSettings(voiceType, readerVoiceSpeed);

      // 2026-02 multi-voice branch selection. Uses the line's
      // character (resolved at call time, not memoized) to look up the
      // per-character assignment. If ElevenLabs is configured AND the
      // character has an explicit voiceId, we route through
      // playSpeech; otherwise we fall through to the pre-2026-02
      // Speech.speak(...) path unchanged.
      const lineCharacter = lines[targetLineIndex]?.character;
      // 2026-02: case-insensitive lookup guards against picker/parser
      // casing drift (see loader above — both exact and upper-cased
      // keys are stored).
      const assignment = lineCharacter
        ? (voiceAssignmentsRef.current[lineCharacter]
           ?? voiceAssignmentsRef.current[lineCharacter.toUpperCase()])
        : undefined;
      const useElevenLabs =
        elevenLabsAvailable.current
        && !!assignment
        && !!assignment.voiceId;

      // TTS_REQUEST diagnostic — emitted BEFORE any provider call so
      // we can see which provider + voiceId is actually being chosen
      // per line. This makes it impossible to claim the voice is
      // working merely because elevenLabsConfigured=true.
      DebugLog.log('DIAGNOSTIC', 'Rehearsal', 'TTS_REQUEST', {
        lineIndex: targetLineIndex,
        character: lineCharacter || '(unknown)',
        provider: useElevenLabs ? 'elevenlabs' : 'expo-speech',
        voiceId: useElevenLabs ? assignment!.voiceId : null,
        voiceKey: useElevenLabs ? assignment!.voiceKey : null,
        globalFallbackVoiceType: voiceType,
        readerStyle,
        voiceSpeed: readerVoiceSpeed,
        assignmentPresent: !!assignment,
        elevenLabsConfigured: elevenLabsAvailable.current,
      });

      // Helper to safely advance once
      const safeAdvance = () => {
        if (advanceProcessedRef.current) {
          console.log('[Rehearsal] Advance already processed, skipping');
          return;
        }
        advanceProcessedRef.current = true;
        isSpeakingRef.current = false;
        setSpeaking(false);
        
        // Clear any pending timeouts
        if (speechTimeoutRef.current) {
          clearTimeout(speechTimeoutRef.current);
        }
        
        // Use a timeout to ensure state has settled
        speechTimeoutRef.current = setTimeout(() => {
          // Double-check we're still on the expected line before advancing
          if (currentLineIndexRef.current === targetLineIndex) {
            advanceToNextLineRef.current();
          }
        }, 300);
      };

      try {
        // Stop any existing speech first
        await Speech.stop();
        await stopElevenLabsSound();

        // Small delay to ensure previous speech is fully stopped
        await new Promise(resolve => setTimeout(resolve, 100));

        if (useElevenLabs && assignment) {
          // ─── Per-character ElevenLabs voice path ─────────────────
          // Uses the existing playSpeech() from elevenLabsService.
          // The returned Audio.Sound is wired to the same safeAdvance
          // callback as the expo-speech path, so line-advancement and
          // pause-handling are unchanged.
          try {
            const sound = await playSpeech(text, assignment.voiceId);
            if (!sound) {
              // Generation failed — fall back to expo-speech so the
              // rehearsal never stalls.
              throw new Error('playSpeech returned null');
            }
            DebugLog.log('DIAGNOSTIC', 'Rehearsal', 'TTS_RESPONSE', {
              lineIndex: targetLineIndex,
              character: lineCharacter,
              provider: 'elevenlabs',
              voiceId: assignment.voiceId,
              voiceKey: assignment.voiceKey,
              success: true,
            });
            DebugLog.log('DIAGNOSTIC', 'Rehearsal', 'AUDIO_PLAYBACK', {
              lineIndex: targetLineIndex,
              character: lineCharacter,
              provider: 'elevenlabs',
              voiceId: assignment.voiceId,
              voiceKey: assignment.voiceKey,
            });
            activeElevenLabsSoundRef.current = sound;
            let doneFired = false;
            sound.setOnPlaybackStatusUpdate((status: any) => {
              if (!status?.isLoaded) return;
              if (status.didJustFinish && !doneFired) {
                doneFired = true;
                console.log('[Rehearsal] ElevenLabs playback finished for line:', targetLineIndex);
                // Match the semantics of Speech onDone.
                activeElevenLabsSoundRef.current = null;
                safeAdvance();
              }
            });
            return; // do not fall through to Speech.speak
          } catch (e: any) {
            console.warn('[Rehearsal] ElevenLabs path failed, falling back to expo-speech:', e?.message);
            DebugLog.log('DIAGNOSTIC', 'Rehearsal', 'TTS_RESPONSE', {
              lineIndex: targetLineIndex,
              character: lineCharacter,
              provider: 'elevenlabs',
              voiceId: assignment.voiceId,
              voiceKey: assignment.voiceKey,
              success: false,
              error: e?.message || String(e),
              fallingBackTo: 'expo-speech',
            });
            DebugLog.errorCaught('elevenlabs-playSpeech', e, {
              character: lineCharacter, lineIndex: targetLineIndex,
              voiceId: assignment.voiceId,
            });
            // Intentional fall-through to the shared path below.
          }
        }

        DebugLog.log('DIAGNOSTIC', 'Rehearsal', 'AUDIO_PLAYBACK', {
          lineIndex: targetLineIndex,
          character: lineCharacter || '(unknown)',
          provider: 'expo-speech',
          voiceId: null,
          globalFallbackVoiceType: voiceType,
          reason: useElevenLabs && assignment
            ? 'elevenlabs-generation-failed'
            : (assignment ? 'no-elevenlabs-key' : 'no-assignment'),
        });

        Speech.speak(text, {
          language: 'en-US',
          pitch: voiceSettings.pitch,
          rate: voiceSettings.rate,
          onDone: () => {
            console.log('[Rehearsal] Speech done for line:', targetLineIndex);
            safeAdvance();
          },
          onError: (error) => {
            console.error('[Rehearsal] Speech error:', error);
            safeAdvance();
          },
          onStopped: () => {
            console.log('[Rehearsal] Speech stopped');
            isSpeakingRef.current = false;
            setSpeaking(false);
            // Don't advance on manual stop - user may have paused
          },
        });
      } catch (error) {
        console.error('[Rehearsal] TTS error:', error);
        safeAdvance();
      }
    },
    [voiceType, isPaused, getVoiceSettings, readerVoiceSpeed, lines, stopElevenLabsSound]
  );

  // Save progress to backend
  const saveProgress = useCallback(async (lineIndex: number) => {
    if (id) {
      await updateRehearsal(id, {
        current_line_index: lineIndex,
        completed_lines: completedLines,
        missed_lines: missedLines,
        weak_lines: weakLines,
      });
    }
  }, [id, completedLines, missedLines, weakLines, updateRehearsal]);

  // ─── END-OF-REHEARSAL FINALIZATION ─────────────────────────────────────
  // A single, idempotent, crash-safe finalization path. Every "we're done"
  // trigger (last line completed, missing next line, restart, exit) must
  // route through this function so cleanup and diagnostics happen exactly
  // once, no unhandled promise rejections can escape, and no native module
  // is torn down twice.
  const finalizeGuardRef = useRef(false);
  const finalizeRehearsal = useCallback(async (reason: string) => {
    if (finalizeGuardRef.current) {
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'finalize skipped (already ran)', { reason });
      return;
    }
    finalizeGuardRef.current = true;
    DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'rehearsal-finish-start', { reason });

    // 1. Stop TTS (never throw to caller)
    try {
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'audio-cleanup-start', {});
      await Promise.resolve(Speech.stop()).catch(() => {});
      isSpeakingRef.current = false;
      speakingLineIndexRef.current = null;
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
      }
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'audio-cleanup-success', {});
    } catch (audioErr: any) {
      DebugLog.errorCaught('audio-cleanup', audioErr);
    }

    // 2. Stop speech-recognition (guard against native re-entry)
    try {
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'speech-cleanup-start', {});
      if (isListening) {
        try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ }
      }
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'speech-cleanup-success', {});
    } catch (srErr: any) {
      DebugLog.errorCaught('speech-cleanup', srErr);
    }

    // 3. Compute + persist final progress (best-effort — never throw)
    try {
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'stats-calculation-start', {
        totalLines: lines.length,
        completedCount: completedLines.length,
        userChar: userCharacter,
      });
      const finalIndex = lines.length;
      if (id) {
        await updateRehearsal(id, {
          current_line_index: finalIndex,
          completed_lines: completedLines,
          missed_lines: missedLines,
          weak_lines: weakLines,
        }).catch((upErr: any) => {
          DebugLog.errorCaught('final-updateRehearsal', upErr);
        });
      }
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'stats-calculation-success', {
        completed: completedLines.length,
        missed: missedLines.length,
        weak: weakLines.length,
      });
    } catch (statsErr: any) {
      DebugLog.errorCaught('stats-calculation', statsErr);
    }

    // 4. Flip state to 'finished' so the completion UI renders
    try {
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'stats-navigation-start', {});
      setState('finished');
      DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'stats-navigation-success', {});
    } catch (navErr: any) {
      DebugLog.errorCaught('stats-navigation', navErr);
    }

    DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'rehearsal-finish-complete', { reason });
  }, [id, lines.length, completedLines, missedLines, weakLines, userCharacter, isListening, updateRehearsal]);

  // Advance to next line
  const advanceToNextLine = useCallback(() => {
    try {
      if (isPaused) return;

      const currentIdx = currentLineIndexRef.current;
      const nextIndex = currentIdx + 1;
      console.log('[Rehearsal] Advancing from line:', currentIdx, 'to line:', nextIndex, 'of', lines.length);

      if (nextIndex >= lines.length) {
        DebugLog.log('DIAGNOSTIC', 'RehearsalScreen', 'final-line-complete', { atIndex: currentIdx });
        // Fire and forget — finalizeRehearsal has its own outer try/catch and can
        // never throw to the caller.
        finalizeRehearsal('end-of-scene').catch(() => {});
        return;
      }

      // Update completed lines and current index
      setCompletedLines((prev) => [...prev, currentIdx]);
      setCurrentLineIndex(nextIndex);
      currentLineIndexRef.current = nextIndex;

      // Reset speaking state for next line - IMPORTANT: clear before deciding to speak
      speakingLineIndexRef.current = null;
      advanceProcessedRef.current = false;
      isSpeakingRef.current = false;

      const nextLine = lines[nextIndex];
      console.log('[Rehearsal] Next line character:', nextLine?.character, 'User:', userCharacter);

      if (!nextLine) {
        console.error('[Rehearsal] nextLine is undefined at index:', nextIndex);
        DebugLog.errorCaught('advance-null-line', new Error(`nextLine undefined at ${nextIndex}`), {
          nextIndex, totalLines: lines.length,
        });
        finalizeRehearsal('null-next-line').catch(() => {});
        return;
      }
      
      if (nextLine.character === userCharacter) {
        setState('user_turn');
        setLineStartTime(Date.now());
        if (mode === 'cue_only' || mode === 'performance') {
          setUserLineVisible(false);
        } else {
          setUserLineVisible(true);
        }
      } else if (!nextLine.is_stage_direction) {
      // AI line - speak it after a short delay
      // Use a flag to prevent double-triggering
      const lineToSpeak = nextIndex;
      setTimeout(() => {
        // Check that we haven't already started speaking this line
        if (!isPaused && 
            currentLineIndexRef.current === lineToSpeak && 
            speakingLineIndexRef.current !== lineToSpeak &&
            !isSpeakingRef.current) {
          speakLine(nextLine.text, lineToSpeak);
        }
      }, 500);
    } else {
      // Stage direction - skip
      setTimeout(() => advanceToNextLine(), 300);
    }
    } catch (err: any) {
      console.error('[Rehearsal] advanceToNextLine error:', err?.message || err);
      debugLog(`Advance Error: ${err?.message || 'unknown'}`);
    }
  }, [lines, userCharacter, isPaused, mode, speakLine, saveProgress]);

  // Keep advanceToNextLine ref updated for use in speakLine callbacks
  useEffect(() => {
    advanceToNextLineRef.current = advanceToNextLine;
  }, [advanceToNextLine]);

  // Auto-start listening when it's the user's turn (if speech recognition is available and enabled)
  useEffect(() => {
    debugLog(`AutoStart check: state=${state}, srAvail=${speechRecognitionAvailable}, autoAdv=${autoAdvanceEnabled}, listening=${isListening}, paused=${isPaused}`);
    if (state === 'user_turn' && 
        speechRecognitionAvailable && 
        autoAdvanceEnabled && 
        !isListening && 
        !isPaused) {
      // Small delay to let UI settle before starting recognition
      debugLog('AutoStart: Will start listening in 500ms');
      const timer = setTimeout(() => {
        debugLog('AutoStart: Starting listening now');
        startListening();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state, speechRecognitionAvailable, autoAdvanceEnabled, isListening, isPaused]);

  // Start rehearsal
  const startRehearsal = () => {
    if (lines.length === 0) {
      Alert.alert('Error', 'No lines in script');
      return;
    }

    // Reset all state
    setCurrentLineIndex(0);
    currentLineIndexRef.current = 0;
    setCompletedLines([]);
    setMissedLines([]);
    setLinePerformances([]);
    setState('idle');
    speakingLineIndexRef.current = null;
    advanceProcessedRef.current = false;
    isSpeakingRef.current = false;

    const firstLine = lines[0];
    if (firstLine.character === userCharacter) {
      setState('user_turn');
      setLineStartTime(Date.now());
      setUserLineVisible(mode !== 'cue_only' && mode !== 'performance');
    } else if (!firstLine.is_stage_direction) {
      speakLine(firstLine.text, 0);
    } else {
      advanceToNextLine();
    }
  };

  // User confirms they've said their line
  const onUserLineDone = (usedHint: boolean = false, speechAccuracy?: number) => {
    const hesitationTime = (Date.now() - lineStartTime) / 1000;
    
    // Track performance with speech accuracy
    const performance: LinePerformance = {
      lineIndex: currentLineIndex,
      hesitationTime,
      attempts: 1,
      hintUsed: usedHint || userLineVisible,
      speechAccuracy: speechAccuracy,
    };
    setLinePerformances((prev) => [...prev, performance]);
    
    // Reset speech recognition state
    setCurrentAccuracy(0);
    setRecognizedText('');
    
    // Mark as weak if hesitation > 5 seconds or hint was used
    if (hesitationTime > 5 || usedHint) {
      setWeakLines((prev) => [...new Set([...prev, currentLineIndex])]);
    }
    
    setState('waiting');
    advanceToNextLine();
  };

  // Mark line as missed
  const onLineMissed = () => {
    setMissedLines((prev) => [...new Set([...prev, currentLineIndex])]);
    setWeakLines((prev) => [...new Set([...prev, currentLineIndex])]);
    onUserLineDone(true);
  };

  // Show line hint
  const showHint = () => {
    setUserLineVisible(true);
  };

  // Toggle pause
  const togglePause = async () => {
    if (isPaused) {
      setIsPaused(false);
      if (state === 'ai_speaking' && !speaking && currentLine && !currentLine.is_stage_direction && currentLine.character !== userCharacter) {
        speakLine(currentLine.text);
      }
    } else {
      setIsPaused(true);
      Speech.stop();
      // 2026-02: also stop any active ElevenLabs playback so the pause
      // button works uniformly across both speech engines.
      stopElevenLabsSound();
      setSpeaking(false);
    }
  };

  // Recording functions (Premium only)
  /**
   * Ensure microphone permission is granted BEFORE calling
   * Audio.requestPermissionsAsync. Same policy as ensureSpeechPermission:
   * skip if already granted, prompt only when undetermined, show a Settings
   * hint if permission was previously denied. Prevents repeated OS prompts
   * every time the Premium record button is tapped.
   */
  const ensureAudioPermission = async (): Promise<boolean> => {
    if (audioPermissionGrantedRef.current) return true;
    try {
      const current = await Audio.getPermissionsAsync();
      if (current.status === 'granted') {
        audioPermissionGrantedRef.current = true;
        return true;
      }
      if (current.canAskAgain === false) {
        Alert.alert(
          'Microphone Access Needed',
          'Recording needs microphone access. Please enable it in Settings → Apps → ScriptM8 → Permissions.',
        );
        return false;
      }
      const result = await Audio.requestPermissionsAsync();
      if (result.status === 'granted') {
        audioPermissionGrantedRef.current = true;
        return true;
      }
      Alert.alert('Permission Required', 'Please grant microphone permission to record');
      return false;
    } catch {
      return false;
    }
  };

  const startRecording = async () => {
    if (!isPremium) {
      Alert.alert('Premium Feature', 'Recording requires Premium subscription');
      return;
    }

    try {
      const ok = await ensureAudioPermission();
      if (!ok) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecordedUri(uri);
      setRecording(null);
      setIsRecording(false);
      setShowRecordingModal(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  const playRecording = async () => {
    if (!recordedUri) return;

    try {
      const { sound } = await Audio.Sound.createAsync({ uri: recordedUri });
      await sound.playAsync();
    } catch (error) {
      console.error('Failed to play recording:', error);
    }
  };

  // Restart from beginning
  const restartRehearsal = () => {
    Alert.alert('Restart Rehearsal', 'Start from the beginning?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        onPress: () => {
          setIsPaused(false);
          startRehearsal();
        },
      },
    ]);
  };

  // Skip to next line
  const skipLine = () => {
    if (isUserLine) {
      onLineMissed();
    } else {
      Speech.stop();
      setSpeaking(false);
      advanceToNextLine();
    }
  };

  // Exit rehearsal
  const exitRehearsal = () => {
    Alert.alert('Exit Rehearsal', 'Save progress and exit?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit',
        onPress: async () => {
          await saveProgress(currentLineIndex);
          router.back();
        },
      },
    ]);
  };

  // Calculate stats — bulletproof: all values coerced to finite numbers.
  // A failure here must not crash the end-of-scene render.
  const getStats = () => {
    try {
      const safeLines = Array.isArray(lines) ? lines : [];
      const safePerformances = Array.isArray(linePerformances) ? linePerformances : [];
      const safeMissed = Array.isArray(missedLines) ? missedLines : [];

      const totalUserLines = safeLines.filter(l => l && l.character === userCharacter).length;
      const completedUserLines = safePerformances.length;

      const totalHesitation = safePerformances.reduce((sum, p) => {
        const v = Number(p?.hesitationTime);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      const avgHesitationRaw = safePerformances.length > 0
        ? totalHesitation / safePerformances.length
        : 0;
      const avgHesitation = Number.isFinite(avgHesitationRaw) ? avgHesitationRaw : 0;

      const hintsUsed = safePerformances.filter(p => p && p.hintUsed).length;

      const accuracyRaw = totalUserLines > 0
        ? Math.round(((completedUserLines - safeMissed.length) / totalUserLines) * 100)
        : 0;
      const accuracy = Number.isFinite(accuracyRaw) ? Math.max(0, Math.min(100, accuracyRaw)) : 0;

      return { totalUserLines, completedUserLines, avgHesitation, hintsUsed, accuracy };
    } catch (e: any) {
      DebugLog.errorCaught('getStats', e);
      return { totalUserLines: 0, completedUserLines: 0, avgHesitation: 0, hintsUsed: 0, accuracy: 0 };
    }
  };

  // Auto-scroll to current line using measured y positions.
  // Skip safely if the line hasn't reported its layout yet — the next
  // render pass will fire onLayout and this effect will re-run.
  useEffect(() => {
    if (!scrollViewRef.current || currentLineIndex <= 0) return;
    const y = lineYRef.current[currentLineIndex];
    if (typeof y !== 'number') return;
    const target = Math.max(0, y - 80);
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: target, animated: true });
    }, 100);
  }, [currentLineIndex]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading rehearsal...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentScript || !currentRehearsal) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#ef4444" />
          <Text style={styles.errorText}>Failed to load rehearsal</Text>
          <TouchableOpacity style={styles.errorButton} onPress={() => router.back()}>
            <Text style={styles.errorButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Check if script has no lines
  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="document-text-outline" size={48} color="#f59e0b" />
          <Text style={styles.errorText}>No dialogue lines found in script</Text>
          <Text style={styles.errorSubtext}>The script may not have been parsed correctly</Text>
          <TouchableOpacity style={styles.errorButton} onPress={() => router.back()}>
            <Text style={styles.errorButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const progress = lines.length > 0 ? (currentLineIndex / lines.length) * 100 : 0;
  const stats = getStats();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={exitRehearsal} style={styles.headerButton}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentScript.title}
          </Text>
          <Text style={styles.headerSubtitle}>Playing as {userCharacter}</Text>
        </View>
        <View style={styles.headerRight}>
          {isPremium && (
            <TouchableOpacity
              onPress={isRecording ? stopRecording : startRecording}
              style={[styles.recordButton, isRecording && styles.recordButtonActive]}
            >
              <Ionicons name={isRecording ? 'stop' : 'radio-button-on'} size={20} color={isRecording ? '#fff' : '#ef4444'} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setShowStatsModal(true)} style={styles.headerButton}>
            <Ionicons name="stats-chart" size={22} color="#6366f1" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {currentLineIndex + 1} / {lines.length}
        </Text>
      </View>

      {/* Recording Indicator */}
      {isRecording && (
        <View style={styles.recordingBanner}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>Recording...</Text>
        </View>
      )}

      {/*
        DEBUG BANNER — visible speech-recognition state on device.

        Gated behind `__DEV__` so it renders only in development builds
        (Metro / Expo Go) and is stripped from release APKs by the Metro
        bundler's `__DEV__` constant. Physical release users must never
        see the raw SR/Auto/Listen/State internals — that leak was
        reported on Samsung S23 Ultra / Android 16 on build 1110.

        The internal `debugLog()` (console.log + setDebugInfo state) is
        deliberately preserved for QA logcat capture — only the visible
        JSX is production-gated.
      */}
      {__DEV__ && (
        <View
          style={{ backgroundColor: '#1a1a2e', padding: 8, borderBottomWidth: 1, borderBottomColor: '#333' }}
          testID="rehearsal-debug-banner"
        >
          <Text style={{ color: '#f59e0b', fontSize: 11, fontFamily: 'monospace' }} numberOfLines={2}>
            [DEBUG] {debugInfo}
          </Text>
          <Text style={{ color: '#6b7280', fontSize: 10 }}>
            SR:{speechRecognitionAvailable ? 'Y' : 'N'} | Auto:{autoAdvanceEnabled ? 'Y' : 'N'} | Listen:{isListening ? 'Y' : 'N'} | State:{state}
          </Text>
        </View>
      )}

      {/* Current Line Display */}
      <View style={styles.currentLineContainer}>
        {state === 'finished' ? (
          <View style={styles.finishedContainer}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
            <Text style={styles.finishedTitle}>Scene Complete!</Text>
            <Text style={styles.finishedSubtitle}>
              Accuracy: {Number.isFinite(stats.accuracy) ? stats.accuracy : 0}% • Avg. Response: {(Number.isFinite(stats.avgHesitation) ? stats.avgHesitation : 0).toFixed(1)}s
            </Text>
            {weakLines.length > 0 && (
              <Text style={styles.weakLinesText}>
                {weakLines.length} lines need more practice
              </Text>
            )}
            <View style={styles.finishedButtons}>
              <TouchableOpacity style={styles.finishedButton} onPress={restartRehearsal}>
                <Ionicons name="refresh" size={20} color="#fff" />
                <Text style={styles.finishedButtonText}>Run Again</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.finishedButton, styles.finishedButtonSecondary]} 
                onPress={() => setShowStatsModal(true)}
              >
                <Ionicons name="analytics" size={20} color="#6366f1" />
                <Text style={[styles.finishedButtonText, { color: '#6366f1' }]}>View Stats</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : state === 'idle' ? (
          <View style={styles.idleContainer}>
            <Ionicons name="play-circle" size={80} color="#6366f1" />
            <Text style={styles.idleTitle}>Ready to Rehearse</Text>
            <Text style={styles.idleSubtitle}>
              Mode: {mode === 'full_read' ? 'Full Read' : mode === 'cue_only' ? 'Cue Only' : 'Performance'}
            </Text>
            <TouchableOpacity style={styles.startButton} onPress={startRehearsal}>
              <Ionicons name="play" size={24} color="#fff" />
              <Text style={styles.startButtonText}>Start Scene</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.activeLineContainer}>
            {/* Speaker indicator */}
            <View style={styles.speakerRow}>
              <View
                style={[
                  styles.speakerBadge,
                  isUserLine ? styles.speakerBadgeUser : styles.speakerBadgeAI,
                ]}
              >
                <Ionicons
                  name={isUserLine ? 'person' : 'mic'}
                  size={16}
                  color="#fff"
                />
                <Text style={styles.speakerName}>
                  {currentLine?.is_stage_direction
                    ? 'Direction'
                    : currentLine?.character}
                </Text>
              </View>
              {speaking && (
                <View style={styles.speakingIndicator}>
                  <Ionicons name="volume-high" size={20} color="#10b981" />
                  <Text style={styles.speakingText}>Speaking...</Text>
                </View>
              )}
              {weakLines.includes(currentLineIndex) && (
                <View style={styles.weakBadge}>
                  <Ionicons name="warning" size={14} color="#f59e0b" />
                  <Text style={styles.weakBadgeText}>Weak</Text>
                </View>
              )}
            </View>

            {/* Line Text */}
            {currentLine?.is_stage_direction ? (
              <Text style={styles.stageDirection}>{currentLine.text}</Text>
            ) : isUserLine ? (
              <View style={styles.userLineContainer}>
                {userLineVisible ? (
                  <Text style={styles.userLineText}>{currentLine?.text}</Text>
                ) : (
                  <View style={styles.hiddenLineContainer}>
                    <Ionicons name="eye-off" size={32} color="#6b7280" />
                    <Text style={styles.hiddenLineText}>Your line is hidden</Text>
                    <TouchableOpacity style={styles.hintButton} onPress={showHint}>
                      <Text style={styles.hintButtonText}>Show Hint</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={styles.userActionContainer}>
                  {/* Speech Recognition Indicator with Accuracy */}
                  {isListening && (
                    <View style={styles.listeningContainer}>
                      <Animated.View 
                        style={[
                          styles.listeningPulse,
                          { transform: [{ scale: pulseAnim }] }
                        ]}
                      >
                        <Ionicons name="mic" size={24} color="#10b981" />
                      </Animated.View>
                      <Text style={styles.listeningText}>Listening...</Text>
                      
                      {/* Real-time accuracy indicator */}
                      {recognizedText.length > 0 && (
                        <>
                          <View style={styles.accuracyContainer}>
                            <View style={styles.accuracyBar}>
                              <View 
                                style={[
                                  styles.accuracyFill,
                                  { 
                                    width: `${Math.min(currentAccuracy * 100, 100)}%`,
                                    backgroundColor: getAccuracyColor(currentAccuracy)
                                  }
                                ]} 
                              />
                            </View>
                            <Text style={[
                              styles.accuracyLabel,
                              { color: getAccuracyColor(currentAccuracy) }
                            ]}>
                              {Math.round(currentAccuracy * 100)}% - {getAccuracyLabel(currentAccuracy)}
                            </Text>
                          </View>
                          <Text style={styles.recognizedText} numberOfLines={2}>
                            &quot;{recognizedText}&quot;
                          </Text>
                        </>
                      )}
                    </View>
                  )}
                  
                  {/* Accuracy feedback after listening */}
                  {showAccuracyFeedback && !isListening && currentAccuracy > 0 && (
                    <View style={[
                      styles.accuracyFeedback,
                      { borderColor: getAccuracyColor(currentAccuracy) }
                    ]}>
                      <Ionicons 
                        name={currentAccuracy >= 0.6 ? 'checkmark-circle' : 'alert-circle'} 
                        size={24} 
                        color={getAccuracyColor(currentAccuracy)} 
                      />
                      <Text style={[
                        styles.accuracyFeedbackText,
                        { color: getAccuracyColor(currentAccuracy) }
                      ]}>
                        {getAccuracyLabel(currentAccuracy)} - {Math.round(currentAccuracy * 100)}% match
                      </Text>
                    </View>
                  )}
                  
                  <Text style={styles.userActionLabel}>
                    {isListening ? 'Speak your line now' : 'Say your line, then tap:'}
                  </Text>
                  <View style={styles.userActionButtons}>
                    {/* Speech Recognition Button */}
                    {speechRecognitionAvailable && isPremium && !isListening && (
                      <TouchableOpacity
                        style={styles.listenButton}
                        onPress={startListening}
                      >
                        <Ionicons name="mic" size={20} color="#10b981" />
                        <Text style={styles.listenButtonText}>Auto</Text>
                      </TouchableOpacity>
                    )}
                    
                    {/* Stop Listening Button */}
                    {isListening && (
                      <TouchableOpacity
                        style={styles.stopListenButton}
                        onPress={stopListening}
                      >
                        <Ionicons name="stop" size={20} color="#ef4444" />
                        <Text style={styles.stopListenButtonText}>Stop</Text>
                      </TouchableOpacity>
                    )}
                    
                    <TouchableOpacity
                      style={styles.doneButton}
                      onPress={() => {
                        if (isListening) stopListening();
                        onUserLineDone(!userLineVisible, currentAccuracy > 0 ? currentAccuracy : undefined);
                      }}
                    >
                      <Ionicons name="checkmark" size={24} color="#fff" />
                      <Text style={styles.doneButtonText}>Done</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.missedButton}
                      onPress={() => {
                        if (isListening) stopListening();
                        onLineMissed();
                      }}
                    >
                      <Ionicons name="close" size={20} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Auto-advance toggle for Premium */}
                  {isPremium && speechRecognitionAvailable && (
                    <TouchableOpacity 
                      style={styles.autoAdvanceToggle}
                      onPress={() => setAutoAdvanceEnabled(!autoAdvanceEnabled)}
                    >
                      <Ionicons 
                        name={autoAdvanceEnabled ? 'checkbox' : 'square-outline'} 
                        size={18} 
                        color={autoAdvanceEnabled ? '#10b981' : '#6b7280'} 
                      />
                      <Text style={styles.autoAdvanceText}>Auto-advance when line detected</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <Text style={styles.aiLineText}>{currentLine?.text}</Text>
            )}
          </View>
        )}
      </View>

      {/* Script View */}
      <View style={styles.scriptContainer}>
        <Text style={styles.scriptViewTitle}>Script</Text>
        <ScrollView
          ref={scrollViewRef}
          style={styles.scriptScroll}
          contentContainerStyle={styles.scriptContent}
        >
          {lines.map((line, index) => (
            <View
              key={line.id}
              onLayout={(e) => {
                // Ground truth for the auto-scroll effect above.
                lineYRef.current[index] = e.nativeEvent.layout.y;
              }}
              style={[
                styles.scriptLine,
                index === currentLineIndex && styles.scriptLineCurrent,
                completedLines.includes(index) && styles.scriptLineCompleted,
                line.character === userCharacter && styles.scriptLineUser,
                weakLines.includes(index) && styles.scriptLineWeak,
              ]}
            >
              {line.is_stage_direction ? (
                <Text style={styles.scriptDirection}>{line.text}</Text>
              ) : (
                <>
                  <View style={styles.scriptLineHeader}>
                    <Text
                      style={[
                        styles.scriptCharacter,
                        line.character === userCharacter && styles.scriptCharacterUser,
                      ]}
                    >
                      {line.character}
                    </Text>
                    {weakLines.includes(index) && (
                      <Ionicons name="warning" size={12} color="#f59e0b" />
                    )}
                  </View>
                  <Text style={styles.scriptText}>{line.text}</Text>
                </>
              )}
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Controls */}
      {state !== 'idle' && state !== 'finished' && (
        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlButton} onPress={skipLine}>
            <Ionicons name="play-skip-forward" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.controlButton, styles.controlButtonMain]}
            onPress={togglePause}
          >
            <Ionicons name={isPaused ? 'play' : 'pause'} size={32} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={restartRehearsal}>
            <Ionicons name="refresh" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Stats Modal */}
      <Modal visible={showStatsModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Performance Stats</Text>
              <TouchableOpacity onPress={() => setShowStatsModal(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.statCard}>
                <Ionicons name="checkmark-circle" size={32} color="#10b981" />
                <Text style={styles.statValue}>{stats.accuracy}%</Text>
                <Text style={styles.statLabel}>Accuracy</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="time" size={32} color="#6366f1" />
                <Text style={styles.statValue}>{stats.avgHesitation.toFixed(1)}s</Text>
                <Text style={styles.statLabel}>Avg. Response Time</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="eye" size={32} color="#f59e0b" />
                <Text style={styles.statValue}>{stats.hintsUsed}</Text>
                <Text style={styles.statLabel}>Hints Used</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="warning" size={32} color="#ef4444" />
                <Text style={styles.statValue}>{weakLines.length}</Text>
                <Text style={styles.statLabel}>Weak Lines</Text>
              </View>
              {!isPremium && (
                <View style={styles.premiumPrompt}>
                  <Ionicons name="star" size={24} color="#f59e0b" />
                  <Text style={styles.premiumPromptText}>
                    Upgrade to Premium for detailed analytics and weak line drills
                  </Text>
                  <TouchableOpacity 
                    style={styles.premiumPromptButton}
                    onPress={() => {
                      setShowStatsModal(false);
                      router.push('/premium');
                    }}
                  >
                    <Text style={styles.premiumPromptButtonText}>Go Premium</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Recording Modal */}
      <Modal visible={showRecordingModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Recording Saved</Text>
              <TouchableOpacity onPress={() => setShowRecordingModal(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.recordingModalContent}>
              <Ionicons name="checkmark-circle" size={64} color="#10b981" />
              <Text style={styles.recordingModalText}>Your performance has been recorded!</Text>
              <TouchableOpacity style={styles.playbackButton} onPress={playRecording}>
                <Ionicons name="play" size={24} color="#fff" />
                <Text style={styles.playbackButtonText}>Play Recording</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.dismissButton} 
                onPress={() => setShowRecordingModal(false)}
              >
                <Text style={styles.dismissButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#6b7280',
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 16,
    textAlign: 'center',
  },
  errorSubtext: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  errorButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
  },
  errorButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6366f1',
    marginTop: 2,
  },
  recordButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: {
    backgroundColor: '#ef4444',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#1a1a2e',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 13,
    color: '#6b7280',
    minWidth: 50,
    textAlign: 'right',
  },
  recordingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingVertical: 8,
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  recordingText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  currentLineContainer: {
    padding: 16,
    minHeight: 200,
  },
  finishedContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  finishedTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  finishedSubtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 8,
  },
  weakLinesText: {
    fontSize: 14,
    color: '#f59e0b',
    marginTop: 8,
  },
  finishedButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  finishedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  finishedButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  finishedButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  idleContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  idleTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  idleSubtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginTop: 8,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 24,
    gap: 10,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  activeLineContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  speakerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  speakerBadgeUser: {
    backgroundColor: '#6366f1',
  },
  speakerBadgeAI: {
    backgroundColor: '#10b981',
  },
  speakerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  speakingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speakingText: {
    fontSize: 13,
    color: '#10b981',
  },
  weakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  weakBadgeText: {
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: '600',
  },
  stageDirection: {
    fontSize: 15,
    color: '#9ca3af',
    fontStyle: 'italic',
    lineHeight: 22,
  },
  userLineContainer: {
    minHeight: 100,
  },
  userLineText: {
    fontSize: 20,
    color: '#fff',
    lineHeight: 30,
    fontWeight: '500',
  },
  hiddenLineContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  hiddenLineText: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 8,
  },
  hintButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderRadius: 8,
    marginTop: 12,
  },
  hintButtonText: {
    color: '#6366f1',
    fontSize: 15,
    fontWeight: '500',
  },
  userActionContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  userActionLabel: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
  },
  userActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10b981',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  missedButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  listenButtonText: {
    color: '#10b981',
    fontSize: 15,
    fontWeight: '600',
  },
  listeningContainer: {
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  listeningPulse: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  listeningText: {
    fontSize: 14,
    color: '#10b981',
    fontWeight: '600',
  },
  recognizedText: {
    fontSize: 13,
    color: '#9ca3af',
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  autoAdvanceToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  autoAdvanceText: {
    fontSize: 12,
    color: '#6b7280',
  },
  // Accuracy feedback styles
  accuracyContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  accuracyBar: {
    width: '80%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  accuracyFill: {
    height: '100%',
    borderRadius: 4,
  },
  accuracyLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  accuracyFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    marginBottom: 12,
  },
  accuracyFeedbackText: {
    fontSize: 14,
    fontWeight: '500',
  },
  stopListenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  stopListenButtonText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '600',
  },
  aiLineText: {
    fontSize: 18,
    color: '#e5e7eb',
    lineHeight: 28,
  },
  scriptContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  scriptViewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  scriptScroll: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  scriptContent: {
    padding: 12,
  },
  scriptLine: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 4,
  },
  scriptLineCurrent: {
    backgroundColor: 'rgba(99, 102, 241, 0.3)',
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  scriptLineCompleted: {
    opacity: 0.5,
  },
  scriptLineUser: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  scriptLineWeak: {
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
  },
  scriptLineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scriptDirection: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  scriptCharacter: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    marginBottom: 2,
  },
  scriptCharacterUser: {
    color: '#6366f1',
  },
  scriptText: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 20,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonMain: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#6366f1',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  modalScroll: {
    maxHeight: 400,
  },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 16,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  statLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  premiumPrompt: {
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  premiumPromptText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  premiumPromptButton: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  premiumPromptButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  recordingModalContent: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  recordingModalText: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  playbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
    marginBottom: 12,
  },
  playbackButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  dismissButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  dismissButtonText: {
    color: '#6b7280',
    fontSize: 15,
  },
});
