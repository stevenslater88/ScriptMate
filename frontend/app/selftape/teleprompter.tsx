import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  Animated,
  Dimensions,
  Modal,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import Slider from '@react-native-community/slider';
import { useScriptStore } from '../../store/scriptStore';
import { 
  trackRecordingStarted, 
  trackRecordingCompleted,
  trackShareInitiated,
  trackShareCompleted,
  trackVideoSaved,
} from '../../services/analyticsService';
import { saveRecording, saveToGallery } from '../../services/selfTapeStorage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TeleprompterScreen() {
  const params = useLocalSearchParams<{
    scriptId: string;
    sceneIndex?: string;
    character?: string;
  }>();

  const { scripts } = useScriptStore();
  const script = scripts.find(s => s.id === params.scriptId);
  const scenes = script?.scenes || [{ name: 'Full Script', lines: script?.lines || [] }];
  const currentScene = scenes[parseInt(params.sceneIndex || '0')];
  const userCharacter = params.character || '';
  
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  
  const [facing, setFacing] = useState<CameraType>('front');
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  
  // Teleprompter state
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);
  const [fontSize, setFontSize] = useState(24);
  const [opacity, setOpacity] = useState(0.85);
  const [position, setPosition] = useState<'top' | 'middle' | 'bottom'>('bottom');
  const [showSettings, setShowSettings] = useState(false);
  const [highlightMyLines, setHighlightMyLines] = useState(true);
  
  // Post-record state
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [processingVideo, setProcessingVideo] = useState(false);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  
  const cameraRef = useRef<CameraView>(null);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const scrollAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const recordingStartTime = useRef<number>(0);
  const currentScrollPosition = useRef(0);

  const lines = currentScene?.lines || [];
  
  // Calculate total scroll height based on lines
  const lineHeight = fontSize + 16;
  const totalContentHeight = lines.length * lineHeight;
  const visibleHeight = 200; // Height of the teleprompter window

  // Request permissions
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        if (!cameraPermission?.granted) {
          const camResult = await requestCameraPermission();
          console.log('[Teleprompter] Camera permission result:', camResult?.status);
        }
        if (!micPermission?.granted) {
          const micResult = await requestMicPermission();
          console.log('[Teleprompter] Mic permission result:', micResult?.status);
        }
      } catch (err) {
        console.error('[Teleprompter] Permission request error:', err);
      }
    };
    requestPermissions();
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      scrollAnimation.current?.stop();
    };
  }, []);

  const toggleCamera = () => {
    setFacing(current => (current === 'front' ? 'back' : 'front'));
  };

  const startTeleprompter = () => {
    const speedMultiplier = [0.15, 0.25, 0.4, 0.6, 0.8][speed - 1];
    const duration = (totalContentHeight / speedMultiplier) * 50;
    
    currentScrollPosition.current = 0;
    scrollAnim.setValue(0);
    
    scrollAnimation.current = Animated.timing(scrollAnim, {
      toValue: totalContentHeight,
      duration,
      useNativeDriver: true,
    });
    scrollAnimation.current.start(({ finished }) => {
      if (finished) {
        setIsPlaying(false);
      }
    });
    setIsPlaying(true);
  };

  const pauseTeleprompter = () => {
    scrollAnimation.current?.stop();
    scrollAnim.stopAnimation((value) => {
      currentScrollPosition.current = value;
    });
    setIsPlaying(false);
  };

  const resumeTeleprompter = () => {
    const speedMultiplier = [0.15, 0.25, 0.4, 0.6, 0.8][speed - 1];
    const remainingHeight = totalContentHeight - currentScrollPosition.current;
    const duration = (remainingHeight / speedMultiplier) * 50;
    
    scrollAnimation.current = Animated.timing(scrollAnim, {
      toValue: totalContentHeight,
      duration: Math.max(duration, 1000),
      useNativeDriver: true,
    });
    scrollAnimation.current.start(({ finished }) => {
      if (finished) {
        setIsPlaying(false);
      }
    });
    setIsPlaying(true);
  };

  const resetTeleprompter = () => {
    scrollAnimation.current?.stop();
    scrollAnim.setValue(0);
    currentScrollPosition.current = 0;
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      pauseTeleprompter();
    } else if (currentScrollPosition.current > 0) {
      resumeTeleprompter();
    } else {
      startTeleprompter();
    }
  };

  const handleSpeedChange = (value: number) => {
    const newSpeed = Math.round(value);
    setSpeed(newSpeed);
    
    if (isPlaying) {
      scrollAnim.stopAnimation((currentValue) => {
        currentScrollPosition.current = currentValue;
        
        const speedMultiplier = [0.15, 0.25, 0.4, 0.6, 0.8][newSpeed - 1];
        const remainingHeight = totalContentHeight - currentValue;
        const duration = (remainingHeight / speedMultiplier) * 50;
        
        scrollAnimation.current = Animated.timing(scrollAnim, {
          toValue: totalContentHeight,
          duration: Math.max(duration, 1000),
          useNativeDriver: true,
        });
        scrollAnimation.current.start(({ finished }) => {
          if (finished) setIsPlaying(false);
        });
      });
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;

    // Countdown
    for (let i = 3; i > 0; i--) {
      setCountdown(i);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    setCountdown(null);

    try {
      trackRecordingStarted(params.scriptId || '', parseInt(params.sceneIndex || '0'));
      setIsRecording(true);
      setRecordingDuration(0);
      recordingStartTime.current = Date.now();
      
      // Start duration timer
      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      // Auto-start teleprompter when recording begins
      if (!isPlaying) {
        startTeleprompter();
      }

      const video = await cameraRef.current.recordAsync({
        maxDuration: 600,
      });

      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }

      const finalDuration = Math.round((Date.now() - recordingStartTime.current) / 1000);

      if (video?.uri) {
        setIsRecording(false);
        pauseTeleprompter();
        setProcessingVideo(true);
        
        trackRecordingCompleted(params.scriptId || '', finalDuration);
        
        setRecordedVideoUri(video.uri);
        setProcessingVideo(false);
        setShowActionSheet(true);
      }
    } catch (error) {
      console.error('Recording error:', error);
      setIsRecording(false);
      pauseTeleprompter();
      setProcessingVideo(false);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Recording Error', `Failed to record: ${errMsg}. Check camera and storage permissions.`);
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
    }
  };

  const handleShareNow = async () => {
    if (!recordedVideoUri) return;
    
    setIsSharing(true);
    trackShareInitiated(params.scriptId || '');
    
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(recordedVideoUri, {
          mimeType: 'video/mp4',
          dialogTitle: 'Share Self-Tape',
        });
        trackShareCompleted(params.scriptId || '');
        await handleSaveQuietly();
      }
    } catch (error) {
      console.error('Share error:', error);
      await handleSaveQuietly();
    } finally {
      setIsSharing(false);
    }
  };

  const handleSaveQuietly = async () => {
    if (!recordedVideoUri) return;
    try {
      await saveRecording(
        recordedVideoUri,
        params.scriptId || '',
        script?.title || 'Teleprompter Recording',
        parseInt(params.sceneIndex || '0'),
        currentScene?.name || 'Scene',
        recordingDuration
      );
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  };

  const handleSave = async () => {
    if (!recordedVideoUri) return;
    
    setIsSaving(true);
    try {
      // Verify source file before attempting save
      const sourceInfo = await FileSystem.getInfoAsync(recordedVideoUri);
      if (!sourceInfo.exists) {
        throw new Error('Recording file no longer exists. It may have been cleaned up by the system.');
      }
      console.log('[Teleprompter] Saving video, source size:', (sourceInfo as any).size || 'unknown');

      await saveRecording(
        recordedVideoUri,
        params.scriptId || '',
        script?.title || 'Teleprompter Recording',
        parseInt(params.sceneIndex || '0'),
        currentScene?.name || 'Scene',
        recordingDuration
      );
      
      trackVideoSaved(params.scriptId || '');
      
      Alert.alert('Saved!', 'Your recording has been saved.', [
        { text: 'OK', onPress: () => {
          setShowActionSheet(false);
          router.replace('/selftape');
        }}
      ]);
    } catch (error: any) {
      console.error('[Teleprompter] Save failed:', error?.message || error);
      Alert.alert('Save Failed', `Could not save: ${error?.message || 'Unknown error'}. Check storage permissions.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRetake = () => {
    setShowActionSheet(false);
    setRecordedVideoUri(null);
    setRecordingDuration(0);
    resetTeleprompter();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPositionStyle = () => {
    switch (position) {
      case 'top':
        return { top: Platform.OS === 'ios' ? 100 : 80 };
      case 'middle':
        return { top: SCREEN_HEIGHT / 2 - 100 };
      case 'bottom':
      default:
        return { bottom: 180 };
    }
  };

  // Permission loading state — hooks haven't returned status yet
  if (cameraPermission === null || micPermission === null) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionView}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.permissionTitle}>Checking permissions...</Text>
        </View>
      </View>
    );
  }

  // Permission denied view
  if (!cameraPermission?.granted || !micPermission?.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionView}>
          <Ionicons name="videocam-off" size={64} color="#6b7280" />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            Please grant camera and microphone access to use the teleprompter.
          </Text>
          <TouchableOpacity 
            style={styles.permissionButton}
            onPress={async () => {
              await requestCameraPermission();
              await requestMicPermission();
            }}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Full Screen Camera */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="video"
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          
          <Text style={styles.titleText} numberOfLines={1}>
            {currentScene?.name || script?.title || 'Teleprompter'}
          </Text>
          
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconButton}>
            <Ionicons name="settings-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Recording Indicator */}
        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
          </View>
        )}

        {/* Countdown Overlay */}
        {countdown !== null && (
          <View style={styles.countdownOverlay}>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        )}

        {/* Teleprompter Overlay */}
        <View style={[styles.teleprompterContainer, getPositionStyle()]}>
          <View style={[styles.teleprompterWindow, { opacity }]}>
            <Animated.View
              style={{
                transform: [{ translateY: Animated.multiply(scrollAnim, -1) }],
              }}
            >
              {lines.map((line: any, index: number) => {
                const isMyLine = line.character?.toLowerCase() === userCharacter?.toLowerCase();
                return (
                  <View key={index} style={styles.lineContainer}>
                    <Text 
                      style={[
                        styles.characterLabel,
                        isMyLine && highlightMyLines && styles.myCharacterLabel
                      ]}
                    >
                      {line.character}
                    </Text>
                    <Text 
                      style={[
                        styles.lineText,
                        { fontSize },
                        isMyLine && highlightMyLines && styles.myLineText
                      ]}
                    >
                      {line.text}
                    </Text>
                  </View>
                );
              })}
              {/* Extra padding at end */}
              <View style={{ height: visibleHeight }} />
            </Animated.View>
          </View>
          
          {/* Gradient overlays */}
          <View style={styles.gradientTop} pointerEvents="none" />
          <View style={styles.gradientBottom} pointerEvents="none" />
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomControls}>
          {/* Teleprompter Controls Row */}
          <View style={styles.teleprompterControls}>
            <TouchableOpacity onPress={resetTeleprompter} style={styles.smallButton}>
              <Ionicons name="refresh" size={20} color="#fff" />
            </TouchableOpacity>
            
            <TouchableOpacity onPress={togglePlayPause} style={styles.playButton}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
            </TouchableOpacity>
            
            <View style={styles.speedControl}>
              <Text style={styles.speedLabel}>{speed}x</Text>
              <Slider
                style={styles.speedSlider}
                minimumValue={1}
                maximumValue={5}
                step={1}
                value={speed}
                onValueChange={handleSpeedChange}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#374151"
                thumbTintColor="#6366f1"
              />
            </View>
          </View>
          
          {/* Camera Controls Row */}
          <View style={styles.cameraControls}>
            <TouchableOpacity onPress={toggleCamera} style={styles.controlButton}>
              <Ionicons name="camera-reverse" size={28} color="#fff" />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.recordButton, isRecording && styles.recordButtonRecording]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              {isRecording ? (
                <View style={styles.stopIcon} />
              ) : (
                <View style={styles.recordIcon} />
              )}
            </TouchableOpacity>
            
            <View style={{ width: 60 }} />
          </View>
        </View>
      </CameraView>

      {/* Settings Modal */}
      <Modal visible={showSettings} transparent animationType="fade">
        <TouchableOpacity 
          style={styles.settingsOverlay} 
          activeOpacity={1}
          onPress={() => setShowSettings(false)}
        >
          <View style={styles.settingsPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.settingsTitle}>Teleprompter Settings</Text>
            
            {/* Font Size */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Font Size</Text>
              <View style={styles.fontButtons}>
                <TouchableOpacity 
                  style={styles.fontButton}
                  onPress={() => setFontSize(Math.max(16, fontSize - 2))}
                >
                  <Text style={styles.fontButtonText}>A-</Text>
                </TouchableOpacity>
                <Text style={styles.fontSizeValue}>{fontSize}</Text>
                <TouchableOpacity 
                  style={styles.fontButton}
                  onPress={() => setFontSize(Math.min(36, fontSize + 2))}
                >
                  <Text style={styles.fontButtonText}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            {/* Opacity */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Background Opacity</Text>
              <Slider
                style={styles.settingSlider}
                minimumValue={0.5}
                maximumValue={1}
                value={opacity}
                onValueChange={setOpacity}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#374151"
                thumbTintColor="#6366f1"
              />
            </View>
            
            {/* Position */}
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Position</Text>
              <View style={styles.positionButtons}>
                {(['top', 'middle', 'bottom'] as const).map((pos) => (
                  <TouchableOpacity
                    key={pos}
                    style={[
                      styles.positionButton,
                      position === pos && styles.positionButtonActive
                    ]}
                    onPress={() => setPosition(pos)}
                  >
                    <Text style={[
                      styles.positionButtonText,
                      position === pos && styles.positionButtonTextActive
                    ]}>
                      {pos.charAt(0).toUpperCase() + pos.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            {/* Highlight Toggle */}
            <TouchableOpacity 
              style={styles.settingRow}
              onPress={() => setHighlightMyLines(!highlightMyLines)}
            >
              <Text style={styles.settingLabel}>Highlight My Lines</Text>
              <Ionicons 
                name={highlightMyLines ? 'checkbox' : 'square-outline'} 
                size={24} 
                color={highlightMyLines ? '#6366f1' : '#6b7280'} 
              />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.settingsDone}
              onPress={() => setShowSettings(false)}
            >
              <Text style={styles.settingsDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Processing Overlay */}
      {processingVideo && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.processingText}>Processing...</Text>
        </View>
      )}

      {/* Post-Record Action Sheet */}
      <Modal visible={showActionSheet} transparent animationType="slide">
        <View style={styles.actionSheetBackdrop}>
          <View style={styles.actionSheet}>
            <View style={styles.actionSheetHandle} />
            
            <Text style={styles.actionSheetTitle}>Recording Complete!</Text>
            <Text style={styles.actionSheetSubtitle}>
              {formatDuration(recordingDuration)} • Teleprompter Mode
            </Text>

            <TouchableOpacity 
              style={styles.primaryActionButton}
              onPress={handleShareNow}
              disabled={isSharing}
            >
              {isSharing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="share-social" size={24} color="#fff" />
                  <Text style={styles.primaryActionText}>Share Now</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.secondaryActions}>
              <TouchableOpacity 
                style={styles.secondaryActionButton}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#6366f1" size="small" />
                ) : (
                  <>
                    <Ionicons name="bookmark" size={22} color="#6366f1" />
                    <Text style={styles.secondaryActionText}>Save</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.secondaryActionButton}
                onPress={handleRetake}
              >
                <Ionicons name="refresh" size={22} color="#6366f1" />
                <Text style={styles.secondaryActionText}>Retake</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  
  // Top Bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  
  // Recording
  recordingIndicator: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 100,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
    marginRight: 8,
  },
  recordingTime: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontWeight: '700',
    color: '#fff',
  },
  
  // Teleprompter
  teleprompterContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 200,
    overflow: 'hidden',
  },
  teleprompterWindow: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 16,
    padding: 16,
    height: 200,
    overflow: 'hidden',
  },
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 40,
    backgroundColor: 'transparent',
  },
  gradientBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    backgroundColor: 'transparent',
  },
  lineContainer: {
    paddingVertical: 8,
  },
  characterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  myCharacterLabel: {
    color: '#6366f1',
  },
  lineText: {
    color: '#fff',
    lineHeight: 32,
  },
  myLineText: {
    color: '#a5b4fc',
    fontWeight: '600',
  },
  
  // Bottom Controls
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  teleprompterControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 16,
  },
  smallButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  speedLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    width: 28,
  },
  speedSlider: {
    width: 100,
    height: 40,
  },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 40,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  recordButtonRecording: {
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    borderColor: '#ef4444',
  },
  recordIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#ef4444',
  },
  stopIcon: {
    width: 30,
    height: 30,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  
  // Settings Modal
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsPanel: {
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 340,
  },
  settingsTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 24,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  settingLabel: {
    fontSize: 15,
    color: '#e5e7eb',
  },
  fontButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fontButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fontButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6366f1',
  },
  fontSizeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    width: 30,
    textAlign: 'center',
  },
  settingSlider: {
    width: 150,
    height: 40,
  },
  positionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  positionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
  positionButtonActive: {
    backgroundColor: '#6366f1',
  },
  positionButtonText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  positionButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  settingsDone: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  settingsDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  
  // Processing
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    fontSize: 16,
    color: '#fff',
    marginTop: 16,
  },
  
  // Action Sheet
  actionSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  actionSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#374151',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  actionSheetTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  actionSheetSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  primaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 18,
    borderRadius: 14,
    gap: 10,
  },
  primaryActionText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  secondaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  secondaryActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6366f1',
  },
  
  // Permission
  permissionView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 20,
  },
  permissionText: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  permissionButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 32,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cancelButton: {
    marginTop: 16,
  },
  cancelButtonText: {
    fontSize: 15,
    color: '#6b7280',
  },
});
