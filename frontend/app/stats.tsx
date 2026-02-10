import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';
import { useAuth } from '../contexts/AuthContext';
import { getPerformanceStats, PerformanceStats } from '../services/syncService';

interface PerformanceData {
  scriptId: string;
  scriptTitle: string;
  totalRehearsals: number;
  totalLinesCompleted: number;
  totalLinesMissed: number;
  averageAccuracy: number;
  totalTime: number;
  weakLines: number[];
  lastPracticed: string;
}

interface GlobalStats {
  totalRehearsals: number;
  totalLinesCompleted: number;
  totalPracticeTime: number;
  averageAccuracy: number;
  streakDays: number;
  lastPracticeDate: string;
}

export default function StatsScreen() {
  const { isPremium, user } = useScriptStore();
  const { isAuthenticated } = useAuth();
  const [stats, setStats] = useState<GlobalStats>({
    totalRehearsals: 0,
    totalLinesCompleted: 0,
    totalPracticeTime: 0,
    averageAccuracy: 0,
    streakDays: 0,
    lastPracticeDate: '',
  });
  const [scriptStats, setScriptStats] = useState<PerformanceData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Use sync service to get stats (from server if authenticated, local otherwise)
      const syncedStats = await getPerformanceStats();
      
      setStats({
        totalRehearsals: syncedStats.total_rehearsals,
        totalLinesCompleted: syncedStats.total_lines_completed,
        totalPracticeTime: syncedStats.total_practice_time,
        averageAccuracy: syncedStats.average_accuracy,
        streakDays: syncedStats.streak_days,
        lastPracticeDate: syncedStats.last_practice_date || '',
      });
      
      // Convert script stats
      const convertedScriptStats: PerformanceData[] = (syncedStats.script_stats || []).map(s => ({
        scriptId: s.script_id,
        scriptTitle: s.script_title,
        totalRehearsals: s.total_rehearsals,
        totalLinesCompleted: s.total_lines_completed,
        totalLinesMissed: 0,
        averageAccuracy: s.average_accuracy,
        totalTime: 0,
        weakLines: s.weak_lines || [],
        lastPracticed: s.last_practiced,
      }));
      setScriptStats(convertedScriptStats);
      
      // Also use user data from store if available
      if (user) {
        setStats(prev => ({
          ...prev,
          totalRehearsals: Math.max(user.total_rehearsals || 0, prev.totalRehearsals),
          totalLinesCompleted: Math.max(user.total_lines_practiced || 0, prev.totalLinesCompleted),
        }));
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getAccuracyColor = (accuracy: number): string => {
    if (accuracy >= 80) return '#10b981';
    if (accuracy >= 60) return '#f59e0b';
    return '#ef4444';
  };

  if (!isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Performance Stats</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.premiumRequired}>
          <Ionicons name="stats-chart" size={64} color="#6366f1" />
          <Text style={styles.premiumTitle}>Premium Feature</Text>
          <Text style={styles.premiumSubtitle}>
            Track your rehearsal progress, see accuracy over time, and identify lines that need more practice.
          </Text>
          <TouchableOpacity 
            style={styles.upgradeButton}
            onPress={() => router.push('/premium')}
          >
            <Ionicons name="star" size={20} color="#fff" />
            <Text style={styles.upgradeButtonText}>Upgrade to Premium</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Performance Stats</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Overview Stats */}
        <View style={styles.overviewCard}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(99, 102, 241, 0.2)' }]}>
                <Ionicons name="repeat" size={24} color="#6366f1" />
              </View>
              <Text style={styles.statValue}>{stats.totalRehearsals}</Text>
              <Text style={styles.statLabel}>Rehearsals</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                <Ionicons name="chatbubbles" size={24} color="#10b981" />
              </View>
              <Text style={styles.statValue}>{stats.totalLinesCompleted}</Text>
              <Text style={styles.statLabel}>Lines Practiced</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                <Ionicons name="time" size={24} color="#f59e0b" />
              </View>
              <Text style={styles.statValue}>{formatTime(stats.totalPracticeTime)}</Text>
              <Text style={styles.statLabel}>Practice Time</Text>
            </View>
            
            <View style={styles.statItem}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
                <Ionicons name="flame" size={24} color="#ef4444" />
              </View>
              <Text style={styles.statValue}>{stats.streakDays}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
            </View>
          </View>
        </View>

        {/* Accuracy Progress */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Accuracy</Text>
          <View style={styles.accuracyContainer}>
            <View style={styles.accuracyCircle}>
              <Text style={[styles.accuracyValue, { color: getAccuracyColor(stats.averageAccuracy) }]}>
                {stats.averageAccuracy || 0}%
              </Text>
              <Text style={styles.accuracyLabel}>Average</Text>
            </View>
            <View style={styles.accuracyLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                <Text style={styles.legendText}>80%+ Excellent</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={styles.legendText}>60-79% Good</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
                <Text style={styles.legendText}>&lt;60% Needs Work</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Script-by-Script Stats */}
        {scriptStats.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>By Script</Text>
            {scriptStats.map((script, index) => (
              <View key={script.scriptId || index} style={styles.scriptStatItem}>
                <View style={styles.scriptStatHeader}>
                  <Text style={styles.scriptTitle} numberOfLines={1}>{script.scriptTitle}</Text>
                  <Text style={[styles.scriptAccuracy, { color: getAccuracyColor(script.averageAccuracy) }]}>
                    {script.averageAccuracy}%
                  </Text>
                </View>
                <View style={styles.scriptStatBar}>
                  <View 
                    style={[
                      styles.scriptStatBarFill, 
                      { 
                        width: `${script.averageAccuracy}%`,
                        backgroundColor: getAccuracyColor(script.averageAccuracy)
                      }
                    ]} 
                  />
                </View>
                <View style={styles.scriptStatMeta}>
                  <Text style={styles.scriptStatMetaText}>
                    {script.totalRehearsals} rehearsals • {script.totalLinesCompleted} lines
                  </Text>
                  {script.weakLines.length > 0 && (
                    <Text style={styles.weakLinesText}>
                      {script.weakLines.length} weak lines
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Tips Card */}
        <View style={styles.tipsCard}>
          <Ionicons name="bulb" size={24} color="#f59e0b" />
          <View style={styles.tipsContent}>
            <Text style={styles.tipsTitle}>Pro Tip</Text>
            <Text style={styles.tipsText}>
              Practice your weak lines in "Performance" mode to simulate real audition pressure.
            </Text>
          </View>
        </View>

        {/* Empty State */}
        {stats.totalRehearsals === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="bar-chart-outline" size={48} color="#4a4a5e" />
            <Text style={styles.emptyTitle}>No Stats Yet</Text>
            <Text style={styles.emptyText}>
              Complete a rehearsal to start tracking your performance!
            </Text>
            <TouchableOpacity 
              style={styles.startButton}
              onPress={() => router.push('/')}
            >
              <Text style={styles.startButtonText}>Start Rehearsing</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  placeholder: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  premiumRequired: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  premiumTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  premiumSubtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  overviewCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  statItem: {
    width: '50%',
    paddingHorizontal: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  statIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  statLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  accuracyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accuracyCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#0a0a0f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#2a2a3e',
  },
  accuracyValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  accuracyLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  accuracyLegend: {
    flex: 1,
    marginLeft: 24,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  legendText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  scriptStatItem: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  scriptStatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  scriptTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginRight: 12,
  },
  scriptAccuracy: {
    fontSize: 16,
    fontWeight: '700',
  },
  scriptStatBar: {
    height: 6,
    backgroundColor: '#2a2a3e',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scriptStatBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  scriptStatMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  scriptStatMetaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  weakLinesText: {
    fontSize: 12,
    color: '#ef4444',
  },
  tipsCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  tipsContent: {
    flex: 1,
    marginLeft: 12,
  },
  tipsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f59e0b',
    marginBottom: 4,
  },
  tipsText: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
  startButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
