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
  
  // Animation refs
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const scrollViewRef = useRef<ScrollView>(null);

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
      try {
        const status = await ExpoSpeechRecognitionModule.getStateAsync();
        setSpeechRecognitionAvailable(status !== 'inactive');
      } catch {
        // On web or unsupported devices, speech recognition won't be available
        setSpeechRecognitionAvailable(false);
      }
    };
    checkAvailability();
  }, []);

  // Speech recognition event handlers (safely wrapped)
  useSpeechRecognitionEvent('start', () => {
    if (!speechRecognitionImported) return;
    setIsListening(true);
    setCurrentAccuracy(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  });

  useSpeechRecognitionEvent('end', () => {
    if (!speechRecognitionImported) return;
    setIsListening(false);
    // Show accuracy feedback briefly after listening ends
    if (currentAccuracy > 0) {
      setShowAccuracyFeedback(true);
      setTimeout(() => setShowAccuracyFeedback(false), 2000);
    }
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    if (!speechRecognitionImported) return;
    const transcript = event.results[0]?.transcript || '';
    setRecognizedText(transcript);
    
    // Calculate and update accuracy in real-time
    if (state === 'user_turn' && transcript.length > 0) {
      const lines = currentScript?.lines || [];
      const currentLine = lines[currentLineIndex];
      const expectedText = currentLine?.text || '';
      
      const similarity = calculateSimilarity(transcript, expectedText);
      setCurrentAccuracy(similarity);
      
      // Auto-advance when accuracy is high enough
      if (autoAdvanceEnabled && similarity >= 0.65 && transcript.length > 5) {
        // Success feedback
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        stopListening();
        onUserLineDone(false, similarity);
      }
    }
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    if (!speechRecognitionImported) return;
    console.log('Speech recognition error:', event.error);
    setIsListening(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  });

  // Start listening for user's line
  const startListening = async () => {
    if (!speechRecognitionAvailable) {
      Alert.alert('Not Available', 'Speech recognition is not available on this device.');
      return;
    }

    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert('Permission Required', 'Please grant microphone permission for speech recognition.');
        return;
      }

      setRecognizedText('');
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
    } catch (error) {
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
      Speech.stop();
      isSpeakingRef.current = false;
      speakingLineIndexRef.current = null;
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current);
      }
      if (recording) {
        recording.stopAndUnloadAsync();
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

  const currentLine = lines[currentLineIndex];
  const isUserLine = currentLine?.character === userCharacter;

  // Voice settings based on voice type
  const getVoiceSettings = useCallback((voice: string) => {
    switch (voice) {
      case 'echo': return { pitch: 0.85, rate: 0.9 };
      case 'onyx': return { pitch: 0.75, rate: 0.85 };
      case 'nova': return { pitch: 1.15, rate: 1.0 };
      case 'shimmer': return { pitch: 1.2, rate: 0.95 };
      case 'fable': return { pitch: 1.0, rate: 0.95 };
      default: return { pitch: 1.0, rate: 0.95 };
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

      const voiceSettings = getVoiceSettings(voiceType);

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
        
        // Small delay to ensure previous speech is fully stopped
        await new Promise(resolve => setTimeout(resolve, 100));
        
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
    [voiceType, isPaused, getVoiceSettings]
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

  // Advance to next line
  const advanceToNextLine = useCallback(() => {
    if (isPaused) return;

    const currentIdx = currentLineIndexRef.current;
    const nextIndex = currentIdx + 1;
    console.log('[Rehearsal] Advancing from line:', currentIdx, 'to line:', nextIndex, 'of', lines.length);
    
    if (nextIndex >= lines.length) {
      console.log('[Rehearsal] Finished!');
      setState('finished');
      saveProgress(nextIndex);
      return;
    }

    // Update completed lines and current index
    setCompletedLines((prev) => [...prev, currentIdx]);
    setCurrentLineIndex(nextIndex);
    currentLineIndexRef.current = nextIndex;
    
    // Reset speaking state for next line
    speakingLineIndexRef.current = null;
    advanceProcessedRef.current = false;

    const nextLine = lines[nextIndex];
    console.log('[Rehearsal] Next line character:', nextLine?.character, 'User:', userCharacter);
    
    if (nextLine?.character === userCharacter) {
      setState('user_turn');
      setLineStartTime(Date.now());
      if (mode === 'cue_only' || mode === 'performance') {
        setUserLineVisible(false);
      } else {
        setUserLineVisible(true);
      }
    } else if (!nextLine?.is_stage_direction) {
      // AI line - speak it after a short delay
      setTimeout(() => {
        if (!isPaused && currentLineIndexRef.current === nextIndex) {
          speakLine(nextLine.text, nextIndex);
        }
      }, 500);
    } else {
      // Stage direction - skip
      setTimeout(() => advanceToNextLine(), 300);
    }
  }, [lines, userCharacter, isPaused, mode, speakLine, saveProgress]);

  // No need for advanceToNextLineRef - we call advanceToNextLine directly now

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
      setSpeaking(false);
    }
  };

  // Recording functions (Premium only)
  const startRecording = async () => {
    if (!isPremium) {
      Alert.alert('Premium Feature', 'Recording requires Premium subscription');
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant microphone permission to record');
        return;
      }

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

  // Calculate stats
  const getStats = () => {
    const totalUserLines = lines.filter(l => l.character === userCharacter).length;
    const completedUserLines = linePerformances.length;
    const avgHesitation = linePerformances.length > 0 
      ? linePerformances.reduce((sum, p) => sum + p.hesitationTime, 0) / linePerformances.length 
      : 0;
    const hintsUsed = linePerformances.filter(p => p.hintUsed).length;
    const accuracy = totalUserLines > 0 
      ? Math.round(((completedUserLines - missedLines.length) / totalUserLines) * 100) 
      : 0;

    return { totalUserLines, completedUserLines, avgHesitation, hintsUsed, accuracy };
  };

  // Auto-scroll to current line
  useEffect(() => {
    if (scrollViewRef.current && currentLineIndex > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: currentLineIndex * 80, animated: true });
      }, 100);
    }
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

      {/* Current Line Display */}
      <View style={styles.currentLineContainer}>
        {state === 'finished' ? (
          <View style={styles.finishedContainer}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
            <Text style={styles.finishedTitle}>Scene Complete!</Text>
            <Text style={styles.finishedSubtitle}>
              Accuracy: {stats.accuracy}% • Avg. Response: {stats.avgHesitation.toFixed(1)}s
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
