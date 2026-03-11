import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { router } from 'expo-router';
import { API_BASE_URL } from '../services/apiConfig';
import { useScriptStore } from '../store/scriptStore';
import { safeHandler } from '../services/debugService';
import { shouldShowOnboarding } from '../components/OnboardingTutorial';

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';


export default function HomeScreen() {
  const { scripts, fetchScripts, initializeUser, isPremium } = useScriptStore();
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [streak, setStreak] = useState<any>(null);

  const logoTapCount = useRef(0);
  const logoTapTimer = useRef<NodeJS.Timeout | null>(null);
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimer.current) clearTimeout(logoTapTimer.current);
    if (logoTapCount.current >= 5) { logoTapCount.current = 0; router.push('/debug'); }
    else { logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0; }, 2000); }
  };

  useEffect(() => {
    (async () => {
      if (await shouldShowOnboarding()) router.replace('/onboarding');
      else setCheckingOnboarding(false);
    })();
  }, []);

  const initialize = useCallback(async () => {
    await initializeUser();
    await fetchScripts();
    try {
      const id = await AsyncStorage.getItem('device_id');
      if (id && API_BASE_URL) {
        const r = await axios.get(`${API_BASE_URL}/api/streak/${id}`, { timeout: 10000 });
        setStreak(r.data);
        console.log(`[Home] Streak loaded: ${r.data.current_streak} day streak`);
      }
    } catch (e: any) {
      console.warn(`[Home] Streak fetch failed: ${e?.message || e}`);
    }
  }, [initializeUser, fetchScripts]);

  useEffect(() => { if (!checkingOnboarding) initialize(); }, [initialize, checkingOnboarding]);

  const onRefresh = async () => { setRefreshing(true); await initialize(); setRefreshing(false); };

  if (checkingOnboarding) {
    return <SafeAreaView style={st.bg}><View style={st.center}><ActivityIndicator size="large" color="#6366f1" /></View></SafeAreaView>;
  }

  const recent = scripts.length > 0 ? scripts[0] : null;

  return (
    <SafeAreaView style={st.bg}>
      <ScrollView style={st.flex} contentContainerStyle={st.pad} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}>

        {/* Header */}
        <View style={st.hdr}>
          <TouchableOpacity style={st.logo} onPress={handleLogoTap} activeOpacity={0.8}>
            <View style={st.logoIc}><Ionicons name="mic" size={18} color="#fff" /></View>
            <Text style={st.logoTx}>ScriptM8</Text>
          </TouchableOpacity>
          <View style={st.hdrR}>
            {streak?.current_streak > 0 && (
              <TouchableOpacity style={st.streakPill} onPress={() => router.push('/daily-drill')} data-testid="streak-pill">
                <Ionicons name="flame" size={14} color="#f59e0b" />
                <Text style={st.streakN}>{streak.current_streak}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={st.hdrBtn} onPress={safeHandler(() => router.push('/stats'), 'Stats')} data-testid="header-stats-btn">
              <Ionicons name="stats-chart" size={18} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity style={st.hdrBtn} onPress={safeHandler(() => router.push('/profile'), 'Profile')} data-testid="header-profile-btn">
              <Ionicons name="person-circle" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Premium */}
        {!isPremium ? (
          <TouchableOpacity style={st.pro} onPress={() => router.push('/premium')} activeOpacity={0.85} data-testid="premium-banner">
            <View style={st.proGlow} />
            <View style={st.proRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.proTag}>PRO</Text>
                <Text style={st.proH}>Unlock Full Studio</Text>
                <Text style={st.proSub}>Unlimited scripts, AI voices, all tools</Text>
              </View>
              <View style={st.proArr}><Ionicons name="arrow-forward" size={16} color="#000" /></View>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={st.proBadge} onPress={() => router.push('/premium')} data-testid="premium-active-badge">
            <Ionicons name="star" size={12} color="#f59e0b" /><Text style={st.proBadgeTx}>Premium</Text>
          </TouchableOpacity>
        )}

        {/* ─── QUICK REHEARSE — hero ─── */}
        <TouchableOpacity
          style={st.hero}
          onPress={() => recent ? router.push(`/script/${recent.id}?autoStart=true`) : router.push('/scripts')}
          activeOpacity={0.85}
          data-testid="quick-rehearse-btn"
        >
          <View style={st.heroTop}>
            <View style={st.heroIc}><Ionicons name="flash" size={26} color="#fff" /></View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
          </View>
          <Text style={st.heroH}>Quick Rehearse</Text>
          <Text style={st.heroSub} numberOfLines={1}>{recent ? recent.title : 'Select a script to begin'}</Text>
        </TouchableOpacity>

        {/* ─── 4-TOOL GRID — Acting Coach, Dialect Coach, Self Tape, New Script ─── */}
        <View style={st.grid4}>
          <ToolCard icon="school"     color="#8b5cf6" label="Acting Coach"  route="/acting-coach"   testId="acting-coach-btn" />
          <ToolCard icon="mic"        color="#ec4899" label="Dialect Coach" route="/dialect-coach"   testId="dialect-coach-btn" />
          <ToolCard icon="videocam"   color="#ef4444" label="Self Tape"     route="/selftape"        testId="selftape-btn" />
          <ToolCard icon="add-circle" color="#10b981" label="New Script"    route="/script-parser"   testId="new-script-btn" />
        </View>

        {/* ─── RECALL + MY SCRIPTS row ─── */}
        <View style={st.dualRow}>
          <TouchableOpacity style={st.dualCard} onPress={() => router.push('/recall')} activeOpacity={0.85} data-testid="recall-btn">
            <View style={[st.dualIc, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
              <Ionicons name="bulb" size={22} color="#f59e0b" />
            </View>
            <Text style={st.dualH}>Recall</Text>
            <Text style={st.dualSub}>Line memory</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.dualCard} onPress={() => router.push('/scripts')} activeOpacity={0.85} data-testid="my-scripts-btn">
            <View style={[st.dualIc, { backgroundColor: 'rgba(99,102,241,0.12)' }]}>
              <Ionicons name="library" size={22} color="#6366f1" />
            </View>
            <Text style={st.dualH}>My Scripts</Text>
            <Text style={st.dualSub}>{scripts.length} saved</Text>
          </TouchableOpacity>
        </View>

        {/* ─── DAILY DRILL ─── */}
        {!streak?.today_completed && (
          <TouchableOpacity style={st.drill} onPress={() => router.push('/daily-drill')} activeOpacity={0.85} data-testid="daily-drill-banner">
            <View style={st.drillL}>
              <View style={st.drillIc}><Ionicons name="flame" size={18} color="#f59e0b" /></View>
              <View><Text style={st.drillH}>Daily Drill</Text><Text style={st.drillS}>Today's challenge</Text></View>
            </View>
            <View style={st.drillXp}><Text style={st.drillXpTx}>+25 XP</Text></View>
          </TouchableOpacity>
        )}

        {/* ─── MORE TOOLS ─── */}
        <Text style={st.secLabel}>More</Text>
        <NavRow icon="cloud-upload" color="#3b82f6" title="Upload Script"    sub="PDF, DOCX, TXT"          route="/upload"       testId="upload-row" />
        <NavRow icon="mic-circle"   color="#6366f1" title="Voice Studio"     sub="Record & build demo reels" route="/voice-studio" testId="voice-studio-row" />
        <NavRow icon="calendar"     color="#f59e0b" title="Auditions"        sub="Track your submissions"   route="/auditions"    testId="auditions-row" />
        <NavRow icon="bar-chart"    color="#10b981" title="Dashboard"        sub="Progress & stats"         route="/dashboard"    testId="dashboard-row" />
        <NavRow icon="help-circle"  color="#6b7280" title="Support"          route="/support"               testId="support-row" />

        <View style={{ height: 36 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Tool Card (2x2 grid) ── */
function ToolCard({ icon, color, label, route, testId }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; label: string; route: string; testId: string;
}) {
  return (
    <TouchableOpacity style={st.toolCard} onPress={() => router.push(route as any)} activeOpacity={0.85} data-testid={testId}>
      <View style={[st.toolIc, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={st.toolLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ── Nav Row (compact list item) ── */
function NavRow({ icon, color, title, sub, route, testId }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub?: string; route: string; testId: string;
}) {
  return (
    <TouchableOpacity style={st.navRow} onPress={() => router.push(route as any)} activeOpacity={0.8} data-testid={testId}>
      <View style={[st.navIc, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={st.navTx}>
        <Text style={st.navH}>{title}</Text>
        {sub ? <Text style={st.navSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color="#4b5563" />
    </TouchableOpacity>
  );
}

/* ── Styles ── */
const CARD_BG = '#12121e';
const BORDER = '#1c1c2e';

const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#08080e' },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pad: { paddingHorizontal: 18, paddingBottom: 44 },

  // Header
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingBottom: 18 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoIc: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  logoTx: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  hdrR: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  hdrBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: CARD_BG, alignItems: 'center', justifyContent: 'center' },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12 },
  streakN: { fontSize: 12, fontWeight: '700', color: '#f59e0b' },

  // Premium
  pro: { borderRadius: 14, overflow: 'hidden', marginBottom: 18, backgroundColor: '#f59e0b' },
  proGlow: { position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.12)' },
  proRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  proTag: { fontSize: 10, fontWeight: '800', color: '#000', backgroundColor: 'rgba(0,0,0,0.1)', alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, marginBottom: 5, letterSpacing: 1 },
  proH: { fontSize: 17, fontWeight: '800', color: '#000' },
  proSub: { fontSize: 11, color: 'rgba(0,0,0,0.55)', marginTop: 2 },
  proArr: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.08)', alignItems: 'center', justifyContent: 'center' },
  proBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, marginBottom: 14 },
  proBadgeTx: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },

  // Hero — Quick Rehearse
  hero: { backgroundColor: '#6366f1', borderRadius: 20, padding: 22, marginBottom: 14 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  heroIc: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroH: { fontSize: 22, fontWeight: '800', color: '#fff' },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },

  // 4-tool grid
  grid4: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  toolCard: { width: '48%', flexGrow: 1, backgroundColor: CARD_BG, borderRadius: 16, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  toolIc: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  toolLabel: { fontSize: 13, fontWeight: '700', color: '#fff', textAlign: 'center' },

  // Dual row — Recall + My Scripts
  dualRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  dualCard: { flex: 1, backgroundColor: CARD_BG, borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  dualIc: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  dualH: { fontSize: 14, fontWeight: '700', color: '#fff' },
  dualSub: { fontSize: 11, color: '#6b7280', marginTop: 2 },

  // Daily Drill
  drill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD_BG, borderRadius: 14, padding: 13, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(245,158,11,0.12)' },
  drillL: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  drillIc: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(245,158,11,0.1)', alignItems: 'center', justifyContent: 'center' },
  drillH: { fontSize: 14, fontWeight: '700', color: '#fff' },
  drillS: { fontSize: 11, color: '#6b7280', marginTop: 1 },
  drillXp: { backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  drillXpTx: { fontSize: 11, fontWeight: '700', color: '#f59e0b' },

  // Section label
  secLabel: { fontSize: 12, fontWeight: '700', color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10, marginTop: 4 },

  // Nav rows
  navRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD_BG, borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: BORDER },
  navIc: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navTx: { flex: 1, marginLeft: 10 },
  navH: { fontSize: 14, fontWeight: '600', color: '#fff' },
  navSub: { fontSize: 11, color: '#6b7280', marginTop: 1 },
});
