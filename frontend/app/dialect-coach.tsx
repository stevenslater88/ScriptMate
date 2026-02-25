import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
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

export default function DialectCoachScreen() {
  const { isPremium, presentPaywall } = useRevenueCat();
  
  // State
  const [accents, setAccents] = useState<AccentProfile[]>([]);
  const [selectedAccent, setSelectedAccent] = useState<AccentProfile | null>(null);
  const [sampleLines, setSampleLines] = useState<SampleLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<SampleLine | null>(null);
  const [customLine, setCustomLine] = useState('');
  
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<DialectAnalysisResult | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  
  const [historyStats, setHistoryStats] = useState<{
    improvement: number;
    best_score: number;
    average_score: number;
    total: number;
  } | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'accent' | 'line' | 'record' | 'result'>('accent');
  
  // Animation
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [accentsData, linesData] = await Promise.all([
          getAccents(),
          getSampleLines()
        ]);
        setAccents(accentsData);
        setSampleLines(linesData);
      } catch (error) {
        console.error('Error loading data:', error);
        Alert.alert('Error', 'Failed to load data. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);
  
  // Recording animation
  useEffect(() => {
    if (isRecording) {
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
  }, [isRecording]);
  
  // Load history when accent is selected
  useEffect(() => {
    if (selectedAccent) {
      loadHistory();
    }
  }, [selectedAccent]);
  
  const loadHistory = async () => {
    if (!selectedAccent) return;
    try {
      const userId = Device.deviceName || 'unknown-user';
      const history = await getDialectHistory(userId, selectedAccent.id, 10);
      setHistoryStats({
        improvement: history.improvement,
        best_score: history.best_score,
        average_score: history.average_score,
        total: history.total,
      });
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };
  
  const handleSelectAccent = (accent: AccentProfile) => {
    if (!isPremium) {
      trackUpgradeTriggered('dialect_coach_accent');
      presentPaywall();
      return;
    }
    setSelectedAccent(accent);
    setStep('line');
  };
  
  const handleSelectLine = (line: SampleLine) => {
    setSelectedLine(line);
    setStep('record');
  };
  
  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Denied', 'Microphone access is required for this feature.');
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
      
      // Start duration timer
      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
      
    } catch (error) {
      console.error('Error starting recording:', error);
      Alert.alert('Error', 'Failed to start recording.');
    }
  };
  
  const stopRecording = async () => {
    if (!recording) return;
    
    try {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      
      if (uri && selectedLine && selectedAccent) {
        await analyzeRecording(uri);
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      Alert.alert('Error', 'Failed to stop recording.');
    }
  };
  
  const analyzeRecording = async (audioUri: string) => {
    if (!selectedAccent || !selectedLine) return;
    
    setIsAnalyzing(true);
    setStep('result');
    
    try {
      const userId = Device.deviceName || 'unknown-user';
      const result = await analyzeDialect(
        audioUri,
        selectedLine.text,
        selectedAccent.id,
        userId
      );
      
      setAnalysisResult(result);
      loadHistory(); // Refresh stats
    } catch (error) {
      console.error('Analysis error:', error);
      Alert.alert('Analysis Failed', 'Could not analyze your recording. Please try again.');
      setStep('record');
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  const handleRetry = () => {
    setAnalysisResult(null);
    setStep('record');
  };
  
  const handleNewLine = () => {
    setAnalysisResult(null);
    setSelectedLine(null);
    setStep('line');
  };
  
  const handleChangeAccent = () => {
    setAnalysisResult(null);
    setSelectedLine(null);
    setSelectedAccent(null);
    setHistoryStats(null);
    setStep('accent');
  };
  
  const formatDuration = (seconds: number) => {
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
  };
  
  const getScoreColor = (score: number) => {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  };
  
  const getPaceIcon = (pace: string) => {
    switch (pace) {
      case 'too_slow': return 'speedometer-outline';
      case 'too_fast': return 'flash';
      default: return 'checkmark-circle';
    }
  };
  
  const getPaceText = (pace: string) => {
    switch (pace) {
      case 'too_slow': return 'Too Slow';
      case 'too_fast': return 'Too Fast';
      default: return 'Good Pace';
    }
  };
  
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading Dialect Coach...</Text>
        </View>
      </SafeAreaView>
    );
  }
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Dialect Coach</Text>
        <View style={styles.headerRight}>
          {!isPremium && <Ionicons name="lock-closed" size={18} color="#f59e0b" />}
        </View>
      </View>
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Step 1: Select Accent */}
        {step === 'accent' && (
          <View style={styles.stepContainer}>
            <Text style={styles.stepTitle}>Choose Your Target Accent</Text>
            <Text style={styles.stepSubtitle}>Select the accent you want to practice</Text>
            
            <View style={styles.accentGrid}>
              {accents.map((accent) => (
                <TouchableOpacity
                  key={accent.id}
                  style={styles.accentCard}
                  onPress={() => handleSelectAccent(accent)}
                >
                  <View style={styles.accentIcon}>
                    <Text style={styles.accentEmoji}>
                      {accent.region === 'United Kingdom' ? '🇬🇧' :
                       accent.region === 'United States' ? '🇺🇸' :
                       accent.region === 'Australia' ? '🇦🇺' :
                       accent.region === 'Ireland' ? '🇮🇪' :
                       accent.region === 'Scotland' ? '🏴󠁧󠁢󠁳󠁣󠁴󠁿' :
                       accent.region === 'Southern United States' ? '🤠' : '🌍'}
                    </Text>
                  </View>
                  <Text style={styles.accentName}>{accent.name}</Text>
                  <Text style={styles.accentRegion}>{accent.region}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        
        {/* Step 2: Select Line */}
        {step === 'line' && selectedAccent && (
          <View style={styles.stepContainer}>
            <View style={styles.selectedAccentBadge}>
              <Text style={styles.selectedAccentText}>{selectedAccent.name}</Text>
              <TouchableOpacity onPress={handleChangeAccent}>
                <Text style={styles.changeText}>Change</Text>
              </TouchableOpacity>
            </View>
            
            {historyStats && historyStats.total > 0 && (
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{historyStats.best_score}%</Text>
                  <Text style={styles.statLabel}>Best</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{historyStats.average_score}%</Text>
                  <Text style={styles.statLabel}>Average</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: historyStats.improvement >= 0 ? '#10b981' : '#ef4444' }]}>
                    {historyStats.improvement >= 0 ? '+' : ''}{historyStats.improvement}%
                  </Text>
                  <Text style={styles.statLabel}>Improvement</Text>
                </View>
              </View>
            )}
            
            <Text style={styles.stepTitle}>Select a Line to Practice</Text>
            <Text style={styles.stepSubtitle}>Choose from famous movie/theatre lines</Text>
            
            <View style={styles.linesContainer}>
              {sampleLines.map((line, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.lineCard}
                  onPress={() => handleSelectLine(line)}
                >
                  <Text style={styles.lineText}>"{line.text}"</Text>
                  <View style={styles.lineFooter}>
                    <Text style={styles.lineSource}>{line.source}</Text>
                    <View style={[styles.difficultyBadge, 
                      line.difficulty === 'easy' && styles.difficultyEasy,
                      line.difficulty === 'medium' && styles.difficultyMedium,
                      line.difficulty === 'hard' && styles.difficultyHard,
                    ]}>
                      <Text style={styles.difficultyText}>{line.difficulty}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        
        {/* Step 3: Record */}
        {step === 'record' && selectedAccent && selectedLine && (
          <View style={styles.stepContainer}>
            <View style={styles.selectedAccentBadge}>
              <Text style={styles.selectedAccentText}>{selectedAccent.name}</Text>
            </View>
            
            <View style={styles.lineToRead}>
              <Text style={styles.lineToReadLabel}>Read this line:</Text>
              <Text style={styles.lineToReadText}>"{selectedLine.text}"</Text>
              <Text style={styles.lineToReadSource}>— {selectedLine.source}</Text>
            </View>
            
            <View style={styles.recordingArea}>
              {isRecording && (
                <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
              )}
              
              <Animated.View style={[styles.recordButtonWrapper, { transform: [{ scale: pulseAnim }] }]}>
                <TouchableOpacity
                  style={[styles.recordButton, isRecording && styles.recordButtonActive]}
                  onPress={isRecording ? stopRecording : startRecording}
                >
                  <Ionicons 
                    name={isRecording ? 'stop' : 'mic'} 
                    size={40} 
                    color="#fff" 
                  />
                </TouchableOpacity>
              </Animated.View>
              
              <Text style={styles.recordHint}>
                {isRecording ? 'Tap to stop' : 'Tap to record'}
              </Text>
            </View>
            
            <TouchableOpacity style={styles.changeLineButton} onPress={handleNewLine}>
              <Ionicons name="refresh" size={18} color="#6366f1" />
              <Text style={styles.changeLineText}>Try a different line</Text>
            </TouchableOpacity>
          </View>
        )}
        
        {/* Step 4: Results */}
        {step === 'result' && (
          <View style={styles.stepContainer}>
            {isAnalyzing ? (
              <View style={styles.analyzingContainer}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.analyzingText}>Analyzing your pronunciation...</Text>
                <Text style={styles.analyzingSubtext}>This may take a few seconds</Text>
              </View>
            ) : analysisResult ? (
              <>
                {/* Score */}
                <View style={styles.scoreContainer}>
                  <Text style={[styles.scoreValue, { color: getScoreColor(analysisResult.pronunciation_score) }]}>
                    {analysisResult.pronunciation_score}%
                  </Text>
                  <Text style={styles.scoreLabel}>Pronunciation Score</Text>
                </View>
                
                {/* Pace */}
                <View style={styles.paceContainer}>
                  <Ionicons 
                    name={getPaceIcon(analysisResult.pace_assessment)} 
                    size={24} 
                    color={analysisResult.pace_assessment === 'good' ? '#10b981' : '#f59e0b'} 
                  />
                  <Text style={styles.paceText}>{getPaceText(analysisResult.pace_assessment)}</Text>
                  <Text style={styles.paceWpm}>{analysisResult.pace_wpm} WPM</Text>
                </View>
                
                {/* Overall Feedback */}
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackText}>{analysisResult.overall_feedback}</Text>
                </View>
                
                {/* Problem Words */}
                {analysisResult.problem_words.length > 0 && (
                  <View style={styles.problemWordsSection}>
                    <Text style={styles.sectionTitle}>Words to Practice</Text>
                    {analysisResult.problem_words.map((pw, index) => (
                      <View key={index} style={styles.problemWordCard}>
                        <View style={styles.problemWordHeader}>
                          <Text style={styles.problemWord}>{pw.word}</Text>
                          <View style={[styles.severityBadge,
                            pw.severity === 'minor' && styles.severityMinor,
                            pw.severity === 'moderate' && styles.severityModerate,
                            pw.severity === 'significant' && styles.severitySignificant,
                          ]}>
                            <Text style={styles.severityText}>{pw.severity}</Text>
                          </View>
                        </View>
                        <Text style={styles.pronunciationGuide}>
                          Say: <Text style={styles.pronunciationCorrect}>{pw.expected_pronunciation}</Text>
                        </Text>
                        <Text style={styles.problemTip}>{pw.tip}</Text>
                      </View>
                    ))}
                  </View>
                )}
                
                {/* Tips */}
                {analysisResult.tips.length > 0 && (
                  <View style={styles.tipsSection}>
                    <Text style={styles.sectionTitle}>Tips for {selectedAccent?.name}</Text>
                    {analysisResult.tips.map((tip, index) => (
                      <View key={index} style={styles.tipRow}>
                        <Ionicons name="bulb" size={18} color="#f59e0b" />
                        <Text style={styles.tipText}>{tip}</Text>
                      </View>
                    ))}
                  </View>
                )}
                
                {/* Action Buttons */}
                <View style={styles.resultActions}>
                  <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={styles.retryButtonText}>Try Again</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={styles.newLineButton} onPress={handleNewLine}>
                    <Ionicons name="list" size={20} color="#6366f1" />
                    <Text style={styles.newLineButtonText}>New Line</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        )}
        
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#9ca3af', marginTop: 16, fontSize: 16 },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: '#fff', marginLeft: 12 },
  headerRight: { width: 40, alignItems: 'flex-end' },
  
  content: { flex: 1 },
  stepContainer: { padding: 20 },
  
  stepTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  stepSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 24 },
  
  // Accent Selection
  accentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  accentCard: {
    width: '47%',
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  accentIcon: { marginBottom: 12 },
  accentEmoji: { fontSize: 36 },
  accentName: { fontSize: 15, fontWeight: '600', color: '#fff', textAlign: 'center' },
  accentRegion: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  
  // Selected Accent Badge
  selectedAccentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 20,
  },
  selectedAccentText: { fontSize: 15, fontWeight: '600', color: '#6366f1' },
  changeText: { fontSize: 13, color: '#9ca3af' },
  
  // Stats Row
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#fff' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  
  // Line Selection
  linesContainer: { gap: 12 },
  lineCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  lineText: { fontSize: 15, color: '#e5e7eb', fontStyle: 'italic', lineHeight: 22 },
  lineFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  lineSource: { fontSize: 12, color: '#6b7280' },
  difficultyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  difficultyEasy: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  difficultyMedium: { backgroundColor: 'rgba(245, 158, 11, 0.2)' },
  difficultyHard: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  difficultyText: { fontSize: 11, fontWeight: '600', color: '#fff', textTransform: 'capitalize' },
  
  // Recording
  lineToRead: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  lineToReadLabel: { fontSize: 12, color: '#6b7280', marginBottom: 8 },
  lineToReadText: { fontSize: 20, color: '#fff', fontStyle: 'italic', lineHeight: 30 },
  lineToReadSource: { fontSize: 13, color: '#6b7280', marginTop: 12 },
  
  recordingArea: { alignItems: 'center', marginBottom: 32 },
  recordingTime: { fontSize: 32, fontWeight: '700', color: '#ef4444', marginBottom: 24 },
  recordButtonWrapper: {},
  recordButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordButtonActive: { backgroundColor: '#ef4444' },
  recordHint: { fontSize: 14, color: '#6b7280', marginTop: 16 },
  
  changeLineButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  changeLineText: { fontSize: 14, color: '#6366f1' },
  
  // Analyzing
  analyzingContainer: { alignItems: 'center', paddingVertical: 60 },
  analyzingText: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 24 },
  analyzingSubtext: { fontSize: 14, color: '#6b7280', marginTop: 8 },
  
  // Results
  scoreContainer: { alignItems: 'center', marginBottom: 24 },
  scoreValue: { fontSize: 64, fontWeight: '700' },
  scoreLabel: { fontSize: 16, color: '#6b7280', marginTop: 4 },
  
  paceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  paceText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  paceWpm: { fontSize: 14, color: '#6b7280' },
  
  feedbackCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#6366f1',
  },
  feedbackText: { fontSize: 15, color: '#e5e7eb', lineHeight: 22 },
  
  // Problem Words
  problemWordsSection: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12 },
  problemWordCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  problemWordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  problemWord: { fontSize: 16, fontWeight: '700', color: '#ef4444' },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  severityMinor: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  severityModerate: { backgroundColor: 'rgba(245, 158, 11, 0.2)' },
  severitySignificant: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  severityText: { fontSize: 10, fontWeight: '600', color: '#fff', textTransform: 'capitalize' },
  pronunciationGuide: { fontSize: 14, color: '#9ca3af', marginBottom: 6 },
  pronunciationCorrect: { color: '#10b981', fontWeight: '600' },
  problemTip: { fontSize: 13, color: '#6b7280', fontStyle: 'italic' },
  
  // Tips
  tipsSection: { marginBottom: 24 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  tipText: { flex: 1, fontSize: 14, color: '#e5e7eb', lineHeight: 20 },
  
  // Action Buttons
  resultActions: { flexDirection: 'row', gap: 12 },
  retryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
  },
  retryButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  newLineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingVertical: 16,
    borderRadius: 12,
  },
  newLineButtonText: { fontSize: 16, fontWeight: '600', color: '#6366f1' },
});
