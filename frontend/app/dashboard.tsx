import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';
import { safeHandler } from '../services/debugService';
import { 
  getStreak, 
  getTodayPracticeTime, 
  getGlobalProgress, 
  MASTERY_LEVELS 
} from '../services/progressService';
import { getPendingAuditions, getAuditionStats } from '../services/auditionService';

export default function DashboardScreen() {
  const { scripts, fetchScripts, loading, initializeUser, isPremium, limits } = useScriptStore();
  const [refreshing, setRefreshing] = useState(false);
  
  // Dashboard stats
  const [practiceTime, setPracticeTime] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [pendingAuditions, setPendingAuditions] = useState(0);
  const [globalXP, setGlobalXP] = useState(0);
  const [masteryLevel, setMasteryLevel] = useState<keyof typeof MASTERY_LEVELS>('ROOKIE');
  const [momentum, setMomentum] = useState<'rising' | 'steady' | 'declining'>('steady');
  
  // Hidden debug screen - tap logo 5x
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<NodeJS.Timeout | null>(null);
  
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) {
      logoTapCount.current = 0;
      router.push('/debug');
    } else {
      logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 2000);
    }
  };

  const loadDashboardData = useCallback(async () => {
    try {
      const [streak, time, progress, pending, stats] = await Promise.all([
        getStreak(),
        getTodayPracticeTime(),
        getGlobalProgress(),
        getPendingAuditions(),
        getAuditionStats(),
      ]);
      
      setCurrentStreak(streak.currentStreak);
      setPracticeTime(time);
      setGlobalXP(progress.totalXP);
      setMasteryLevel(progress.globalMasteryLevel);
      setPendingAuditions(pending.length);
      setMomentum(stats.momentum);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    }
  }, []);

  const initialize = useCallback(async () => {
    await initializeUser();
    await Promise.all([fetchScripts(), loadDashboardData()]);
  }, [initializeUser, fetchScripts, loadDashboardData]);

  useEffect(() => {
    initialize();
  }, [initialize]);
  
  // Refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchScripts(), loadDashboardData()]);
    setRefreshing(false);
  };

  const recentScript = scripts.length > 0 ? scripts[0] : null;
  const levelInfo = MASTERY_LEVELS[masteryLevel];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity style={styles.logoContainer} onPress={handleLogoTap} activeOpacity={0.8}>
              <Ionicons name="mic" size={28} color="#6366f1" />
              <Text style={styles.logoText}>ScriptMate</Text>
            </TouchableOpacity>
            <View style={styles.headerButtons}>
              <TouchableOpacity style={styles.headerButton} onPress={() => router.push('/support')}>
                <Ionicons name="help-circle-outline" size={24} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerButton} onPress={() => router.push('/profile')}>
                <Ionicons name="person-circle-outline" size={26} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.greeting}>Today in ScriptMate</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={styles.statIcon}>
              <Ionicons name="time-outline" size={20} color="#10b981" />
            </View>
            <Text style={styles.statValue}>{practiceTime}m</Text>
            <Text style={styles.statLabel}>Practice</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="flame" size={20} color="#f59e0b" />
            </View>
            <Text style={styles.statValue}>{currentStreak}</Text>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: 'rgba(99, 102, 241, 0.15)' }]}>
              <Ionicons name="clipboard-outline" size={20} color="#6366f1" />
            </View>
            <Text style={styles.statValue}>{pendingAuditions}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: `${levelInfo.color}20` }]}>
              <Ionicons name={levelInfo.icon as any} size={20} color={levelInfo.color} />
            </View>
            <Text style={styles.statValue}>{globalXP}</Text>
            <Text style={styles.statLabel}>XP</Text>
          </View>
        </View>

        {/* Momentum Badge */}
        {momentum !== 'steady' && (
          <View style={[styles.momentumBadge, momentum === 'rising' ? styles.momentumRising : styles.momentumDeclining]}>
            <Ionicons 
              name={momentum === 'rising' ? 'trending-up' : 'trending-down'} 
              size={16} 
              color={momentum === 'rising' ? '#10b981' : '#ef4444'} 
            />
            <Text style={[styles.momentumText, momentum === 'rising' ? styles.momentumTextRising : styles.momentumTextDeclining]}>
              {momentum === 'rising' ? 'Momentum Rising!' : 'Keep pushing!'}
            </Text>
          </View>
        )}

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/scripts')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#6366f1' }]}>
              <Ionicons name="book" size={24} color="#fff" />
            </View>
            <Text style={styles.quickActionText}>Practice</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/selftape/index')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#10b981' }]}>
              <Ionicons name="videocam" size={24} color="#fff" />
            </View>
            <Text style={styles.quickActionText}>Self Tape</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/auditions')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#f59e0b' }]}>
              <Ionicons name="calendar" size={24} color="#fff" />
            </View>
            <Text style={styles.quickActionText}>Auditions</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.quickAction} onPress={() => router.push('/upload')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#8b5cf6' }]}>
              <Ionicons name="add" size={24} color="#fff" />
            </View>
            <Text style={styles.quickActionText}>New Script</Text>
          </TouchableOpacity>
        </View>

        {/* Premium Banner */}
        {!isPremium && (
          <TouchableOpacity style={styles.premiumBanner} onPress={() => router.push('/paywall')}>
            <View style={styles.premiumBannerContent}>
              <Ionicons name="star" size={24} color="#f59e0b" />
              <View style={styles.premiumBannerText}>
                <Text style={styles.premiumBannerTitle}>Unlock Premium</Text>
                <Text style={styles.premiumBannerSubtitle}>Full recall modes, shot coach & unlimited auditions</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#f59e0b" />
          </TouchableOpacity>
        )}

        {/* Continue Learning */}
        {recentScript && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Continue Learning</Text>
            <TouchableOpacity
              style={styles.continueCard}
              onPress={() => router.push(`/script/${recentScript.id}`)}
            >
              <View style={styles.continueIcon}>
                <Ionicons name="play-circle" size={44} color="#6366f1" />
              </View>
              <View style={styles.continueText}>
                <Text style={styles.continueTitle} numberOfLines={1}>{recentScript.title}</Text>
                <Text style={styles.continueSubtitle}>
                  {recentScript.characters?.length || 0} characters • {recentScript.lines?.length || 0} lines
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>
        )}

        {/* Mastery Level Card */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Level</Text>
          <View style={styles.masteryCard}>
            <View style={[styles.masteryIcon, { backgroundColor: `${levelInfo.color}20` }]}>
              <Ionicons name={levelInfo.icon as any} size={32} color={levelInfo.color} />
            </View>
            <View style={styles.masteryInfo}>
              <Text style={[styles.masteryLevel, { color: levelInfo.color }]}>{levelInfo.name}</Text>
              <Text style={styles.masteryXP}>{globalXP} XP earned</Text>
              {masteryLevel !== 'MASTER' && (
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { 
                        backgroundColor: levelInfo.color,
                        width: `${Math.min(100, (globalXP / MASTERY_LEVELS.MASTER.minXP) * 100)}%`
                      }
                    ]} 
                  />
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Feature Cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actor Tools</Text>
          <View style={styles.featureGrid}>
            <TouchableOpacity style={styles.featureCard} onPress={() => router.push('/scripts')}>
              <Ionicons name="flash" size={28} color="#10b981" />
              <Text style={styles.featureTitle}>Adaptive Recall</Text>
              <Text style={styles.featureDesc}>Smart memorization</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.featureCard} onPress={() => router.push('/selftape/index')}>
              <Ionicons name="grid" size={28} color="#3b82f6" />
              <Text style={styles.featureTitle}>Shot Coach</Text>
              <Text style={styles.featureDesc}>Framing guides</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.featureCard} onPress={() => router.push('/auditions')}>
              <Ionicons name="trending-up" size={28} color="#f59e0b" />
              <Text style={styles.featureTitle}>Audition Tracker</Text>
              <Text style={styles.featureDesc}>Track & analyze</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.featureCard} onPress={() => router.push('/stats')}>
              <Ionicons name="bar-chart" size={28} color="#8b5cf6" />
              <Text style={styles.featureTitle}>Statistics</Text>
              <Text style={styles.featureDesc}>Your progress</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { paddingTop: 16, paddingBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { padding: 8 },
  logoContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  greeting: { fontSize: 28, fontWeight: '700', color: '#fff' },
  
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, alignItems: 'center' },
  statIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(16, 185, 129, 0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#fff' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  
  momentumBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 20, gap: 6 },
  momentumRising: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  momentumDeclining: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  momentumText: { fontSize: 13, fontWeight: '600' },
  momentumTextRising: { color: '#10b981' },
  momentumTextDeclining: { color: '#ef4444' },
  
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 12 },
  section: { marginBottom: 24 },
  
  quickActions: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  quickAction: { flex: 1, alignItems: 'center' },
  quickActionIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickActionText: { fontSize: 12, fontWeight: '500', color: '#9ca3af' },
  
  premiumBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)', borderRadius: 12, padding: 14, marginBottom: 24 },
  premiumBannerContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  premiumBannerText: { marginLeft: 12, flex: 1 },
  premiumBannerTitle: { fontSize: 16, fontWeight: '600', color: '#f59e0b' },
  premiumBannerSubtitle: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  
  continueCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3e' },
  continueIcon: { marginRight: 14 },
  continueText: { flex: 1 },
  continueTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  continueSubtitle: { fontSize: 13, color: '#6b7280' },
  
  masteryCard: { backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3e' },
  masteryIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  masteryInfo: { flex: 1 },
  masteryLevel: { fontSize: 18, fontWeight: '700' },
  masteryXP: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
  progressBar: { height: 4, backgroundColor: '#2a2a3e', borderRadius: 2, marginTop: 10 },
  progressFill: { height: '100%', borderRadius: 2 },
  
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  featureCard: { width: '47%', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#2a2a3e' },
  featureTitle: { fontSize: 14, fontWeight: '600', color: '#fff', marginTop: 10 },
  featureDesc: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  
  loadingContainer: { padding: 40, alignItems: 'center' },
});
