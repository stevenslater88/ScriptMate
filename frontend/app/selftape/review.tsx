import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
  TextInput,
  Modal,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import axios from 'axios';

import { API_BASE_URL } from '../../services/apiConfig';
import { useScriptStore } from '../../store/scriptStore';
import { saveRecording, saveToGallery, getRecordings, deleteRecording as deleteFromStorage } from '../../services/selfTapeStorage';
import { trackVideoSaved, trackVideoShared } from '../../services/analyticsService';
import { Watermark } from '../../components/Watermark';
import { C, RADIUS, TYPE, tint } from '../../constants/cinematicTheme';
import { IconButton, ScreenGlow } from '../../components/cinematic';

export default function ReviewScreen() {
  const params = useLocalSearchParams<{
    videoUri?: string;
    id?: string;
    scriptId?: string;
    sceneIndex?: string;
    duration?: string;
  }>();

  const { scripts } = useScriptStore();
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(!!params.id);
  const [videoUri, setVideoUri] = useState(params.videoUri || '');
  const [recordingInfo, setRecordingInfo] = useState<any>(null);
  const videoRef = useRef<Video>(null);
  
  // Phase D: Share link state
  const [showShareModal, setShowShareModal] = useState(false);
  const [actorName, setActorName] = useState('');
  const [roleName, setRoleName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [generatingLink, setGeneratingLink] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);

  // Load recording info if viewing from library
  useEffect(() => {
    const loadRecording = async () => {
      if (params.id) {
        const recordings = await getRecordings();
        const recording = recordings.find(r => r.id === params.id);
        if (recording) {
          setVideoUri(recording.uri);
          setRecordingInfo(recording);
        }
      }
    };
    loadRecording();
  }, [params.id]);

  const script = scripts.find(s => s.id === (recordingInfo?.scriptId || params.scriptId));
  const scenes = script?.scenes || [{ name: 'Full Script' }];
  const rawIndex = parseInt(recordingInfo?.sceneIndex?.toString() || params.sceneIndex || '0');
  const sceneIndex = Math.max(0, Math.min(rawIndex, scenes.length - 1));
  const currentScene = scenes[sceneIndex];

  const handlePlayPause = async () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSave = async () => {
    if (saved || !videoUri) return;
    
    setLoading(true);
    try {
      await saveRecording(
        videoUri,
        params.scriptId || '',
        script?.title || 'Unknown Script',
        sceneIndex,
        currentScene?.name || `Scene ${sceneIndex + 1}`,
        parseInt(params.duration || '0')
      );
      
      trackVideoSaved(params.scriptId || '');
      setSaved(true);
      Alert.alert('Saved!', 'Your self-tape has been saved to your library.');
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save recording. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToGallery = async () => {
    setLoading(true);
    try {
      const success = await saveToGallery(videoUri);
      if (success) {
        Alert.alert('Saved!', 'Video saved to your photo library.');
      } else {
        Alert.alert('Error', 'Could not save to gallery. Check permissions.');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save to gallery.');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      trackVideoShared(params.scriptId || recordingInfo?.scriptId || '');
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(videoUri, {
          mimeType: 'video/mp4',
          dialogTitle: 'Share Self-Tape',
        });
      } else {
        Alert.alert('Sharing not available', 'Sharing is not supported on this device.');
      }
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Recording?',
      'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (params.id) {
              await deleteFromStorage(params.id);
            }
            router.back();
          },
        },
      ]
    );
  };

  const handleRetake = () => {
    router.replace({
      pathname: '/selftape/prep',
      params: { scriptId: params.scriptId || recordingInfo?.scriptId },
    });
  };

  const handleGenerateLink = async () => {
    if (!actorName.trim()) return;
    setGeneratingLink(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/tapes/share`, {
        actor_name: actorName.trim(),
        role_name: roleName.trim(),
        project_name: projectName.trim(),
        video_uri: videoUri,
        script_title: script?.title || recordingInfo?.scriptTitle || '',
        duration: parseInt(params.duration || '0') || recordingInfo?.duration || 0,
        password: usePassword ? sharePassword : null,
      }, { timeout: 15000 });
      const fullUrl = `${API_BASE_URL}/api/tapes/share/${res.data.share_id}`;
      setShareLink(fullUrl);
      setShareId(res.data.share_id);
    } catch (error) {
      console.error('Generate link error:', error);
      Alert.alert('Error', 'Failed to generate casting link. Please try again.');
    } finally {
      setGeneratingLink(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    await Clipboard.setStringAsync(shareLink);
    Alert.alert('Copied!', 'Casting link copied to clipboard.');
  };

  const handleShareLink = async () => {
    if (!shareLink) return;
    try {
      await Share.share({
        message: `Check out my self-tape audition: ${shareLink}`,
        url: shareLink,
        title: `${actorName} - Self Tape${roleName ? ` for ${roleName}` : ''}`,
      });
    } catch (error) {
      console.error('Share link error:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenGlow />
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} testID="review-back-btn" />
        <Text style={styles.headerTitle} testID="review-header-title">Review Take</Text>
        <TouchableOpacity onPress={handleDelete} style={styles.headerButton} testID="review-delete-btn" accessibilityLabel="Delete recording">
          <Ionicons name="trash-outline" size={19} color="#FF5C7A" />
        </TouchableOpacity>
      </View>

      {/* Video Player */}
      <View style={styles.videoContainer}>
        {videoUri ? (
          <Video
            ref={videoRef}
            source={{ uri: videoUri }}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            isLooping
            onPlaybackStatusUpdate={(status) => {
              if (status.isLoaded) {
                setIsPlaying(status.isPlaying);
              }
            }}
          />
        ) : (
          <View style={styles.noVideo} testID="review-no-video">
            <Ionicons name="videocam-off" size={48} color="#6E6A95" />
            <Text style={styles.noVideoText}>Video not available</Text>
          </View>
        )}

        {/* Watermark Overlay */}
        <Watermark />

        {/* Play/Pause Overlay */}
        <TouchableOpacity style={styles.playOverlay} onPress={handlePlayPause} testID="review-play-toggle">
          {!isPlaying && (
            <View style={styles.playButton}>
              <Ionicons name="play" size={34} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.infoSection}>
        <Text style={styles.scriptTitle} testID="review-script-title">{script?.title || recordingInfo?.scriptTitle}</Text>
        <Text style={styles.sceneName}>{currentScene?.name || recordingInfo?.sceneName}</Text>
        {(params.duration || recordingInfo?.duration) && (
          <Text style={styles.duration} testID="review-duration">
            Duration: {Math.floor((recordingInfo?.duration || parseInt(params.duration || '0')) / 60)}:
            {((recordingInfo?.duration || parseInt(params.duration || '0')) % 60).toString().padStart(2, '0')}
          </Text>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actionsContainer}>
        {!saved && (
          <TouchableOpacity 
            style={[styles.actionButton, styles.saveButton]} 
            onPress={handleSave}
            disabled={loading}
            data-testid="save-to-library-btn"
            testID="save-to-library-btn"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="bookmark" size={22} color="#fff" />
                <Text style={styles.actionButtonText}>Save to Library</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Generate Casting Link */}
        <TouchableOpacity
          style={[styles.actionButton, styles.castingLinkButton]}
          onPress={() => setShowShareModal(true)}
          data-testid="generate-casting-link-btn"
          testID="generate-casting-link-btn"
        >
          <Ionicons name="link" size={20} color={C.violetSoft} />
          <Text style={[styles.actionButtonText, { color: C.text }]}>Generate Casting Link</Text>
        </TouchableOpacity>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleSaveToGallery} testID="review-gallery-btn">
            <Ionicons name="download" size={20} color={C.violetSoft} />
            <Text style={styles.secondaryButtonText}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleShare} testID="review-share-btn">
            <Ionicons name="share-outline" size={20} color={C.violetSoft} />
            <Text style={styles.secondaryButtonText}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleRetake} testID="review-retake-btn">
            <Ionicons name="refresh" size={20} color={C.violetSoft} />
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Done Button */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.doneButton} 
          onPress={() => router.replace('/selftape')}
          testID="review-done-btn"
        >
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* Share Link Modal */}
      <Modal
        visible={showShareModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowShareModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {shareLink ? 'Casting Link Ready' : 'Generate Casting Link'}
              </Text>
              <TouchableOpacity
                onPress={() => { setShowShareModal(false); setShareLink(null); setShareId(null); }}
                data-testid="close-share-modal-btn"
                    testID="close-share-modal-btn"
              >
                <Ionicons name="close" size={24} color="#A19DC6" />
              </TouchableOpacity>
            </View>

            {!shareLink ? (
              <>
                <Text style={styles.modalSubtitle}>
                  Create a professional link to share with casting directors
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Actor Name *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Your name"
                    placeholderTextColor="#6E6A95"
                    value={actorName}
                    onChangeText={setActorName}
                    data-testid="actor-name-input"
                    testID="actor-name-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Role</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Character / Role name"
                    placeholderTextColor="#6E6A95"
                    value={roleName}
                    onChangeText={setRoleName}
                    data-testid="role-name-input"
                    testID="role-name-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Project</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Project / Show name"
                    placeholderTextColor="#6E6A95"
                    value={projectName}
                    onChangeText={setProjectName}
                    data-testid="project-name-input"
                    testID="project-name-input"
                  />
                </View>

                <View style={styles.switchRow}>
                  <View>
                    <Text style={styles.switchLabel}>Password Protect</Text>
                    <Text style={styles.switchSub}>Only viewers with the password can watch</Text>
                  </View>
                  <Switch
                    testID="share-password-switch"
                    value={usePassword}
                    onValueChange={setUsePassword}
                    trackColor={{ false: '#2A2650', true: '#7C5CFF' }}
                    thumbColor="#fff"
                  />
                </View>

                {usePassword && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Password</Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="Enter a password"
                      placeholderTextColor="#6E6A95"
                      value={sharePassword}
                      onChangeText={setSharePassword}
                      secureTextEntry
                      data-testid="share-password-input"
                    testID="share-password-input"
                    />
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.generateBtn, !actorName.trim() && styles.generateBtnDisabled]}
                  onPress={handleGenerateLink}
                  disabled={!actorName.trim() || generatingLink}
                  data-testid="generate-link-btn"
                    testID="generate-link-btn"
                >
                  {generatingLink ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="link" size={20} color="#fff" />
                      <Text style={styles.generateBtnText}>Generate Link</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.linkSuccess}>
                  <View style={styles.linkSuccessIcon}>
                    <Ionicons name="checkmark-circle" size={48} color="#34D399" />
                  </View>
                  <Text style={styles.linkSuccessText}>Your casting link is ready!</Text>
                </View>

                <View style={styles.linkBox}>
                  <Text style={styles.linkText} numberOfLines={2} testID="share-link-text">{shareLink}</Text>
                </View>

                <View style={styles.linkActions}>
                  <TouchableOpacity
                    style={styles.linkActionBtn}
                    onPress={handleCopyLink}
                    data-testid="copy-link-btn"
                    testID="copy-link-btn"
                  >
                    <Ionicons name="copy" size={20} color="#7C5CFF" />
                    <Text style={styles.linkActionText}>Copy Link</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.linkActionBtn, styles.linkShareBtn]}
                    onPress={handleShareLink}
                    data-testid="share-link-btn"
                    testID="share-link-btn"
                  >
                    <Ionicons name="share-social" size={20} color="#fff" />
                    <Text style={[styles.linkActionText, { color: '#fff' }]}>Share</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.linkInfo}>
                  <Ionicons name="information-circle" size={16} color="#6E6A95" />
                  <Text style={styles.linkInfoText}>
                    {usePassword ? 'Password-protected link. ' : ''}Anyone with this link can view your tape.
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  headerButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.danger, 0.1), borderWidth: 1, borderColor: tint(C.danger, 0.2) },
  headerTitle: { ...TYPE.title, fontSize: 18 },
  videoContainer: { flex: 1, backgroundColor: '#000', maxHeight: '50%', marginHorizontal: 18, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  video: { flex: 1 },
  noVideo: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.surface },
  noVideoText: { fontSize: 14, color: C.muted, marginTop: 12 },
  playOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  playButton: { width: 68, height: 68, borderRadius: 34, backgroundColor: tint(C.violet, 0.9), borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', paddingLeft: 5 },
  infoSection: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 6, alignItems: 'center' },
  scriptTitle: { ...TYPE.title, fontSize: 18, textAlign: 'center' },
  sceneName: { fontSize: 14, color: C.muted, marginTop: 4 },
  duration: { fontSize: 12, color: C.cyan, fontWeight: '700', marginTop: 8, letterSpacing: 0.4 },
  actionsContainer: { paddingHorizontal: 18, paddingTop: 12 },
  actionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: RADIUS.md, gap: 8 },
  saveButton: { backgroundColor: C.violet, marginBottom: 10 },
  actionButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  secondaryButton: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: C.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line },
  secondaryButtonText: { fontSize: 12, color: C.text, marginTop: 5, fontWeight: '600' },
  footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, marginTop: 'auto', borderTopWidth: 1, borderTopColor: C.line },
  doneButton: { backgroundColor: C.surface2, paddingVertical: 14, borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  doneButtonText: { fontSize: 16, fontWeight: '700', color: C.text },
  castingLinkButton: { backgroundColor: tint(C.violet, 0.14), borderWidth: 1, borderColor: tint(C.violet, 0.4) },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(5, 4, 14, 0.78)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, maxHeight: '85%', borderWidth: 1, borderColor: C.line },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { ...TYPE.title },
  modalSubtitle: { fontSize: 14, color: C.muted, marginBottom: 20 },
  inputGroup: { marginBottom: 14 },
  inputLabel: { ...TYPE.label, fontSize: 10, color: C.muted, marginBottom: 6 },
  modalInput: { backgroundColor: C.ink, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, borderWidth: 1, borderColor: C.line },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginBottom: 8 },
  switchLabel: { fontSize: 15, fontWeight: '700', color: C.text },
  switchSub: { ...TYPE.caption, marginTop: 2 },
  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.violet, paddingVertical: 14, borderRadius: RADIUS.md, gap: 8, marginTop: 8 },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  linkSuccess: { alignItems: 'center', paddingVertical: 16 },
  linkSuccessIcon: { marginBottom: 8 },
  linkSuccessText: { fontSize: 16, fontWeight: '700', color: C.success },
  linkBox: { backgroundColor: C.ink, borderRadius: RADIUS.md, padding: 14, marginVertical: 16, borderWidth: 1, borderColor: tint(C.violet, 0.3) },
  linkText: { fontSize: 14, color: C.blueSoft, fontWeight: '600' },
  linkActions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  linkActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: RADIUS.md, gap: 6, backgroundColor: tint(C.violet, 0.12), borderWidth: 1, borderColor: tint(C.violet, 0.3) },
  linkShareBtn: { backgroundColor: C.violet, borderColor: C.violet },
  linkActionText: { fontSize: 14, fontWeight: '700', color: C.violetSoft },
  linkInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8 },
  linkInfoText: { fontSize: 12, color: C.dim, flex: 1 },
});
