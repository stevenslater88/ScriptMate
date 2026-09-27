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
import { 
  getStreak, 
  getTodayPracticeTime, 
  getGlobalProgress,
  getAllSceneProgress,
  MASTERY_LEVELS,
  SceneProgress,
} from '../services/progressService';
import { getPendingAuditions, getAuditionStats, AuditionStats } from '../services/auditionService';

export default function DashboardScreen() {
  const { scripts, fetchScripts, loading, initializeUser, isPremium } = useScriptStore();
  const [refreshing, setRefreshing] = useState(false);
  
  // Daily Progress Stats
  const [practiceTime, setPracticeTime] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [lastScene, setLastScene] = useState<SceneProgress | null>(null);
  const [globalXP, setGlobalXP] = useState(0);
  const [masteryLevel, setMasteryLevel] = useState<keyof typeof MASTERY_LEVELS>('ROOKIE');
  
  // Career Momentum Stats
  const [pendingAuditions, setPendingAuditions] = useState(0);
  const [auditionStats, setAuditionStats] = useState<AuditionStats | null>(null);
  
  // Hidden debug screen - tap logo 5x
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<any>(null);
  
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
      const [streak, time, progress, pending, stats, scenes] = await Promise.all([
        getStreak(),
        getTodayPracticeTime(),
        getGlobalProgress(),
        getPendingAuditions(),
        getAuditionStats(),
        getAllSceneProgress(),
      ]);
      
      setCurrentStreak(streak.currentStreak);
      setPracticeTime(time);
      setGlobalXP(progress.totalXP);
      setMasteryLevel(progress.globalMasteryLevel);
      setPendingAuditions(pending.length);
      setAuditionStats(stats);
      
      // Get last practiced scene
      if (scenes.length > 0) {
        const sorted = [...scenes].sort((a, b) => 
          new Date(b.lastPracticed).getTime() - new Date(a.lastPracticed).getTime()
        );
        setLastScene(sorted[0]);
      }
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

  const levelInfo = MASTERY_LEVELS[masteryLevel];
  const lastSceneLevelInfo = lastScene ? MASTERY_LEVELS[lastScene.masteryLevel] : null;
  const masteryProgress = lastScene 
    ? Math.min(100, (lastScene.xp / MASTERY_LEVELS.MASTER.minXP) * 100) 
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity style={styles.logoContainer} onPress={handleLogoTap} activeOpacity={0.8}>
              <View style={styles.logoIcon}>
                <Ionicons name="mic" size={20} color="#fff" />
              </View>
              <Text style={styles.logoText}>ScriptM8</Text>
            </TouchableOpacity>
            <View style={styles.headerButtons}>
              <TouchableOpacity 
                style={styles.headerButton} 
                onPress={() => router.push('/support')}
                data-testid="help-button"
              >
                <Ionicons name="help-circle-outline" size={22} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.headerButton} 
                onPress={() => router.push('/profile')}
                data-testid="profile-button"
              >
                <Ionicons name="person-circle-outline" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.greeting}>Today in ScriptM8</Text>
          <Text style={styles.subGreeting}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </Text>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            DAILY PROGRESS SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="sunny-outline" size={18} color="#f59e0b" />
              <Text style={styles.sectionTitle}>Daily Progress</Text>
            </View>
          </View>
          
          <View style={styles.dailyStatsRow}>
            {/* Practice Time */}
            <View style={styles.dailyStat}>
              <View style={[styles.dailyStatIcon, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <Ionicons name="time-outline" size={22} color="#10b981" />
              </View>
              <Text style={styles.dailyStatValue}>{practiceTime}</Text>
              <Text style={styles.dailyStatUnit}>min</Text>
              <Text style={styles.dailyStatLabel}>Practice</Text>
            </View>
            
            {/* Streak */}
            <View style={styles.dailyStat}>
              <View style={[styles.dailyStatIcon, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
                <Ionicons name="flame" size={22} color="#f59e0b" />
              </View>
              <Text style={styles.dailyStatValue}>{currentStreak}</Text>
              <Text style={styles.dailyStatUnit}>days</Text>
              <Text style={styles.dailyStatLabel}>Streak</Text>
            </View>
            
            {/* XP */}
            <View style={styles.dailyStat}>
              <View style={[styles.dailyStatIcon, { backgroundColor: `${levelInfo.color}15` }]}>
                <Ionicons name={levelInfo.icon as any} size={22} color={levelInfo.color} />
              </View>
              <Text style={styles.dailyStatValue}>{globalXP}</Text>
              <Text style={styles.dailyStatUnit}>XP</Text>
              <Text style={styles.dailyStatLabel}>{levelInfo.name}</Text>
            </View>
          </View>

          {/* Scene Mastery Progress */}
          {lastScene && lastSceneLevelInfo && (
            <View style={styles.masteryCard}>
              <View style={styles.masteryHeader}>
                <Text style={styles.masterySceneName} numberOfLines={1}>{lastScene.sceneName}</Text>
                <View style={[styles.masteryBadge, { backgroundColor: `${lastSceneLevelInfo.color}15` }]}>
                  <Ionicons name={lastSceneLevelInfo.icon as any} size={12} color={lastSceneLevelInfo.color} />
                  <Text style={[styles.masteryBadgeText, { color: lastSceneLevelInfo.color }]}>
                    {lastSceneLevelInfo.name}
                  </Text>
                </View>
              </View>
              <View style={styles.masteryProgressBar}>
                <View 
                  style={[
                    styles.masteryProgressFill, 
                    { width: `${masteryProgress}%`, backgroundColor: lastSceneLevelInfo.color }
                  ]} 
                />
              </View>
              <Text style={styles.masteryProgressText}>
                {lastScene.xp} / {MASTERY_LEVELS.MASTER.minXP} XP to Master
              </Text>
            </View>
          )}
          
          {!lastScene && (
            <TouchableOpacity 
              style={styles.emptyMasteryCard}
              onPress={() => router.push('/scripts')}
            >
              <Ionicons name="school-outline" size={24} color="#4b5563" />
              <Text style={styles.emptyMasteryText}>Start practicing to track mastery</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            CAREER MOMENTUM SECTION
        ═══════════════════════════════════════════════════════════════════ */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="trending-up" size={18} color="#6366f1" />
              <Text style={styles.sectionTitle}>Career Momentum</Text>
            </View>
            {auditionStats && auditionStats.momentum !== 'steady' && (
              <View style={[
                styles.momentumBadge, 
                auditionStats.momentum === 'rising' ? styles.momentumRising : styles.momentumDeclining
              ]}>
                <Ionicons 
                  name={auditionStats.momentum === 'rising' ? 'arrow-up' : 'arrow-down'} 
                  size={12} 
                  color={auditionStats.momentum === 'rising' ? '#10b981' : '#ef4444'} 
                />
                <Text style={[
                  styles.momentumBadgeText,
                  { color: auditionStats.momentum === 'rising' ? '#10b981' : '#ef4444' }
                ]}>
                  {auditionStats.momentum === 'rising' ? 'Rising' : 'Keep Going'}
                </Text>
              </View>
            )}
          </View>
          
          <View style={styles.careerStatsRow}>
            {/* Pending Auditions */}
            <TouchableOpacity 
              style={styles.careerStat}
              onPress={() => router.push('/auditions')}
              data-testid="pending-auditions-card"
            >
              <View style={[styles.careerStatIcon, { backgroundColor: 'rgba(59, 130, 246, 0.12)' }]}>
                <Ionicons name="hourglass-outline" size={20} color="#3b82f6" />
              </View>
              <Text style={styles.careerStatValue}>{pendingAuditions}</Text>
              <Text style={styles.careerStatLabel}>Pending</Text>
            </TouchableOpacity>
            
            {/* This Month */}
            <View style={styles.careerStat}>
              <View style={[styles.careerStatIcon, { backgroundColor: 'rgba(99, 102, 241, 0.12)' }]}>
                <Ionicons name="calendar-outline" size={20} color="#6366f1" />
              </View>
              <Text style={styles.careerStatValue}>{auditionStats?.auditionsThisMonth || 0}</Text>
              <Text style={styles.careerStatLabel}>This Month</Text>
            </View>
            
            {/* Callbacks */}
            <View style={styles.careerStat}>
              <View style={[styles.careerStatIcon, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <Ionicons name="call-outline" size={20} color="#10b981" />
              </View>
              <Text style={styles.careerStatValue}>{auditionStats?.callbackCount || 0}</Text>
              <Text style={styles.careerStatLabel}>Callbacks</Text>
            </View>
          </View>
          
          {/* Quick Stats */}
          {auditionStats && auditionStats.totalAuditions > 0 && (
            <View style={styles.quickStatsRow}>
              <View style={styles.quickStatItem}>
                <Text style={styles.quickStatLabel}>Callback Rate</Text>
                <Text style={[styles.quickStatValue, { color: '#f59e0b' }]}>
                  {auditionStats.callbackRate}%
                </Text>
              </View>
              <View style={styles.quickStatDivider} />
              <View style={styles.quickStatItem}>
                <Text style={styles.quickStatLabel}>Booking Rate</Text>
                <Text style={[styles.quickStatValue, { color: '#10b981' }]}>
                  {auditionStats.bookingRate}%
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            QUICK ACTIONS
        ═══════════════════════════════════════════════════════════════════ */}
        <Text style={styles.actionsTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {/* Practice Scene */}
          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => router.push('/scripts')}
            data-testid="practice-scene-btn"
          >
            <View style={[styles.actionIcon, { backgroundColor: '#6366f1' }]}>
              <Ionicons name="school" size={26} color="#fff" />
            </View>
            <Text style={styles.actionTitle}>Practice Scene</Text>
            <Text style={styles.actionSubtitle}>Run lines with AI</Text>
          </TouchableOpacity>
          
          {/* Record Self-Tape */}
          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => router.push('/selftape')}
            data-testid="record-selftape-btn"
          >
            <View style={[styles.actionIcon, { backgroundColor: '#10b981' }]}>
              <Ionicons name="videocam" size={26} color="#fff" />
            </View>
            <Text style={styles.actionTitle}>Record Self-Tape</Text>
            <Text style={styles.actionSubtitle}>Pro framing guides</Text>
          </TouchableOpacity>
          
          {/* Audition Tracker */}
          <TouchableOpacity 
            style={[styles.actionCard, styles.actionCardWide]}
            onPress={() => router.push('/auditions')}
            data-testid="audition-tracker-btn"
          >
            <View style={[styles.actionIcon, { backgroundColor: '#f59e0b' }]}>
              <Ionicons name="clipboard" size={26} color="#fff" />
            </View>
            <View style={styles.actionCardContent}>
              <Text style={styles.actionTitle}>Audition Tracker</Text>
              <Text style={styles.actionSubtitle}>Log & track opportunities</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#4b5563" />
          </TouchableOpacity>
          
          {/* Dialect Coach */}
          <TouchableOpacity 
            style={[styles.actionCard, styles.actionCardWide]}
            onPress={() => router.push('/dialect-coach')}
            data-testid="dialect-coach-btn"
          >
            <View style={[styles.actionIcon, { backgroundColor: '#8b5cf6' }]}>
              <Ionicons name="mic" size={26} color="#fff" />
            </View>
            <View style={styles.actionCardContent}>
              <Text style={styles.actionTitle}>Dialect Coach</Text>
              <Text style={styles.actionSubtitle}>Master accents with AI feedback</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#4b5563" />
          </TouchableOpacity>

          {/* Acting Coach - NEW */}
          <TouchableOpacity 
            style={[styles.actionCard, styles.actionCardWide]}
            onPress={() => router.push('/acting-coach')}
            data-testid="acting-coach-btn"
          >
            <View style={[styles.actionIcon, { backgroundColor: '#6366f1' }]}>
              <Ionicons name="sparkles" size={26} color="#fff" />
            </View>
            <View style={styles.actionCardContent}>
              <Text style={styles.actionTitle}>Acting Coach</Text>
              <Text style={styles.actionSubtitle}>AI performance coaching</Text>
            </View>
            <View style={styles.newFeatureBadge}>
              <Text style={styles.newFeatureText}>NEW</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ═══════════════════════════════════════════════════════════════════
            PREMIUM UPGRADE (Soft, Non-Intrusive)
        ═══════════════════════════════════════════════════════════════════ */}
        {!isPremium && (
          <TouchableOpacity 
            style={styles.premiumCard}
            onPress={() => router.push('/premium')}
            data-testid="upgrade-card"
          >
            <View style={styles.premiumContent}>
              <View style={styles.premiumIconContainer}>
                <Ionicons name="star" size={20} color="#f59e0b" />
              </View>
              <View style={styles.premiumText}>
                <Text style={styles.premiumTitle}>Go Pro</Text>
                <Text style={styles.premiumSubtitle}>Unlock all tools & features</Text>
              </View>
            </View>
            <View style={styles.premiumArrow}>
              <Ionicons name="chevron-forward" size={18} color="#f59e0b" />
            </View>
          </TouchableOpacity>
        )}

        {/* Loading indicator */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#6366f1" />
          </View>
        )}
        
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  
  // Header
  header: { paddingTop: 12, paddingBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { padding: 8, borderRadius: 20 },
  logoContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  greeting: { fontSize: 28, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  subGreeting: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  
  // Section Card
  sectionCard: { backgroundColor: '#111118', borderRadius: 16, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#1a1a2e' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#e5e7eb', letterSpacing: -0.2 },
  
  // Daily Stats
  dailyStatsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  dailyStat: { flex: 1, alignItems: 'center' },
  dailyStatIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  dailyStatValue: { fontSize: 24, fontWeight: '700', color: '#fff', lineHeight: 28 },
  dailyStatUnit: { fontSize: 11, color: '#6b7280', marginTop: -2 },
  dailyStatLabel: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  
  // Mastery Card
  masteryCard: { marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1a1a2e' },
  masteryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  masterySceneName: { fontSize: 14, fontWeight: '600', color: '#e5e7eb', flex: 1, marginRight: 12 },
  masteryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  masteryBadgeText: { fontSize: 11, fontWeight: '600' },
  masteryProgressBar: { height: 6, backgroundColor: '#1a1a2e', borderRadius: 3, overflow: 'hidden' },
  masteryProgressFill: { height: '100%', borderRadius: 3 },
  masteryProgressText: { fontSize: 11, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  
  emptyMasteryCard: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1a1a2e', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  emptyMasteryText: { fontSize: 13, color: '#4b5563' },
  
  // Career Stats
  careerStatsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  careerStat: { flex: 1, alignItems: 'center', padding: 12, backgroundColor: '#0a0a0f', borderRadius: 12 },
  careerStatIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  careerStatValue: { fontSize: 22, fontWeight: '700', color: '#fff' },
  careerStatLabel: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  
  // Quick Stats Row
  quickStatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1a1a2e' },
  quickStatItem: { flex: 1, alignItems: 'center' },
  quickStatDivider: { width: 1, height: 32, backgroundColor: '#1a1a2e' },
  quickStatLabel: { fontSize: 11, color: '#6b7280', marginBottom: 4 },
  quickStatValue: { fontSize: 18, fontWeight: '700' },
  
  // Momentum Badge
  momentumBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  momentumRising: { backgroundColor: 'rgba(16, 185, 129, 0.12)' },
  momentumDeclining: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  
  // Actions
  actionsTitle: { fontSize: 15, fontWeight: '600', color: '#e5e7eb', marginBottom: 14, marginTop: 8 },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: { width: '47%', backgroundColor: '#111118', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1a1a2e' },
  actionCardWide: { width: '100%', flexDirection: 'row', alignItems: 'center' },
  actionCardContent: { flex: 1, marginLeft: 14 },
  actionIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  actionTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  actionSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 3 },
  newFeatureBadge: { backgroundColor: '#8b5cf6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  newFeatureText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  
  // Premium Card
  premiumCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(245, 158, 11, 0.06)', borderRadius: 14, padding: 16, marginTop: 20, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.15)' },
  premiumContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  premiumIconContainer: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(245, 158, 11, 0.12)', alignItems: 'center', justifyContent: 'center' },
  premiumText: { marginLeft: 14 },
  premiumTitle: { fontSize: 16, fontWeight: '600', color: '#f59e0b' },
  premiumSubtitle: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  premiumArrow: { padding: 4 },
  
  loadingContainer: { padding: 20, alignItems: 'center' },
  bottomSpacer: { height: 40 },
});
