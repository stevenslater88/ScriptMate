import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { useScriptStore, DialogueLine } from '../../store/scriptStore';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type RehearsalState = 'idle' | 'ai_speaking' | 'user_turn' | 'waiting' | 'finished';

export default function RehearsalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentRehearsal, currentScript, fetchRehearsal, fetchScript, updateRehearsal } =
    useScriptStore();

  const [state, setState] = useState<RehearsalState>('idle');
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [userLineVisible, setUserLineVisible] = useState(true);
  const [completedLines, setCompletedLines] = useState<number[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  // Load rehearsal and script data
  useEffect(() => {
    const loadData = async () => {
      if (id) {
        const rehearsal = await fetchRehearsal(id);
        if (rehearsal) {
          await fetchScript(rehearsal.script_id);
          setCurrentLineIndex(rehearsal.current_line_index || 0);
          setCompletedLines(rehearsal.completed_lines || []);
        }
        setLoading(false);
      }
    };
    loadData();

    // Cleanup
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      Speech.stop();
    };
  }, [id]);

  // Configure audio
  useEffect(() => {
    const configureAudio = async () => {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
    };
    configureAudio();
  }, []);

  const lines = currentScript?.lines || [];
  const userCharacter = currentRehearsal?.user_character || '';
  const voiceType = currentRehearsal?.voice_type || 'alloy';
  const mode = currentRehearsal?.mode || 'full_read';

  const currentLine = lines[currentLineIndex];
  const isUserLine = currentLine?.character === userCharacter;

  // Map voice type to pitch/rate settings for variety
  const getVoiceSettings = useCallback((voice: string) => {
    switch (voice) {
      case 'echo': return { pitch: 0.85, rate: 0.9 }; // Male, warm - lower pitch
      case 'onyx': return { pitch: 0.75, rate: 0.85 }; // Deep, authoritative
      case 'nova': return { pitch: 1.15, rate: 1.0 }; // Female, energetic
      case 'shimmer': return { pitch: 1.2, rate: 0.95 }; // Female, soft
      case 'fable': return { pitch: 1.0, rate: 0.95 }; // British accent - normal
      default: return { pitch: 1.0, rate: 0.95 }; // alloy - neutral
    }
  }, []);

  // Speak a line using device TTS
  const speakLine = useCallback(
    async (text: string) => {
      if (!text || isPaused) return;

      setSpeaking(true);
      setState('ai_speaking');

      const voiceSettings = getVoiceSettings(voiceType);

      try {
        // Stop any ongoing speech
        await Speech.stop();
        
        Speech.speak(text, {
          language: 'en-US',
          pitch: voiceSettings.pitch,
          rate: voiceSettings.rate,
          onDone: () => {
            setSpeaking(false);
            advanceToNextLine();
          },
          onError: (error) => {
            console.error('Speech error:', error);
            setSpeaking(false);
            advanceToNextLine();
          },
          onStopped: () => {
            setSpeaking(false);
          },
        });
      } catch (error) {
        console.error('TTS error:', error);
        setSpeaking(false);
        advanceToNextLine();
      }
    },
    [voiceType, isPaused, getVoiceSettings]
  );

  // Advance to next line
  const advanceToNextLine = useCallback(() => {
    if (isPaused) return;

    const nextIndex = currentLineIndex + 1;
    if (nextIndex >= lines.length) {
      setState('finished');
      // Save progress
      if (id) {
        updateRehearsal(id, {
          current_line_index: nextIndex,
          completed_lines: [...completedLines, currentLineIndex],
        });
      }
      return;
    }

    setCompletedLines((prev) => [...prev, currentLineIndex]);
    setCurrentLineIndex(nextIndex);

    // Check if next line is user's line
    const nextLine = lines[nextIndex];
    if (nextLine?.character === userCharacter) {
      setState('user_turn');
      // In cue_only mode, hide the line initially
      if (mode === 'cue_only' || mode === 'performance') {
        setUserLineVisible(false);
      } else {
        setUserLineVisible(true);
      }
    } else if (!nextLine?.is_stage_direction) {
      // AI speaks next
      setTimeout(() => {
        if (!isPaused) {
          speakLine(nextLine.text);
        }
      }, 500);
    } else {
      // Skip stage directions
      setTimeout(() => advanceToNextLine(), 300);
    }
  }, [currentLineIndex, lines, userCharacter, completedLines, isPaused, id, mode, speakLine]);

  // Start rehearsal
  const startRehearsal = () => {
    if (lines.length === 0) {
      Alert.alert('Error', 'No lines in script');
      return;
    }

    setCurrentLineIndex(0);
    setCompletedLines([]);
    setState('idle');

    const firstLine = lines[0];
    if (firstLine.character === userCharacter) {
      setState('user_turn');
      setUserLineVisible(mode !== 'cue_only' && mode !== 'performance');
    } else if (!firstLine.is_stage_direction) {
      speakLine(firstLine.text);
    } else {
      advanceToNextLine();
    }
  };

  // User confirms they've said their line
  const onUserLineDone = () => {
    setState('waiting');
    advanceToNextLine();
  };

  // Show line hint
  const showHint = () => {
    setUserLineVisible(true);
  };

  // Toggle pause
  const togglePause = async () => {
    if (isPaused) {
      setIsPaused(false);
      // Resume where we left off
      if (state === 'ai_speaking' && !speaking) {
        speakLine(currentLine?.text || '');
      }
    } else {
      setIsPaused(true);
      // Stop any playing audio
      if (soundRef.current) {
        await soundRef.current.pauseAsync();
      }
      Speech.stop();
      setSpeaking(false);
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
    advanceToNextLine();
  };

  // Exit rehearsal
  const exitRehearsal = () => {
    Alert.alert('Exit Rehearsal', 'Save progress and exit?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Exit',
        onPress: async () => {
          if (id) {
            await updateRehearsal(id, {
              current_line_index: currentLineIndex,
              completed_lines: completedLines,
            });
          }
          router.back();
        },
      },
    ]);
  };

  // Auto-scroll to current line
  useEffect(() => {
    if (scrollViewRef.current && currentLineIndex > 0) {
      // Scroll after a brief delay
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

  const progress = lines.length > 0 ? (currentLineIndex / lines.length) * 100 : 0;

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
        <TouchableOpacity onPress={restartRehearsal} style={styles.headerButton}>
          <Ionicons name="refresh" size={24} color="#6366f1" />
        </TouchableOpacity>
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

      {/* Current Line Display */}
      <View style={styles.currentLineContainer}>
        {state === 'finished' ? (
          <View style={styles.finishedContainer}>
            <Ionicons name="checkmark-circle" size={64} color="#10b981" />
            <Text style={styles.finishedTitle}>Scene Complete!</Text>
            <Text style={styles.finishedSubtitle}>
              You completed {lines.length} lines
            </Text>
            <TouchableOpacity style={styles.finishedButton} onPress={restartRehearsal}>
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.finishedButtonText}>Run Again</Text>
            </TouchableOpacity>
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
                  <Text style={styles.userActionLabel}>Say your line, then tap:</Text>
                  <TouchableOpacity
                    style={styles.doneButton}
                    onPress={onUserLineDone}
                  >
                    <Ionicons name="checkmark" size={24} color="#fff" />
                    <Text style={styles.doneButtonText}>Done</Text>
                  </TouchableOpacity>
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
              ]}
            >
              {line.is_stage_direction ? (
                <Text style={styles.scriptDirection}>{line.text}</Text>
              ) : (
                <>
                  <Text
                    style={[
                      styles.scriptCharacter,
                      line.character === userCharacter && styles.scriptCharacterUser,
                    ]}
                  >
                    {line.character}
                  </Text>
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
  finishedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 10,
  },
  finishedButtonText: {
    color: '#fff',
    fontSize: 17,
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
    justifyContent: 'space-between',
    marginBottom: 12,
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
});
