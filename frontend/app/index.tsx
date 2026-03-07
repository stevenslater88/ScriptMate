import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
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

const { width: SCREEN_W } = Dimensions.get('window');

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
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) {
      logoTapCount.current = 0;
      router.push('/debug');
    } else {
      logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 2000);
    }
  };

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
    try {
      const deviceId = await AsyncStorage.getItem('device_id');
      if (deviceId && BACKEND_URL) {
        const res = await axios.get(`${BACKEND_URL}/api/streak/${deviceId}`, { timeout: 10000 });
        setStreak(res.data);
      }
    } catch (e) { /* streak is non-critical */ }
  }, [initializeUser, fetchScripts]);

  useEffect(() => {
    if (!checkingOnboarding) initialize();
  }, [initialize, checkingOnboarding]);

  const onRefresh = async () => {
    setRefreshing(true);
    await initialize();
    setRefreshing(false);
  };

  if (checkingOnboarding) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </SafeAreaView>
    );
  }

  const recentScript = scripts.length > 0 ? scripts[0] : null;

  return (
    <SafeAreaView style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity style={s.logoWrap} onPress={handleLogoTap} activeOpacity={0.8}>
            <View style={s.logoIcon}>
              <Ionicons name="mic" size={20} color="#fff" />
            </View>
            <Text style={s.logoText}>ScriptM8</Text>
          </TouchableOpacity>
          <View style={s.headerRight}>
            {streak && streak.current_streak > 0 && (
              <TouchableOpacity style={s.streakPill} onPress={() => router.push('/daily-drill')} data-testid="streak-pill">
                <Ionicons name="flame" size={14} color="#f59e0b" />
                <Text style={s.streakNum}>{streak.current_streak}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.headerBtn} onPress={safeHandler(() => router.push('/stats'), 'Stats')} data-testid="header-stats-btn">
              <Ionicons name="stats-chart" size={20} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity style={s.headerBtn} onPress={safeHandler(() => router.push('/profile'), 'Profile')} data-testid="header-profile-btn">
              <Ionicons name="person-circle" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Premium CTA ── */}
        {!isPremium && (
          <TouchableOpacity style={s.premiumCard} onPress={() => router.push('/paywall')} activeOpacity={0.85} data-testid="premium-banner">
            <View style={s.premiumGlow} />
            <View style={s.premiumInner}>
              <View style={s.premiumLeft}>
                <Text style={s.premiumLabel}>PRO</Text>
                <Text style={s.premiumTitle}>Unlock Full Studio</Text>
                <Text style={s.premiumSub}>Unlimited scripts, 6 AI voices, all coaching tools</Text>
              </View>
              <View style={s.premiumArrow}>
                <Ionicons name="arrow-forward" size={18} color="#000" />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {isPremium && (
          <TouchableOpacity style={s.proBadge} onPress={() => router.push('/premium')} data-testid="premium-active-badge">
            <Ionicons name="star" size={13} color="#f59e0b" />
            <Text style={s.proBadgeText}>Premium Active</Text>
          </TouchableOpacity>
        )}

        {/* ── Primary Actions ── */}
        <View style={s.heroRow}>
          <TouchableOpacity
            style={[s.heroCard, { backgroundColor: '#6366f1' }]}
            onPress={() => recentScript ? router.push(`/script/${recentScript.id}?autoStart=true`) : router.push('/scripts')}
            activeOpacity={0.85}
            data-testid="quick-rehearse-btn"
          >
            <View style={s.heroIconWrap}>
              <Ionicons name="flash" size={28} color="#fff" />
            </View>
            <Text style={s.heroTitle}>Quick Rehearse</Text>
            <Text style={s.heroSub} numberOfLines={1}>
              {recentScript ? recentScript.title : 'Pick a script'}
            </Text>
          </TouchableOpacity>

          <View style={s.heroCol}>
            <TouchableOpacity
              style={[s.heroHalf, { backgroundColor: '#ef4444' }]}
              onPress={() => router.push('/selftape')}
              activeOpacity={0.85}
              data-testid="quick-selftape-btn"
            >
              <Ionicons name="videocam" size={22} color="#fff" />
              <Text style={s.heroHalfTitle}>Self Tape</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.heroHalf, { backgroundColor: '#10b981' }]}
              onPress={() => router.push('/script-parser')}
              activeOpacity={0.85}
              data-testid="new-script-btn"
            >
              <Ionicons name="add-circle" size={22} color="#fff" />
              <Text style={s.heroHalfTitle}>New Script</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Daily Drill ── */}
        {(!streak?.today_completed) && (
          <TouchableOpacity style={s.drillBanner} onPress={() => router.push('/daily-drill')} activeOpacity={0.85} data-testid="daily-drill-banner">
            <View style={s.drillLeft}>
              <View style={s.drillIcon}>
                <Ionicons name="flame" size={20} color="#f59e0b" />
              </View>
              <View>
                <Text style={s.drillTitle}>Daily Drill</Text>
                <Text style={s.drillSub}>Complete today's challenge</Text>
              </View>
            </View>
            <View style={s.drillXp}>
              <Text style={s.drillXpText}>+25 XP</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* ── Coaching ── */}
        <Text style={s.sectionLabel}>Coaching</Text>
        <View style={s.coachRow}>
          <CoachCard
            icon="school"
            color="#8b5cf6"
            title="Acting Coach"
            sub="AI scene feedback"
            route="/acting-coach"
            testId="acting-coach-tile"
          />
          <CoachCard
            icon="mic"
            color="#ec4899"
            title="Dialect Coach"
            sub="Accent training"
            route="/dialect-coach"
            testId="dialect-coach-tile"
          />
          <CoachCard
            icon="bulb"
            color="#f59e0b"
            title="Recall"
            sub="Line memory"
            route="/recall"
            testId="recall-tile"
          />
        </View>

        {/* ── Library ── */}
        <Text style={s.sectionLabel}>Library</Text>
        <ListRow icon="library" color="#6366f1" title="My Scripts" badge={scripts.length > 0 ? `${scripts.length}` : undefined} route="/scripts" testId="my-scripts-row" />
        <ListRow icon="cloud-upload" color="#3b82f6" title="Upload Script" sub="PDF, DOCX, TXT" route="/upload" testId="upload-script-row" />
        <ListRow icon="mic-circle" color="#6366f1" title="Voice Studio" sub="Record & build demo reels" route="/voice-studio" testId="voice-studio-row" />

        {/* ── Career ── */}
        <Text style={s.sectionLabel}>Career</Text>
        <ListRow icon="calendar" color="#f59e0b" title="Auditions" sub="Track submissions" route="/auditions" testId="auditions-row" />
        <ListRow icon="stats-chart" color="#10b981" title="Dashboard" sub="Progress & stats" route="/dashboard" testId="dashboard-row" />

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Sub-components ── */

function CoachCard({ icon, color, title, sub, route, testId }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub: string; route: string; testId: string;
}) {
  return (
    <TouchableOpacity style={s.coachCard} onPress={() => router.push(route as any)} activeOpacity={0.85} data-testid={testId}>
      <View style={[s.coachIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={s.coachTitle}>{title}</Text>
      <Text style={s.coachSub}>{sub}</Text>
    </TouchableOpacity>
  );
}

function ListRow({ icon, color, title, sub, badge, route, testId }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub?: string; badge?: string; route: string; testId: string;
}) {
  return (
    <TouchableOpacity style={s.listRow} onPress={() => router.push(route as any)} activeOpacity={0.8} data-testid={testId}>
      <View style={[s.listIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={s.listContent}>
        <Text style={s.listTitle}>{title}</Text>
        {sub && <Text style={s.listSub}>{sub}</Text>}
      </View>
      {badge && (
        <View style={s.listBadge}>
          <Text style={s.listBadgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color="#4b5563" />
    </TouchableOpacity>
  );
}

/* ── Styles ── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090f' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingBottom: 20 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#161622', alignItems: 'center', justifyContent: 'center' },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  streakNum: { fontSize: 13, fontWeight: '700', color: '#f59e0b' },

  // Premium
  premiumCard: { borderRadius: 16, overflow: 'hidden', marginBottom: 20, backgroundColor: '#f59e0b' },
  premiumGlow: { position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.15)' },
  premiumInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
  premiumLeft: { flex: 1 },
  premiumLabel: { fontSize: 11, fontWeight: '800', color: '#000', backgroundColor: 'rgba(0,0,0,0.12)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 6, letterSpacing: 1 },
  premiumTitle: { fontSize: 18, fontWeight: '800', color: '#000' },
  premiumSub: { fontSize: 12, color: 'rgba(0,0,0,0.6)', marginTop: 3 },
  premiumArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  proBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginBottom: 16 },
  proBadgeText: { fontSize: 12, fontWeight: '700', color: '#f59e0b' },

  // Hero
  heroRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  heroCard: { flex: 1, borderRadius: 18, padding: 20, justifyContent: 'flex-end', minHeight: 160 },
  heroIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 3 },
  heroCol: { flex: 1, gap: 12 },
  heroHalf: { flex: 1, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroHalfTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Daily Drill
  drillBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#161622', borderRadius: 14, padding: 14, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)' },
  drillLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drillIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center' },
  drillTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  drillSub: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  drillXp: { backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  drillXpText: { fontSize: 12, fontWeight: '700', color: '#f59e0b' },

  // Section
  sectionLabel: { fontSize: 14, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 },

  // Coach cards
  coachRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  coachCard: { flex: 1, backgroundColor: '#161622', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1e1e30' },
  coachIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  coachTitle: { fontSize: 13, fontWeight: '700', color: '#fff', textAlign: 'center' },
  coachSub: { fontSize: 11, color: '#6b7280', marginTop: 2, textAlign: 'center' },

  // List rows
  listRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161622', borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#1e1e30' },
  listIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  listContent: { flex: 1, marginLeft: 12 },
  listTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  listSub: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  listBadge: { backgroundColor: 'rgba(99,102,241,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 8 },
  listBadgeText: { fontSize: 11, fontWeight: '700', color: '#6366f1' },
});
