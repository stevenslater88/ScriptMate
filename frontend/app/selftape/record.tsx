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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useScriptStore } from '../../store/scriptStore';
import { trackRecordingStarted, trackRecordingCompleted, trackTeleprompterToggled } from '../../services/analyticsService';
import { checkStorageAvailable } from '../../services/selfTapeStorage';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  
  const cameraRef = useRef<CameraView>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);
  const teleprompterAnim = useRef(new Animated.Value(0)).current;
  const teleprompterAnimation = useRef<Animated.CompositeAnimation | null>(null);

  const fontSize = parseInt(params.fontSize || '18');
  const hideOthers = params.hideOthers === 'true';
  const countdownEnabled = params.countdown === 'true';
  const teleprompterSpeed = parseInt(params.teleprompterSpeed || '3');

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
          `Only ${Math.round(freeSpace || 0)}MB available. Recording may fail.`,
          [{ text: 'OK' }]
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
      teleprompterAnimation.current?.stop();
    };
  }, []);

  const toggleCamera = () => {
    setFacing(current => (current === 'front' ? 'back' : 'front'));
  };

  const toggleTeleprompter = () => {
    const newState = !teleprompterActive;
    setTeleprompterActive(newState);
    trackTeleprompterToggled(newState);
    
    if (!newState) {
      teleprompterAnimation.current?.stop();
      teleprompterAnim.setValue(0);
    }
  };

  const startTeleprompter = () => {
    if (!teleprompterActive) return;
    
    const lines = currentScene?.lines || [];
    const totalScrollHeight = lines.length * (fontSize + 20) * 2;
    const speedMultiplier = [0.3, 0.5, 0.7, 1, 1.5][teleprompterSpeed - 1];
    const duration = (totalScrollHeight / speedMultiplier) * 50;
    
    teleprompterAnim.setValue(0);
    teleprompterAnimation.current = Animated.timing(teleprompterAnim, {
      toValue: totalScrollHeight,
      duration,
      useNativeDriver: true,
    });
    teleprompterAnimation.current.start();
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;

    if (countdownEnabled) {
      // Countdown
      setCountdown(3);
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
      
      // Start duration timer
      recordingTimer.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      // Start teleprompter if enabled
      startTeleprompter();

      const video = await cameraRef.current.recordAsync({
        maxDuration: 600, // 10 minutes max
      });

      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }

      if (video?.uri) {
        trackRecordingCompleted(params.scriptId || '', recordingDuration);
        router.replace({
          pathname: '/selftape/review',
          params: {
            videoUri: video.uri,
            scriptId: params.scriptId,
            sceneIndex: params.sceneIndex,
            duration: recordingDuration.toString(),
          },
        });
      }
    } catch (error) {
      console.error('Recording error:', error);
      setIsRecording(false);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      Alert.alert('Recording Error', 'Failed to record video. Please try again.');
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
      teleprompterAnimation.current?.stop();
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Permission check
  if (!cameraPermission?.granted || !micPermission?.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionView}>
          <Ionicons name="videocam-off" size={64} color="#6b7280" />
          <Text style={styles.permissionTitle}>Camera & Mic Required</Text>
          <Text style={styles.permissionText}>
            Self Tape needs access to your camera and microphone to record videos.
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
      <View style={styles.scriptContainer}>
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
          scrollEnabled={!teleprompterActive || !isRecording}
          contentContainerStyle={{ 
            paddingBottom: 100,
            transform: teleprompterActive && isRecording ? [{ translateY: Animated.multiply(teleprompterAnim, -1) }] : []
          }}
        >
          {lines.map((line: any, index: number) => {
            const isMyLine = line.character === params.character;
            if (hideOthers && !isMyLine) {
              return (
                <View key={index} style={styles.lineContainer}>
                  <Text style={[styles.characterName, styles.otherCharacter]}>{line.character}</Text>
                  <Text style={[styles.lineText, { fontSize }, styles.hiddenLine]}>• • •</Text>
                </View>
              );
            }
            return (
              <View key={index} style={[styles.lineContainer, isMyLine && styles.myLineContainer]}>
                <Text style={[styles.characterName, isMyLine && styles.myCharacterName]}>
                  {line.character}
                </Text>
                <Text style={[styles.lineText, { fontSize }, isMyLine && styles.myLineText]}>
                  {line.text}
                </Text>
              </View>
            );
          })}
        </Animated.ScrollView>
      </View>

      {/* Camera View - Bottom 60% */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode="video"
        >
          {/* Face Guide Overlay */}
          <View style={styles.faceGuide}>
            <View style={styles.faceGuideOval} />
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
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 32,
  },
  permissionButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  cancelButton: { marginTop: 16 },
  cancelButtonText: { fontSize: 15, color: '#6b7280' },
});
