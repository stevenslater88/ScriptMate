import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { useScriptStore } from '../../store/scriptStore';
import { saveRecording, saveToGallery, getRecordings, deleteRecording as deleteFromStorage } from '../../services/selfTapeStorage';
import { trackVideoSaved, trackVideoShared } from '../../services/analyticsService';

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
        <View style={styles.watermarkContainer}>
          <Text style={styles.watermarkText}>Sent from ScriptMate</Text>
        </View>

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
  watermarkContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  watermarkText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
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
});
