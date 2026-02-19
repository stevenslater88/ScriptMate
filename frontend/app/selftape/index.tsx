import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScriptStore } from '../../store/scriptStore';
import useRevenueCat from '../../hooks/useRevenueCat';
import { trackSelfTapeOpened, trackUpgradeTriggered } from '../../services/analyticsService';
import { getRecordings, SelfTapeRecording } from '../../services/selfTapeStorage';

export default function SelfTapeHub() {
  const { scripts, fetchScripts, loading } = useScriptStore();
  const { isPremium, presentPaywall } = useRevenueCat();
  const [recordings, setRecordings] = useState<SelfTapeRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);

  useEffect(() => {
    trackSelfTapeOpened();
    fetchScripts();
    loadRecordings();
  }, []);

  const loadRecordings = async () => {
    setLoadingRecordings(true);
    const recs = await getRecordings();
    setRecordings(recs);
    setLoadingRecordings(false);
  };

  const handleSelectScript = async (scriptId: string) => {
    if (!isPremium) {
      trackUpgradeTriggered('selftape_script_select');
      const purchased = await presentPaywall();
      if (!purchased) return;
    }
    router.push(`/selftape/prep?scriptId=${scriptId}`);
  };

  const handleViewLibrary = async () => {
    if (!isPremium) {
      trackUpgradeTriggered('selftape_library');
      const purchased = await presentPaywall();
      if (!purchased) return;
    }
    router.push('/selftape/library');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Self Tape Studio</Text>
        <TouchableOpacity onPress={() => router.push('/upload')} style={styles.addButton}>
          <Ionicons name="add-circle" size={28} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Library Button */}
        <TouchableOpacity onPress={handleViewLibrary} style={styles.libraryCard}>
          <View style={styles.libraryIcon}>
            <Ionicons name="folder-open" size={24} color="#6366f1" />
          </View>
          <View style={styles.libraryInfo}>
            <Text style={styles.libraryTitle}>My Takes</Text>
            <Text style={styles.librarySubtitle}>{recordings.length} recordings</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#6b7280" />
        </TouchableOpacity>
        {/* Pro Badge */}
        <View style={styles.proBadge}>
          <Ionicons name="videocam" size={20} color="#6366f1" />
          <Text style={styles.proBadgeText}>PRO FEATURE</Text>
          {!isPremium && (
            <TouchableOpacity 
              style={styles.unlockButton}
              onPress={() => {
                trackUpgradeTriggered('selftape_badge');
                presentPaywall();
              }}
            >
              <Text style={styles.unlockButtonText}>Unlock</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Record Professional{"\n"}Self Tapes</Text>
          <Text style={styles.heroSubtitle}>
            Split-screen recording with your script visible while you perform.
            Perfect for auditions.
          </Text>
        </View>

        {/* Features List */}
        <View style={styles.featuresSection}>
          <FeatureItem icon="document-text" text="Script overlay while recording" />
          <FeatureItem icon="swap-horizontal" text="Front/back camera switch" />
          <FeatureItem icon="timer" text="3-second countdown timer" />
          <FeatureItem icon="text" text="Teleprompter mode" />
          <FeatureItem icon="share" text="Save & share recordings" />
        </View>

        {/* Recent Recordings */}
        {recordings.length > 0 && (
          <View style={styles.recentSection}>
            <Text style={styles.sectionTitle}>Recent Takes</Text>
            {recordings.slice(0, 3).map((rec) => (
              <TouchableOpacity 
                key={rec.id} 
                style={styles.recordingItem}
                onPress={() => router.push(`/selftape/review?id=${rec.id}`)}
              >
                <View style={styles.recordingIcon}>
                  <Ionicons name="play-circle" size={32} color="#6366f1" />
                </View>
                <View style={styles.recordingInfo}>
                  <Text style={styles.recordingTitle} numberOfLines={1}>{rec.scriptTitle}</Text>
                  <Text style={styles.recordingMeta}>{rec.sceneName} • {Math.round(rec.duration)}s</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Script Selection */}
        <View style={styles.scriptsSection}>
          <Text style={styles.sectionTitle}>Select a Script</Text>
          
          {loading ? (
            <ActivityIndicator color="#6366f1" style={{ marginTop: 20 }} />
          ) : scripts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={48} color="#4b5563" />
              <Text style={styles.emptyText}>No scripts yet</Text>
              <TouchableOpacity 
                style={styles.uploadButton}
                onPress={() => router.push('/upload')}
              >
                <Text style={styles.uploadButtonText}>Upload Script</Text>
              </TouchableOpacity>
            </View>
          ) : (
            scripts.map((script) => (
              <TouchableOpacity
                key={script.id}
                style={styles.scriptItem}
                onPress={() => handleSelectScript(script.id)}
              >
                <View style={styles.scriptIcon}>
                  <Ionicons name="document-text" size={24} color="#6366f1" />
                </View>
                <View style={styles.scriptInfo}>
                  <Text style={styles.scriptTitle} numberOfLines={1}>{script.title}</Text>
                  <Text style={styles.scriptMeta}>
                    {script.characters?.length || 0} characters • {script.scenes?.length || 1} scenes
                  </Text>
                </View>
                {!isPremium && (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={14} color="#f59e0b" />
                  </View>
                )}
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const FeatureItem = ({ icon, text }: { icon: string; text: string }) => (
  <View style={styles.featureItem}>
    <Ionicons name={icon as any} size={20} color="#6366f1" />
    <Text style={styles.featureText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  libraryButton: { padding: 4 },
  content: { flex: 1 },
  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  proBadgeText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#6366f1', letterSpacing: 1 },
  unlockButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  unlockButtonText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  heroSection: { padding: 20 },
  heroTitle: { fontSize: 28, fontWeight: '700', color: '#fff', lineHeight: 36 },
  heroSubtitle: { fontSize: 15, color: '#9ca3af', marginTop: 12, lineHeight: 22 },
  featuresSection: {
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
  },
  featureItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  featureText: { fontSize: 14, color: '#e5e7eb' },
  recentSection: { padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12 },
  recordingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  recordingIcon: { marginRight: 12 },
  recordingInfo: { flex: 1 },
  recordingTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },
  recordingMeta: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  scriptsSection: { padding: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 14, color: '#6b7280', marginTop: 12 },
  uploadButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 16,
  },
  uploadButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  scriptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  scriptIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  scriptInfo: { flex: 1 },
  scriptTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  scriptMeta: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  lockBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    padding: 6,
    borderRadius: 6,
    marginRight: 8,
  },
});
