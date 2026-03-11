import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getAccents,
  getSampleLines,
  analyzeDialect,
  getDialectHistory,
  AccentProfile,
  SampleLine,
  DialectAnalysisResult,
} from '../services/dialectCoachService';
import useRevenueCat from '../hooks/useRevenueCat';
import { trackUpgradeTriggered } from '../services/analyticsService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.7;

export default function DialectCoachScreen() {
  const { isPremium } = useRevenueCat();
  
  // Navigation state
  const [currentScreen, setCurrentScreen] = useState<'record' | 'feedback' | 'progress'>('record');
  
  // Data state
  const [accents, setAccents] = useState<AccentProfile[]>([]);
  const [selectedAccentIndex, setSelectedAccentIndex] = useState(0);
  const [sampleLines, setSampleLines] = useState<SampleLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<DialectAnalysisResult | null>(null);
  
  // Progress state
  const [historyStats, setHistoryStats] = useState<{
    improvement: number;
    best_score: number;
    average_score: number;
    total: number;
    attempts: any[];
  } | null>(null);
  const [streak, setStreak] = useState(0);
  
  const [loading, setLoading] = useState(true);
  
  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const selectedAccent = accents[selectedAccentIndex];
  const currentLine = sampleLines[currentLineIndex];

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [accentsData, linesData] = await Promise.all([
        getAccents(),
        getSampleLines()
      ]);
      setAccents(accentsData);
      setSampleLines(linesData);
      loadHistory();
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const userId = Device.deviceName || 'unknown-user';
      const history = await getDialectHistory(userId, undefined, 30);
      setHistoryStats({
        improvement: history.improvement,
        best_score: history.best_score,
        average_score: history.average_score,
        total: history.total,
        attempts: history.attempts || [],
      });
      
      // Calculate streak (simplified)
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      let currentStreak = 0;
      if (history.attempts?.length > 0) {
        const lastAttempt = new Date(history.attempts[0]?.created_at).toDateString();
        if (lastAttempt === today || lastAttempt === yesterday) {
          currentStreak = Math.min(history.total, 7); // Cap at 7 for display
        }
      }
      setStreak(currentStreak);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  // Glow animation
  useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, []);

  // Recording pulse animation
  useEffect(() => {
    if (isRecording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      
      // Wave animation
      const wave = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(waveAnim, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ])
      );
      
      pulse.start();
      wave.start();
      
      return () => {
        pulse.stop();
        wave.stop();
      };
    } else {
      pulseAnim.setValue(1);
      waveAnim.setValue(0);
    }
  }, [isRecording]);

  // Score animation
  useEffect(() => {
    if (analysisResult && currentScreen === 'feedback') {
      scoreAnim.setValue(0);
      Animated.timing(scoreAnim, {
        toValue: analysisResult.pronunciation_score,
        duration: 1500,
        useNativeDriver: false,
      }).start();
    }
  }, [analysisResult, currentScreen]);

  const handleAccentChange = (index: number) => {
    if (!isPremium) {
      trackUpgradeTriggered('dialect_coach_accent');
      router.push('/premium');
      return;
    }
    setSelectedAccentIndex(index);
  };

  const startRecording = async () => {
    if (!isPremium) {
      trackUpgradeTriggered('dialect_coach_record');
      router.push('/premium');
      return;
    }

    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Microphone access is needed for this feature.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error('Recording error:', error);
      Alert.alert('Error', 'Failed to start recording.');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      if (uri && currentLine && selectedAccent) {
        await analyzeRecording(uri);
      }
    } catch (error) {
      console.error('Stop recording error:', error);
    }
  };

  const analyzeRecording = async (audioUri: string) => {
    setIsAnalyzing(true);
    setCurrentScreen('feedback');

    try {
      const userId = Device.deviceName || 'unknown-user';
      const result = await analyzeDialect(
        audioUri,
        currentLine.text,
        selectedAccent.id,
        userId
      );
      
      setAnalysisResult(result);
      loadHistory();
    } catch (error) {
      console.error('Analysis error:', error);
      Alert.alert('Analysis Failed', 'Please try again.');
      setCurrentScreen('record');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTryAgain = () => {
    setAnalysisResult(null);
    setCurrentScreen('record');
  };

  const handleNextLine = () => {
    setCurrentLineIndex((prev) => (prev + 1) % sampleLines.length);
    setAnalysisResult(null);
    setCurrentScreen('record');
  };

  const getAccentEmoji = (region: string) => {
    const emojis: Record<string, string> = {
      'United Kingdom': '🇬🇧',
      'United States': '🇺🇸',
      'Australia': '🇦🇺',
      'Ireland': '🇮🇪',
      'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
      'Southern United States': '🤠',
    };
    return emojis[region] || '🌍';
  };

  const getHighlightedText = (text: string, problemWords: any[]) => {
    const words = text.split(' ');
    const problemWordSet = new Set(problemWords.map(pw => pw.word.toLowerCase()));
    
    return words.map((word, index) => {
      const cleanWord = word.replace(/[.,!?'"]/g, '').toLowerCase();
      const isProblem = problemWordSet.has(cleanWord);
      
      return (
        <Text
          key={index}
          style={[
            styles.feedbackWord,
            isProblem ? styles.feedbackWordProblem : styles.feedbackWordGood,
          ]}
        >
          {word}{' '}
        </Text>
      );
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>Loading Dialect Coach...</Text>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCREEN 1: RECORD
  // ═══════════════════════════════════════════════════════════════════
  if (currentScreen === 'record') {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0a0a0f', '#1a1a2e', '#0a0a0f']}
          style={StyleSheet.absoluteFill}
        />
        
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Dialect Coach</Text>
            <TouchableOpacity onPress={() => setCurrentScreen('progress')} style={styles.headerBtn}>
              <Ionicons name="stats-chart" size={22} color="#8b5cf6" />
            </TouchableOpacity>
          </View>

          {/* Accent Selector - Swipeable Cards */}
          <View style={styles.accentSection}>
            <Text style={styles.sectionLabel}>SELECT ACCENT</Text>
            <ScrollView
              ref={scrollViewRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.accentScrollContent}
              snapToInterval={CARD_WIDTH + 16}
              decelerationRate="fast"
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 16));
                handleAccentChange(Math.max(0, Math.min(index, accents.length - 1)));
              }}
            >
              {accents.map((accent, index) => (
                <TouchableOpacity
                  key={accent.id}
                  style={[
                    styles.accentCard,
                    index === selectedAccentIndex && styles.accentCardActive,
                  ]}
                  onPress={() => handleAccentChange(index)}
                  activeOpacity={0.8}
                >
                  <Animated.View
                    style={[
                      styles.accentGlow,
                      index === selectedAccentIndex && {
                        opacity: glowAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.3, 0.7],
                        }),
                      },
                    ]}
                  />
                  <Text style={styles.accentEmoji}>{getAccentEmoji(accent.region)}</Text>
                  <Text style={styles.accentName}>{accent.name}</Text>
                  <Text style={styles.accentRegion}>{accent.region}</Text>
                  {!isPremium && index > 0 && (
                    <View style={styles.lockBadge}>
                      <Ionicons name="lock-closed" size={12} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Line to Speak */}
          <View style={styles.lineSection}>
            <Text style={styles.instructionText}>
              Speak this line in a <Text style={styles.accentHighlight}>{selectedAccent?.name || 'British'}</Text> accent
            </Text>
            <View style={styles.lineCard}>
              <Text style={styles.lineText}>"{currentLine?.text || 'Loading...'}"</Text>
              <Text style={styles.lineSource}>— {currentLine?.source || ''}</Text>
            </View>
            <TouchableOpacity onPress={handleNextLine} style={styles.shuffleBtn}>
              <Ionicons name="shuffle" size={18} color="#8b5cf6" />
              <Text style={styles.shuffleText}>Different line</Text>
            </TouchableOpacity>
          </View>

          {/* Microphone Button */}
          <View style={styles.micSection}>
            {/* Waveform visualization */}
            {isRecording && (
              <View style={styles.waveformContainer}>
                {[...Array(7)].map((_, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: waveAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 40 + Math.random() * 30],
                        }),
                        opacity: waveAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.3, 0.8],
                        }),
                      },
                    ]}
                  />
                ))}
              </View>
            )}

            {isRecording && (
              <Text style={styles.recordingTime}>
                {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
              </Text>
            )}

            <Animated.View style={[styles.micButtonOuter, { transform: [{ scale: pulseAnim }] }]}>
              <TouchableOpacity
                style={[styles.micButton, isRecording && styles.micButtonRecording]}
                onPress={isRecording ? stopRecording : startRecording}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={isRecording ? ['#ef4444', '#dc2626'] : ['#8b5cf6', '#6366f1']}
                  style={styles.micButtonGradient}
                >
                  <Ionicons
                    name={isRecording ? 'stop' : 'mic'}
                    size={48}
                    color="#fff"
                  />
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            <Text style={styles.micHint}>
              {isRecording ? 'Tap to stop recording' : 'Tap to start recording'}
            </Text>
          </View>

          {/* Premium CTA for free users */}
          {!isPremium && (
            <TouchableOpacity style={styles.premiumCta} onPress={() => router.push('/premium')}>
              <LinearGradient
                colors={['rgba(139, 92, 246, 0.2)', 'rgba(99, 102, 241, 0.2)']}
                style={styles.premiumCtaGradient}
              >
                <Ionicons name="star" size={20} color="#f59e0b" />
                <Text style={styles.premiumCtaText}>Unlock Pro for full access</Text>
                <Ionicons name="chevron-forward" size={18} color="#8b5cf6" />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCREEN 2: FEEDBACK
  // ═══════════════════════════════════════════════════════════════════
  if (currentScreen === 'feedback') {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0a0a0f', '#1a1a2e', '#0a0a0f']}
          style={StyleSheet.absoluteFill}
        />
        
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setCurrentScreen('record')} style={styles.headerBtn}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Your Results</Text>
            <View style={styles.headerBtn} />
          </View>

          {isAnalyzing ? (
            <View style={styles.analyzingContainer}>
              <View style={styles.analyzingSpinner}>
                <ActivityIndicator size="large" color="#8b5cf6" />
              </View>
              <Text style={styles.analyzingText}>Analyzing your accent...</Text>
              <Text style={styles.analyzingSubtext}>This takes just a moment</Text>
            </View>
          ) : analysisResult ? (
            <ScrollView style={styles.feedbackScroll} showsVerticalScrollIndicator={false}>
              {/* Score Ring */}
              <View style={styles.scoreSection}>
                <View style={styles.scoreRing}>
                  <Animated.View
                    style={[
                      styles.scoreRingProgress,
                      {
                        borderColor: analysisResult.pronunciation_score >= 70 ? '#10b981' : 
                                     analysisResult.pronunciation_score >= 50 ? '#f59e0b' : '#ef4444',
                      },
                    ]}
                  />
                  <View style={styles.scoreRingInner}>
                    <Animated.Text style={styles.scoreValue}>
                      {scoreAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0', '100'],
                        extrapolate: 'clamp',
                      })}%
                    </Animated.Text>
                    <Text style={styles.scoreLabel}>Accuracy</Text>
                  </View>
                  <View style={[
                    styles.scoreGlow,
                    { backgroundColor: analysisResult.pronunciation_score >= 70 ? '#10b981' : 
                                       analysisResult.pronunciation_score >= 50 ? '#f59e0b' : '#ef4444' },
                  ]} />
                </View>

                {/* Pace Badge */}
                <View style={[
                  styles.paceBadge,
                  analysisResult.pace_assessment === 'good' && styles.paceBadgeGood,
                  analysisResult.pace_assessment === 'too_slow' && styles.paceBadgeSlow,
                  analysisResult.pace_assessment === 'too_fast' && styles.paceBadgeFast,
                ]}>
                  <Ionicons
                    name={analysisResult.pace_assessment === 'good' ? 'checkmark-circle' : 'speedometer'}
                    size={16}
                    color="#fff"
                  />
                  <Text style={styles.paceBadgeText}>
                    {analysisResult.pace_assessment === 'good' ? 'Great rhythm!' :
                     analysisResult.pace_assessment === 'too_slow' ? 'A bit slow' : 'A bit fast'}
                  </Text>
                </View>
              </View>

              {/* Highlighted Text */}
              <View style={styles.feedbackTextCard}>
                <Text style={styles.feedbackTextLabel}>Your line:</Text>
                <Text style={styles.feedbackTextContent}>
                  {getHighlightedText(currentLine?.text || '', analysisResult.problem_words)}
                </Text>
                <View style={styles.feedbackLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                    <Text style={styles.legendText}>Good</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                    <Text style={styles.legendText}>Needs work</Text>
                  </View>
                </View>
              </View>

              {/* Tips */}
              <View style={styles.tipsCard}>
                <Text style={styles.tipsTitle}>Tips for you</Text>
                {analysisResult.tips.slice(0, 3).map((tip, index) => (
                  <View key={index} style={styles.tipRow}>
                    <View style={styles.tipBullet}>
                      <Ionicons name="bulb" size={16} color="#f59e0b" />
                    </View>
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
                {analysisResult.problem_words.slice(0, 2).map((pw, index) => (
                  <View key={`pw-${index}`} style={styles.tipRow}>
                    <View style={styles.tipBullet}>
                      <Ionicons name="mic" size={16} color="#8b5cf6" />
                    </View>
                    <Text style={styles.tipText}>
                      <Text style={styles.tipHighlight}>"{pw.word}"</Text> — {pw.tip}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Action Buttons */}
              <View style={styles.feedbackActions}>
                <TouchableOpacity style={styles.tryAgainBtn} onPress={handleTryAgain}>
                  <LinearGradient
                    colors={['#8b5cf6', '#6366f1']}
                    style={styles.tryAgainGradient}
                  >
                    <Ionicons name="refresh" size={22} color="#fff" />
                    <Text style={styles.tryAgainText}>Try Again</Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={styles.nextLineBtn} onPress={handleNextLine}>
                  <Ionicons name="arrow-forward" size={20} color="#8b5cf6" />
                  <Text style={styles.nextLineText}>Next Line</Text>
                </TouchableOpacity>
              </View>

              <View style={{ height: 40 }} />
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCREEN 3: PROGRESS
  // ═══════════════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0a0a0f', '#1a1a2e', '#0a0a0f']}
        style={StyleSheet.absoluteFill}
      />
      
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setCurrentScreen('record')} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your Progress</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView style={styles.progressScroll} showsVerticalScrollIndicator={false}>
          {/* Streak Card */}
          <View style={styles.streakCard}>
            <LinearGradient
              colors={['rgba(139, 92, 246, 0.15)', 'rgba(99, 102, 241, 0.08)']}
              style={styles.streakGradient}
            >
              <View style={styles.streakIcon}>
                <Ionicons name="flame" size={32} color="#f59e0b" />
              </View>
              <View style={styles.streakInfo}>
                <Text style={styles.streakValue}>{streak}</Text>
                <Text style={styles.streakLabel}>Day Streak</Text>
              </View>
              <View style={styles.streakDays}>
                {[...Array(7)].map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.streakDot,
                      i < streak && styles.streakDotActive,
                    ]}
                  />
                ))}
              </View>
            </LinearGradient>
          </View>

          {/* Stats Grid */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{historyStats?.best_score || 0}%</Text>
              <Text style={styles.statLabel}>Best Score</Text>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="trophy" size={18} color="#10b981" />
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{historyStats?.average_score || 0}%</Text>
              <Text style={styles.statLabel}>Average</Text>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
                <Ionicons name="analytics" size={18} color="#6366f1" />
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={[
                styles.statValue,
                { color: (historyStats?.improvement || 0) >= 0 ? '#10b981' : '#ef4444' }
              ]}>
                {(historyStats?.improvement || 0) >= 0 ? '+' : ''}{historyStats?.improvement || 0}%
              </Text>
              <Text style={styles.statLabel}>Improvement</Text>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <Ionicons name="trending-up" size={18} color="#f59e0b" />
              </View>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{historyStats?.total || 0}</Text>
              <Text style={styles.statLabel}>Total Sessions</Text>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Ionicons name="mic" size={18} color="#8b5cf6" />
              </View>
            </View>
          </View>

          {/* Accent Progress */}
          <View style={styles.accentProgressSection}>
            <Text style={styles.sectionTitle}>Accent Progress</Text>
            {accents.slice(0, 4).map((accent) => {
              const accentAttempts = historyStats?.attempts?.filter(a => a.accent_id === accent.id) || [];
              const bestScore = accentAttempts.length > 0 
                ? Math.max(...accentAttempts.map(a => a.pronunciation_score))
                : 0;
              
              return (
                <View key={accent.id} style={styles.accentProgressRow}>
                  <Text style={styles.accentProgressEmoji}>{getAccentEmoji(accent.region)}</Text>
                  <View style={styles.accentProgressInfo}>
                    <Text style={styles.accentProgressName}>{accent.name}</Text>
                    <View style={styles.accentProgressBar}>
                      <View 
                        style={[
                          styles.accentProgressFill,
                          { width: `${bestScore}%` }
                        ]} 
                      />
                    </View>
                  </View>
                  <Text style={styles.accentProgressScore}>{bestScore}%</Text>
                </View>
              );
            })}
          </View>

          {/* Motivational Message */}
          <View style={styles.motivationCard}>
            <Ionicons name="sparkles" size={24} color="#f59e0b" />
            <Text style={styles.motivationText}>
              {historyStats?.total === 0 
                ? "Start practicing to track your progress!"
                : historyStats?.improvement && historyStats.improvement > 0
                  ? "You're improving! Keep up the great work!"
                  : "Every practice session makes you better!"}
            </Text>
          </View>

          {/* Start Practice Button */}
          <TouchableOpacity style={styles.startPracticeBtn} onPress={() => setCurrentScreen('record')}>
            <LinearGradient
              colors={['#8b5cf6', '#6366f1']}
              style={styles.startPracticeGradient}
            >
              <Ionicons name="mic" size={24} color="#fff" />
              <Text style={styles.startPracticeText}>Start Practice</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  safeArea: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0f' },
  loadingText: { color: '#9ca3af', marginTop: 16, fontSize: 16 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },

  // Section Label
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#6b7280', letterSpacing: 1.5, marginBottom: 12, paddingHorizontal: 20 },

  // Accent Selector
  accentSection: { marginTop: 8 },
  accentScrollContent: { paddingHorizontal: 20, gap: 16 },
  accentCard: {
    width: CARD_WIDTH,
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    overflow: 'hidden',
  },
  accentCardActive: { borderColor: '#8b5cf6' },
  accentGlow: {
    position: 'absolute',
    top: -50,
    left: '50%',
    marginLeft: -75,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#8b5cf6',
    opacity: 0,
  },
  accentEmoji: { fontSize: 48, marginBottom: 12 },
  accentName: { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  accentRegion: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  lockBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 6,
  },

  // Line Section
  lineSection: { paddingHorizontal: 20, marginTop: 32 },
  instructionText: { fontSize: 16, color: '#9ca3af', textAlign: 'center', marginBottom: 16 },
  accentHighlight: { color: '#8b5cf6', fontWeight: '600' },
  lineCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  lineText: { fontSize: 20, color: '#fff', fontStyle: 'italic', textAlign: 'center', lineHeight: 30 },
  lineSource: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 12 },
  shuffleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  shuffleText: { fontSize: 14, color: '#8b5cf6' },

  // Mic Section
  micSection: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  waveformContainer: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 60, marginBottom: 16 },
  waveBar: { width: 6, backgroundColor: '#8b5cf6', borderRadius: 3 },
  recordingTime: { fontSize: 28, fontWeight: '700', color: '#ef4444', marginBottom: 20 },
  micButtonOuter: {},
  micButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  micButtonRecording: { shadowColor: '#ef4444' },
  micButtonGradient: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  micHint: { fontSize: 14, color: '#6b7280', marginTop: 20 },

  // Premium CTA
  premiumCta: { marginHorizontal: 20, marginBottom: 20 },
  premiumCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  premiumCtaText: { fontSize: 15, fontWeight: '600', color: '#8b5cf6' },

  // Feedback Screen
  analyzingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  analyzingSpinner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  analyzingText: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 24 },
  analyzingSubtext: { fontSize: 14, color: '#6b7280', marginTop: 8 },

  feedbackScroll: { flex: 1, paddingHorizontal: 20 },

  // Score Ring
  scoreSection: { alignItems: 'center', marginTop: 20, marginBottom: 32 },
  scoreRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 8,
    borderColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  scoreRingProgress: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 8,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
    transform: [{ rotate: '-45deg' }],
  },
  scoreRingInner: { alignItems: 'center' },
  scoreValue: { fontSize: 48, fontWeight: '700', color: '#fff' },
  scoreLabel: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  scoreGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.15,
    zIndex: -1,
  },

  paceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 16,
  },
  paceBadgeGood: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  paceBadgeSlow: { backgroundColor: 'rgba(245, 158, 11, 0.2)' },
  paceBadgeFast: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  paceBadgeText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  // Feedback Text
  feedbackTextCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, marginBottom: 20 },
  feedbackTextLabel: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  feedbackTextContent: { flexDirection: 'row', flexWrap: 'wrap' },
  feedbackWord: { fontSize: 18, lineHeight: 28 },
  feedbackWordGood: { color: '#10b981' },
  feedbackWordProblem: { color: '#f59e0b', textDecorationLine: 'underline' },
  feedbackLegend: { flexDirection: 'row', gap: 16, marginTop: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: '#6b7280' },

  // Tips
  tipsCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, marginBottom: 24 },
  tipsTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 16 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  tipBullet: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(245, 158, 11, 0.15)', justifyContent: 'center', alignItems: 'center' },
  tipText: { flex: 1, fontSize: 14, color: '#e5e7eb', lineHeight: 20 },
  tipHighlight: { color: '#8b5cf6', fontWeight: '600' },

  // Feedback Actions
  feedbackActions: { flexDirection: 'row', gap: 12 },
  tryAgainBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  tryAgainGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  tryAgainText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  nextLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 18,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 14,
  },
  nextLineText: { fontSize: 15, fontWeight: '600', color: '#8b5cf6' },

  // Progress Screen
  progressScroll: { flex: 1, paddingHorizontal: 20 },

  // Streak Card
  streakCard: { marginTop: 16, marginBottom: 24, borderRadius: 20, overflow: 'hidden' },
  streakGradient: { flexDirection: 'row', alignItems: 'center', padding: 20 },
  streakIcon: { marginRight: 16 },
  streakInfo: { flex: 1 },
  streakValue: { fontSize: 36, fontWeight: '700', color: '#fff' },
  streakLabel: { fontSize: 14, color: '#9ca3af' },
  streakDays: { flexDirection: 'row', gap: 6 },
  streakDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2a2a3e' },
  streakDotActive: { backgroundColor: '#f59e0b' },

  // Stats Grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  statCard: {
    width: '47%',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  statValue: { fontSize: 28, fontWeight: '700', color: '#fff' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  statIcon: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  // Accent Progress
  accentProgressSection: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 16 },
  accentProgressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  accentProgressEmoji: { fontSize: 24, marginRight: 12 },
  accentProgressInfo: { flex: 1 },
  accentProgressName: { fontSize: 14, fontWeight: '500', color: '#fff', marginBottom: 6 },
  accentProgressBar: { height: 6, backgroundColor: '#2a2a3e', borderRadius: 3, overflow: 'hidden' },
  accentProgressFill: { height: '100%', backgroundColor: '#8b5cf6', borderRadius: 3 },
  accentProgressScore: { fontSize: 14, fontWeight: '600', color: '#8b5cf6', marginLeft: 12 },

  // Motivation
  motivationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  motivationText: { flex: 1, fontSize: 14, color: '#f59e0b', lineHeight: 20 },

  // Start Practice Button
  startPracticeBtn: { borderRadius: 14, overflow: 'hidden' },
  startPracticeGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18 },
  startPracticeText: { fontSize: 17, fontWeight: '600', color: '#fff' },
});
