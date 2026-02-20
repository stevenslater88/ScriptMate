import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Slider from '@react-native-community/slider';
import { useScriptStore } from '../store/scriptStore';
import useRevenueCat from '../hooks/useRevenueCat';
import {
  saveSessionResult,
  calculateXP,
  getMasteryLevel,
  getSceneProgress,
  MASTERY_LEVELS,
  SceneProgress,
} from '../services/progressService';

const FREE_DIFFICULTY_LIMIT = 50;

interface WordState {
  word: string;
  hidden: boolean;
  revealed: boolean;
}

export default function RecallScreen() {
  const { scriptId, sceneIndex } = useLocalSearchParams<{ scriptId: string; sceneIndex: string }>();
  const { scripts } = useScriptStore();
  const { isPremium, presentPaywall } = useRevenueCat();
  
  const script = scripts.find(s => s.id === scriptId);
  const scenes = script?.scenes || [{ name: 'Full Script', lines: script?.lines || [] }];
  const currentScene = scenes[parseInt(sceneIndex || '0')];
  const sceneId = `${scriptId}_${sceneIndex || '0'}`;
  
  // Settings
  const [difficulty, setDifficulty] = useState(30); // 10-100%
  const [speed, setSpeed] = useState(1.0); // 0.5-2.0
  const [hidePartnerLines, setHidePartnerLines] = useState(false);
  const [timerMode, setTimerMode] = useState(false);
  const [targetTime, setTargetTime] = useState(60); // seconds
  
  // Game state
  const [gameStarted, setGameStarted] = useState(false);
  const [gameComplete, setGameComplete] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [wordStates, setWordStates] = useState<WordState[][]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalHidden, setTotalHidden] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [sceneProgress, setSceneProgress] = useState<SceneProgress | null>(null);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Load existing progress
  useEffect(() => {
    loadProgress();
  }, [sceneId]);

  const loadProgress = async () => {
    const progress = await getSceneProgress(sceneId);
    setSceneProgress(progress);
  };

  // Initialize word states based on difficulty
  const initializeGame = useCallback(() => {
    const lines = currentScene?.lines || [];
    const newWordStates: WordState[][] = [];
    let hiddenCount = 0;
    
    lines.forEach((line: any) => {
      const words = line.text.split(/\s+/);
      const lineStates: WordState[] = words.map((word: string) => {
        // Randomly hide words based on difficulty
        const shouldHide = Math.random() * 100 < difficulty;
        if (shouldHide) hiddenCount++;
        return {
          word,
          hidden: shouldHide,
          revealed: false,
        };
      });
      newWordStates.push(lineStates);
    });
    
    setWordStates(newWordStates);
    setTotalHidden(hiddenCount);
    setCorrectCount(0);
    setCurrentLineIndex(0);
    setElapsedTime(0);
    setGameComplete(false);
  }, [currentScene, difficulty]);

  const startGame = () => {
    // Check premium for advanced difficulty - Natural, value-driven prompt
    if (!isPremium && difficulty > FREE_DIFFICULTY_LIMIT) {
      Alert.alert(
        'Unlock Advanced Recall',
        "You've reached the basic practice level.\n\nUnlock full difficulty control, timed challenges, and mastery tracking to train like a professional.",
        [
          { text: 'Use 50%', onPress: () => { setDifficulty(50); }, style: 'cancel' },
          { text: 'Unlock Advanced Practice', onPress: () => router.push('/premium') },
        ]
      );
      return;
    }
    
    // Check premium for timer mode - Natural, value-driven prompt
    if (!isPremium && timerMode) {
      Alert.alert(
        'Unlock Advanced Recall',
        'Timed challenges help you build confidence under pressure—just like a real audition.\n\nUpgrade to unlock timer mode and track your progress.',
        [
          { text: 'Disable Timer', onPress: () => { setTimerMode(false); }, style: 'cancel' },
          { text: 'Unlock Advanced Practice', onPress: () => router.push('/premium') },
        ]
      );
      return;
    }
    
    initializeGame();
    setGameStarted(true);
    startTimeRef.current = Date.now();
    
    // Start timer
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
      
      // Check timer mode
      if (timerMode && elapsed >= targetTime) {
        endGame(false);
      }
    }, 1000);
  };

  const revealWord = (lineIndex: number, wordIndex: number) => {
    setWordStates(prev => {
      const newStates = [...prev];
      if (newStates[lineIndex][wordIndex].hidden && !newStates[lineIndex][wordIndex].revealed) {
        newStates[lineIndex][wordIndex].revealed = true;
        setCorrectCount(c => c + 1);
        
        // Flash animation
        Animated.sequence([
          Animated.timing(fadeAnim, { toValue: 0.5, duration: 100, useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
        ]).start();
      }
      return newStates;
    });
  };

  const endGame = async (completed: boolean = true) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    const finalTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const accuracy = totalHidden > 0 ? Math.round((correctCount / totalHidden) * 100) : 100;
    const beatTimer = timerMode && finalTime <= targetTime;
    const xpEarned = calculateXP(accuracy, difficulty, beatTimer);
    
    // Save result
    const result = await saveSessionResult({
      sceneId,
      scriptId: scriptId || '',
      sceneName: currentScene?.name || 'Scene',
      accuracy,
      timeSpent: finalTime,
      difficulty,
      wordsHidden: totalHidden,
      totalWords: wordStates.flat().length,
      xpEarned,
      timestamp: new Date().toISOString(),
    });
    
    setSceneProgress(result);
    setGameComplete(true);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const lines = currentScene?.lines || [];
  const accuracy = totalHidden > 0 ? Math.round((correctCount / totalHidden) * 100) : 0;
  const levelInfo = sceneProgress ? MASTERY_LEVELS[sceneProgress.masteryLevel] : MASTERY_LEVELS.ROOKIE;

  // Settings screen
  if (!gameStarted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Adaptive Recall</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={styles.content}>
          {/* Scene Info */}
          <View style={styles.sceneCard}>
            <Text style={styles.sceneTitle}>{currentScene?.name || script?.title}</Text>
            <Text style={styles.sceneSubtitle}>{lines.length} lines to practice</Text>
            {sceneProgress && (
              <View style={styles.progressBadge}>
                <Ionicons name={levelInfo.icon as any} size={16} color={levelInfo.color} />
                <Text style={[styles.progressText, { color: levelInfo.color }]}>
                  {levelInfo.name} • {sceneProgress.xp} XP
                </Text>
              </View>
            )}
          </View>

          {/* Difficulty Slider */}
          <View style={styles.settingSection}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingTitle}>Difficulty</Text>
              <Text style={styles.settingValue}>{difficulty}%</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={10}
              maximumValue={100}
              step={5}
              value={difficulty}
              onValueChange={setDifficulty}
              minimumTrackTintColor="#6366f1"
              maximumTrackTintColor="#374151"
              thumbTintColor="#6366f1"
            />
            <Text style={styles.settingHint}>
              {difficulty <= 30 ? 'Easy - Few words hidden' : difficulty <= 60 ? 'Medium - Half words hidden' : 'Hard - Most words hidden'}
            </Text>
            {!isPremium && difficulty > FREE_DIFFICULTY_LIMIT && (
              <View style={styles.premiumHint}>
                <Ionicons name="lock-closed" size={14} color="#f59e0b" />
                <Text style={styles.premiumHintText}>Premium required for {difficulty}%</Text>
              </View>
            )}
          </View>

          {/* Speed Slider */}
          <View style={styles.settingSection}>
            <View style={styles.settingHeader}>
              <Text style={styles.settingTitle}>Speed</Text>
              <Text style={styles.settingValue}>{speed.toFixed(1)}x</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.5}
              maximumValue={2.0}
              step={0.1}
              value={speed}
              onValueChange={setSpeed}
              minimumTrackTintColor="#10b981"
              maximumTrackTintColor="#374151"
              thumbTintColor="#10b981"
            />
          </View>

          {/* Toggle Options */}
          <View style={styles.toggleSection}>
            <TouchableOpacity
              style={[styles.toggleOption, hidePartnerLines && styles.toggleOptionActive]}
              onPress={() => setHidePartnerLines(!hidePartnerLines)}
            >
              <Ionicons name="eye-off" size={20} color={hidePartnerLines ? '#6366f1' : '#6b7280'} />
              <Text style={[styles.toggleText, hidePartnerLines && styles.toggleTextActive]}>
                Hide Partner Lines
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toggleOption, timerMode && styles.toggleOptionActive]}
              onPress={() => setTimerMode(!timerMode)}
            >
              <Ionicons name="timer" size={20} color={timerMode ? '#f59e0b' : '#6b7280'} />
              <Text style={[styles.toggleText, timerMode && styles.toggleTextActive]}>
                Timer Challenge
              </Text>
              {!isPremium && <Ionicons name="lock-closed" size={12} color="#f59e0b" style={{ marginLeft: 4 }} />}
            </TouchableOpacity>
          </View>

          {timerMode && (
            <View style={styles.settingSection}>
              <View style={styles.settingHeader}>
                <Text style={styles.settingTitle}>Target Time</Text>
                <Text style={styles.settingValue}>{formatTime(targetTime)}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={30}
                maximumValue={300}
                step={15}
                value={targetTime}
                onValueChange={setTargetTime}
                minimumTrackTintColor="#f59e0b"
                maximumTrackTintColor="#374151"
                thumbTintColor="#f59e0b"
              />
            </View>
          )}

          {/* Start Button */}
          <TouchableOpacity style={styles.startButton} onPress={startGame}>
            <Ionicons name="play" size={24} color="#fff" />
            <Text style={styles.startButtonText}>Start Practice</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Results screen
  if (gameComplete) {
    const beatTimer = timerMode && elapsedTime <= targetTime;
    const xpEarned = calculateXP(accuracy, difficulty, beatTimer);
    
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.resultsContainer}>
          <View style={styles.resultsCard}>
            <View style={[styles.resultIcon, { backgroundColor: `${levelInfo.color}20` }]}>
              <Ionicons name={levelInfo.icon as any} size={48} color={levelInfo.color} />
            </View>
            
            <Text style={styles.resultsTitle}>Session Complete!</Text>
            <Text style={[styles.levelText, { color: levelInfo.color }]}>{levelInfo.name}</Text>
            
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{accuracy}%</Text>
                <Text style={styles.statLabel}>Accuracy</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatTime(elapsedTime)}</Text>
                <Text style={styles.statLabel}>Time</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{difficulty}%</Text>
                <Text style={styles.statLabel}>Difficulty</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#f59e0b' }]}>+{xpEarned}</Text>
                <Text style={styles.statLabel}>XP Earned</Text>
              </View>
            </View>

            {timerMode && (
              <View style={[styles.timerBadge, beatTimer ? styles.timerSuccess : styles.timerFailed]}>
                <Ionicons name={beatTimer ? 'checkmark-circle' : 'close-circle'} size={20} color={beatTimer ? '#10b981' : '#ef4444'} />
                <Text style={[styles.timerBadgeText, { color: beatTimer ? '#10b981' : '#ef4444' }]}>
                  {beatTimer ? 'Beat the Scene!' : `Missed by ${formatTime(elapsedTime - targetTime)}`}
                </Text>
              </View>
            )}

            {sceneProgress && (
              <View style={styles.progressSection}>
                <Text style={styles.progressTitle}>Scene Progress</Text>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, (sceneProgress.xp / MASTERY_LEVELS.MASTER.minXP) * 100)}%`, backgroundColor: levelInfo.color }]} />
                </View>
                <Text style={styles.progressXP}>{sceneProgress.xp} / {MASTERY_LEVELS.MASTER.minXP} XP to Master</Text>
              </View>
            )}

            <View style={styles.resultsActions}>
              <TouchableOpacity style={styles.retryButton} onPress={() => { setGameStarted(false); setGameComplete(false); }}>
                <Ionicons name="refresh" size={20} color="#6366f1" />
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.doneButton} onPress={() => router.back()}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Game screen
  return (
    <SafeAreaView style={styles.container}>
      {/* Game Header */}
      <View style={styles.gameHeader}>
        <TouchableOpacity onPress={() => { if (timerRef.current) clearInterval(timerRef.current); router.back(); }}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        
        <View style={styles.gameStats}>
          <View style={styles.gameStat}>
            <Ionicons name="checkmark-circle" size={16} color="#10b981" />
            <Text style={styles.gameStatText}>{correctCount}/{totalHidden}</Text>
          </View>
          <View style={[styles.gameStat, timerMode && elapsedTime > targetTime * 0.8 && styles.gameStatWarning]}>
            <Ionicons name="time" size={16} color={timerMode && elapsedTime > targetTime * 0.8 ? '#ef4444' : '#6b7280'} />
            <Text style={[styles.gameStatText, timerMode && elapsedTime > targetTime * 0.8 && { color: '#ef4444' }]}>
              {formatTime(elapsedTime)}{timerMode && ` / ${formatTime(targetTime)}`}
            </Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => endGame(true)}>
          <Text style={styles.finishText}>Finish</Text>
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      <View style={styles.gameProgressBar}>
        <View style={[styles.gameProgressFill, { width: `${(correctCount / Math.max(1, totalHidden)) * 100}%` }]} />
      </View>

      {/* Lines */}
      <ScrollView style={styles.linesContainer}>
        {lines.map((line: any, lineIndex: number) => {
          const lineWords = wordStates[lineIndex] || [];
          const isPartnerLine = hidePartnerLines && line.character !== 'YOU'; // Simplified check
          
          return (
            <View key={lineIndex} style={styles.lineCard}>
              <Text style={styles.characterName}>{line.character}</Text>
              {isPartnerLine ? (
                <Text style={styles.hiddenPartnerLine}>• • •</Text>
              ) : (
                <Animated.View style={[styles.wordsContainer, { opacity: fadeAnim }]}>
                  {lineWords.map((wordState, wordIndex) => (
                    <TouchableOpacity
                      key={wordIndex}
                      onPress={() => wordState.hidden && !wordState.revealed && revealWord(lineIndex, wordIndex)}
                      disabled={!wordState.hidden || wordState.revealed}
                    >
                      {wordState.hidden && !wordState.revealed ? (
                        <View style={styles.hiddenWord}>
                          <Text style={styles.hiddenWordText}>{'_'.repeat(Math.min(wordState.word.length, 8))}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.wordText, wordState.revealed && styles.revealedWord]}>
                          {wordState.word}{' '}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </Animated.View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  content: { flex: 1, padding: 20 },
  
  sceneCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16, marginBottom: 24 },
  sceneTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  sceneSubtitle: { fontSize: 14, color: '#9ca3af', marginTop: 4 },
  progressBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: 'rgba(99, 102, 241, 0.1)', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  progressText: { fontSize: 12, fontWeight: '600' },
  
  settingSection: { marginBottom: 24 },
  settingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  settingTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  settingValue: { fontSize: 16, fontWeight: '700', color: '#6366f1' },
  slider: { height: 40 },
  settingHint: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  premiumHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  premiumHintText: { fontSize: 12, color: '#f59e0b' },
  
  toggleSection: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  toggleOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2a2a3e' },
  toggleOptionActive: { borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.1)' },
  toggleText: { fontSize: 13, color: '#6b7280' },
  toggleTextActive: { color: '#fff' },
  
  startButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#6366f1', borderRadius: 14, padding: 18, marginTop: 20 },
  startButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  
  // Game styles
  gameHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  gameStats: { flexDirection: 'row', gap: 16 },
  gameStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gameStatText: { fontSize: 14, color: '#9ca3af' },
  gameStatWarning: { backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  finishText: { fontSize: 16, fontWeight: '600', color: '#6366f1' },
  
  gameProgressBar: { height: 3, backgroundColor: '#1a1a2e' },
  gameProgressFill: { height: '100%', backgroundColor: '#10b981' },
  
  linesContainer: { flex: 1, padding: 16 },
  lineCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 12 },
  characterName: { fontSize: 12, fontWeight: '700', color: '#6366f1', marginBottom: 8, textTransform: 'uppercase' },
  wordsContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  wordText: { fontSize: 16, color: '#fff', lineHeight: 28 },
  revealedWord: { color: '#10b981', fontWeight: '600' },
  hiddenWord: { backgroundColor: '#374151', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, marginRight: 4, marginBottom: 4 },
  hiddenWordText: { fontSize: 16, color: '#6b7280', letterSpacing: 2 },
  hiddenPartnerLine: { fontSize: 16, color: '#4b5563' },
  
  // Results styles
  resultsContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  resultsCard: { backgroundColor: '#1a1a2e', borderRadius: 20, padding: 24, alignItems: 'center' },
  resultIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  resultsTitle: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8 },
  levelText: { fontSize: 16, fontWeight: '600', marginBottom: 24 },
  
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  statItem: { width: '46%', backgroundColor: '#0a0a0f', borderRadius: 12, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '700', color: '#fff' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, marginBottom: 20 },
  timerSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  timerFailed: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  timerBadgeText: { fontSize: 14, fontWeight: '600' },
  
  progressSection: { width: '100%', marginBottom: 24 },
  progressTitle: { fontSize: 14, fontWeight: '600', color: '#9ca3af', marginBottom: 10 },
  progressBar: { height: 8, backgroundColor: '#0a0a0f', borderRadius: 4 },
  progressFill: { height: '100%', borderRadius: 4 },
  progressXP: { fontSize: 12, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  
  resultsActions: { flexDirection: 'row', gap: 12, width: '100%' },
  retryButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0a0a0f', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#6366f1' },
  retryButtonText: { fontSize: 16, fontWeight: '600', color: '#6366f1' },
  doneButton: { flex: 1, backgroundColor: '#6366f1', borderRadius: 12, padding: 14, alignItems: 'center' },
  doneButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
