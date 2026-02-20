import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  Animated,
  Dimensions,
  Modal,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Sharing from 'expo-sharing';
import Slider from '@react-native-community/slider';
import { useScriptStore } from '../../store/scriptStore';
import { 
  trackRecordingStarted, 
  trackRecordingCompleted, 
  trackTeleprompterToggled,
  trackShareInitiated,
  trackShareCompleted,
  trackVideoSaved,
  trackRetakeStarted,
  trackWatermarkApplied,
} from '../../services/analyticsService';
import { saveRecording, checkStorageAvailable, saveToGallery } from '../../services/selfTapeStorage';
import ShotCoachOverlay from '../../components/ShotCoachOverlay';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CAMERA_HEIGHT = SCREEN_HEIGHT * 0.6;

export default function RecordScreen() {
  const params = useLocalSearchParams<{
    scriptId: string;
    sceneIndex: string;
    character: string;
    fontSize: string;
    hideOthers: string;
    countdown: string;
    teleprompter: string;
    teleprompterSpeed: string;
  }>();

  const { scripts } = useScriptStore();
  const script = scripts.find(s => s.id === params.scriptId);
  const scenes = script?.scenes || [{ name: 'Full Script', lines: script?.lines || [] }];
  const currentScene = scenes[parseInt(params.sceneIndex || '0')];
  
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  
  const [facing, setFacing] = useState<CameraType>('front');
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [teleprompterActive, setTeleprompterActive] = useState(params.teleprompter === 'true');
  
  // Post-record state
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [processingVideo, setProcessingVideo] = useState(false);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  
  // Teleprompter controls state
  const [teleprompterPlaying, setTeleprompterPlaying] = useState(false);
  const [currentFontSize, setCurrentFontSize] = useState(parseInt(params.fontSize || '18'));
  const [currentSpeed, setCurrentSpeed] = useState(parseInt(params.teleprompterSpeed || '3'));
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  
  // Shot Coach state
  const [showShotCoach, setShowShotCoach] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showEyeLine, setShowEyeLine] = useState(true);
  const [showHeadroom, setShowHeadroom] = useState(true);
  const [showShotCoachMenu, setShowShotCoachMenu] = useState(false);
  
  const cameraRef = useRef<CameraView>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const teleprompterAnim = useRef(new Animated.Value(0)).current;
  const teleprompterAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const recordingStartTime = useRef<number>(0);
  const currentScrollPosition = useRef(0);

  const hideOthers = params.hideOthers === 'true';
  const countdownEnabled = params.countdown === 'true';

  // Request permissions
  useEffect(() => {
    const requestPermissions = async () => {
      if (!cameraPermission?.granted) {
        await requestCameraPermission();
      }
      if (!micPermission?.granted) {
        await requestMicPermission();
      }
    };
    requestPermissions();
  }, []);

  // Check storage
  useEffect(() => {
    checkStorageAvailable().then(({ available, freeSpace }) => {
      if (!available) {
        Alert.alert(
          'Low Storage',
          `Only ${Math.round(freeSpace || 0)}MB available. Recording may fail. Please free up space.`,
          [
            { text: 'Continue Anyway' },
            { text: 'Go Back', onPress: () => router.back() }
          ]
        );
      }
    });
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      teleprompterAnimation.current?.stop();
    };
  }, []);

  // Auto-hide controls during recording
  useEffect(() => {
    if (isRecording) {
      hideControlsWithDelay();
    } else {
      showControlsAnimated();
    }
  }, [isRecording]);

  const hideControlsWithDelay = () => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
    }
    controlsTimeout.current = setTimeout(() => {
      Animated.timing(controlsOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setShowControls(false));
    }, 2000);
  };

  const showControlsAnimated = () => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
    }
    setShowControls(true);
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const handleScriptTap = () => {
    if (isRecording) {
      if (showControls) {
        hideControlsWithDelay();
      } else {
        showControlsAnimated();
        hideControlsWithDelay();
      }
    }
  };

  const toggleCamera = () => {
    setFacing(current => (current === 'front' ? 'back' : 'front'));
  };

  const toggleTeleprompter = () => {
    const newState = !teleprompterActive;
    setTeleprompterActive(newState);
    trackTeleprompterToggled(newState);
    
    if (!newState) {
      pauseTeleprompter();
    }
  };

  const toggleTeleprompterPlayPause = () => {
    if (teleprompterPlaying) {
      pauseTeleprompter();
    } else {
      resumeTeleprompter();
    }
  };

  const pauseTeleprompter = () => {
    teleprompterAnimation.current?.stop();
    // Store current position
    teleprompterAnim.stopAnimation((value) => {
      currentScrollPosition.current = value;
    });
    setTeleprompterPlaying(false);
  };

  const resumeTeleprompter = () => {
    if (!teleprompterActive) return;
    
    const lines = currentScene?.lines || [];
    const totalScrollHeight = lines.length * (currentFontSize + 20) * 2;
    const speedMultiplier = [0.2, 0.4, 0.6, 0.8, 1.0][currentSpeed - 1];
    const remainingHeight = totalScrollHeight - currentScrollPosition.current;
    const duration = (remainingHeight / speedMultiplier) * 60;
    
    teleprompterAnimation.current = Animated.timing(teleprompterAnim, {
      toValue: totalScrollHeight,
      duration: Math.max(duration, 1000),
      useNativeDriver: true,
    });
    teleprompterAnimation.current.start(({ finished }) => {
      if (finished) {
        setTeleprompterPlaying(false);
      }
    });
    setTeleprompterPlaying(true);
  };

  const startTeleprompter = () => {
    if (!teleprompterActive) return;
    
    const lines = currentScene?.lines || [];
    const totalScrollHeight = lines.length * (currentFontSize + 20) * 2;
    const speedMultiplier = [0.2, 0.4, 0.6, 0.8, 1.0][currentSpeed - 1];
    const duration = (totalScrollHeight / speedMultiplier) * 60;
    
    currentScrollPosition.current = 0;
    teleprompterAnim.setValue(0);
    teleprompterAnimation.current = Animated.timing(teleprompterAnim, {
      toValue: totalScrollHeight,
      duration,
      useNativeDriver: true,
    });
    teleprompterAnimation.current.start(({ finished }) => {
      if (finished) {
        setTeleprompterPlaying(false);
      }
    });
    setTeleprompterPlaying(true);
  };

  const handleSpeedChange = (value: number) => {
    const newSpeed = Math.round(value);
    setCurrentSpeed(newSpeed);
    
    // If playing, restart with new speed
    if (teleprompterPlaying) {
      teleprompterAnim.stopAnimation((currentValue) => {
        currentScrollPosition.current = currentValue;
        
        const lines = currentScene?.lines || [];
        const totalScrollHeight = lines.length * (currentFontSize + 20) * 2;
        const speedMultiplier = [0.2, 0.4, 0.6, 0.8, 1.0][newSpeed - 1];
        const remainingHeight = totalScrollHeight - currentValue;
        const duration = (remainingHeight / speedMultiplier) * 60;
        
        teleprompterAnimation.current = Animated.timing(teleprompterAnim, {
          toValue: totalScrollHeight,
          duration: Math.max(duration, 1000),
          useNativeDriver: true,
        });
        teleprompterAnimation.current.start(({ finished }) => {
          if (finished) setTeleprompterPlaying(false);
        });
      });
    }
  };

  const adjustFontSize = (delta: number) => {
    setCurrentFontSize(prev => Math.max(12, Math.min(32, prev + delta)));
  };

  const toggleHighlight = () => {
    setHighlightEnabled(prev => !prev);
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;

    if (countdownEnabled) {
      // Countdown
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      setCountdown(null);
    }

    try {
      trackRecordingStarted(params.scriptId || '', parseInt(params.sceneIndex || '0'));
      setIsRecording(true);
      setRecordingDuration(0);
      recordingStartTime.current = Date.now();
      
      // Start duration timer
      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      // Start teleprompter if enabled
      if (teleprompterActive) {
        startTeleprompter();
      }

      const video = await cameraRef.current.recordAsync({
        maxDuration: 600, // 10 minutes max
      });

      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }

      const finalDuration = Math.round((Date.now() - recordingStartTime.current) / 1000);

      if (video?.uri) {
        setIsRecording(false);
        setTeleprompterPlaying(false);
        setProcessingVideo(true);
        
        // Track completion
        trackRecordingCompleted(params.scriptId || '', finalDuration);
        
        // Apply watermark (placeholder - actual watermark would need native module)
        // For MVP, we'll proceed without actual watermark but track the event
        trackWatermarkApplied(true);
        
        setRecordedVideoUri(video.uri);
        setProcessingVideo(false);
        setShowActionSheet(true);
      }
    } catch (error) {
      console.error('Recording error:', error);
      setIsRecording(false);
      setTeleprompterPlaying(false);
      setProcessingVideo(false);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      
      Alert.alert(
        'Recording Error', 
        'Failed to record video. Please check camera permissions and try again.',
        [
          { text: 'Try Again' },
          { text: 'Go Back', onPress: () => router.back() }
        ]
      );
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
      pauseTeleprompter();
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
          UTI: 'public.mpeg-4',
        });
        trackShareCompleted(params.scriptId || '');
        
        // Auto-save after sharing
        await handleSaveQuietly();
      } else {
        Alert.alert('Sharing Unavailable', 'Sharing is not available on this device.');
      }
    } catch (error) {
      console.error('Share error:', error);
      // Still try to save even if share fails
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
        script?.title || 'Unknown Script',
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
      await saveRecording(
        recordedVideoUri,
        params.scriptId || '',
        script?.title || 'Unknown Script',
        parseInt(params.sceneIndex || '0'),
        currentScene?.name || 'Scene',
        recordingDuration
      );
      
      trackVideoSaved(params.scriptId || '');
      
      Alert.alert('Saved!', 'Your self-tape has been saved to your library.', [
        { text: 'OK', onPress: () => {
          setShowActionSheet(false);
          router.replace('/selftape');
        }}
      ]);
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Save Failed', 'Could not save the recording. Please try again or share directly.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRetake = () => {
    trackRetakeStarted(params.scriptId || '');
    setShowActionSheet(false);
    setRecordedVideoUri(null);
    setRecordingDuration(0);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const openSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  // Permission denied view
  if (!cameraPermission?.granted || !micPermission?.granted) {
    const cameraGranted = cameraPermission?.granted;
    const micGranted = micPermission?.granted;
    
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionView}>
          <Ionicons name="videocam-off" size={64} color="#6b7280" />
          <Text style={styles.permissionTitle}>Permissions Required</Text>
          <Text style={styles.permissionText}>
            Self Tape needs access to your {!cameraGranted && 'camera'}{!cameraGranted && !micGranted && ' and '}{!micGranted && 'microphone'} to record videos.
          </Text>
          
          {(cameraPermission?.canAskAgain || micPermission?.canAskAgain) ? (
            <TouchableOpacity 
              style={styles.permissionButton}
              onPress={async () => {
                if (!cameraGranted) await requestCameraPermission();
                if (!micGranted) await requestMicPermission();
              }}
            >
              <Text style={styles.permissionButtonText}>Grant Permission</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={styles.permissionButton}
              onPress={openSettings}
            >
              <Ionicons name="settings-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.permissionButtonText}>Open Settings</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const lines = currentScene?.lines || [];

  return (
    <View style={styles.container}>
      {/* Script Overlay - Top 40% */}
      <TouchableOpacity 
        style={styles.scriptContainer} 
        activeOpacity={1}
        onPress={handleScriptTap}
      >
        <View style={styles.scriptHeader}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.scriptTitle} numberOfLines={1}>
            {currentScene?.name || script?.title}
          </Text>
          <TouchableOpacity onPress={toggleTeleprompter} style={styles.teleprompterButton}>
            <Ionicons 
              name={teleprompterActive ? 'reader' : 'reader-outline'} 
              size={22} 
              color={teleprompterActive ? '#6366f1' : '#9ca3af'} 
            />
          </TouchableOpacity>
        </View>

        <Animated.ScrollView
          ref={scrollViewRef}
          style={styles.scriptScroll}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!teleprompterPlaying}
          contentContainerStyle={{ 
            paddingBottom: 100,
            transform: teleprompterActive && teleprompterPlaying ? [{ translateY: Animated.multiply(teleprompterAnim, -1) }] : []
          }}
        >
          {lines.map((line: any, index: number) => {
            const isMyLine = line.character === params.character;
            if (hideOthers && !isMyLine) {
              return (
                <View key={index} style={styles.lineContainer}>
                  <Text style={[styles.characterName, styles.otherCharacter]}>{line.character}</Text>
                  <Text style={[styles.lineText, { fontSize: currentFontSize }, styles.hiddenLine]}>• • •</Text>
                </View>
              );
            }
            return (
              <View key={index} style={[
                styles.lineContainer, 
                isMyLine && highlightEnabled && styles.myLineContainer
              ]}>
                <Text style={[
                  styles.characterName, 
                  isMyLine && highlightEnabled && styles.myCharacterName
                ]}>
                  {line.character}
                </Text>
                <Text style={[
                  styles.lineText, 
                  { fontSize: currentFontSize }, 
                  isMyLine && highlightEnabled && styles.myLineText
                ]}>
                  {line.text}
                </Text>
              </View>
            );
          })}
        </Animated.ScrollView>

        {/* Teleprompter Controls Overlay */}
        {teleprompterActive && showControls && (
          <Animated.View style={[styles.teleprompterControls, { opacity: controlsOpacity }]}>
            {/* Play/Pause Button */}
            <TouchableOpacity 
              style={styles.controlPlayButton} 
              onPress={toggleTeleprompterPlayPause}
            >
              <Ionicons 
                name={teleprompterPlaying ? 'pause' : 'play'} 
                size={24} 
                color="#fff" 
              />
            </TouchableOpacity>

            {/* Speed Slider */}
            <View style={styles.speedControlContainer}>
              <Ionicons name="speedometer-outline" size={16} color="#9ca3af" />
              <Slider
                style={styles.speedSlider}
                minimumValue={1}
                maximumValue={5}
                step={1}
                value={currentSpeed}
                onValueChange={handleSpeedChange}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#374151"
                thumbTintColor="#6366f1"
              />
              <Text style={styles.speedLabel}>{currentSpeed}x</Text>
            </View>

            {/* Font Size Controls */}
            <View style={styles.fontControls}>
              <TouchableOpacity 
                style={styles.fontButton} 
                onPress={() => adjustFontSize(-2)}
              >
                <Text style={styles.fontButtonText}>A-</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.fontButton} 
                onPress={() => adjustFontSize(2)}
              >
                <Text style={styles.fontButtonText}>A+</Text>
              </TouchableOpacity>
            </View>

            {/* Highlight Toggle */}
            <TouchableOpacity 
              style={[
                styles.highlightToggle, 
                highlightEnabled && styles.highlightToggleActive
              ]} 
              onPress={toggleHighlight}
            >
              <Ionicons 
                name="color-wand" 
                size={18} 
                color={highlightEnabled ? '#6366f1' : '#6b7280'} 
              />
            </TouchableOpacity>
          </Animated.View>
        )}
      </TouchableOpacity>

      {/* Camera View - Bottom 60% */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode="video"
        >
          {/* Shot Coach Overlay */}
          {showShotCoach && (
            <ShotCoachOverlay
              showGrid={showGrid}
              showEyeLine={showEyeLine}
              showHeadroom={showHeadroom}
              cameraHeight={CAMERA_HEIGHT}
            />
          )}

          {/* Face Guide Overlay */}
          {!showShotCoach && (
            <View style={styles.faceGuide}>
              <View style={styles.faceGuideOval} />
            </View>
          )}

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

          {/* Controls */}
          <View style={styles.controlsContainer}>
            {/* Top Controls */}
            <View style={styles.topControls}>
              <TouchableOpacity 
                style={styles.controlButton} 
                onPress={toggleCamera}
                disabled={isRecording}
              >
                <Ionicons name="camera-reverse" size={28} color="#fff" />
              </TouchableOpacity>
              
              {/* Shot Coach Toggle */}
              <TouchableOpacity 
                style={[styles.controlButton, showShotCoach && styles.controlButtonActive]} 
                onPress={() => setShowShotCoach(!showShotCoach)}
                onLongPress={() => setShowShotCoachMenu(true)}
              >
                <Ionicons name="grid" size={24} color={showShotCoach ? '#10b981' : '#fff'} />
              </TouchableOpacity>
            </View>

            {/* Bottom Controls */}
            <View style={styles.bottomControls}>
              {/* Record Button */}
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
            </View>
          </View>
        </CameraView>
      </View>

      {/* Shot Coach Menu */}
      <Modal visible={showShotCoachMenu} transparent animationType="fade">
        <TouchableOpacity 
          style={styles.shotCoachMenuOverlay} 
          activeOpacity={1} 
          onPress={() => setShowShotCoachMenu(false)}
        >
          <View style={styles.shotCoachMenu}>
            <Text style={styles.shotCoachMenuTitle}>Shot Coach Overlays</Text>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuItem} 
              onPress={() => setShowGrid(!showGrid)}
            >
              <Ionicons name="grid-outline" size={20} color={showGrid ? '#10b981' : '#6b7280'} />
              <Text style={[styles.shotCoachMenuText, showGrid && styles.shotCoachMenuTextActive]}>
                Rule of Thirds Grid
              </Text>
              <Ionicons name={showGrid ? 'checkbox' : 'square-outline'} size={20} color={showGrid ? '#10b981' : '#6b7280'} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuItem} 
              onPress={() => setShowEyeLine(!showEyeLine)}
            >
              <Ionicons name="eye-outline" size={20} color={showEyeLine ? '#6366f1' : '#6b7280'} />
              <Text style={[styles.shotCoachMenuText, showEyeLine && styles.shotCoachMenuTextActive]}>
                Eye-line Markers
              </Text>
              <Ionicons name={showEyeLine ? 'checkbox' : 'square-outline'} size={20} color={showEyeLine ? '#6366f1' : '#6b7280'} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuItem} 
              onPress={() => setShowHeadroom(!showHeadroom)}
            >
              <Ionicons name="resize-outline" size={20} color={showHeadroom ? '#f59e0b' : '#6b7280'} />
              <Text style={[styles.shotCoachMenuText, showHeadroom && styles.shotCoachMenuTextActive]}>
                Headroom Boundary
              </Text>
              <Ionicons name={showHeadroom ? 'checkbox' : 'square-outline'} size={20} color={showHeadroom ? '#f59e0b' : '#6b7280'} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuClose} 
              onPress={() => setShowShotCoachMenu(false)}
            >
              <Text style={styles.shotCoachMenuCloseText}>Done</Text>
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
      <Modal
        visible={showActionSheet}
        transparent
        animationType="slide"
        onRequestClose={() => {}}
      >
        <View style={styles.actionSheetBackdrop}>
          <View style={styles.actionSheet}>
            <View style={styles.actionSheetHandle} />
            
            <Text style={styles.actionSheetTitle}>Take Complete! 🎬</Text>
            <Text style={styles.actionSheetSubtitle}>
              {formatDuration(recordingDuration)} • {currentScene?.name || 'Scene'}
            </Text>

            {/* Primary Action - Share Now */}
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

            {/* Secondary Actions */}
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

            {/* Review option */}
            <TouchableOpacity 
              style={styles.reviewButton}
              onPress={() => {
                setShowActionSheet(false);
                router.replace({
                  pathname: '/selftape/review',
                  params: {
                    videoUri: recordedVideoUri || '',
                    scriptId: params.scriptId,
                    sceneIndex: params.sceneIndex,
                    duration: recordingDuration.toString(),
                  },
                });
              }}
            >
              <Text style={styles.reviewButtonText}>Review Recording</Text>
              <Ionicons name="chevron-forward" size={18} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  
  // Script Section
  scriptContainer: {
    height: '40%',
    backgroundColor: '#0a0a0f',
  },
  scriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    backgroundColor: '#0a0a0f',
  },
  closeButton: { padding: 4 },
  scriptTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#fff', textAlign: 'center', marginHorizontal: 8 },
  teleprompterButton: {
    padding: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderRadius: 8,
  },
  scriptScroll: { flex: 1, paddingHorizontal: 16 },
  lineContainer: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  myLineContainer: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  characterName: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' },
  myCharacterName: { color: '#6366f1' },
  otherCharacter: { color: '#4b5563' },
  lineText: { color: '#e5e7eb', lineHeight: 24 },
  myLineText: { color: '#fff', fontWeight: '500' },
  hiddenLine: { color: '#4b5563', fontStyle: 'italic' },

  // Camera Section
  cameraContainer: {
    height: '60%',
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  faceGuide: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuideOval: {
    width: 180,
    height: 240,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 90,
    marginTop: -60,
  },
  recordingIndicator: {
    position: 'absolute',
    top: 20,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
    marginRight: 8,
  },
  recordingTime: { fontSize: 14, fontWeight: '600', color: '#fff' },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: { fontSize: 120, fontWeight: '700', color: '#fff' },
  controlsContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 20,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomControls: {
    alignItems: 'center',
    paddingBottom: 40,
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

  // Processing Overlay
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
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  reviewButtonText: {
    fontSize: 14,
    color: '#6b7280',
    marginRight: 4,
  },

  // Teleprompter Controls
  teleprompterControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(10, 10, 15, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(99, 102, 241, 0.2)',
  },
  controlPlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedControlContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    gap: 4,
  },
  speedSlider: {
    flex: 1,
    height: 40,
  },
  speedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
    width: 24,
    textAlign: 'center',
  },
  fontControls: {
    flexDirection: 'row',
    gap: 4,
  },
  fontButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fontButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e5e7eb',
  },
  highlightToggle: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(107, 114, 128, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  highlightToggleActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
  },

  // Permission View
  permissionView: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 20 },
  permissionText: { fontSize: 15, color: '#9ca3af', textAlign: 'center', marginTop: 12, lineHeight: 22 },
  permissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 32,
  },
  permissionButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  cancelButton: { marginTop: 16 },
  cancelButtonText: { fontSize: 15, color: '#6b7280' },
  
  // Shot Coach Menu
  controlButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  shotCoachMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shotCoachMenu: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    width: '80%',
    maxWidth: 300,
  },
  shotCoachMenuTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  shotCoachMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  shotCoachMenuText: {
    flex: 1,
    fontSize: 15,
    color: '#9ca3af',
    marginLeft: 12,
  },
  shotCoachMenuTextActive: {
    color: '#fff',
  },
  shotCoachMenuClose: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  shotCoachMenuCloseText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
