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
import Constants from 'expo-constants';
import { useScriptStore } from '../../store/scriptStore';
import { saveRecording, saveToGallery, getRecordings, deleteRecording as deleteFromStorage } from '../../services/selfTapeStorage';
import { trackVideoSaved, trackVideoShared } from '../../services/analyticsService';

import { Watermark } from '../../components/Watermark';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ||
                    Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL;

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
  const sceneIndex = parseInt(recordingInfo?.sceneIndex?.toString() || params.sceneIndex || '0');
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
      const res = await axios.post(`${BACKEND_URL}/api/tapes/share`, {
        actor_name: actorName.trim(),
        role_name: roleName.trim(),
        project_name: projectName.trim(),
        video_uri: videoUri,
        script_title: script?.title || recordingInfo?.scriptTitle || '',
        duration: parseInt(params.duration || '0') || recordingInfo?.duration || 0,
        password: usePassword ? sharePassword : null,
      }, { timeout: 15000 });
      const fullUrl = `${BACKEND_URL}/api/tapes/share/${res.data.share_id}`;
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review Take</Text>
        <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
          <Ionicons name="trash-outline" size={24} color="#ef4444" />
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
          <View style={styles.noVideo}>
            <Ionicons name="videocam-off" size={48} color="#6b7280" />
            <Text style={styles.noVideoText}>Video not available</Text>
          </View>
        )}

        {/* Watermark Overlay */}
        <Watermark />

        {/* Play/Pause Overlay */}
        <TouchableOpacity style={styles.playOverlay} onPress={handlePlayPause}>
          {!isPlaying && (
            <View style={styles.playButton}>
              <Ionicons name="play" size={40} color="#fff" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.infoSection}>
        <Text style={styles.scriptTitle}>{script?.title || recordingInfo?.scriptTitle}</Text>
        <Text style={styles.sceneName}>{currentScene?.name || recordingInfo?.sceneName}</Text>
        {(params.duration || recordingInfo?.duration) && (
          <Text style={styles.duration}>
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
        >
          <Ionicons name="link" size={22} color="#fff" />
          <Text style={styles.actionButtonText}>Generate Casting Link</Text>
        </TouchableOpacity>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleSaveToGallery}>
            <Ionicons name="download" size={22} color="#6366f1" />
            <Text style={styles.secondaryButtonText}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={22} color="#6366f1" />
            <Text style={styles.secondaryButtonText}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={handleRetake}>
            <Ionicons name="refresh" size={22} color="#6366f1" />
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Done Button */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.doneButton} 
          onPress={() => router.replace('/selftape')}
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
              >
                <Ionicons name="close" size={24} color="#9ca3af" />
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
                    placeholderTextColor="#6b7280"
                    value={actorName}
                    onChangeText={setActorName}
                    data-testid="actor-name-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Role</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Character / Role name"
                    placeholderTextColor="#6b7280"
                    value={roleName}
                    onChangeText={setRoleName}
                    data-testid="role-name-input"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Project</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Project / Show name"
                    placeholderTextColor="#6b7280"
                    value={projectName}
                    onChangeText={setProjectName}
                    data-testid="project-name-input"
                  />
                </View>

                <View style={styles.switchRow}>
                  <View>
                    <Text style={styles.switchLabel}>Password Protect</Text>
                    <Text style={styles.switchSub}>Only viewers with the password can watch</Text>
                  </View>
                  <Switch
                    value={usePassword}
                    onValueChange={setUsePassword}
                    trackColor={{ false: '#374151', true: '#6366f1' }}
                    thumbColor="#fff"
                  />
                </View>

                {usePassword && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Password</Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="Enter a password"
                      placeholderTextColor="#6b7280"
                      value={sharePassword}
                      onChangeText={setSharePassword}
                      secureTextEntry
                      data-testid="share-password-input"
                    />
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.generateBtn, !actorName.trim() && styles.generateBtnDisabled]}
                  onPress={handleGenerateLink}
                  disabled={!actorName.trim() || generatingLink}
                  data-testid="generate-link-btn"
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
                    <Ionicons name="checkmark-circle" size={48} color="#10b981" />
                  </View>
                  <Text style={styles.linkSuccessText}>Your casting link is ready!</Text>
                </View>

                <View style={styles.linkBox}>
                  <Text style={styles.linkText} numberOfLines={2}>{shareLink}</Text>
                </View>

                <View style={styles.linkActions}>
                  <TouchableOpacity
                    style={styles.linkActionBtn}
                    onPress={handleCopyLink}
                    data-testid="copy-link-btn"
                  >
                    <Ionicons name="copy" size={20} color="#6366f1" />
                    <Text style={styles.linkActionText}>Copy Link</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.linkActionBtn, styles.linkShareBtn]}
                    onPress={handleShareLink}
                    data-testid="share-link-btn"
                  >
                    <Ionicons name="share-social" size={20} color="#fff" />
                    <Text style={[styles.linkActionText, { color: '#fff' }]}>Share</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.linkInfo}>
                  <Ionicons name="information-circle" size={16} color="#6b7280" />
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
  headerButton: { width: 36 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
    maxHeight: '50%',
  },
  video: { flex: 1 },
  noVideo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noVideoText: { fontSize: 14, color: '#6b7280', marginTop: 12 },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(99, 102, 241, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 6,
  },
  infoSection: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  scriptTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  sceneName: { fontSize: 14, color: '#9ca3af', marginTop: 4 },
  duration: { fontSize: 13, color: '#6b7280', marginTop: 8 },
  actionsContainer: { padding: 16 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  saveButton: { backgroundColor: '#6366f1' },
  actionButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 12,
    minWidth: 90,
  },
  secondaryButtonText: { fontSize: 12, color: '#6366f1', marginTop: 4, fontWeight: '500' },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  doneButton: {
    backgroundColor: '#374151',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  castingLinkButton: { backgroundColor: '#8b5cf6', marginBottom: 8 },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  modalSubtitle: { fontSize: 14, color: '#9ca3af', marginBottom: 20 },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 6 },
  modalInput: {
    backgroundColor: '#0a0a0f',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginBottom: 8,
  },
  switchLabel: { fontSize: 15, fontWeight: '600', color: '#fff' },
  switchSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  linkSuccess: { alignItems: 'center', paddingVertical: 16 },
  linkSuccessIcon: { marginBottom: 8 },
  linkSuccessText: { fontSize: 16, fontWeight: '600', color: '#10b981' },
  linkBox: {
    backgroundColor: '#0a0a0f',
    borderRadius: 10,
    padding: 14,
    marginVertical: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  linkText: { fontSize: 14, color: '#6366f1', fontWeight: '500' },
  linkActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  linkActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  linkShareBtn: { backgroundColor: '#6366f1' },
  linkActionText: { fontSize: 14, fontWeight: '600', color: '#6366f1' },
  linkInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
  },
  linkInfoText: { fontSize: 12, color: '#6b7280', flex: 1 },
});
