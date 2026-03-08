import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { API_BASE_URL } from '../services/apiConfig';



export default function DailyDrillScreen() {
  const [drill, setDrill] = useState<any>(null);
  const [streak, setStreak] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [feedback, setFeedback] = useState<any>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const getDeviceId = async () => {
    let id = await AsyncStorage.getItem('device_id');
    if (!id) {
      id = `drill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem('device_id', id);
    }
    return id;
  };

  const fetchDrill = useCallback(async () => {
    try {
      setLoading(true);
      const userId = await getDeviceId();
      const [drillRes, streakRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/daily-drill/${userId}`, { timeout: 15000 }),
        axios.get(`${API_BASE_URL}/api/streak/${userId}`, { timeout: 15000 }),
      ]);
      setDrill(drillRes.data);
      setStreak(streakRes.data);
    } catch (error: any) {
      setLoadError(true);
      Alert.alert('Error', 'Unable to load daily drill. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrill(); }, [fetchDrill]);

  const completeDrill = async () => {
    if (!drill) return;
    try {
      setCompleting(true);
      const userId = await getDeviceId();
      const res = await axios.post(`${API_BASE_URL}/api/daily-drill/${userId}/complete`, {}, { timeout: 15000 });
      const streakRes = await axios.get(`${API_BASE_URL}/api/streak/${userId}`, { timeout: 15000 });
      setStreak(streakRes.data);
      setDrill({ ...drill, completed: true });
      
      // Fetch AI feedback
      setLoadingFeedback(true);
      try {
        const fbRes = await axios.post(`${API_BASE_URL}/api/daily-drill/${userId}/feedback`, {
          drill_prompt: drill.prompt || '',
          challenge_type: drill.challenge_type || 'emotion_shift',
        }, { timeout: 20000 });
        setFeedback(fbRes.data);
      } catch (fbErr) {
        console.error('Feedback error:', fbErr);
      } finally {
        setLoadingFeedback(false);
      }
      
      Alert.alert('Challenge Complete!', `+${res.data.xp_awarded} XP earned!`);
    } catch (error: any) {
      Alert.alert('Error', 'Failed to complete drill. Please try again.');
    } finally {
      setCompleting(false);
    }
  };

  const typeColors: Record<string, string> = {
    emotion_shift: '#8b5cf6',
    cold_read: '#3b82f6',
    physicality: '#10b981',
    improv_react: '#f59e0b',
    accent_sprint: '#ec4899',
  };

  const typeIcons: Record<string, string> = {
    emotion_shift: 'happy',
    cold_read: 'book',
    physicality: 'body',
    improv_react: 'flash',
    accent_sprint: 'mic',
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f59e0b" />
          <Text style={styles.loadingText}>Loading today's challenge...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !drill) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="cloud-offline" size={48} color="#374151" />
          <Text style={[styles.loadingText, { marginTop: 12, fontSize: 16 }]}>Unable to load drill</Text>
          <Text style={styles.loadingText}>Check your connection and try again</Text>
          <TouchableOpacity
            style={[styles.completeBtn, { backgroundColor: '#6366f1', marginTop: 20, paddingHorizontal: 32 }]}
            onPress={() => { setLoadError(false); setLoading(true); fetchDrill(); }}
          >
            <Ionicons name="refresh" size={20} color="#fff" />
            <Text style={styles.completeBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const accentColor = drill ? (typeColors[drill.challenge_type] || '#f59e0b') : '#f59e0b';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} testID="drill-back-btn">
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Daily Actor Drill</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Streak Banner */}
        {streak && (
          <View style={styles.streakBanner}>
            <View style={styles.streakItem}>
              <Text style={styles.streakEmoji}>
                <Ionicons name="flame" size={24} color="#f59e0b" />
              </Text>
              <Text style={styles.streakNumber}>{streak.current_streak}</Text>
              <Text style={styles.streakLabel}>Day Streak</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Text style={styles.streakEmoji}>
                <Ionicons name="trophy" size={24} color="#f59e0b" />
              </Text>
              <Text style={styles.streakNumber}>{streak.best_streak}</Text>
              <Text style={styles.streakLabel}>Best Streak</Text>
            </View>
            <View style={styles.streakDivider} />
            <View style={styles.streakItem}>
              <Text style={styles.streakEmoji}>
                <Ionicons name="star" size={24} color="#f59e0b" />
              </Text>
              <Text style={styles.streakNumber}>{streak.total_xp}</Text>
              <Text style={styles.streakLabel}>Total XP</Text>
            </View>
          </View>
        )}

        {/* Challenge Card */}
        {drill && (
          <View style={[styles.challengeCard, { borderColor: accentColor + '40' }]}>
            <View style={[styles.challengeTypeTag, { backgroundColor: accentColor + '20' }]}>
              <Ionicons name={(typeIcons[drill.challenge_type] || 'flash') as any} size={16} color={accentColor} />
              <Text style={[styles.challengeType, { color: accentColor }]}>{drill.title}</Text>
            </View>
            <Text style={styles.challengePrompt}>{drill.prompt}</Text>
            <View style={styles.challengeMeta}>
              <View style={styles.metaItem}>
                <Ionicons name="time" size={16} color="#6b7280" />
                <Text style={styles.metaText}>{drill.duration_seconds}s</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="star" size={16} color="#f59e0b" />
                <Text style={styles.metaText}>+{drill.xp_reward} XP</Text>
              </View>
            </View>
          </View>
        )}

        {/* Action Buttons */}
        {drill && !drill.completed ? (
          <TouchableOpacity
            style={[styles.completeBtn, { backgroundColor: accentColor }]}
            onPress={completeDrill}
            disabled={completing}
            testID="complete-drill-btn"
          >
            {completing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={24} color="#fff" />
                <Text style={styles.completeBtnText}>I Did It! Claim XP</Text>
              </>
            )}
          </TouchableOpacity>
        ) : drill?.completed ? (
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={32} color="#10b981" />
            <Text style={styles.completedText}>Today's drill complete!</Text>
            <Text style={styles.completedSub}>Come back tomorrow for a new challenge</Text>
          </View>
        ) : null}

        {/* AI Performance Feedback */}
        {loadingFeedback && (
          <View style={styles.feedbackLoading}>
            <ActivityIndicator size="small" color="#8b5cf6" />
            <Text style={styles.feedbackLoadingText}>AI analyzing your performance...</Text>
          </View>
        )}

        {feedback && (
          <View style={styles.feedbackSection}>
            <Text style={styles.feedbackTitle}>Performance Feedback</Text>
            {(['emotion', 'pacing', 'delivery', 'confidence'] as const).map((key) => {
              const item = feedback[key];
              if (!item) return null;
              const colors: Record<string, string> = { emotion: '#8b5cf6', pacing: '#3b82f6', delivery: '#10b981', confidence: '#f59e0b' };
              const icons: Record<string, string> = { emotion: 'heart', pacing: 'speedometer', delivery: 'mic', confidence: 'shield-checkmark' };
              return (
                <View key={key} style={styles.feedbackCard}>
                  <View style={styles.feedbackCardHeader}>
                    <Ionicons name={icons[key] as any} size={20} color={colors[key]} />
                    <Text style={styles.feedbackCardTitle}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                    <View style={[styles.scoreBadge, { backgroundColor: colors[key] + '20' }]}>
                      <Text style={[styles.scoreText, { color: colors[key] }]}>{item.score}/10</Text>
                    </View>
                    <Text style={styles.feedbackLabel}>{item.label}</Text>
                  </View>
                  <Text style={styles.feedbackText}>{item.feedback}</Text>
                  {item.tip && (
                    <View style={styles.tipRow}>
                      <Ionicons name="bulb" size={14} color="#f59e0b" />
                      <Text style={styles.tipText}>{item.tip}</Text>
                    </View>
                  )}
                </View>
              );
            })}
            {feedback.overall_note && (
              <View style={styles.overallNote}>
                <Ionicons name="star" size={18} color="#f59e0b" />
                <Text style={styles.overallNoteText}>{feedback.overall_note}</Text>
              </View>
            )}
          </View>
        )}

        {/* Today's Activities */}
        {streak && streak.activities_today?.length > 0 && (
          <View style={styles.activitiesSection}>
            <Text style={styles.activitiesTitle}>Today's Training</Text>
            {streak.activities_today.map((act: string, i: number) => (
              <View key={i} style={styles.activityRow}>
                <Ionicons name="checkmark-circle" size={18} color="#10b981" />
                <Text style={styles.activityText}>{act.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 20, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#6b7280', marginTop: 12, fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  streakBanner: {
    flexDirection: 'row', backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20,
    marginBottom: 24, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  streakItem: { flex: 1, alignItems: 'center' },
  streakDivider: { width: 1, backgroundColor: '#2a2a3e', marginHorizontal: 8 },
  streakEmoji: { marginBottom: 4 },
  streakNumber: { fontSize: 28, fontWeight: '700', color: '#fff' },
  streakLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  challengeCard: {
    backgroundColor: '#1a1a2e', borderRadius: 16, padding: 24,
    marginBottom: 24, borderWidth: 1,
  },
  challengeTypeTag: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 6, marginBottom: 16,
  },
  challengeType: { fontSize: 13, fontWeight: '600' },
  challengePrompt: { fontSize: 18, fontWeight: '500', color: '#fff', lineHeight: 28, marginBottom: 20 },
  challengeMeta: { flexDirection: 'row', gap: 20 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 14, color: '#6b7280' },
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    padding: 18, borderRadius: 14, gap: 10, marginBottom: 24,
  },
  completeBtnText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  completedBanner: { alignItems: 'center', padding: 24, marginBottom: 24 },
  completedText: { fontSize: 20, fontWeight: '700', color: '#10b981', marginTop: 8 },
  completedSub: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  activitiesSection: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2a2a3e' },
  activitiesTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  activityText: { fontSize: 14, color: '#9ca3af' },
  // Feedback styles
  feedbackLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  feedbackLoadingText: { fontSize: 14, color: '#8b5cf6' },
  feedbackSection: { marginBottom: 24 },
  feedbackTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 12 },
  feedbackCard: {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  feedbackCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  feedbackCardTitle: { fontSize: 15, fontWeight: '600', color: '#fff', flex: 1 },
  scoreBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  scoreText: { fontSize: 13, fontWeight: '700' },
  feedbackLabel: { fontSize: 12, color: '#6b7280' },
  feedbackText: { fontSize: 14, color: '#d1d5db', lineHeight: 20 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: 'rgba(245,158,11,0.08)', padding: 8, borderRadius: 8 },
  tipText: { fontSize: 13, color: '#f59e0b', flex: 1 },
  overallNote: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(245,158,11,0.1)',
    borderRadius: 12, padding: 14, marginTop: 4,
  },
  overallNoteText: { fontSize: 14, color: '#f59e0b', flex: 1, fontWeight: '500' },
});
