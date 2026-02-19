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

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function HomeScreen() {
  const { scripts, fetchScripts, loading, initializeUser, user, isPremium, limits } = useScriptStore();
  const [refreshing, setRefreshing] = useState(false);
  
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

  const initialize = useCallback(async () => {
    await initializeUser();
    await fetchScripts();
  }, [initializeUser, fetchScripts]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchScripts();
    setRefreshing(false);
  };

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
              <Text style={styles.logoText}>ScriptMate</Text>
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
          <Text style={styles.tagline}>AI Script Learning Partner</Text>
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

        {/* Self Tape Button */}
        <TouchableOpacity
          style={styles.selfTapeButton}
          onPress={() => router.push('/selftape')}
          activeOpacity={0.8}
        >
          <View style={styles.selfTapeIcon}>
            <Ionicons name="videocam" size={24} color="#fff" />
          </View>
          <View style={styles.selfTapeContent}>
            <Text style={styles.selfTapeTitle}>Self Tape Studio</Text>
            <Text style={styles.selfTapeSubtitle}>Record professional audition tapes</Text>
          </View>
          <View style={styles.proBadgeSmall}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#6b7280" />
        </TouchableOpacity>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.actionCard, styles.primaryCard]}
            onPress={() => router.push('/upload')}
            activeOpacity={0.8}
          >
            <View style={styles.actionIconContainer}>
              <Ionicons name="add-circle" size={40} color="#fff" />
            </View>
            <Text style={styles.actionTitle}>New Script</Text>
            <Text style={styles.actionSubtitle}>Upload or paste your script</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, styles.secondaryCard]}
            onPress={() => router.push('/scripts')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconContainer, styles.secondaryIcon]}>
              <Ionicons name="library" size={40} color="#6366f1" />
            </View>
            <Text style={styles.actionTitle}>My Scripts</Text>
            <Text style={styles.actionSubtitle}>
              {scripts.length}{!isPremium && limits ? `/${limits.max_scripts}` : ''} scripts
            </Text>
          </TouchableOpacity>
        </View>

        {/* Continue Learning */}
        {recentScript && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Continue Learning</Text>
            <TouchableOpacity
              style={styles.continueCard}
              onPress={() => router.push(`/script/${recentScript.id}`)}
              activeOpacity={0.8}
            >
              <View style={styles.continueContent}>
                <View style={styles.continueIcon}>
                  <Ionicons name="play-circle" size={48} color="#6366f1" />
                </View>
                <View style={styles.continueText}>
                  <Text style={styles.continueTitle} numberOfLines={1}>
                    {recentScript.title}
                  </Text>
                  <Text style={styles.continueSubtitle}>
                    {recentScript.characters?.length || 0} characters •{' '}
                    {recentScript.lines?.length || 0} lines
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>
        )}

        {/* Training Modes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training Modes</Text>
          <View style={styles.modesGrid}>
            <View style={styles.modeCard}>
              <Ionicons name="chatbubbles" size={28} color="#10b981" />
              <Text style={styles.modeTitle}>Full Read</Text>
              <Text style={styles.modeDesc}>Practice with AI partner</Text>
            </View>
            <View style={styles.modeCard}>
              <Ionicons name="flash" size={28} color="#f59e0b" />
              <Text style={styles.modeTitle}>Cue Only</Text>
              <Text style={styles.modeDesc}>Recall your lines</Text>
            </View>
            <TouchableOpacity 
              style={[styles.modeCard, !isPremium && styles.modeCardLocked]}
              onPress={() => !isPremium && router.push('/premium')}
            >
              <View style={styles.modeIconRow}>
                <Ionicons name="trophy" size={28} color={isPremium ? "#ef4444" : "#4a4a5e"} />
                {!isPremium && <Ionicons name="lock-closed" size={14} color="#f59e0b" style={styles.lockIcon} />}
              </View>
              <Text style={[styles.modeTitle, !isPremium && styles.modeTextLocked]}>Performance</Text>
              <Text style={styles.modeDesc}>{isPremium ? 'No prompts mode' : 'Premium'}</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.modeCard, !isPremium && styles.modeCardLocked]}
              onPress={() => !isPremium && router.push('/premium')}
            >
              <View style={styles.modeIconRow}>
                <Ionicons name="repeat" size={28} color={isPremium ? "#8b5cf6" : "#4a4a5e"} />
                {!isPremium && <Ionicons name="lock-closed" size={14} color="#f59e0b" style={styles.lockIcon} />}
              </View>
              <Text style={[styles.modeTitle, !isPremium && styles.modeTextLocked]}>Loop</Text>
              <Text style={styles.modeDesc}>{isPremium ? 'Repeat weak lines' : 'Premium'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Loading indicator */}
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
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 30,
    alignItems: 'center',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 8,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerButton: {
    padding: 8,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  tagline: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 8,
  },
  selfTapeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  selfTapeIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfTapeContent: {
    flex: 1,
    marginLeft: 14,
  },
  selfTapeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  selfTapeSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  proBadgeSmall: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#f59e0b',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionCard: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryCard: {
    backgroundColor: '#6366f1',
  },
  secondaryCard: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  actionIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  secondaryIcon: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  actionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  actionSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  continueCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  continueContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  continueIcon: {
    marginRight: 16,
  },
  continueText: {
    flex: 1,
  },
  continueTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  continueSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  modesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  modeCard: {
    width: '47%',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  modeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginTop: 10,
    marginBottom: 4,
  },
  modeDesc: {
    fontSize: 12,
    color: '#6b7280',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  premiumBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  premiumBannerText: {
    marginLeft: 12,
    flex: 1,
  },
  premiumBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f59e0b',
  },
  premiumBannerSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  premiumStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
    gap: 6,
  },
  premiumStatusText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
  modeCardLocked: {
    opacity: 0.7,
  },
  modeTextLocked: {
    color: '#6b7280',
  },
  modeIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockIcon: {
    marginLeft: 4,
  },
});
