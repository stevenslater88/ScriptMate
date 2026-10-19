import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, TextInput, FlatList, Modal,
  Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
// SDK 54: `documentDirectory` / `EncodingType` moved to the legacy
// submodule. The bare import returns undefined for those constants,
// which broke every Voice Studio save on Android (see 2026-02 QA).
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import {
  VoiceTake, saveTake, getTakes, updateTake, deleteTake,
  DemoReel, saveReel, getReels, deleteReel,
} from '../services/voiceStudioStorage';
import { WATERMARK_TEXT, WATERMARK_SUBTEXT } from '../services/watermarkService';
import { useScriptStore, type Script } from '../store/scriptStore';

import { API_BASE_URL } from '../services/apiConfig';
import { C, RADIUS, TYPE, tint } from '../constants/cinematicTheme';
import { ScreenGlow } from '../components/cinematic';

const { width: SCREEN_W } = Dimensions.get('window');
const BAR_COUNT = 30;

type Tab = 'record' | 'takes' | 'reel';

export default function VoiceStudioScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('record');

  // Recording state
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recDuration, setRecDuration] = useState(0);
  const [meterLevels, setMeterLevels] = useState<number[]>(new Array(BAR_COUNT).fill(0));

  // Playback state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playProgress, setPlayProgress] = useState(0);

  // Takes state
  const [takes, setTakes] = useState<VoiceTake[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [processing, setProcessing] = useState(false);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTake, setEditTake] = useState<VoiceTake | null>(null);
  const [trimStart, setTrimStart] = useState('0');
  const [trimEnd, setTrimEnd] = useState('0');
  const [editOp, setEditOp] = useState<'trim' | 'normalize' | 'remove_silence' | 'all'>('all');

  // Demo reel state
  const [reels, setReels] = useState<DemoReel[]>([]);
  const [selectedTakes, setSelectedTakes] = useState<string[]>([]);
  const [buildingReel, setBuildingReel] = useState(false);
  const [reelName, setReelName] = useState('');
  const [showReelBuilder, setShowReelBuilder] = useState(false);

  // Error state
  const [loadError, setLoadError] = useState(false);

  // Script material state — lets the actor read a saved script while
  // recording. Purely optional; a bare voice-over is still supported.
  // See services/voiceStudioStorage.ts::saveTake which already accepts
  // scriptId / scriptTitle metadata — this UI wires them in.
  const { scripts, fetchScripts } = useScriptStore();
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  // Index of the "current" line the actor is on. Advanced manually with
  // Prev/Next buttons; also used to visually highlight the active line.
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  // Animation refs
  const barAnims = useRef(new Array(BAR_COUNT).fill(0).map(() => new Animated.Value(0))).current;

  useEffect(() => {
    loadData();
    // Fetch the user's saved scripts so the picker has real material.
    // Non-blocking: an empty scripts list is handled gracefully below.
    fetchScripts().catch(() => { /* handled via store error state */ });
    return () => {
      try { sound?.unloadAsync(); } catch (_) { /* already unloaded */ }
    };
  }, []);

  const loadData = async () => {
    try {
      setLoadError(false);
      const [t, r] = await Promise.all([getTakes(), getReels()]);
      setTakes(t);
      setReels(r);
    } catch (err) {
      console.error('Load voice studio data error:', err);
      setLoadError(true);
    }
  };

  // ================= RECORDING =================

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Microphone access is needed to record.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        {
          isMeteringEnabled: true,
          android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 44100, numberOfChannels: 1, bitRate: 128000 },
          ios: { extension: '.m4a', outputFormat: 'aac', audioQuality: 127, sampleRate: 44100, numberOfChannels: 1, bitRate: 128000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
          web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
        },
        (status) => {
          if (status.isRecording) {
            setRecDuration(Math.floor((status.durationMillis || 0) / 1000));
            const meter = status.metering ?? -160;
            const normalized = Math.max(0, Math.min(1, (meter + 60) / 60));
            updateWaveform(normalized);
          }
        },
        100
      );

      setRecording(rec);
      setIsRecording(true);
      setIsPaused(false);
      setRecDuration(0);
    } catch (err) {
      console.error('Start recording error:', err);
      Alert.alert('Error', 'Could not start recording. Check microphone permissions.');
    }
  };

  const updateWaveform = (level: number) => {
    setMeterLevels(prev => {
      const next = [...prev.slice(1), level];
      next.forEach((v, i) => {
        Animated.timing(barAnims[i], {
          toValue: v,
          duration: 80,
          useNativeDriver: false,
        }).start();
      });
      return next;
    });
  };

  const pauseRecording = async () => {
    if (!recording) return;
    try {
      await recording.pauseAsync();
      setIsPaused(true);
    } catch (err) {
      console.error('Pause error:', err);
    }
  };

  const resumeRecording = async () => {
    if (!recording) return;
    try {
      await recording.startAsync();
      setIsPaused(false);
    } catch (err) {
      console.error('Resume error:', err);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      // CRITICAL: Get URI BEFORE stopping — some Android devices lose the URI after unload
      const uri = recording.getURI();
      console.log('[VoiceStudio] Pre-stop URI:', uri);

      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      setRecording(null);
      setIsRecording(false);
      setIsPaused(false);

      if (!uri) {
        console.error('[VoiceStudio] Recording URI is null after stop');
        Alert.alert('Error', 'Recording completed but the audio file was not found. Please try again.');
        return;
      }

      // Verify the temp file actually exists before saving
      const fileInfo = await FileSystem.getInfoAsync(uri);
      console.log('[VoiceStudio] Temp file exists:', fileInfo.exists, 'size:', fileInfo.exists ? (fileInfo as any).size : 0);

      if (!fileInfo.exists) {
        Alert.alert('Error', 'Recording file was not saved by the system. Please check app permissions in device Settings.');
        return;
      }

      const takeNum = takes.length + 1;
      const scriptSuffix = selectedScript
        ? ` — ${selectedScript.title.slice(0, 30)}${selectedCharacter ? ` (${selectedCharacter})` : ''}`
        : '';
      const name = `Take ${takeNum}${scriptSuffix}`;
      const take = await saveTake(
        uri,
        name,
        recDuration,
        selectedScript?.id,
        selectedScript?.title,
      );
      setTakes(prev => [take, ...prev]);
      setActiveTab('takes');
      Alert.alert('Saved!', `"${name}" saved (${formatDuration(recDuration)})`);

      // Reset waveform
      barAnims.forEach(a => a.setValue(0));
      setMeterLevels(new Array(BAR_COUNT).fill(0));
    } catch (err: any) {
      console.error('[VoiceStudio] Stop recording error:', err?.message || err);
      Alert.alert('Error', `Failed to save recording: ${err?.message || 'Unknown error'}. Check app storage permissions.`);
    }
  };

  // ================= PLAYBACK =================

  const playTake = async (take: VoiceTake) => {
    try {
      if (sound) { await sound.unloadAsync(); setSound(null); }
      if (playingId === take.id) { setPlayingId(null); return; }

      const fileUri = take.processedUri || take.uri;
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: fileUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            if (status.didJustFinish) { setPlayingId(null); setPlayProgress(0); }
            else if (status.positionMillis && status.durationMillis) {
              setPlayProgress(status.positionMillis / status.durationMillis);
            }
          }
        }
      );
      setSound(s);
      setPlayingId(take.id);
    } catch (err) {
      console.error('Play error:', err);
      Alert.alert('Error', 'Could not play this take.');
    }
  };

  const stopPlayback = async () => {
    if (sound) {
      try { await sound.stopAsync(); } catch (_) { /* already stopped */ }
      try { await sound.unloadAsync(); } catch (_) { /* already unloaded */ }
    }
    setSound(null);
    setPlayingId(null);
    setPlayProgress(0);
  };

  // ================= TAKE MANAGEMENT =================

  const renameTake = async (id: string, newName: string) => {
    try {
      await updateTake(id, { name: newName });
      setTakes(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
    } catch (err) {
      console.error('Rename error:', err);
      Alert.alert('Error', 'Failed to rename take.');
    }
    setEditingId(null);
  };

  const removeTake = (take: VoiceTake) => {
    Alert.alert('Delete Take?', `Delete "${take.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await stopPlayback();
          await deleteTake(take.id);
          setTakes(prev => prev.filter(t => t.id !== take.id));
        }
      },
    ]);
  };

  // ================= AUDIO EDITING =================

  const openEditModal = (take: VoiceTake) => {
    setEditTake(take);
    setTrimStart('0');
    setTrimEnd('0');
    setEditOp('all');
    setShowEditModal(true);
  };

  const processAudio = async () => {
    if (!editTake) return;
    setProcessing(true);
    try {
      const fileUri = editTake.processedUri || editTake.uri;
      const formData = new FormData();
      formData.append('audio', {
        uri: fileUri,
        type: 'audio/m4a',
        name: 'audio.m4a',
      } as any);
      formData.append('operation', editOp);
      formData.append('trim_start', trimStart);
      formData.append('trim_end', trimEnd);

      const res = await axios.post(`${API_BASE_URL}/api/voice-studio/process`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      // Save processed audio locally
      const processedDir = `${FileSystem.documentDirectory}voice-studio/`;
      await FileSystem.makeDirectoryAsync(processedDir, { intermediates: true }).catch(() => {});
      const processedPath = `${processedDir}processed_${editTake.id}.mp3`;
      await FileSystem.writeAsStringAsync(processedPath, res.data.audio_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      await updateTake(editTake.id, {
        processedUri: processedPath,
        duration: res.data.new_duration,
      });

      setTakes(prev => prev.map(t =>
        t.id === editTake.id ? { ...t, processedUri: processedPath, duration: res.data.new_duration } : t
      ));

      setShowEditModal(false);
      Alert.alert('Processed!', `Audio ${editOp === 'all' ? 'trimmed, normalized & cleaned' : editOp}: ${res.data.new_duration}s`);
    } catch (err) {
      console.error('Process error:', err);
      Alert.alert('Error', 'Audio processing failed. Try again.');
    } finally {
      setProcessing(false);
    }
  };

  // ================= DEMO REEL =================

  const toggleTakeForReel = (id: string) => {
    setSelectedTakes(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const moveTakeInReel = (id: string, direction: 'up' | 'down') => {
    setSelectedTakes(prev => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  };

  const buildDemoReel = async () => {
    if (selectedTakes.length < 2) {
      Alert.alert('Select Takes', 'Choose at least 2 takes for a demo reel.');
      return;
    }
    setBuildingReel(true);
    try {
      const formData = new FormData();
      for (const takeId of selectedTakes) {
        const take = takes.find(t => t.id === takeId);
        if (!take) continue;
        const uri = take.processedUri || take.uri;
        formData.append('files', {
          uri,
          type: 'audio/m4a',
          name: `${take.id}.m4a`,
        } as any);
      }
      formData.append('gaps', '0.5');

      const res = await axios.post(`${API_BASE_URL}/api/voice-studio/demo-reel`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });

      // Save reel locally
      const reelDir = `${FileSystem.documentDirectory}voice-studio/`;
      await FileSystem.makeDirectoryAsync(reelDir, { intermediates: true }).catch(() => {});
      const reelPath = `${reelDir}reel_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(reelPath, res.data.audio_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const name = reelName.trim() || `Demo Reel ${reels.length + 1}`;
      const reel = await saveReel(reelPath, name, res.data.duration, selectedTakes);
      setReels(prev => [reel, ...prev]);
      setShowReelBuilder(false);
      setSelectedTakes([]);
      setReelName('');
      Alert.alert('Demo Reel Created!', `"${name}" (${res.data.duration}s) with ${res.data.segments_count} segments.`);
    } catch (err) {
      console.error('Build reel error:', err);
      Alert.alert('Error', 'Failed to build demo reel. Try again.');
    } finally {
      setBuildingReel(false);
    }
  };

  const shareFile = async (uri: string) => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'audio/mpeg', dialogTitle: 'Share Audio' });
      } else {
        Alert.alert('Sharing Unavailable', 'Sharing is not supported on this device.');
      }
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  const removeReel = (reel: DemoReel) => {
    Alert.alert('Delete Reel?', `Delete "${reel.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteReel(reel.id);
          setReels(prev => prev.filter(r => r.id !== reel.id));
        }
      },
    ]);
  };

  // ================= HELPERS =================

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ================= RENDER =================

  return (
    <SafeAreaView style={styles.container}>
      <ScreenGlow />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} data-testid="voice-studio-back" testID="voice-studio-back" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={19} color="#CFCBF2" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} testID="voice-studio-title">Voice Actor Studio</Text>
          <Text style={styles.headerSub}>Record and manage your own voice takes</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Error Banner */}
      {loadError && (
        <View style={styles.errorBanner} data-testid="voice-studio-error-banner" testID="voice-studio-error-banner">
          <Ionicons name="warning" size={18} color="#FFC37A" />
          <Text style={styles.errorBannerText}>Failed to load saved data</Text>
          <TouchableOpacity onPress={loadData} data-testid="voice-studio-retry-btn" testID="voice-studio-retry-btn">
            <Ionicons name="refresh" size={18} color="#7C5CFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {([
          { key: 'record' as Tab, label: 'Record', icon: 'mic' },
          { key: 'takes' as Tab, label: `Takes (${takes.length})`, icon: 'list' },
          { key: 'reel' as Tab, label: 'Reels', icon: 'albums' },
        ]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            data-testid={`tab-${tab.key}`}
            testID={`tab-${tab.key}`}
          >
            <Ionicons name={tab.icon as any} size={16} color={activeTab === tab.key ? '#fff' : '#6E6A95'} />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ====== RECORD TAB ====== */}
      {activeTab === 'record' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
          {/* Script material picker + on-screen script view.
              Independent of recording — the actor can pick material,
              start recording, and scroll/highlight lines while their
              voice is being captured. Empty script list is handled
              gracefully via the "Choose from library" affordance. */}
          <View style={styles.scriptPickerRow} data-testid="script-picker-row" testID="script-picker-row">
            {selectedScript ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.scriptPickerLabel}>Reading</Text>
                <Text style={styles.scriptPickerTitle} numberOfLines={1}>
                  {selectedScript.title}
                  {selectedCharacter ? ` — ${selectedCharacter}` : ''}
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={styles.scriptPickerLabel}>Optional</Text>
                <Text style={styles.scriptPickerTitle} numberOfLines={1}>
                  No script selected
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.scriptPickerBtn}
              onPress={() => setShowScriptPicker(true)}
              data-testid="choose-script-btn" testID="choose-script-btn"
            >
              <Ionicons name="library" size={16} color="#fff" />
              <Text style={styles.scriptPickerBtnText}>
                {selectedScript ? 'Change' : 'Choose Script'}
              </Text>
            </TouchableOpacity>
            {selectedScript && (
              <TouchableOpacity
                style={styles.scriptClearBtn}
                onPress={() => {
                  setSelectedScript(null);
                  setSelectedCharacter(null);
                  setActiveLineIndex(0);
                }}
                data-testid="clear-script-btn" testID="clear-script-btn"
              >
                <Ionicons name="close-circle" size={22} color="#6E6A95" />
              </TouchableOpacity>
            )}
          </View>

          {/* Character chips — visible only when a script is selected
              and it exposes characters (screenplay-parsed scripts do). */}
          {selectedScript && selectedScript.characters && selectedScript.characters.length > 0 && (
            <View style={styles.characterChips} data-testid="voice-studio-character-chips" testID="voice-studio-character-chips">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TouchableOpacity
                  style={[
                    styles.charChip,
                    selectedCharacter === null && styles.charChipActive,
                  ]}
                  onPress={() => setSelectedCharacter(null)}
                  data-testid="char-chip-all" testID="char-chip-all"
                >
                  <Text style={[
                    styles.charChipText,
                    selectedCharacter === null && styles.charChipTextActive,
                  ]}>All lines</Text>
                </TouchableOpacity>
                {selectedScript.characters.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.charChip,
                      selectedCharacter === c.name && styles.charChipActive,
                    ]}
                    onPress={() => { setSelectedCharacter(c.name); setActiveLineIndex(0); }}
                    data-testid={`char-chip-${c.name}`} testID={`char-chip-${c.name}`}
                  >
                    <Text style={[
                      styles.charChipText,
                      selectedCharacter === c.name && styles.charChipTextActive,
                    ]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Script view — read-only, scrollable. Highlights the current
              active line so the actor knows where they are. Only rendered
              when a script is selected and has dialogue lines. */}
          {selectedScript && selectedScript.lines && selectedScript.lines.length > 0 && (() => {
            const displayLines = selectedCharacter
              ? selectedScript.lines.filter(
                  (ln) => ln.character === selectedCharacter && !ln.is_stage_direction,
                )
              : selectedScript.lines;
            const safeIndex = Math.min(activeLineIndex, Math.max(0, displayLines.length - 1));
            return (
              <View style={styles.scriptPanel} data-testid="voice-studio-script-panel" testID="voice-studio-script-panel">
                <ScrollView style={styles.scriptScroll} nestedScrollEnabled>
                  {displayLines.map((line, i) => {
                    const isActive = i === safeIndex;
                    const isDirection = line.is_stage_direction;
                    return (
                      <View
                        key={line.id}
                        style={[
                          styles.scriptLine,
                          isActive && styles.scriptLineActive,
                        ]}
                        data-testid={isActive ? 'active-script-line' : undefined}
                        testID={isActive ? 'active-script-line' : undefined}
                      >
                        {!isDirection && (
                          <Text style={[
                            styles.scriptLineChar,
                            isActive && styles.scriptLineCharActive,
                          ]}>{line.character}</Text>
                        )}
                        <Text style={[
                          styles.scriptLineText,
                          isDirection && styles.scriptLineDirection,
                          isActive && styles.scriptLineTextActive,
                        ]}>{line.text}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
                <View style={styles.scriptNavRow}>
                  <TouchableOpacity
                    style={styles.scriptNavBtn}
                    onPress={() => setActiveLineIndex((i) => Math.max(0, i - 1))}
                    disabled={safeIndex === 0}
                    data-testid="prev-line-btn" testID="prev-line-btn"
                  >
                    <Ionicons name="chevron-back" size={18}
                      color={safeIndex === 0 ? '#3A3666' : '#fff'} />
                    <Text style={[
                      styles.scriptNavText,
                      safeIndex === 0 && { color: '#3A3666' },
                    ]}>Prev</Text>
                  </TouchableOpacity>
                  <Text style={styles.scriptNavCount}>
                    Line {safeIndex + 1} / {displayLines.length}
                  </Text>
                  <TouchableOpacity
                    style={styles.scriptNavBtn}
                    onPress={() => setActiveLineIndex((i) => Math.min(displayLines.length - 1, i + 1))}
                    disabled={safeIndex >= displayLines.length - 1}
                    data-testid="next-line-btn" testID="next-line-btn"
                  >
                    <Text style={[
                      styles.scriptNavText,
                      safeIndex >= displayLines.length - 1 && { color: '#3A3666' },
                    ]}>Next</Text>
                    <Ionicons name="chevron-forward" size={18}
                      color={safeIndex >= displayLines.length - 1 ? '#3A3666' : '#fff'} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}

          {/* Waveform */}
          <View style={styles.waveformContainer}>
            <View style={styles.waveformBars}>
              {barAnims.map((anim, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.waveBar,
                    {
                      height: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 80],
                      }),
                      backgroundColor: isRecording
                        ? (isPaused ? '#FFC37A' : '#FF5C7A')
                        : '#7C5CFF',
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.recTime} testID="voice-rec-time">{formatDuration(recDuration)}</Text>
            <Text style={styles.recLabel} testID="voice-rec-status">
              {isRecording ? (isPaused ? 'Paused' : 'Recording...') : 'Ready to record'}
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.controlsRow}>
            {!isRecording ? (
              <TouchableOpacity style={styles.recordBtn} onPress={startRecording} data-testid="start-record-btn" testID="start-record-btn" accessibilityLabel="Start recording">
                <View style={styles.recordBtnInner}>
                  <Ionicons name="mic" size={36} color="#fff" />
                </View>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.controlBtn}
                  onPress={isPaused ? resumeRecording : pauseRecording}
                  data-testid="pause-resume-btn" testID="pause-resume-btn"
                >
                  <Ionicons name={isPaused ? 'play' : 'pause'} size={28} color="#fff" />
                  <Text style={styles.controlLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.stopBtn} onPress={stopRecording} data-testid="stop-record-btn" testID="stop-record-btn" accessibilityLabel="Stop recording">
                  <View style={styles.stopBtnInner}>
                    <Ionicons name="stop" size={32} color="#fff" />
                  </View>
                </TouchableOpacity>

                <View style={styles.controlBtn}>
                  <Ionicons name="time" size={28} color="#6E6A95" />
                  <Text style={styles.controlLabel}>{formatDuration(recDuration)}</Text>
                </View>
              </>
            )}
          </View>

          {/* Quick Tips */}
          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Voice-Over Tips</Text>
            <View style={styles.tipRow}>
              <Ionicons name="volume-medium" size={16} color="#7C5CFF" />
              <Text style={styles.tipText}>Maintain consistent distance from mic</Text>
            </View>
            <View style={styles.tipRow}>
              <Ionicons name="water" size={16} color="#7C5CFF" />
              <Text style={styles.tipText}>Stay hydrated for clear vocal quality</Text>
            </View>
            <View style={styles.tipRow}>
              <Ionicons name="happy" size={16} color="#7C5CFF" />
              <Text style={styles.tipText}>Smile while recording for warmth</Text>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ====== TAKES TAB ====== */}
      {activeTab === 'takes' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
          {takes.length === 0 ? (
            <View style={styles.emptyState} testID="voice-takes-empty">
              <View style={styles.emptyIcon}><Ionicons name="mic-off" size={34} color={C.violetSoft} /></View>
              <Text style={styles.emptyTitle}>No Takes Yet</Text>
              <Text style={styles.emptyDesc}>Record your first voice-over take to get started</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setActiveTab('record')} testID="voice-takes-empty-record-btn">
                <Ionicons name="mic" size={20} color="#fff" />
                <Text style={styles.emptyBtnText}>Start Recording</Text>
              </TouchableOpacity>
            </View>
          ) : (
            takes.map((take) => (
              <View key={take.id} style={styles.takeCard}>
                <View style={styles.takeHeader}>
                  {editingId === take.id ? (
                    <View style={styles.renameRow}>
                      <TextInput
                        style={styles.renameInput}
                        value={editName}
                        onChangeText={setEditName}
                        autoFocus
                        onSubmitEditing={() => renameTake(take.id, editName)}
                        data-testid={`rename-input-${take.id}`} testID={`rename-input-${take.id}`}
                      />
                      <TouchableOpacity onPress={() => renameTake(take.id, editName)} testID={`rename-confirm-${take.id}`}>
                        <Ionicons name="checkmark" size={22} color="#34D399" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingId(null)} testID={`rename-cancel-${take.id}`}>
                        <Ionicons name="close" size={22} color="#6E6A95" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.takeName}>{take.name}</Text>
                        <Text style={styles.takeMeta}>
                          {formatDuration(take.duration)} · {new Date(take.createdAt).toLocaleDateString()}
                          {take.processedUri ? ' · Processed' : ''}
                        </Text>
                      </View>
                    </>
                  )}
                </View>

                {/* Progress bar when playing */}
                {playingId === take.id && (
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${playProgress * 100}%` }]} />
                  </View>
                )}

                <View style={styles.takeActions}>
                  <TouchableOpacity
                    style={[styles.takeActionBtn, playingId === take.id && styles.takeActionActive]}
                    onPress={() => playTake(take)}
                    data-testid={`play-take-${take.id}`} testID={`play-take-${take.id}`}
                  >
                    <Ionicons name={playingId === take.id ? 'stop' : 'play'} size={18}
                      color={playingId === take.id ? '#FF5C7A' : '#7C5CFF'} />
                    <Text style={styles.takeActionText}>{playingId === take.id ? 'Stop' : 'Play'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => { setEditingId(take.id); setEditName(take.name); }}
                    data-testid={`rename-take-${take.id}`} testID={`rename-take-${take.id}`}
                  >
                    <Ionicons name="pencil" size={18} color="#FFC37A" />
                    <Text style={styles.takeActionText}>Rename</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => openEditModal(take)}
                    data-testid={`edit-take-${take.id}`} testID={`edit-take-${take.id}`}
                  >
                    <Ionicons name="options" size={18} color="#34D399" />
                    <Text style={styles.takeActionText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => shareFile(take.processedUri || take.uri)}
                    data-testid={`share-take-${take.id}`} testID={`share-take-${take.id}`}
                  >
                    <Ionicons name="share-outline" size={18} color="#8FAAFF" />
                    <Text style={styles.takeActionText}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => removeTake(take)}
                    data-testid={`delete-take-${take.id}`} testID={`delete-take-${take.id}`}
                  >
                    <Ionicons name="trash" size={18} color="#FF5C7A" />
                    <Text style={styles.takeActionText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* ====== REEL TAB ====== */}
      {activeTab === 'reel' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
          {/* Build Reel CTA */}
          <TouchableOpacity
            style={[styles.buildReelBtn, takes.length < 2 && styles.buildReelBtnDisabled]}
            onPress={() => setShowReelBuilder(true)}
            disabled={takes.length < 2}
            data-testid="open-reel-builder-btn" testID="open-reel-builder-btn"
          >
            <Ionicons name="add-circle" size={24} color="#fff" />
            <Text style={styles.buildReelBtnText}>Build Demo Reel</Text>
            {takes.length < 2 && (
              <Text style={styles.buildReelSub}>Record at least 2 takes first</Text>
            )}
          </TouchableOpacity>

          {/* Existing Reels */}
          {reels.length === 0 ? (
            <View style={styles.emptyState} testID="voice-reels-empty">
              <View style={styles.emptyIcon}><Ionicons name="albums-outline" size={34} color={C.violetSoft} /></View>
              <Text style={styles.emptyTitle}>No Demo Reels</Text>
              <Text style={styles.emptyDesc}>
                Combine your best takes into a professional demo reel
              </Text>
            </View>
          ) : (
            reels.map(reel => (
              <View key={reel.id} style={styles.reelCard}>
                <View style={styles.reelHeader}>
                  <View style={styles.reelIcon}><Ionicons name="albums" size={20} color={C.cyan} /></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.reelName}>{reel.name}</Text>
                    <Text style={styles.reelMeta}>
                      {formatDuration(reel.duration)} · {reel.takeIds.length} takes · {new Date(reel.createdAt).toLocaleDateString()}
                    </Text>
                    <Text style={styles.reelWatermark}>{WATERMARK_TEXT}</Text>
                  </View>
                </View>
                <View style={styles.reelActions}>
                  <TouchableOpacity
                    style={styles.reelActionBtn}
                    onPress={async () => {
                      try {
                        const { sound: s } = await Audio.Sound.createAsync({ uri: reel.uri }, { shouldPlay: true });
                        s.setOnPlaybackStatusUpdate((status) => {
                          if (status.isLoaded && status.didJustFinish) s.unloadAsync();
                        });
                      } catch { Alert.alert('Error', 'Could not play reel.'); }
                    }}
                    data-testid={`play-reel-${reel.id}`} testID={`play-reel-${reel.id}`}
                  >
                    <Ionicons name="play" size={18} color="#7C5CFF" />
                    <Text style={styles.reelActionText}>Play</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reelActionBtn}
                    onPress={() => shareFile(reel.uri)}
                    data-testid={`share-reel-${reel.id}`} testID={`share-reel-${reel.id}`}
                  >
                    <Ionicons name="share-outline" size={18} color="#8FAAFF" />
                    <Text style={styles.reelActionText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reelActionBtn}
                    onPress={() => removeReel(reel)}
                    data-testid={`delete-reel-${reel.id}`} testID={`delete-reel-${reel.id}`}
                  >
                    <Ionicons name="trash" size={18} color="#FF5C7A" />
                    <Text style={styles.reelActionText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* ====== EDIT MODAL ====== */}
      <Modal visible={showEditModal} transparent animationType="slide" onRequestClose={() => setShowEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Audio</Text>
              <TouchableOpacity onPress={() => setShowEditModal(false)} testID="edit-modal-close" style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color="#A19DC6" />
              </TouchableOpacity>
            </View>

            {editTake && (
              <>
                <Text style={styles.modalSubtitle}>
                  {editTake.name} ({formatDuration(editTake.duration)})
                </Text>

                {/* Operation selector */}
                <Text style={styles.inputLabel}>Operation</Text>
                <View style={styles.opRow}>
                  {([
                    { key: 'trim' as const, label: 'Trim', icon: 'cut' },
                    { key: 'normalize' as const, label: 'Normalize', icon: 'volume-high' },
                    { key: 'remove_silence' as const, label: 'De-Silence', icon: 'remove-circle' },
                    { key: 'all' as const, label: 'All', icon: 'flash' },
                  ]).map(op => (
                    <TouchableOpacity
                      key={op.key}
                      testID={`edit-op-${op.key}`}
                      style={[styles.opBtn, editOp === op.key && styles.opBtnActive]}
                      onPress={() => setEditOp(op.key)}
                    >
                      <Ionicons name={op.icon as any} size={16} color={editOp === op.key ? '#fff' : '#A19DC6'} />
                      <Text style={[styles.opBtnText, editOp === op.key && { color: '#fff' }]}>{op.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {(editOp === 'trim' || editOp === 'all') && (
                  <View style={styles.trimRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>Trim Start (s)</Text>
                      <TextInput
                        style={styles.modalInput}
                        value={trimStart}
                        onChangeText={setTrimStart}
                        keyboardType="decimal-pad"
                        data-testid="trim-start-input" testID="trim-start-input"
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.inputLabel}>Trim End (s)</Text>
                      <TextInput
                        style={styles.modalInput}
                        value={trimEnd}
                        onChangeText={setTrimEnd}
                        keyboardType="decimal-pad"
                        data-testid="trim-end-input" testID="trim-end-input"
                      />
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.processBtn}
                  onPress={processAudio}
                  disabled={processing}
                  data-testid="process-audio-btn" testID="process-audio-btn"
                >
                  {processing ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="flash" size={20} color="#fff" />
                      <Text style={styles.processBtnText}>Process Audio</Text>
                    </>
                  )}
                </TouchableOpacity>

                <Text style={styles.editNote}>
                  Original take is preserved. Processing creates a new version.
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ====== REEL BUILDER MODAL ====== */}
      <Modal visible={showReelBuilder} transparent animationType="slide" onRequestClose={() => setShowReelBuilder(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Build Demo Reel</Text>
              <TouchableOpacity onPress={() => { setShowReelBuilder(false); setSelectedTakes([]); }} testID="reel-builder-close" style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color="#A19DC6" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Reel name (optional)"
              placeholderTextColor="#6E6A95"
              value={reelName}
              onChangeText={setReelName}
              data-testid="reel-name-input" testID="reel-name-input"
            />

            <Text style={[styles.inputLabel, { marginTop: 16 }]}>
              Select and arrange takes ({selectedTakes.length} selected)
            </Text>

            <ScrollView style={{ maxHeight: 320, marginVertical: 8 }}>
              {takes.map(take => {
                const isSelected = selectedTakes.includes(take.id);
                const orderIdx = selectedTakes.indexOf(take.id);
                return (
                  <TouchableOpacity
                    key={take.id}
                    style={[styles.reelTakeItem, isSelected && styles.reelTakeSelected]}
                    onPress={() => toggleTakeForReel(take.id)}
                    data-testid={`reel-select-${take.id}`} testID={`reel-select-${take.id}`}
                  >
                    <View style={[styles.checkCircle, isSelected && styles.checkCircleActive]}>
                      {isSelected && <Text style={styles.checkNum}>{orderIdx + 1}</Text>}
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.reelTakeName}>{take.name}</Text>
                      <Text style={styles.reelTakeMeta}>{formatDuration(take.duration)}</Text>
                    </View>
                    {isSelected && (
                      <View style={styles.reorderBtns}>
                        <TouchableOpacity onPress={() => moveTakeInReel(take.id, 'up')} testID={`reel-move-up-${take.id}`}>
                          <Ionicons name="chevron-up" size={20} color="#7C5CFF" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => moveTakeInReel(take.id, 'down')} testID={`reel-move-down-${take.id}`}>
                          <Ionicons name="chevron-down" size={20} color="#7C5CFF" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.processBtn, selectedTakes.length < 2 && { opacity: 0.5 }]}
              onPress={buildDemoReel}
              disabled={selectedTakes.length < 2 || buildingReel}
              data-testid="build-reel-btn" testID="build-reel-btn"
            >
              {buildingReel ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="albums" size={20} color="#fff" />
                  <Text style={styles.processBtnText}>
                    Build Reel ({selectedTakes.length} takes)
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Script picker modal — lists user's saved scripts. Handles the
          empty state ("no scripts yet") with a helpful CTA. */}
      <Modal
        visible={showScriptPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowScriptPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} data-testid="script-picker-modal" testID="script-picker-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose a script</Text>
              <TouchableOpacity
                onPress={() => setShowScriptPicker(false)}
                data-testid="script-picker-close" testID="script-picker-close"
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {scripts.length === 0 ? (
              <View style={styles.emptyState} data-testid="script-picker-empty" testID="script-picker-empty">
                <View style={styles.emptyIcon}><Ionicons name="document-text-outline" size={32} color={C.violetSoft} /></View>
                <Text style={styles.emptyTitle}>No scripts yet</Text>
                <Text style={styles.emptyDesc}>
                  Import a script from the Library first, then come back to
                  record with it on screen.
                </Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => {
                    setShowScriptPicker(false);
                    router.push('/scripts');
                  }}
                  data-testid="script-picker-goto-library" testID="script-picker-goto-library"
                >
                  <Ionicons name="library" size={18} color="#fff" />
                  <Text style={styles.emptyBtnText}>Open Library</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={scripts}
                keyExtractor={(s) => s.id}
                contentContainerStyle={{ paddingBottom: 24 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.scriptPickerItem}
                    onPress={() => {
                      setSelectedScript(item);
                      setSelectedCharacter(null);
                      setActiveLineIndex(0);
                      setShowScriptPicker(false);
                    }}
                    data-testid={`script-picker-item-${item.id}`} testID={`script-picker-item-${item.id}`}
                  >
                    <Ionicons name="document-text" size={22} color="#7C5CFF" />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.scriptPickerItemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.scriptPickerItemMeta}>
                        {item.characters?.length ?? 0} characters ·{' '}
                        {item.lines?.length ?? 0} lines
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#6E6A95" />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const panel = { backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.line };
const chipBtn = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  headerBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  headerCenter: { flex: 1, alignItems: 'center', marginHorizontal: 8 },
  headerTitle: { ...TYPE.title, fontSize: 18 },
  headerSub: { ...TYPE.caption, fontSize: 11, marginTop: 2 },

  // Tab bar
  tabBar: { flexDirection: 'row', marginHorizontal: 18, marginBottom: 4, padding: 4, gap: 4, ...panel, borderRadius: RADIUS.md },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 6, borderRadius: 11 },
  tabActive: { backgroundColor: C.violet },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '600' },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  tabContent: { padding: 18, paddingBottom: 40 },

  // Waveform
  waveformContainer: { alignItems: 'center', ...panel, borderRadius: RADIUS.xl, padding: 24, marginBottom: 24, borderColor: tint(C.violet, 0.22) },
  waveformBars: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 80, gap: 3, marginBottom: 16 },
  waveBar: { width: 4, borderRadius: 2 },
  recTime: { fontSize: 38, fontWeight: '800', color: C.text, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  recLabel: { ...TYPE.label, marginTop: 6 },

  // Controls
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, marginBottom: 28 },
  recordBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: tint(C.danger, 0.14), borderWidth: 1, borderColor: tint(C.danger, 0.35), justifyContent: 'center', alignItems: 'center' },
  recordBtnInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.danger, justifyContent: 'center', alignItems: 'center' },
  stopBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: tint(C.danger, 0.14), borderWidth: 1, borderColor: tint(C.danger, 0.35), justifyContent: 'center', alignItems: 'center' },
  stopBtnInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.danger, justifyContent: 'center', alignItems: 'center' },
  controlBtn: { alignItems: 'center', gap: 4, minWidth: 60 },
  controlLabel: { fontSize: 12, color: C.muted, fontWeight: '600' },

  // Tips
  tipsCard: { ...panel, padding: 16 },
  tipsTitle: { ...TYPE.label, marginBottom: 8 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  tipText: { fontSize: 13, color: C.text },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.violet, 0.12), borderWidth: 1, borderColor: tint(C.violet, 0.3) },
  emptyTitle: { ...TYPE.title, fontSize: 18, marginTop: 16 },
  emptyDesc: { fontSize: 14, color: C.muted, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, backgroundColor: C.violet, paddingHorizontal: 22, paddingVertical: 13, borderRadius: RADIUS.md },
  emptyBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Take card
  takeCard: { ...panel, padding: 14, marginBottom: 12 },
  takeHeader: { marginBottom: 10 },
  takeName: { fontSize: 16, fontWeight: '700', color: C.text },
  takeMeta: { ...TYPE.caption, marginTop: 2 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  renameInput: { flex: 1, backgroundColor: C.ink, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: C.text, borderWidth: 1, borderColor: C.violet },
  progressBar: { height: 3, backgroundColor: C.surface2, borderRadius: 2, marginBottom: 10 },
  progressFill: { height: 3, backgroundColor: C.cyan, borderRadius: 2 },
  takeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  takeActionBtn: chipBtn,
  takeActionActive: { backgroundColor: tint(C.danger, 0.12), borderColor: tint(C.danger, 0.35) },
  takeActionText: { fontSize: 12, color: C.text, fontWeight: '600' },

  // Reel
  buildReelBtn: { alignItems: 'center', backgroundColor: C.violet, borderRadius: RADIUS.lg, padding: 18, marginBottom: 20, gap: 4 },
  buildReelBtnDisabled: { backgroundColor: tint(C.violet, 0.35) },
  buildReelBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  buildReelSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  reelCard: { ...panel, padding: 14, marginBottom: 12 },
  reelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  reelIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(C.cyan, 0.14) },
  reelName: { fontSize: 16, fontWeight: '700', color: C.text },
  reelMeta: { ...TYPE.caption, marginTop: 2 },
  reelWatermark: { fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4, letterSpacing: 0.3 },
  reelActions: { flexDirection: 'row', gap: 8 },
  reelActionBtn: { ...chipBtn, paddingHorizontal: 12, paddingVertical: 8 },
  reelActionText: { fontSize: 13, color: C.text, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(5, 4, 14, 0.78)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: 24, maxHeight: '80%', borderWidth: 1, borderColor: C.line },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalCloseBtn: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  modalTitle: { ...TYPE.title },
  modalSubtitle: { fontSize: 14, color: C.muted, marginBottom: 16 },
  inputLabel: { ...TYPE.label, fontSize: 10, color: C.muted, marginBottom: 8 },
  modalInput: { backgroundColor: C.ink, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, borderWidth: 1, borderColor: C.line },
  opRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  opBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: C.ink, borderWidth: 1, borderColor: C.line, gap: 4 },
  opBtnActive: { backgroundColor: C.violet, borderColor: C.violet },
  opBtnText: { fontSize: 11, color: C.muted, fontWeight: '600' },
  trimRow: { flexDirection: 'row', marginBottom: 16 },
  processBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.violet, paddingVertical: 14, borderRadius: RADIUS.md, gap: 8, marginTop: 8 },
  processBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  editNote: { fontSize: 12, color: C.dim, textAlign: 'center', marginTop: 12 },

  // Reel builder
  reelTakeItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: C.ink, borderRadius: RADIUS.md, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  reelTakeSelected: { borderColor: C.violet, backgroundColor: tint(C.violet, 0.1) },
  checkCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#3A3666', alignItems: 'center', justifyContent: 'center' },
  checkCircleActive: { backgroundColor: C.violet, borderColor: C.violet },
  checkNum: { color: '#fff', fontSize: 13, fontWeight: '800' },
  reelTakeName: { fontSize: 15, fontWeight: '600', color: C.text },
  reelTakeMeta: { fontSize: 12, color: C.muted },
  reorderBtns: { gap: 2 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 9, marginHorizontal: 18, marginBottom: 8, borderRadius: RADIUS.md, backgroundColor: tint(C.warning, 0.1), borderWidth: 1, borderColor: tint(C.warning, 0.25) },
  errorBannerText: { fontSize: 13, color: C.warning, fontWeight: '600' },

  // Script material — picker row, character chips, on-screen script.
  scriptPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, ...panel, padding: 14, marginBottom: 12 },
  scriptPickerLabel: { ...TYPE.label, fontSize: 10 },
  scriptPickerTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginTop: 3 },
  scriptPickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.violet, paddingHorizontal: 12, paddingVertical: 9, borderRadius: RADIUS.pill },
  scriptPickerBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  scriptClearBtn: { paddingLeft: 4 },
  characterChips: { marginBottom: 12 },
  charChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginRight: 8 },
  charChipActive: { backgroundColor: tint(C.violet, 0.22), borderColor: C.violet },
  charChipText: { fontSize: 13, color: C.muted, fontWeight: '600' },
  charChipTextActive: { color: C.text, fontWeight: '700' },
  scriptPanel: { backgroundColor: C.ink, borderRadius: RADIUS.lg, marginBottom: 16, borderWidth: 1, borderColor: tint(C.violet, 0.22), overflow: 'hidden' },
  scriptScroll: { maxHeight: 220, padding: 12 },
  scriptLine: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 4 },
  scriptLineActive: { backgroundColor: tint(C.violet, 0.15), borderLeftWidth: 3, borderLeftColor: C.violet },
  scriptLineChar: { fontSize: 11, fontWeight: '800', color: C.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  scriptLineCharActive: { color: C.violetSoft },
  scriptLineText: { fontSize: 14, color: '#D6D3F0', lineHeight: 20 },
  scriptLineTextActive: { color: C.text, fontWeight: '600' },
  scriptLineDirection: { fontStyle: 'italic', color: C.dim },
  scriptNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.surface },
  scriptNavBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  scriptNavText: { fontSize: 13, color: C.text, fontWeight: '700' },
  scriptNavCount: { fontSize: 12, color: C.muted, fontVariant: ['tabular-nums'] },
  scriptPickerItem: { flexDirection: 'row', alignItems: 'center', ...panel, borderRadius: RADIUS.md, padding: 14, marginBottom: 8 },
  scriptPickerItemTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  scriptPickerItemMeta: { ...TYPE.caption, marginTop: 2 },
});
