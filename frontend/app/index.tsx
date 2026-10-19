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
import { getAuthHeader } from '../services/authClient';
import { useScriptStore } from '../store/scriptStore';
import { safeHandler } from '../services/debugService';
import { shouldShowOnboarding } from '../components/OnboardingTutorial';

import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRADIENT, TYPE, tint } from '../constants/cinematicTheme';
import { IconButton, IconWell, Pill, ScreenGlow, SectionLabel } from '../components/cinematic';


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
        const r = await axios.get(`${API_BASE_URL}/api/streak/${id}`, {
          headers: await getAuthHeader(),
          timeout: 10000,
        });
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
    return <SafeAreaView style={st.bg}><View style={st.center}><ActivityIndicator size="large" color={C.violet} /></View></SafeAreaView>;
  }

  const recent = scripts.length > 0 ? scripts[0] : null;

  const recentMeta = recent
    ? `${recent.characters?.length || 0} characters · ${recent.lines?.length || 0} lines`
    : 'Select a script to begin';

  return (
    <SafeAreaView style={st.bg}>
      <ScreenGlow />
      <ScrollView style={st.flex} contentContainerStyle={st.pad} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.violet} />}>

        {/* Header */}
        <View style={st.hdr}>
          <TouchableOpacity style={st.logo} onPress={handleLogoTap} activeOpacity={0.8}>
            <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.logoIc}>
              <Ionicons name="mic" size={17} color="#fff" />
            </LinearGradient>
            <Text style={st.logoTx}>ScriptM8</Text>
          </TouchableOpacity>
          <View style={st.hdrR}>
            {isPremium && (
              <TouchableOpacity onPress={() => router.push('/premium')} data-testid="premium-active-badge">
                <Pill label="Pro" icon="sparkles" />
              </TouchableOpacity>
            )}
            {streak?.current_streak > 0 && (
              <TouchableOpacity style={st.streakPill} onPress={() => router.push('/daily-drill')} data-testid="streak-pill">
                <Ionicons name="flame" size={13} color={C.ember} />
                <Text style={st.streakN}>{streak.current_streak}</Text>
              </TouchableOpacity>
            )}
            <IconButton icon="stats-chart" onPress={safeHandler(() => router.push('/stats'), 'Stats')} testID="header-stats-btn" />
            <IconButton icon="person-circle" onPress={safeHandler(() => router.push('/profile'), 'Profile')} testID="header-profile-btn" />
          </View>
        </View>

        {/* ─── QUICK REHEARSE — hero ─── */}
        <SectionLabel style={st.secGap}>{recent ? 'Continue rehearsing' : 'Get started'}</SectionLabel>
        <TouchableOpacity
          style={st.hero}
          onPress={() => recent ? router.push(`/script/${recent.id}?autoStart=true`) : router.push('/scripts')}
          activeOpacity={0.88}
          data-testid="quick-rehearse-btn"
        >
          <LinearGradient colors={GRADIENT.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.heroGrad}>
            <View style={st.heroOrb} />
            <View style={st.heroTop}>
              <Pill label="Quick Rehearse" icon="flash" color="#DCD6FF" />
              <Ionicons name="chevron-forward" size={18} color="#BDB4FF" />
            </View>
            <Text style={st.heroH} numberOfLines={2}>{recent ? recent.title : 'Your next scene'}</Text>
            <Text style={st.heroSub} numberOfLines={1}>{recentMeta}</Text>
            <View style={st.heroBtn}>
              <Ionicons name={recent ? 'play' : 'library'} size={16} color="#20155A" />
              <Text style={st.heroBtnTx}>{recent ? 'Resume scene' : 'Choose a script'}</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* ─── 6-TOOL GRID (3 cols × 2 rows) — Self Tape, Voice Studio,
                  New Script, My Scripts, Recall, Auditions ─── */}
        <SectionLabel style={st.secGap}>Studio tools</SectionLabel>
        <View style={st.grid3x2}>
          <ToolCard icon="videocam"    color={C.danger}     label="Self Tape"     route="/selftape"      testId="selftape-btn" />
          <ToolCard icon="mic-circle"  color={C.violetSoft} label="Voice Studio"  route="/voice-studio"  testId="voice-studio-btn" />
          <ToolCard icon="add-circle"  color={C.cyan}       label="New Script"    route="/script-parser" testId="new-script-btn" />
          <ToolCard icon="library"     color={C.blueSoft}   label="My Scripts"    route="/scripts"       testId="my-scripts-btn" />
          <ToolCard icon="bulb"        color={C.success}    label="Recall"        route="/recall"        testId="recall-btn" />
          <ToolCard icon="calendar"    color="#C3B6FF"      label="Auditions"     route="/auditions"     testId="auditions-btn" />
        </View>

        {/* ─── DAILY DRILL ─── */}
        {!streak?.today_completed && (
          <TouchableOpacity style={st.drill} onPress={() => router.push('/daily-drill')} activeOpacity={0.85} data-testid="daily-drill-banner">
            <View style={st.drillL}>
              <IconWell icon="flame" color={C.ember} size={36} />
              <View><Text style={st.drillH}>Daily Drill</Text><Text style={st.drillS}>Today's challenge</Text></View>
            </View>
            <Pill label="+25 XP" style={{ alignSelf: 'center' }} />
          </TouchableOpacity>
        )}

        {/* Premium */}
        {!isPremium && (
          <TouchableOpacity style={st.pro} onPress={() => router.push('/premium')} activeOpacity={0.85} data-testid="premium-banner">
            <LinearGradient colors={GRADIENT.proBanner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.proRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.proTag}>PRO</Text>
                <Text style={st.proH}>Unlock Full Studio</Text>
                <Text style={st.proSub}>Unlimited scripts, AI voices, all tools</Text>
              </View>
              <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.proArr}>
                <Ionicons name="arrow-forward" size={17} color="#fff" />
              </LinearGradient>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* ─── MORE TOOLS ─── */}
        {/* Upload stays reachable via New Script (/script-parser); /upload route is kept. */}
        <Text style={st.secLabel}>More</Text>
        <NavRow icon="bar-chart"    color={C.success}  title="Dashboard"        sub="Progress & stats"         route="/dashboard"    testId="dashboard-row" />
        <NavRow icon="help-circle"  color={C.muted}    title="Support"          route="/support"               testId="support-row" />

        <View style={{ height: 36 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Tool Card (3x2 grid) ── */
function ToolCard({ icon, color, label, route, testId }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; label: string; route: string; testId: string;
}) {
  return (
    <TouchableOpacity style={st.toolCard} onPress={() => router.push(route as any)} activeOpacity={0.85} data-testid={testId}>
      <IconWell icon={icon} color={color} size={36} />
      <Text style={st.toolLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ── Nav Row (compact list item) ── */
function NavRow({ icon, color, title, sub, route, testId }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; title: string; sub?: string; route: string; testId: string;
}) {
  return (
    <TouchableOpacity style={st.navRow} onPress={() => router.push(route as any)} activeOpacity={0.8} data-testid={testId}>
      <IconWell icon={icon} color={color} size={36} />
      <View style={st.navTx}>
        <Text style={st.navH}>{title}</Text>
        {sub ? <Text style={st.navSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={C.dim} />
    </TouchableOpacity>
  );
}

/* ── Styles ── */
const st = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.ink },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pad: { paddingHorizontal: 18, paddingBottom: 44 },
  secGap: { marginBottom: 9 },

  // Header
  hdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingBottom: 20 },
  logo: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoIc: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoTx: { ...TYPE.title, fontSize: 21 },
  hdrR: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  streakPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: tint(C.ember, 0.12), paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  streakN: { fontSize: 12, fontWeight: '800', color: C.ember },

  // Hero — Quick Rehearse
  hero: { borderRadius: 22, overflow: 'hidden', marginBottom: 22, borderWidth: 1, borderColor: 'rgba(160,140,255,0.25)' },
  heroGrad: { padding: 18 },
  heroOrb: { position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(98,224,255,0.12)' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  heroH: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.4 },
  heroSub: { fontSize: 13, color: '#BFB8EE', marginTop: 4 },
  heroBtn: { marginTop: 16, height: 44, borderRadius: 13, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  heroBtnTx: { fontSize: 14, fontWeight: '800', color: '#20155A' },

  // 3-cols × 2-rows grid for the 6 primary actor tools; flexGrow keeps the last row full-width.
  grid3x2: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 14 },
  toolCard: { width: '31%', flexGrow: 1, minHeight: 92, backgroundColor: C.surface, borderRadius: 16, padding: 12, justifyContent: 'space-between', borderWidth: 1, borderColor: C.line },
  toolLabel: { fontSize: 13, fontWeight: '700', color: C.text, marginTop: 10 },

  // Daily Drill
  drill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface, borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.line },
  drillL: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  drillH: { fontSize: 14, fontWeight: '700', color: C.text },
  drillS: { fontSize: 11.5, color: C.muted, marginTop: 1 },

  // Premium banner
  pro: { borderRadius: 16, overflow: 'hidden', marginBottom: 22, borderWidth: 1, borderColor: 'rgba(124,92,255,0.32)', backgroundColor: C.surface },
  proRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  proTag: { fontSize: 10, fontWeight: '800', color: C.violetSoft, letterSpacing: 1.6, marginBottom: 3 },
  proH: { fontSize: 15, fontWeight: '800', color: C.text },
  proSub: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  proArr: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },

  // Section label
  secLabel: { ...TYPE.label, marginBottom: 9, marginTop: 4 },

  // Nav rows
  navRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, padding: 11, marginBottom: 7, borderWidth: 1, borderColor: C.line },
  navTx: { flex: 1, marginLeft: 11 },
  navH: { fontSize: 14, fontWeight: '700', color: C.text },
  navSub: { fontSize: 11.5, color: C.muted, marginTop: 1 },
});
