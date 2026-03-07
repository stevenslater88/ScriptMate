import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';
import { safeHandler } from '../services/debugService';
import { shouldShowOnboarding } from '../components/OnboardingTutorial';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ||
                    Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL;

export default function HomeScreen() {
  const { scripts, fetchScripts, loading, initializeUser, user, isPremium, limits } = useScriptStore();
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [streak, setStreak] = useState<any>(null);
  
  // Hidden debug screen - tap logo 5x
  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<NodeJS.Timeout | null>(null);
  
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    
    if (logoTapTimer.current) {
      clearTimeout(logoTapTimer.current);
    }
    
    if (logoTapCount.current >= 5) {
      logoTapCount.current = 0;
      router.push('/debug');
    } else {
      logoTapTimer.current = setTimeout(() => {
        logoTapCount.current = 0;
      }, 2000);
    }
  };

  // Check if onboarding should be shown on first launch
  useEffect(() => {
    const checkOnboarding = async () => {
      const showOnboarding = await shouldShowOnboarding();
      if (showOnboarding) {
        router.replace('/onboarding');
      } else {
        setCheckingOnboarding(false);
      }
    };
    checkOnboarding();
  }, []);

  const initialize = useCallback(async () => {
    await initializeUser();
    await fetchScripts();
    // Fetch streak
    try {
      const deviceId = await AsyncStorage.getItem('device_id');
      if (deviceId && BACKEND_URL) {
        const res = await axios.get(`${BACKEND_URL}/api/streak/${deviceId}`, { timeout: 10000 });
        setStreak(res.data);
      }
    } catch (e) { /* streak is non-critical */ }
  }, [initializeUser, fetchScripts]);

  useEffect(() => {
    if (!checkingOnboarding) {
      initialize();
    }
  }, [initialize, checkingOnboarding]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchScripts();
    setRefreshing(false);
  };

  // Show loading while checking onboarding status
  if (checkingOnboarding) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </SafeAreaView>
    );
  }

  const recentScript = scripts.length > 0 ? scripts[0] : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity style={styles.logoContainer} onPress={handleLogoTap} activeOpacity={0.8}>
              <Ionicons name="mic" size={32} color="#6366f1" />
              <Text style={styles.logoText}>ScriptM8</Text>
            </TouchableOpacity>
            <View style={styles.headerButtons}>
              <TouchableOpacity 
                style={styles.headerButton}
                onPress={safeHandler(() => router.push('/stats'), 'Navigate to Stats')}
              >
                <Ionicons name="stats-chart" size={24} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.headerButton}
                onPress={safeHandler(() => router.push('/support'), 'Navigate to Support')}
              >
                <Ionicons name="help-circle-outline" size={24} color="#6b7280" />
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.headerButton}
                onPress={safeHandler(() => router.push('/profile'), 'Navigate to Profile')}
              >
                <Ionicons name="person-circle-outline" size={26} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.tagline}>AI Training Studio for Actors</Text>
        </View>

        {/* Premium Banner */}
        {!isPremium && (
          <TouchableOpacity 
            style={styles.premiumBanner}
            onPress={() => router.push('/paywall')}
            activeOpacity={0.8}
          >
            <View style={styles.premiumBannerContent}>
              <Ionicons name="star" size={24} color="#f59e0b" />
              <View style={styles.premiumBannerText}>
                <Text style={styles.premiumBannerTitle}>Unlock Premium</Text>
                <Text style={styles.premiumBannerSubtitle}>
                  Unlimited scripts, 6 AI voices, all modes
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#f59e0b" />
          </TouchableOpacity>
        )}

        {/* Premium Status Badge */}
        {isPremium && (
          <TouchableOpacity 
            style={styles.premiumStatusBadge}
            onPress={() => router.push('/premium')}
          >
            <Ionicons name="star" size={16} color="#f59e0b" />
            <Text style={styles.premiumStatusText}>Premium Active</Text>
          </TouchableOpacity>
        )}

        {/* Quick Actions — Top Priority */}
        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={[styles.quickActionBtn, styles.quickRehearseBtn]}
            onPress={() => {
              if (recentScript) {
                router.push(`/script/${recentScript.id}`);
              } else {
                router.push('/scripts');
              }
            }}
            activeOpacity={0.8}
            testID="quick-rehearse-btn"
          >
            <Ionicons name="flash" size={32} color="#fff" />
            <Text style={styles.quickActionTitle}>Quick Rehearse</Text>
            <Text style={styles.quickActionSub}>
              {recentScript ? 'Resume last script' : 'Select a script'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.quickActionBtn, styles.quickSelfTapeBtn]}
            onPress={() => router.push('/selftape')}
            activeOpacity={0.8}
            testID="quick-selftape-btn"
          >
            <Ionicons name="videocam" size={32} color="#fff" />
            <Text style={styles.quickActionTitle}>Quick Self Tape</Text>
            <Text style={styles.quickActionSub}>Start recording now</Text>
          </TouchableOpacity>
        </View>

        {/* Streak Banner */}
        {streak && streak.current_streak > 0 && (
          <View style={styles.streakRow}>
            <Ionicons name="flame" size={20} color="#f59e0b" />
            <Text style={styles.streakText}>{streak.current_streak} day streak</Text>
            <Text style={styles.streakXp}>{streak.total_xp} XP</Text>
          </View>
        )}

        {/* Daily Actor Drill — Featured */}
        <TouchableOpacity
          style={styles.drillCard}
          onPress={() => router.push('/daily-drill')}
          activeOpacity={0.8}
          testID="daily-drill-btn"
        >
          <View style={styles.drillIcon}>
            <Ionicons name="flame" size={28} color="#f59e0b" />
          </View>
          <View style={styles.drillContent}>
            <Text style={styles.drillTitle}>Daily Actor Drill</Text>
            <Text style={styles.drillSubtitle}>
              {streak?.today_completed ? 'Completed today!' : 'New challenge ready'}
            </Text>
          </View>
          {streak?.today_completed ? (
            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
          ) : (
            <View style={styles.xpBadge}>
              <Text style={styles.xpText}>+25 XP</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Training Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training</Text>
          <View style={styles.tileRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/acting-coach')}
              activeOpacity={0.8}
              testID="acting-coach-tile"
            >
              <Ionicons name="school" size={28} color="#8b5cf6" />
              <Text style={styles.tileTitle}>Acting Coach</Text>
              <Text style={styles.tileDesc}>AI scene feedback</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/dialect-coach')}
              activeOpacity={0.8}
              testID="dialect-coach-tile"
            >
              <Ionicons name="mic" size={28} color="#ec4899" />
              <Text style={styles.tileTitle}>Dialect Coach</Text>
              <Text style={styles.tileDesc}>Accent training</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Rehearsal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rehearsal</Text>
          <View style={styles.tileRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/scripts')}
              activeOpacity={0.8}
              testID="practice-scene-tile"
            >
              <Ionicons name="chatbubbles" size={28} color="#10b981" />
              <Text style={styles.tileTitle}>Practice Scene</Text>
              <Text style={styles.tileDesc}>Run with AI partner</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/upload')}
              activeOpacity={0.8}
              testID="scripts-tile"
            >
              <Ionicons name="document-text" size={28} color="#3b82f6" />
              <Text style={styles.tileTitle}>Scripts</Text>
              <Text style={styles.tileDesc}>Upload & parse</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recording Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recording</Text>
          <View style={styles.tileRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/selftape')}
              activeOpacity={0.8}
              testID="selftape-studio-tile"
            >
              <Ionicons name="videocam" size={28} color="#ef4444" />
              <Text style={styles.tileTitle}>Self Tape Studio</Text>
              <Text style={styles.tileDesc}>Record auditions</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/voice-studio')}
              activeOpacity={0.8}
              testID="voice-studio-tile"
            >
              <Ionicons name="mic-circle" size={28} color="#6366f1" />
              <Text style={styles.tileTitle}>Voice Studio</Text>
              <Text style={styles.tileDesc}>Voice-over recording</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tools Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tools</Text>
          <View style={styles.tileRow}>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/auditions')}
              activeOpacity={0.8}
              testID="audition-tracker-tile"
            >
              <Ionicons name="calendar" size={28} color="#f59e0b" />
              <Text style={styles.tileTitle}>Audition Tracker</Text>
              <Text style={styles.tileDesc}>Track submissions</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tile}
              onPress={() => router.push('/scripts')}
              activeOpacity={0.8}
              testID="my-scripts-tile"
            >
              <Ionicons name="library" size={28} color="#6366f1" />
              <Text style={styles.tileTitle}>My Scripts</Text>
              <Text style={styles.tileDesc}>{scripts.length} saved</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { paddingTop: 20, paddingBottom: 24, alignItems: 'center' },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 8 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { padding: 8 },
  logoContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  tagline: { fontSize: 16, color: '#6b7280', marginTop: 8 },
  premiumBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12, padding: 14, marginBottom: 20,
  },
  premiumBannerContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  premiumBannerText: { marginLeft: 12, flex: 1 },
  premiumBannerTitle: { fontSize: 16, fontWeight: '600', color: '#f59e0b' },
  premiumBannerSubtitle: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  premiumStatusBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, marginBottom: 16, gap: 6,
  },
  premiumStatusText: { color: '#f59e0b', fontSize: 13, fontWeight: '600' },
  // Quick Actions
  quickActionsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  quickActionBtn: {
    flex: 1, borderRadius: 16, padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 140,
  },
  quickRehearseBtn: { backgroundColor: '#6366f1' },
  quickSelfTapeBtn: { backgroundColor: '#ef4444' },
  quickActionTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 10 },
  quickActionSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4, textAlign: 'center' },
  // Streak
  streakRow: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, marginBottom: 20,
  },
  streakText: { fontSize: 14, fontWeight: '600', color: '#f59e0b' },
  streakXp: { fontSize: 12, color: '#9ca3af', marginLeft: 4 },
  // Daily Drill
  drillCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 14,
    padding: 16, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  drillIcon: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  drillContent: { flex: 1, marginLeft: 14 },
  drillTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  drillSubtitle: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  xpBadge: { backgroundColor: 'rgba(245, 158, 11, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  xpText: { fontSize: 12, fontWeight: '600', color: '#f59e0b' },
  // Sections
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 12 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1, backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#2a2a3e', alignItems: 'center',
  },
  tileTitle: { fontSize: 14, fontWeight: '600', color: '#fff', marginTop: 10, textAlign: 'center' },
  tileDesc: { fontSize: 11, color: '#6b7280', marginTop: 3, textAlign: 'center' },
});
