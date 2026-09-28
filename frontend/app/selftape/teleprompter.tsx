import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  Dimensions,
  Modal,
  ActivityIndicator,
  StatusBar,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
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

  const { scripts, fetchScript } = useScriptStore();
  const script = scripts.find(s => s.id === params.scriptId);
  const [scriptLoading, setScriptLoading] = useState(!script);
  const [scriptError, setScriptError] = useState<string | null>(null);

  // If script not in store, fetch it
  useEffect(() => {
    if (script || !params.scriptId) {
      setScriptLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setScriptLoading(true);
      setScriptError(null);
      try {
        const result = await fetchScript(params.scriptId);
        if (!cancelled && !result) {
          setScriptError('Script not found. It may have been deleted.');
        }
      } catch (err: any) {
        if (!cancelled) {
          setScriptError(err?.message || 'Failed to load script');
        }
      } finally {
        if (!cancelled) setScriptLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [params.scriptId, script]);

  const scenes = script?.scenes || (script?.lines ? [{ name: 'Full Script', lines: script.lines }] : []);
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
  // ─── Framing Guides (Post-Phase-3 polish) ─────────────────────────────
  // Optional, purely-visual placement guides overlaid on the camera view.
  // Off by default. STRICTLY no face detection, no CV, no camera APIs, no
  // animation, no recording-pipeline changes — just static <View>s rendered
  // OUTSIDE the teleprompter ScrollView so they stay fixed while the
  // script scrolls. Overlay uses `pointerEvents="none"` so it cannot
  // intercept touches on any control below it.
  //
  // Regression: backend/tests/test_teleprompter_framing_guides.py
  const [showFramingGuides, setShowFramingGuides] = useState(false);

  // ─── Camera bring-up observability + guarding (2026-02 hardening) ─────
  // Two independent signals mirror the proven Route A shape (record.tsx):
  //   * `isCameraReady`  → set by <CameraView onCameraReady>. Record is
  //     guarded on this so recordAsync() cannot be invoked before the
  //     native camera provider + capture use cases are bound.
  //   * `cameraMountError` → set by <CameraView onMountError>. Route B
  //     shows a controlled, user-visible error and does NOT crash. The
  //     underlying expo-camera patch (expo-camera+17.0.10.patch) has been
  //     extended to route ProcessCameraProvider.awaitInstance failures
  //     into this same mount-error surface (upstream expo/expo#47696),
  //     so intermittent Samsung SM-S918B / Android 16 first-record
  //     process crashes now arrive here instead of terminating the app.
  //
  // Regression: backend/tests/test_route_b_camera_hardening.py
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraMountError, setCameraMountError] = useState<string | null>(null);
  
  // Post-record state
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [processingVideo, setProcessingVideo] = useState(false);
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  
  const cameraRef = useRef<CameraView>(null);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const recordingStartTime = useRef<number>(0);
  const currentScrollPosition = useRef(0);

  // ─── Fabric-safe JS-driven teleprompter scroll driver ───────────────────
  // Route B is now aligned with Route A (record.tsx). We do NOT use
  // Animated.timing/multiply on the New Architecture: on SDK 54 / Fabric /
  // Android 16, native-driver teleprompter animations that start in the
  // same commit as CameraView.recordAsync() are exactly the shape of the
  // Failure 5 crash that record.tsx already resolved. The scroll here is
  // driven purely from JS via requestAnimationFrame + ScrollView.scrollTo.
  //
  // Guarantees enforced by refs + a single loop function:
  //   * exactly ONE active loop at a time
  //   * cancelled on pause / stop / retake / unmount
  //   * speed changes read from a ref → no restart, no duplicate loop
  //   * content height is the LATEST value from ScrollView
  //     onContentSizeChange (not the pre-render heuristic)
  //
  // Regression: backend/tests/test_phase3_selftape_regression.py
  const teleprompterRafId = useRef<number | null>(null);
  const teleprompterLastTs = useRef<number>(0);
  const teleprompterSpeedRef = useRef<number>(3);
  const teleprompterTotalHeight = useRef<number>(0);
  const teleprompterViewportHeight = useRef<number>(0);

  const lines = currentScene?.lines || [];

  // --- GATE: Script loading / error / empty states (before anything else renders) ---

  // Script loading state
  if (scriptLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionView}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.permissionTitle}>Loading script...</Text>
        </View>
      </View>
    );
  }

  // Script not found / error state
  if (!script || scriptError) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionView}>
          <Ionicons name="document-text-outline" size={64} color="#ef4444" />
          <Text style={styles.permissionTitle}>
            {scriptError || 'Unable to load script for teleprompter'}
          </Text>
          <Text style={[styles.permissionText, { marginTop: 8 }]}>
            {!params.scriptId ? 'No script ID provided.' : `Script ID: ${params.scriptId.substring(0, 12)}...`}
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={() => router.back()}>
            <Text style={styles.permissionButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // No content in script
  if (lines.length === 0) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.permissionView}>
          <Ionicons name="document-text-outline" size={64} color="#f59e0b" />
          <Text style={styles.permissionTitle}>No script content found</Text>
          <Text style={styles.permissionText}>
            This script has no lines to display. Try re-uploading it.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={() => router.back()}>
            <Text style={styles.permissionButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Content height is measured via ScrollView.onContentSizeChange into
  // teleprompterTotalHeight, so the previous
  //   totalContentHeight = lines.length * (fontSize + 16)
  // heuristic is no longer needed (was under-counting wrapped/multi-line
  // dialogue and caused early stops).
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

  // Keep speed ref in sync with state so the RAF loop always reads the
  // latest value without stop-and-restart.
  useEffect(() => {
    teleprompterSpeedRef.current = speed;
  }, [speed]);

  const stopTeleprompterLoop = useCallback(() => {
    if (teleprompterRafId.current !== null) {
      cancelAnimationFrame(teleprompterRafId.current);
      teleprompterRafId.current = null;
    }
    teleprompterLastTs.current = 0;
  }, []);

  const runTeleprompterLoop = useCallback(() => {
    // Cancel any pre-existing frame first — guarantees exactly one loop.
    if (teleprompterRafId.current !== null) {
      cancelAnimationFrame(teleprompterRafId.current);
      teleprompterRafId.current = null;
    }
    const step = (ts: number) => {
      if (teleprompterLastTs.current === 0) {
        teleprompterLastTs.current = ts;
      }
      const delta = ts - teleprompterLastTs.current;
      teleprompterLastTs.current = ts;

      // Proven Route-A pacing model.
      const pxPerSecond =
        [30, 60, 90, 120, 150][teleprompterSpeedRef.current - 1] ?? 90;
      currentScrollPosition.current += (pxPerSecond * delta) / 1000;

      // Effective travel budget: full content minus one viewport, so the
      // last line rests above the fold. Fall back gracefully if the
      // viewport size hasn't been measured yet (e.g. first frame).
      const budget = Math.max(
        0,
        teleprompterTotalHeight.current -
          Math.max(teleprompterViewportHeight.current, 0),
      );
      const done =
        budget > 0 && currentScrollPosition.current >= budget;
      const yToScroll = done ? budget : currentScrollPosition.current;
      scrollViewRef.current?.scrollTo({ y: yToScroll, animated: false });

      if (done) {
        currentScrollPosition.current = budget;
        teleprompterRafId.current = null;
        teleprompterLastTs.current = 0;
        setIsPlaying(false);
        return;
      }

      teleprompterRafId.current = requestAnimationFrame(step);
    };
    teleprompterLastTs.current = 0;
    teleprompterRafId.current = requestAnimationFrame(step);
  }, []);

  // Cleanup — cancel timers and the RAF loop on unmount.
  useEffect(() => {
    return () => {
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      stopTeleprompterLoop();
    };
  }, [stopTeleprompterLoop]);

  const toggleCamera = () => {
    setFacing(current => (current === 'front' ? 'back' : 'front'));
  };

  const startTeleprompter = () => {
    // Reset to top and start the JS RAF loop. No native driver, no
    // Animated.timing, no Animated.multiply — see the runTeleprompterLoop
    // block above for the rationale (Failure 5 anti-pattern avoidance).
    // pxPerSecond = [30, 60, 90, 120, 150] via teleprompterSpeedRef.current.
    currentScrollPosition.current = 0;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    setIsPlaying(true);
    runTeleprompterLoop();
  };

  const pauseTeleprompter = () => {
    stopTeleprompterLoop();
    setIsPlaying(false);
  };

  const resumeTeleprompter = () => {
    // Resume from wherever the scroll currently rests. If we've already
    // reached the bottom, do nothing.
    const budget = Math.max(
      0,
      teleprompterTotalHeight.current -
        Math.max(teleprompterViewportHeight.current, 0),
    );
    if (budget > 0 && currentScrollPosition.current >= budget) {
      return;
    }
    setIsPlaying(true);
    runTeleprompterLoop();
  };

  const resetTeleprompter = () => {
    stopTeleprompterLoop();
    currentScrollPosition.current = 0;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
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
    // Update the ref immediately so the running RAF loop picks up the new
    // pxPerSecond on the very next frame — no stop/restart required, and
    // therefore no way to accidentally double-mount the loop.
    // pxPerSecond = [30, 60, 90, 120, 150]
    teleprompterSpeedRef.current = newSpeed;
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;
    // 2026-02 hardening: never invoke recordAsync before the native camera
    // provider + capture use cases have finished binding. onCameraReady is
    // what flips isCameraReady; without this guard a fast tap on Record
    // during first-frame bring-up on Samsung SM-S918B / Android 16 lands
    // in expo-camera's `recorder?.let { … } ?: promise.reject(...)` early
    // return with no user-visible surface. Route B now mirrors Route A's
    // proven readiness contract.
    if (!isCameraReady) {
      Alert.alert(
        'Camera Not Ready',
        'The camera is still initializing. Please try again in a moment.',
      );
      return;
    }
    if (cameraMountError) {
      Alert.alert('Camera Error', cameraMountError);
      return;
    }

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
        onCameraReady={() => {
          // 2026-02 hardening — mirrors Route A. Flip readiness only after
          // expo-camera has bound the CameraX use cases; startRecording()
          // is guarded on this.
          setIsCameraReady(true);
          setCameraMountError(null);
        }}
        onMountError={(event: any) => {
          // 2026-02 hardening — the expo-camera patch we ship extends this
          // surface to also cover ProcessCameraProvider.awaitInstance()
          // failures (upstream expo/expo#47696) so a Samsung SM-S918B /
          // Android 16 first-record bring-up failure lands here instead
          // of terminating the process. Show a controlled, recoverable
          // error to the user; never crash.
          const msg =
            event?.nativeEvent?.message ||
            event?.message ||
            'Camera failed to initialize. Please close and reopen the app.';
          console.error('[Teleprompter] Camera mount error:', msg);
          setIsCameraReady(false);
          setCameraMountError(msg);
        }}
      >
        {/*
          Framing Guides overlay — Post-Phase-3 polish.
          Rendered as the FIRST child inside CameraView so it sits under
          all interactive controls (top bar, teleprompter, bottom bar).
          Fixed to the camera viewport → does NOT move when the
          teleprompter ScrollView scrolls. `pointerEvents="none"` on the
          container guarantees zero interference with recording, scrolling,
          settings, save, retake, or countdown.
        */}
        {showFramingGuides && (
          <View
            style={styles.framingGuidesLayer}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="framing-guides-overlay"
          >
            {/* Rule-of-thirds — 2 vertical + 2 horizontal thin lines. */}
            <View style={[styles.framingGuideVLine, { left: '33.333%' }]} />
            <View style={[styles.framingGuideVLine, { left: '66.666%' }]} />
            <View style={[styles.framingGuideHLine, { top: '33.333%' }]} />
            <View style={[styles.framingGuideHLine, { top: '66.666%' }]} />
            {/* Face-safe zone — centered oval in the upper-middle third. */}
            <View style={styles.framingGuideFaceZone} />
            {/* Eye-line marker — subtle horizontal tick at ~1/3 down. */}
            <View style={styles.framingGuideEyeLine} />
          </View>
        )}

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
          <View
            style={[styles.teleprompterWindow, { opacity }]}
            onLayout={(e) => {
              // Track viewport for the RAF driver's travel budget.
              teleprompterViewportHeight.current = e.nativeEvent.layout.height;
            }}
          >
            <ScrollView
              ref={scrollViewRef}
              showsVerticalScrollIndicator={false}
              scrollEnabled={!isPlaying}
              onContentSizeChange={(_w, h) => {
                // Use the REAL measured content height for the RAF budget,
                // not the pre-render heuristic that under-counted wrapped
                // dialogue and caused the teleprompter to stop early.
                teleprompterTotalHeight.current = h;
              }}
            >
              {lines.map((line: any, index: number) => {
                const isMyLine =
                  line.character?.toLowerCase() === userCharacter?.toLowerCase();
                return (
                  <View key={index} style={styles.lineContainer}>
                    <Text
                      style={[
                        styles.characterLabel,
                        isMyLine && highlightMyLines && styles.myCharacterLabel,
                      ]}
                    >
                      {line.character}
                    </Text>
                    <Text
                      style={[
                        styles.lineText,
                        { fontSize },
                        isMyLine && highlightMyLines && styles.myLineText,
                      ]}
                    >
                      {line.text}
                    </Text>
                  </View>
                );
              })}
              {/* Extra padding at end */}
              <View style={{ height: visibleHeight }} />
            </ScrollView>
          </View>

          {/* Gradient overlays */}
          <View style={styles.gradientTop} pointerEvents="none" />
          <View style={styles.gradientBottom} pointerEvents="none" />
        </View>

        {/* Bottom Controls */}
        <View style={styles.bottomControls}>
          {/*
            Camera bring-up status banner (2026-02 hardening).
            Two mutually-exclusive states are surfaced to the user WITHOUT
            crashing the app:
              * cameraMountError → hard failure; user can retry via
                Go Back / reopen. Handled here instead of a native crash
                dialog.
              * !isCameraReady   → transient bring-up delay. Visible until
                onCameraReady fires. Record button is disabled during this
                window.
          */}
          {cameraMountError ? (
            <View
              style={styles.cameraStatusErrorBanner}
              testID="camera-mount-error-banner"
            >
              <Ionicons name="warning" size={18} color="#fff" />
              <Text style={styles.cameraStatusErrorText} numberOfLines={2}>
                {cameraMountError}
              </Text>
            </View>
          ) : !isCameraReady ? (
            <View
              style={styles.cameraStatusPendingBanner}
              testID="camera-initializing-banner"
            >
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.cameraStatusPendingText}>
                Camera initializing…
              </Text>
            </View>
          ) : null}

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
              {/*
                Segmented [1..5] speed control — mirrors Route A
                (record.tsx) and replaces @react-native-community/slider,
                which was removed as part of the Failure 4 anti-pattern
                purge. pxPerSecond = [30, 60, 90, 120, 150] is mapped
                inside runTeleprompterLoop.
              */}
              <View style={styles.speedSegments}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.speedSegment,
                      speed === s && styles.speedSegmentActive,
                    ]}
                    onPress={() => handleSpeedChange(s)}
                    accessibilityRole="button"
                    accessibilityLabel={`Teleprompter speed ${s} of 5`}
                  >
                    <Text
                      style={[
                        styles.speedSegmentText,
                        speed === s && styles.speedSegmentTextActive,
                      ]}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          
          {/* Camera Controls Row */}
          <View style={styles.cameraControls}>
            <TouchableOpacity onPress={toggleCamera} style={styles.controlButton}>
              <Ionicons name="camera-reverse" size={28} color="#fff" />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.recordButton,
                isRecording && styles.recordButtonRecording,
                (!isCameraReady || !!cameraMountError) &&
                  !isRecording &&
                  styles.recordButtonDisabled,
              ]}
              onPress={isRecording ? stopRecording : startRecording}
              disabled={(!isCameraReady || !!cameraMountError) && !isRecording}
              accessibilityState={{
                disabled:
                  (!isCameraReady || !!cameraMountError) && !isRecording,
              }}
              testID="record-button"
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
              {/*
                Segmented opacity presets — replaces
                @react-native-community/slider (Fabric SDK 54 anti-pattern
                purge). Discrete steps are sufficient for a teleprompter
                background and remove all native-slider surface.
              */}
              <View style={styles.opacitySegments}>
                {[0.5, 0.65, 0.8, 0.9, 1].map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[
                      styles.opacitySegment,
                      Math.abs(opacity - v) < 0.01 && styles.opacitySegmentActive,
                    ]}
                    onPress={() => setOpacity(v)}
                    accessibilityRole="button"
                    accessibilityLabel={`Background opacity ${Math.round(v * 100)} percent`}
                  >
                    <Text
                      style={[
                        styles.opacitySegmentText,
                        Math.abs(opacity - v) < 0.01 && styles.opacitySegmentTextActive,
                      ]}
                    >
                      {Math.round(v * 100)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
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

            {/* Framing Guides Toggle — visual-only camera placement guides. */}
            <TouchableOpacity
              style={styles.settingRow}
              onPress={() => setShowFramingGuides(!showFramingGuides)}
              accessibilityRole="switch"
              accessibilityState={{ checked: showFramingGuides }}
              accessibilityLabel="Framing Guides"
              testID="framing-guides-toggle"
            >
              <Text style={styles.settingLabel}>Framing Guides</Text>
              <Ionicons
                name={showFramingGuides ? 'checkbox' : 'square-outline'}
                size={24}
                color={showFramingGuides ? '#6366f1' : '#6b7280'}
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

  // ─── Framing Guides (Post-Phase-3 polish) ─────────────────────────────
  // Purely visual overlay. Absolute-fill inside CameraView, pointerEvents
  // none, no animation, no native APIs. Fixed to the viewport → does not
  // scroll with the teleprompter.
  framingGuidesLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  framingGuideVLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  framingGuideHLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  framingGuideFaceZone: {
    // Head-and-shoulders safe zone: ~55% width × ~40% height, centered
    // horizontally, positioned so the oval spans roughly the upper-third
    // to just below the horizon line. Ellipse via borderRadius: 999.
    position: 'absolute',
    width: '55%',
    height: '40%',
    left: '22.5%',
    top: '18%',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  framingGuideEyeLine: {
    // Recommended eye-line — sits at the upper rule-of-thirds line,
    // rendered as a slightly brighter tick so the actor has a target.
    position: 'absolute',
    left: '30%',
    right: '30%',
    top: '33.333%',
    height: 1,
    backgroundColor: 'rgba(99, 102, 241, 0.7)',
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
  // Route B convergence — segmented [1..5] speed control (mirrors Route A).
  speedSegments: {
    flexDirection: 'row',
    gap: 4,
  },
  speedSegment: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(107, 114, 128, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedSegmentActive: {
    backgroundColor: '#6366f1',
  },
  speedSegmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
  },
  speedSegmentTextActive: {
    color: '#fff',
  },
  // Settings-modal opacity presets — segmented replacement for Slider.
  opacitySegments: {
    flexDirection: 'row',
    gap: 6,
  },
  opacitySegment: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
  },
  opacitySegmentActive: {
    backgroundColor: '#6366f1',
  },
  opacitySegmentText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  opacitySegmentTextActive: {
    color: '#fff',
    fontWeight: '600',
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
  recordButtonDisabled: {
    opacity: 0.45,
  },
  // ─── Camera bring-up status banners (2026-02 hardening) ──────────────
  cameraStatusErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
  },
  cameraStatusErrorText: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  cameraStatusPendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignSelf: 'center',
  },
  cameraStatusPendingText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '500',
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
