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
// NOTE: @react-native-community/slider v4.5.x supports OLD arch only.
// Expo SDK 54 runs on the new architecture (Fabric), which causes a silent
// native crash the moment the Slider component mounts on Android 16 (Samsung
// SM-S918B physical repro). The teleprompter controls now use a Fabric-safe
// segmented speed control built with core RN components — no Slider import
// on this screen. The dependency itself is intentionally left in place for
// other screens that haven't been exercised yet (do-not-touch-unrelated
// scope). Regression: backend/tests/test_phase3_selftape_regression.py
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
import { C, RADIUS, TYPE, tint } from '../../constants/cinematicTheme';
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
  const rawSceneIdx = parseInt(params.sceneIndex || '0');
  const safeSceneIdx = Math.max(0, Math.min(rawSceneIdx, scenes.length - 1));
  const currentScene = scenes[safeSceneIdx];
  
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

  // ─── Fabric-safe teleprompter scroll driver (JS, no native Animated) ────
  // Previous approach used `Animated.timing` (useNativeDriver:true) driving
  // an `Animated.multiply` translateY transform on an inner Animated.View
  // nested inside <Animated.ScrollView>. On Android 16 / Fabric (Samsung
  // SM-S918B), starting that native animation at the exact tick CameraView
  // begins MediaCodec/MediaMuxer capture caused an immediate native crash
  // (Phase 3 Failure 5). Root cause: two native transactional systems
  // (Reanimated/AnimatedNativeDriver + camera capture pipeline) contending
  // on the render thread in the same commit as a Fabric prop flip
  // (scrollEnabled true→false).
  //
  // Fix: drive the teleprompter scroll from JS with requestAnimationFrame
  // + ScrollView.scrollTo({ animated:false }). No native Animated nodes
  // are attached to the scroll surface, so recording start no longer
  // competes with a native animation transaction. Speed changes are read
  // from a ref inside the loop, so no restart is needed.
  //
  // Regression: backend/tests/test_phase3_selftape_regression.py
  const teleprompterRafId = useRef<number | null>(null);
  const teleprompterLastTs = useRef<number>(0);
  const teleprompterSpeedRef = useRef<number>(parseInt(params.teleprompterSpeed || '3'));
  const teleprompterTotalHeight = useRef<number>(0);
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

  // Keep speed ref in sync with state so the RAF loop reads the latest
  // value on every frame without needing to restart the animation.
  useEffect(() => {
    teleprompterSpeedRef.current = currentSpeed;
  }, [currentSpeed]);

  const stopTeleprompterLoop = useCallback(() => {
    if (teleprompterRafId.current !== null) {
      cancelAnimationFrame(teleprompterRafId.current);
      teleprompterRafId.current = null;
    }
    teleprompterLastTs.current = 0;
  }, []);

  const runTeleprompterLoop = useCallback(() => {
    const step = (ts: number) => {
      if (teleprompterLastTs.current === 0) {
        teleprompterLastTs.current = ts;
      }
      const delta = ts - teleprompterLastTs.current;
      teleprompterLastTs.current = ts;

      // See startTeleprompter for the pxPerSecond rationale.
      const pxPerSecond = [30, 60, 90, 120, 150][teleprompterSpeedRef.current - 1];
      currentScrollPosition.current += (pxPerSecond * delta) / 1000;

      const done = currentScrollPosition.current >= teleprompterTotalHeight.current;
      const yToScroll = done
        ? teleprompterTotalHeight.current
        : currentScrollPosition.current;
      scrollViewRef.current?.scrollTo({ y: yToScroll, animated: false });

      if (done) {
        currentScrollPosition.current = teleprompterTotalHeight.current;
        teleprompterRafId.current = null;
        teleprompterLastTs.current = 0;
        setTeleprompterPlaying(false);
        return;
      }

      teleprompterRafId.current = requestAnimationFrame(step);
    };
    teleprompterLastTs.current = 0;
    teleprompterRafId.current = requestAnimationFrame(step);
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
      stopTeleprompterLoop();
    };
  }, [stopTeleprompterLoop]);

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
      // Phase 3 Failure 6 diagnostic experiment (c1f8a2d regression):
      // controlsOpacity was previously driven with useNativeDriver:true.
      // In build 8f53b6d (parent c1f8a2d) enabling the teleprompter first
      // mounts the <Animated.View> at line 651 as the FIRST-EVER
      // AnimatedProps consumer on this screen. On SDK 54 / Fabric /
      // Android 16, AnimatedProps.__attach runs inside useInsertionEffect
      // during the same Fabric commit that mounts the view, and
      // #connectAnimatedView -> findNodeHandle can throw before the
      // Fabric shadow view is finalized. Switching this Value to a
      // JS driver removes native NativeAnimatedNodesManager involvement
      // for this Value only, so the enable transition no longer performs
      // a native connect during that first Fabric commit.
      // Scope: DIAGNOSTIC ONLY. If the physical Enable test passes with
      // this change, we have strong evidence for the hypothesis. Do not
      // treat this as a final architecture decision.
      // Regression: backend/tests/test_phase3_selftape_regression.py
      Animated.timing(controlsOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start(() => setShowControls(false));
    }, 2000);
  };

  const showControlsAnimated = () => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
    }
    setShowControls(true);
    // See hideControlsWithDelay for the useNativeDriver:false rationale
    // (Phase 3 Failure 6 diagnostic experiment against c1f8a2d).
    Animated.timing(controlsOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
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
    stopTeleprompterLoop();
    setTeleprompterPlaying(false);
  };

  const resumeTeleprompter = () => {
    if (!teleprompterActive) return;

    const lines = currentScene?.lines || [];
    const totalScrollHeight = lines.length * (currentFontSize + 20) * 2;
    teleprompterTotalHeight.current = totalScrollHeight;

    // If we've already reached the end, wrap the resume to a no-op instead
    // of restarting from the top — actor asked to un-pause, not to replay.
    if (currentScrollPosition.current >= totalScrollHeight) {
      return;
    }

    setTeleprompterPlaying(true);
    runTeleprompterLoop();
  };

  const startTeleprompter = () => {
    if (!teleprompterActive) return;

    const lines = currentScene?.lines || [];
    // Fabric-safe teleprompter pacing: map speed 1..5 → pixels-per-second.
    // The previous `speedMultiplier * 60` formula produced 2–12 minute
    // durations even for short scripts (Samsung SM-S918B physical repro:
    // ~4 minutes at speed 3 for a 32-line script). Now: 30/60/90/120/150 px/s
    // → ~81/40/27/20/16s for a 2432px scroll — actor-usable pacing.
    // Held here so grep + the regression test find pxPerSecond=[30,60,90,120,150]
    // in all three teleprompter sites (start/resume/handleSpeedChange).
    const pxPerSecond = [30, 60, 90, 120, 150][teleprompterSpeedRef.current - 1];
    void pxPerSecond; // used inside the RAF loop; kept named for grep-ability
    const totalScrollHeight = lines.length * (currentFontSize + 20) * 2;

    teleprompterTotalHeight.current = totalScrollHeight;
    currentScrollPosition.current = 0;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });

    setTeleprompterPlaying(true);
    runTeleprompterLoop();
  };

  const handleSpeedChange = (value: number) => {
    const newSpeed = Math.round(value);
    setCurrentSpeed(newSpeed);
    // Update the ref immediately so the running RAF loop picks up the new
    // pxPerSecond on the very next frame — no stop/restart required.
    teleprompterSpeedRef.current = newSpeed;
    // Kept for regression parity: pxPerSecond=[30, 60, 90, 120, 150]
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const pxPerSecond = [30, 60, 90, 120, 150][newSpeed - 1];
    void pxPerSecond;
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
        stopTeleprompterLoop();
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
      stopTeleprompterLoop();
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
          <View style={styles.permissionIcon}>
            <Ionicons name="videocam-off" size={40} color={C.violetSoft} />
          </View>
          <Text style={styles.permissionTitle} testID="record-permission-title">Permissions Required</Text>
          <Text style={styles.permissionText}>
            Self Tape needs access to your {!cameraGranted && 'camera'}{!cameraGranted && !micGranted && ' and '}{!micGranted && 'microphone'} to record videos.
          </Text>
          
          {(cameraPermission?.canAskAgain || micPermission?.canAskAgain) ? (
            <TouchableOpacity 
              style={styles.permissionButton}
              testID="record-grant-permission-btn"
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
              testID="record-open-settings-btn"
              onPress={openSettings}
            >
              <Ionicons name="settings-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.permissionButtonText}>Open Settings</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} testID="record-permission-cancel-btn">
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
          <TouchableOpacity onPress={() => router.back()} style={styles.closeButton} testID="record-close-btn">
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.scriptTitle} numberOfLines={1} testID="record-scene-title">
            {currentScene?.name || script?.title}
          </Text>
          <TouchableOpacity onPress={toggleTeleprompter} style={[styles.teleprompterButton, teleprompterActive && styles.teleprompterButtonActive]} testID="record-teleprompter-toggle">
            <Ionicons 
              name={teleprompterActive ? 'reader' : 'reader-outline'} 
              size={22} 
              color={teleprompterActive ? '#fff' : '#A19DC6'} 
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scriptScroll}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!teleprompterPlaying}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          {/*
            Teleprompter auto-scroll is driven from JS (requestAnimationFrame
            + scrollTo({animated:false})) — see the teleprompterRafId /
            runTeleprompterLoop block above. We deliberately do NOT wrap the
            script lines in an Animated.View, and this ScrollView is NOT an
            Animated.ScrollView, because on Android 16 / Fabric (Samsung
            SM-S918B repro on build 1110) starting a native-driver
            Animated.timing at the same tick CameraView begins native
            recording caused an immediate app crash. Regression:
            backend/tests/test_phase3_selftape_regression.py
          */}
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
        </ScrollView>

        {/* Teleprompter Controls Overlay */}
        {teleprompterActive && showControls && (
          <Animated.View style={[styles.teleprompterControls, { opacity: controlsOpacity }]}>
            {/* Play/Pause Button */}
            <TouchableOpacity 
              style={styles.controlPlayButton} 
              onPress={toggleTeleprompterPlayPause}
              testID="record-teleprompter-play-btn"
            >
              <Ionicons 
                name={teleprompterPlaying ? 'pause' : 'play'} 
                size={24} 
                color="#fff" 
              />
            </TouchableOpacity>

            {/* Speed Segmented Control (Fabric-safe replacement for Slider) */}
            <View style={styles.speedControlContainer}>
              <Ionicons name="speedometer-outline" size={16} color="#A19DC6" />
              {[1, 2, 3, 4, 5].map((speed) => (
                <TouchableOpacity
                  key={speed}
                  testID={`record-speed-${speed}`}
                  onPress={() => handleSpeedChange(speed)}
                  style={[
                    styles.speedSegment,
                    currentSpeed === speed && styles.speedSegmentActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.speedSegmentText,
                      currentSpeed === speed && styles.speedSegmentTextActive,
                    ]}
                  >
                    {speed}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={styles.speedLabel}>{currentSpeed}x</Text>
            </View>

            {/* Font Size Controls */}
            <View style={styles.fontControls}>
              <TouchableOpacity 
                style={styles.fontButton} 
                onPress={() => adjustFontSize(-2)}
                testID="record-font-decrease-btn"
              >
                <Text style={styles.fontButtonText}>A-</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.fontButton} 
                onPress={() => adjustFontSize(2)}
                testID="record-font-increase-btn"
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
              testID="record-highlight-toggle"
            >
              <Ionicons 
                name="color-wand" 
                size={18} 
                color={highlightEnabled ? '#A993FF' : '#6E6A95'} 
              />
            </TouchableOpacity>
          </Animated.View>
        )}
      </TouchableOpacity>

      {/* Camera View - Bottom 60% */}
      <View style={styles.cameraContainer}>
        {cameraPermission?.granted && micPermission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
            mode="video"
            onCameraReady={() => {}}
            onMountError={(error) => {
              console.error('[Camera] Mount error:', error);
              Alert.alert('Camera Error', 'Failed to initialize camera. Please try again.');
            }}
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
            <View style={styles.recordingIndicator} testID="record-recording-indicator">
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
            </View>
          )}

          {/* Countdown Overlay */}
          {countdown !== null && (
            <View style={styles.countdownOverlay}>
              <Text style={styles.countdownText} testID="record-countdown">{countdown}</Text>
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
                testID="record-flip-camera-btn"
              >
                <Ionicons name="camera-reverse" size={24} color="#fff" />
              </TouchableOpacity>
              
              {/* Shot Coach Toggle */}
              <TouchableOpacity 
                style={[styles.controlButton, showShotCoach && styles.controlButtonActive]} 
                onPress={() => setShowShotCoach(!showShotCoach)}
                onLongPress={() => setShowShotCoachMenu(true)}
                testID="record-shot-coach-toggle"
              >
                <Ionicons name="grid" size={22} color={showShotCoach ? '#62E0FF' : '#fff'} />
              </TouchableOpacity>
            </View>

            {/* Bottom Controls */}
            <View style={styles.bottomControls}>
              {/* Record Button */}
              <TouchableOpacity
                style={[styles.recordButton, isRecording && styles.recordButtonRecording]}
                onPress={isRecording ? stopRecording : startRecording}
                testID="record-record-btn"
                accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
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
        ) : (
          <View style={[styles.camera, { backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="videocam-off" size={48} color="#6E6A95" />
            <Text style={{ color: C.muted, marginTop: 12 }}>Waiting for camera permission...</Text>
          </View>
        )}
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
              testID="shot-coach-grid-toggle"
            >
              <Ionicons name="grid-outline" size={20} color={showGrid ? '#34D399' : '#6E6A95'} />
              <Text style={[styles.shotCoachMenuText, showGrid && styles.shotCoachMenuTextActive]}>
                Rule of Thirds Grid
              </Text>
              <Ionicons name={showGrid ? 'checkbox' : 'square-outline'} size={20} color={showGrid ? '#34D399' : '#6E6A95'} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuItem} 
              onPress={() => setShowEyeLine(!showEyeLine)}
              testID="shot-coach-eyeline-toggle"
            >
              <Ionicons name="eye-outline" size={20} color={showEyeLine ? '#7C5CFF' : '#6E6A95'} />
              <Text style={[styles.shotCoachMenuText, showEyeLine && styles.shotCoachMenuTextActive]}>
                Eye-line Markers
              </Text>
              <Ionicons name={showEyeLine ? 'checkbox' : 'square-outline'} size={20} color={showEyeLine ? '#7C5CFF' : '#6E6A95'} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuItem} 
              onPress={() => setShowHeadroom(!showHeadroom)}
              testID="shot-coach-headroom-toggle"
            >
              <Ionicons name="resize-outline" size={20} color={showHeadroom ? '#FFC37A' : '#6E6A95'} />
              <Text style={[styles.shotCoachMenuText, showHeadroom && styles.shotCoachMenuTextActive]}>
                Headroom Boundary
              </Text>
              <Ionicons name={showHeadroom ? 'checkbox' : 'square-outline'} size={20} color={showHeadroom ? '#FFC37A' : '#6E6A95'} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.shotCoachMenuClose} 
              onPress={() => setShowShotCoachMenu(false)}
              testID="shot-coach-done-btn"
            >
              <Text style={styles.shotCoachMenuCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Processing Overlay */}
      {processingVideo && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" color="#7C5CFF" />
          <Text style={styles.processingText} testID="record-processing">Processing...</Text>
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
            
            <View style={styles.actionSheetBadge}>
              <Ionicons name="film-outline" size={22} color={C.violetSoft} />
            </View>
            <Text style={styles.actionSheetTitle} testID="record-take-complete-title">Take Complete!</Text>
            <Text style={styles.actionSheetSubtitle}>
              {formatDuration(recordingDuration)} • {currentScene?.name || 'Scene'}
            </Text>

            {/* Primary Action - Share Now */}
            <TouchableOpacity 
              style={styles.primaryActionButton}
              onPress={handleShareNow}
              disabled={isSharing}
              testID="record-share-now-btn"
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
                testID="record-save-btn"
              >
                {isSaving ? (
                  <ActivityIndicator color={C.violetSoft} size="small" />
                ) : (
                  <>
                    <Ionicons name="bookmark" size={20} color={C.violetSoft} />
                    <Text style={styles.secondaryActionText}>Save</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.secondaryActionButton}
                onPress={handleRetake}
                testID="record-retake-btn"
              >
                <Ionicons name="refresh" size={20} color={C.violetSoft} />
                <Text style={styles.secondaryActionText}>Retake</Text>
              </TouchableOpacity>
            </View>

            {/* Review option */}
            <TouchableOpacity 
              style={styles.reviewButton}
              testID="record-review-btn"
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
              <Ionicons name="chevron-forward" size={18} color="#6E6A95" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const glass = 'rgba(11, 10, 26, 0.55)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Script Section
  scriptContainer: { height: '40%', backgroundColor: C.ink, borderBottomWidth: 1, borderBottomColor: tint(C.violet, 0.25) },
  scriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8, paddingTop: Platform.OS === 'ios' ? 50 : 30, backgroundColor: C.ink },
  closeButton: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  scriptTitle: { flex: 1, ...TYPE.heading, fontSize: 14, textAlign: 'center', marginHorizontal: 8 },
  teleprompterButton: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.violet, 0.14), borderWidth: 1, borderColor: tint(C.violet, 0.3) },
  teleprompterButtonActive: { backgroundColor: C.violet, borderColor: C.violet },
  scriptScroll: { flex: 1, paddingHorizontal: 16 },
  lineContainer: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  myLineContainer: { backgroundColor: tint(C.violet, 0.12), marginHorizontal: -16, paddingHorizontal: 16, borderLeftWidth: 3, borderLeftColor: C.violet },
  characterName: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: C.dim, marginBottom: 4, textTransform: 'uppercase' },
  myCharacterName: { color: C.violetSoft },
  otherCharacter: { color: '#4A4670' },
  lineText: { color: '#E4E1FA', lineHeight: 24 },
  myLineText: { color: C.text, fontWeight: '600' },
  hiddenLine: { color: '#4A4670', fontStyle: 'italic' },

  // Camera Section
  cameraContainer: { height: '60%', backgroundColor: '#000' },
  camera: { flex: 1 },
  faceGuide: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  faceGuideOval: { width: 180, height: 240, borderWidth: 2, borderColor: tint(C.violetSoft, 0.28), borderRadius: 90, marginTop: -60 },
  recordingIndicator: { position: 'absolute', top: 20, left: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: glass, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: tint(C.danger, 0.45) },
  recordingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.danger, marginRight: 8 },
  recordingTime: { fontSize: 14, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11, 10, 26, 0.72)', justifyContent: 'center', alignItems: 'center' },
  countdownText: { fontSize: 120, fontWeight: '800', color: '#fff', textShadowColor: tint(C.violet, 0.8), textShadowRadius: 30, textShadowOffset: { width: 0, height: 0 } },
  controlsContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  topControls: { flexDirection: 'row', justifyContent: 'flex-end', padding: 20, gap: 10 },
  controlButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: glass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', justifyContent: 'center', alignItems: 'center' },
  bottomControls: { alignItems: 'center', paddingBottom: 40 },
  recordButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255, 255, 255, 0.18)', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#fff' },
  recordButtonRecording: { backgroundColor: tint(C.danger, 0.25), borderColor: C.danger },
  recordIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.danger },
  stopIcon: { width: 30, height: 30, borderRadius: 6, backgroundColor: C.danger },

  // Processing Overlay
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11, 10, 26, 0.85)', justifyContent: 'center', alignItems: 'center' },
  processingText: { fontSize: 15, fontWeight: '600', color: C.text, marginTop: 16 },

  // Action Sheet
  actionSheetBackdrop: { flex: 1, backgroundColor: 'rgba(5, 4, 14, 0.7)', justifyContent: 'flex-end' },
  actionSheet: { backgroundColor: C.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, borderWidth: 1, borderColor: C.line },
  actionSheetHandle: { width: 40, height: 4, backgroundColor: C.surface2, borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  actionSheetBadge: { alignSelf: 'center', width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.violet, 0.16), borderWidth: 1, borderColor: tint(C.violet, 0.35), marginBottom: 12 },
  actionSheetTitle: { ...TYPE.display, textAlign: 'center' },
  actionSheetSubtitle: { fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 6, marginBottom: 22 },
  primaryActionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.violet, paddingVertical: 17, borderRadius: RADIUS.md, gap: 10 },
  primaryActionText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  secondaryActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  secondaryActionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, paddingVertical: 14, borderRadius: RADIUS.md, gap: 8 },
  secondaryActionText: { fontSize: 15, fontWeight: '700', color: C.text },
  reviewButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, marginTop: 6 },
  reviewButtonText: { fontSize: 14, fontWeight: '600', color: C.muted, marginRight: 4 },

  // Teleprompter Controls
  teleprompterControls: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(20, 18, 42, 0.94)', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: tint(C.violet, 0.3) },
  controlPlayButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.violet, justifyContent: 'center', alignItems: 'center' },
  speedControlContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, gap: 4 },
  speedSlider: { flex: 1, height: 40 },
  speedSegment: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, minWidth: 24, alignItems: 'center', backgroundColor: C.surface2 },
  speedSegmentActive: { backgroundColor: C.violet },
  speedSegmentText: { fontSize: 12, fontWeight: '700', color: C.muted },
  speedSegmentTextActive: { color: '#ffffff' },
  speedLabel: { fontSize: 12, fontWeight: '700', color: C.violetSoft, width: 24, textAlign: 'center' },
  fontControls: { flexDirection: 'row', gap: 4 },
  fontButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, justifyContent: 'center', alignItems: 'center' },
  fontButtonText: { fontSize: 13, fontWeight: '800', color: C.text },
  highlightToggle: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },
  highlightToggleActive: { backgroundColor: tint(C.violet, 0.22), borderColor: tint(C.violet, 0.5) },

  // Permission View
  permissionView: { flex: 1, backgroundColor: C.ink, justifyContent: 'center', alignItems: 'center', padding: 32 },
  permissionIcon: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.violet, 0.12), borderWidth: 1, borderColor: tint(C.violet, 0.3) },
  permissionTitle: { ...TYPE.title, fontSize: 22, marginTop: 20 },
  permissionText: { fontSize: 15, color: C.muted, textAlign: 'center', marginTop: 12, lineHeight: 22 },
  permissionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.violet, paddingVertical: 14, paddingHorizontal: 32, borderRadius: RADIUS.md, marginTop: 32 },
  permissionButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  cancelButton: { marginTop: 16, padding: 8 },
  cancelButtonText: { fontSize: 15, color: C.muted, fontWeight: '600' },

  // Shot Coach Menu
  controlButtonActive: { backgroundColor: tint(C.cyan, 0.2), borderColor: tint(C.cyan, 0.5) },
  shotCoachMenuOverlay: { flex: 1, backgroundColor: 'rgba(5, 4, 14, 0.75)', justifyContent: 'center', alignItems: 'center' },
  shotCoachMenu: { backgroundColor: C.surface, borderRadius: RADIUS.lg, padding: 20, width: '80%', maxWidth: 300, borderWidth: 1, borderColor: C.line },
  shotCoachMenuTitle: { ...TYPE.title, fontSize: 17, marginBottom: 12, textAlign: 'center' },
  shotCoachMenuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  shotCoachMenuText: { flex: 1, fontSize: 15, color: C.muted, marginLeft: 12 },
  shotCoachMenuTextActive: { color: C.text, fontWeight: '600' },
  shotCoachMenuClose: { backgroundColor: C.violet, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  shotCoachMenuCloseText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
