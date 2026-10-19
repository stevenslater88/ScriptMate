import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import axios from 'axios';
import { useScriptStore } from '../../store/scriptStore';
import useRevenueCat from '../../hooks/useRevenueCat';
import { trackSelfTapeOpened, trackUpgradeTriggered } from '../../services/analyticsService';
import { getRecordings, SelfTapeRecording } from '../../services/selfTapeStorage';
import { C, RADIUS, TYPE, tint } from '../../constants/cinematicTheme';
import { GradientButton, IconButton, IconWell, ScreenGlow } from '../../components/cinematic';



export default function SelfTapeHub() {
  const { scripts, fetchScripts, loading, createScript } = useScriptStore();
  const { isPremium } = useRevenueCat();
  const [recordings, setRecordings] = useState<SelfTapeRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  
  // Quick Upload Modal State
  const [showQuickUpload, setShowQuickUpload] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickText, setQuickText] = useState('');
  const [uploading, setUploading] = useState(false);
  const textInputRef = useRef<TextInput>(null);

  useEffect(() => {
    trackSelfTapeOpened();
    fetchScripts();
    loadRecordings();
  }, []);

  const loadRecordings = async () => {
    try {
      setLoadingRecordings(true);
      const recs = await getRecordings();
      setRecordings(recs);
    } catch (e) {
      setRecordings([]);
    } finally {
      setLoadingRecordings(false);
    }
  };

  const handleSelectScript = async (scriptId: string) => {
    if (!isPremium) {
      trackUpgradeTriggered('selftape_script_select');
      router.push('/premium');
      return;
    }
    router.push(`/selftape/prep?scriptId=${scriptId}`);
  };

  const handleViewLibrary = async () => {
    if (!isPremium) {
      trackUpgradeTriggered('selftape_library');
      router.push('/premium');
      return;
    }
    router.push('/selftape/library');
  };

  const handleQuickUpload = async () => {
    if (!quickText.trim()) {
      Alert.alert('Missing Script', 'Please paste your script text.');
      return;
    }

    const title = quickTitle.trim() || `Self Tape ${new Date().toLocaleDateString()}`;
    
    setUploading(true);
    Keyboard.dismiss();
    
    try {
      const script = await createScript(title, quickText.trim());
      
      if (script) {
        setShowQuickUpload(false);
        setQuickTitle('');
        setQuickText('');
        
        // Go directly to prep screen with the new script
        if (!isPremium) {
          trackUpgradeTriggered('selftape_quick_upload');
          router.push('/premium');
          return;
        }
        router.push(`/selftape/prep?scriptId=${script.id}`);
      }
    } catch (error) {
      console.error('Quick upload error:', error);
      Alert.alert('Upload Failed', 'Could not process the script. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const openQuickUpload = () => {
    setShowQuickUpload(true);
    setTimeout(() => textInputRef.current?.focus(), 300);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenGlow />
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} testID="selftape-back-btn" />
        <Text style={styles.headerTitle} testID="selftape-header-title">Self Tape Studio</Text>
        <IconButton icon="add" primary onPress={openQuickUpload} testID="selftape-quick-add-btn" />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        {/* Quick Paste Card */}
        <TouchableOpacity onPress={openQuickUpload} style={styles.quickPasteCard} activeOpacity={0.85} testID="selftape-quick-paste-card">
          <IconWell icon="clipboard-outline" color={C.cyan} size={44} />
          <View style={styles.quickPasteInfo}>
            <Text style={styles.quickPasteTitle}>Quick Paste Script</Text>
            <Text style={styles.quickPasteSubtitle}>Paste text and start recording instantly</Text>
          </View>
          <Ionicons name="add" size={22} color={C.cyan} />
        </TouchableOpacity>

        {/* Teleprompter Mode Card - NEW */}
        <TouchableOpacity 
          onPress={() => {
            if (scripts.length === 0) {
              Alert.alert('No Scripts', 'Upload a script first to use teleprompter mode.');
              return;
            }
            // Go to first script's teleprompter
            const firstScript = scripts[0];
            router.push(`/selftape/teleprompter?scriptId=${firstScript.id}`);
          }} 
          style={styles.teleprompterCard}
          activeOpacity={0.85}
          testID="selftape-teleprompter-card"
        >
          <IconWell icon="tablet-portrait-outline" color={C.violetSoft} size={44} />
          <View style={styles.teleprompterInfo}>
            <Text style={styles.teleprompterTitle}>Teleprompter Mode</Text>
            <Text style={styles.teleprompterSubtitle}>Full-screen camera with scrolling script overlay</Text>
          </View>
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        </TouchableOpacity>

        {/* Library Button */}
        <TouchableOpacity onPress={handleViewLibrary} style={styles.libraryCard} activeOpacity={0.85} testID="selftape-library-card">
          <IconWell icon="folder-open" color={C.blueSoft} size={44} />
          <View style={styles.libraryInfo}>
            <Text style={styles.libraryTitle}>My Takes</Text>
            <Text style={styles.librarySubtitle} testID="selftape-library-count">{recordings.length} recordings</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#6E6A95" />
        </TouchableOpacity>

        {/* Pro Badge */}
        <View style={styles.proBadge}>
          <Ionicons name="videocam" size={18} color={C.violetSoft} />
          <Text style={styles.proBadgeText}>PRO FEATURE</Text>
          {!isPremium && (
            <TouchableOpacity 
              testID="selftape-unlock-btn"
              style={styles.unlockButton}
              onPress={() => {
                trackUpgradeTriggered('selftape_badge');
                router.push('/premium');
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
                testID={`selftape-recent-take-${rec.id}`}
                style={styles.recordingItem}
                onPress={() => router.push(`/selftape/review?id=${rec.id}`)}
              >
                <View style={styles.recordingIcon}>
                  <Ionicons name="play-circle" size={32} color="#7C5CFF" />
                </View>
                <View style={styles.recordingInfo}>
                  <Text style={styles.recordingTitle} numberOfLines={1}>{rec.scriptTitle}</Text>
                  <Text style={styles.recordingMeta}>{rec.sceneName} • {Math.round(rec.duration)}s</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6E6A95" />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Script Selection */}
        <View style={styles.scriptsSection}>
          <Text style={styles.sectionTitle}>Select a Script</Text>
          
          {loading ? (
            <ActivityIndicator color="#7C5CFF" style={{ marginTop: 20 }} />
          ) : scripts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={48} color="#4A4670" />
              <Text style={styles.emptyText}>No scripts yet</Text>
              <GradientButton
                label="Upload Script"
                icon="cloud-upload-outline"
                onPress={() => router.push('/upload')}
                testID="selftape-empty-upload-btn"
                style={styles.uploadButton}
              />
            </View>
          ) : (
            scripts.map((script) => (
              <TouchableOpacity
                key={script.id}
                style={styles.scriptItem}
                onPress={() => handleSelectScript(script.id)}
                activeOpacity={0.85}
                testID={`selftape-script-${script.id}`}
              >
                <View style={styles.scriptIcon}>
                  <IconWell icon="document-text" color={C.violetSoft} size={42} />
                </View>
                <View style={styles.scriptInfo}>
                  <Text style={styles.scriptTitle} numberOfLines={1}>{script.title}</Text>
                  <Text style={styles.scriptMeta}>
                    {script.characters?.length || 0} characters • {script.scenes?.length || 1} scenes
                  </Text>
                </View>
                {!isPremium && (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={14} color="#FFC37A" />
                  </View>
                )}
                <Ionicons name="chevron-forward" size={20} color="#6E6A95" />
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {/* Quick Upload Modal */}
      <Modal
        visible={showQuickUpload}
        animationType="slide"
        transparent
        onRequestClose={() => setShowQuickUpload(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.quickUploadModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Quick Paste Script</Text>
              <IconButton icon="close" onPress={() => setShowQuickUpload(false)} testID="quick-paste-close-btn" />
            </View>

            <Text style={styles.modalSubtitle}>
              Paste your script text below and go straight to recording
            </Text>

            <TextInput
              testID="quick-paste-title-input"
              style={styles.titleInput}
              placeholder="Script Title (optional)"
              placeholderTextColor="#6E6A95"
              value={quickTitle}
              onChangeText={setQuickTitle}
            />

            <TextInput
              ref={textInputRef}
              testID="quick-paste-text-input"
              style={styles.scriptTextInput}
              placeholder="Paste your script here...

Example format:
JOHN: Hey, how are you?
SARAH: I'm doing great, thanks!
JOHN: That's wonderful to hear."
              placeholderTextColor="#4A4670"
              value={quickText}
              onChangeText={setQuickText}
              multiline
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => setShowQuickUpload(false)}
                testID="quick-paste-cancel-btn"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.uploadNowButton, uploading && styles.uploadNowButtonDisabled]}
                onPress={handleQuickUpload}
                disabled={uploading}
                testID="quick-paste-start-btn"
              >
                {uploading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="videocam" size={20} color="#fff" />
                    <Text style={styles.uploadNowButtonText}>Start Recording</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const FeatureItem = ({ icon, text }: { icon: string; text: string }) => (
  <View style={styles.featureItem}>
    <IconWell icon={icon as any} color={C.violetSoft} size={32} />
    <Text style={styles.featureText}>{text}</Text>
  </View>
);

const card = { flexDirection: 'row' as const, alignItems: 'center' as const, marginHorizontal: 18, marginTop: 12, padding: 14, borderRadius: RADIUS.lg, borderWidth: 1, gap: 12 };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  headerTitle: { ...TYPE.title, fontSize: 18 },
  content: { flex: 1 },
  contentInner: { paddingBottom: 40 },
  quickPasteCard: { ...card, marginTop: 14, backgroundColor: tint(C.cyan, 0.07), borderColor: tint(C.cyan, 0.28), borderStyle: 'dashed' },
  quickPasteInfo: { flex: 1 },
  quickPasteTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  quickPasteSubtitle: { ...TYPE.caption, marginTop: 2 },
  teleprompterCard: { ...card, backgroundColor: tint(C.violet, 0.12), borderColor: tint(C.violet, 0.32) },
  teleprompterInfo: { flex: 1 },
  teleprompterTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  teleprompterSubtitle: { ...TYPE.caption, marginTop: 2 },
  newBadge: { backgroundColor: C.violet, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  newBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#fff' },
  libraryCard: { ...card, backgroundColor: C.surface, borderColor: C.line },
  libraryInfo: { flex: 1 },
  libraryTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  librarySubtitle: { ...TYPE.caption, marginTop: 2 },
  proBadge: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 18, marginTop: 16, paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.md, gap: 8, backgroundColor: tint(C.violet, 0.1), borderWidth: 1, borderColor: tint(C.violet, 0.22) },
  proBadgeText: { flex: 1, fontSize: 11, fontWeight: '800', color: C.violetSoft, letterSpacing: 1.6 },
  unlockButton: { backgroundColor: C.violet, paddingVertical: 6, paddingHorizontal: 14, borderRadius: RADIUS.pill },
  unlockButtonText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  heroSection: { paddingHorizontal: 18, paddingTop: 28, paddingBottom: 18 },
  heroTitle: { ...TYPE.display, fontSize: 28, lineHeight: 34 },
  heroSubtitle: { fontSize: 14, color: C.muted, marginTop: 10, lineHeight: 21 },
  featuresSection: { backgroundColor: C.surface, marginHorizontal: 18, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: C.line },
  featureItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  featureText: { fontSize: 14, color: C.text },
  recentSection: { paddingHorizontal: 18, paddingTop: 24 },
  sectionTitle: { ...TYPE.label, marginBottom: 12 },
  recordingItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: RADIUS.md, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  recordingIcon: { marginRight: 12 },
  recordingInfo: { flex: 1 },
  recordingTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  recordingMeta: { ...TYPE.caption, marginTop: 2 },
  scriptsSection: { paddingHorizontal: 18, paddingTop: 24 },
  emptyState: { alignItems: 'center', paddingVertical: 28 },
  emptyText: { fontSize: 14, color: C.muted, marginTop: 12 },
  uploadButton: { marginTop: 18, alignSelf: 'stretch' },
  scriptItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: RADIUS.lg, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.line },
  scriptIcon: { marginRight: 12 },
  scriptInfo: { flex: 1 },
  scriptTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  scriptMeta: { ...TYPE.caption, marginTop: 2 },
  lockBadge: { backgroundColor: tint(C.warning, 0.14), padding: 6, borderRadius: 8, marginRight: 8 },

  // Quick Upload Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(5, 4, 14, 0.82)', justifyContent: 'flex-end' },
  quickUploadModal: { backgroundColor: C.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 20, maxHeight: '85%', borderWidth: 1, borderColor: C.line },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { ...TYPE.title },
  modalSubtitle: { fontSize: 14, color: C.muted, marginBottom: 20 },
  titleInput: { backgroundColor: C.ink, borderRadius: RADIUS.md, padding: 14, fontSize: 16, color: C.text, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  scriptTextInput: { backgroundColor: C.ink, borderRadius: RADIUS.md, padding: 14, fontSize: 15, color: C.text, minHeight: 200, maxHeight: 300, borderWidth: 1, borderColor: C.line, lineHeight: 22 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20, paddingBottom: Platform.OS === 'ios' ? 20 : 0 },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: C.text },
  uploadNowButton: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: RADIUS.md, backgroundColor: C.violet, gap: 8 },
  uploadNowButtonDisabled: { opacity: 0.6 },
  uploadNowButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
