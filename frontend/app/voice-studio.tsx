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
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import {
  VoiceTake, saveTake, getTakes, updateTake, deleteTake,
  DemoReel, saveReel, getReels, deleteReel,
} from '../services/voiceStudioStorage';
import { WATERMARK_TEXT, WATERMARK_SUBTEXT } from '../services/watermarkService';

import { API_BASE_URL } from '../services/apiConfig';

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

  // Animation refs
  const barAnims = useRef(new Array(BAR_COUNT).fill(0).map(() => new Animated.Value(0))).current;

  useEffect(() => {
    loadData();
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
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      setIsPaused(false);

      if (uri) {
        const takeNum = takes.length + 1;
        const name = `Take ${takeNum}`;
        const take = await saveTake(uri, name, recDuration);
        setTakes(prev => [take, ...prev]);
        setActiveTab('takes');
        Alert.alert('Saved!', `"${name}" saved (${formatDuration(recDuration)})`);
      }

      // Reset waveform
      barAnims.forEach(a => a.setValue(0));
      setMeterLevels(new Array(BAR_COUNT).fill(0));
    } catch (err) {
      console.error('Stop recording error:', err);
      Alert.alert('Error', 'Failed to save recording.');
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} data-testid="voice-studio-back">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Voice Actor Studio</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Error Banner */}
      {loadError && (
        <View style={styles.errorBanner} data-testid="voice-studio-error-banner">
          <Ionicons name="warning" size={18} color="#f59e0b" />
          <Text style={styles.errorBannerText}>Failed to load saved data</Text>
          <TouchableOpacity onPress={loadData} data-testid="voice-studio-retry-btn">
            <Ionicons name="refresh" size={18} color="#6366f1" />
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
          >
            <Ionicons name={tab.icon as any} size={18} color={activeTab === tab.key ? '#6366f1' : '#6b7280'} />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ====== RECORD TAB ====== */}
      {activeTab === 'record' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
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
                        ? (isPaused ? '#f59e0b' : '#ef4444')
                        : '#6366f1',
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.recTime}>{formatDuration(recDuration)}</Text>
            <Text style={styles.recLabel}>
              {isRecording ? (isPaused ? 'Paused' : 'Recording...') : 'Ready to record'}
            </Text>
          </View>

          {/* Controls */}
          <View style={styles.controlsRow}>
            {!isRecording ? (
              <TouchableOpacity style={styles.recordBtn} onPress={startRecording} data-testid="start-record-btn">
                <View style={styles.recordBtnInner}>
                  <Ionicons name="mic" size={36} color="#fff" />
                </View>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.controlBtn}
                  onPress={isPaused ? resumeRecording : pauseRecording}
                  data-testid="pause-resume-btn"
                >
                  <Ionicons name={isPaused ? 'play' : 'pause'} size={28} color="#fff" />
                  <Text style={styles.controlLabel}>{isPaused ? 'Resume' : 'Pause'}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.stopBtn} onPress={stopRecording} data-testid="stop-record-btn">
                  <View style={styles.stopBtnInner}>
                    <Ionicons name="stop" size={32} color="#fff" />
                  </View>
                </TouchableOpacity>

                <View style={styles.controlBtn}>
                  <Ionicons name="time" size={28} color="#6b7280" />
                  <Text style={styles.controlLabel}>{formatDuration(recDuration)}</Text>
                </View>
              </>
            )}
          </View>

          {/* Quick Tips */}
          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>Voice-Over Tips</Text>
            <View style={styles.tipRow}>
              <Ionicons name="volume-medium" size={16} color="#6366f1" />
              <Text style={styles.tipText}>Maintain consistent distance from mic</Text>
            </View>
            <View style={styles.tipRow}>
              <Ionicons name="water" size={16} color="#6366f1" />
              <Text style={styles.tipText}>Stay hydrated for clear vocal quality</Text>
            </View>
            <View style={styles.tipRow}>
              <Ionicons name="happy" size={16} color="#6366f1" />
              <Text style={styles.tipText}>Smile while recording for warmth</Text>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ====== TAKES TAB ====== */}
      {activeTab === 'takes' && (
        <ScrollView contentContainerStyle={styles.tabContent}>
          {takes.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="mic-off" size={48} color="#374151" />
              <Text style={styles.emptyTitle}>No Takes Yet</Text>
              <Text style={styles.emptyDesc}>Record your first voice-over take to get started</Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setActiveTab('record')}>
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
                        data-testid={`rename-input-${take.id}`}
                      />
                      <TouchableOpacity onPress={() => renameTake(take.id, editName)}>
                        <Ionicons name="checkmark" size={22} color="#10b981" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingId(null)}>
                        <Ionicons name="close" size={22} color="#6b7280" />
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
                    data-testid={`play-take-${take.id}`}
                  >
                    <Ionicons name={playingId === take.id ? 'stop' : 'play'} size={18}
                      color={playingId === take.id ? '#ef4444' : '#6366f1'} />
                    <Text style={styles.takeActionText}>{playingId === take.id ? 'Stop' : 'Play'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => { setEditingId(take.id); setEditName(take.name); }}
                    data-testid={`rename-take-${take.id}`}
                  >
                    <Ionicons name="pencil" size={18} color="#f59e0b" />
                    <Text style={styles.takeActionText}>Rename</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => openEditModal(take)}
                    data-testid={`edit-take-${take.id}`}
                  >
                    <Ionicons name="options" size={18} color="#10b981" />
                    <Text style={styles.takeActionText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => shareFile(take.processedUri || take.uri)}
                    data-testid={`share-take-${take.id}`}
                  >
                    <Ionicons name="share-outline" size={18} color="#3b82f6" />
                    <Text style={styles.takeActionText}>Share</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.takeActionBtn}
                    onPress={() => removeTake(take)}
                    data-testid={`delete-take-${take.id}`}
                  >
                    <Ionicons name="trash" size={18} color="#ef4444" />
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
            style={styles.buildReelBtn}
            onPress={() => setShowReelBuilder(true)}
            disabled={takes.length < 2}
            data-testid="open-reel-builder-btn"
          >
            <Ionicons name="add-circle" size={24} color="#fff" />
            <Text style={styles.buildReelBtnText}>Build Demo Reel</Text>
            {takes.length < 2 && (
              <Text style={styles.buildReelSub}>Record at least 2 takes first</Text>
            )}
          </TouchableOpacity>

          {/* Existing Reels */}
          {reels.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="albums-outline" size={48} color="#374151" />
              <Text style={styles.emptyTitle}>No Demo Reels</Text>
              <Text style={styles.emptyDesc}>
                Combine your best takes into a professional demo reel
              </Text>
            </View>
          ) : (
            reels.map(reel => (
              <View key={reel.id} style={styles.reelCard}>
                <View style={styles.reelHeader}>
                  <Ionicons name="albums" size={24} color="#10b981" />
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
                    data-testid={`play-reel-${reel.id}`}
                  >
                    <Ionicons name="play" size={18} color="#6366f1" />
                    <Text style={styles.reelActionText}>Play</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reelActionBtn}
                    onPress={() => shareFile(reel.uri)}
                    data-testid={`share-reel-${reel.id}`}
                  >
                    <Ionicons name="share-outline" size={18} color="#3b82f6" />
                    <Text style={styles.reelActionText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.reelActionBtn}
                    onPress={() => removeReel(reel)}
                    data-testid={`delete-reel-${reel.id}`}
                  >
                    <Ionicons name="trash" size={18} color="#ef4444" />
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
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={24} color="#9ca3af" />
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
                      style={[styles.opBtn, editOp === op.key && styles.opBtnActive]}
                      onPress={() => setEditOp(op.key)}
                    >
                      <Ionicons name={op.icon as any} size={16} color={editOp === op.key ? '#fff' : '#9ca3af'} />
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
                        data-testid="trim-start-input"
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.inputLabel}>Trim End (s)</Text>
                      <TextInput
                        style={styles.modalInput}
                        value={trimEnd}
                        onChangeText={setTrimEnd}
                        keyboardType="decimal-pad"
                        data-testid="trim-end-input"
                      />
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.processBtn}
                  onPress={processAudio}
                  disabled={processing}
                  data-testid="process-audio-btn"
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
              <TouchableOpacity onPress={() => { setShowReelBuilder(false); setSelectedTakes([]); }}>
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Reel name (optional)"
              placeholderTextColor="#6b7280"
              value={reelName}
              onChangeText={setReelName}
              data-testid="reel-name-input"
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
                    data-testid={`reel-select-${take.id}`}
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
                        <TouchableOpacity onPress={() => moveTakeInReel(take.id, 'up')}>
                          <Ionicons name="chevron-up" size={20} color="#6366f1" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => moveTakeInReel(take.id, 'down')}>
                          <Ionicons name="chevron-down" size={20} color="#6366f1" />
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
              data-testid="build-reel-btn"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },

  // Tab bar
  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, gap: 6,
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  tabTextActive: { color: '#6366f1' },
  tabContent: { padding: 16, paddingBottom: 40 },

  // Waveform
  waveformContainer: {
    alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 16,
    padding: 24, marginBottom: 24, borderWidth: 1, borderColor: '#2a2a3e',
  },
  waveformBars: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 80, gap: 3, marginBottom: 16,
  },
  waveBar: { width: 4, borderRadius: 2 },
  recTime: { fontSize: 36, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
  recLabel: { fontSize: 14, color: '#6b7280', marginTop: 4 },

  // Controls
  controlsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 32, marginBottom: 32,
  },
  recordBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(239, 68, 68, 0.15)', justifyContent: 'center', alignItems: 'center',
  },
  recordBtnInner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center',
  },
  stopBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(239, 68, 68, 0.15)', justifyContent: 'center', alignItems: 'center',
  },
  stopBtnInner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center',
  },
  controlBtn: { alignItems: 'center', gap: 4, minWidth: 60 },
  controlLabel: { fontSize: 12, color: '#9ca3af' },

  // Tips
  tipsCard: {
    backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  tipsTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 10 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  tipText: { fontSize: 13, color: '#9ca3af' },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#6b7280', marginTop: 12 },
  emptyDesc: { fontSize: 14, color: '#4b5563', marginTop: 4, textAlign: 'center' },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Take card
  takeCard: {
    backgroundColor: '#1a1a2e', borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  takeHeader: { marginBottom: 8 },
  takeName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  takeMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  renameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  renameInput: {
    flex: 1, backgroundColor: '#0a0a0f', borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: 8, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#6366f1',
  },
  progressBar: {
    height: 3, backgroundColor: '#2a2a3e', borderRadius: 2, marginBottom: 8,
  },
  progressFill: { height: 3, backgroundColor: '#6366f1', borderRadius: 2 },
  takeActions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  takeActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  takeActionActive: { backgroundColor: 'rgba(239, 68, 68, 0.1)' },
  takeActionText: { fontSize: 12, color: '#9ca3af', fontWeight: '500' },

  // Reel
  buildReelBtn: {
    alignItems: 'center', backgroundColor: '#6366f1', borderRadius: 14,
    padding: 18, marginBottom: 20, gap: 4,
  },
  buildReelBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  buildReelSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  reelCard: {
    backgroundColor: '#1a1a2e', borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  reelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  reelName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  reelMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  reelWatermark: { fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4, letterSpacing: 0.3 },
  reelActions: { flexDirection: 'row', gap: 8 },
  reelActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  reelActionText: { fontSize: 13, color: '#9ca3af', fontWeight: '500' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  modalSubtitle: { fontSize: 14, color: '#9ca3af', marginBottom: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 6 },
  modalInput: {
    backgroundColor: '#0a0a0f', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#2a2a3e',
  },
  opRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  opBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#2a2a3e', gap: 4,
  },
  opBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  opBtnText: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
  trimRow: { flexDirection: 'row', marginBottom: 16 },
  processBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#6366f1', paddingVertical: 14, borderRadius: 12, gap: 8, marginTop: 8,
  },
  processBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  editNote: { fontSize: 12, color: '#4b5563', textAlign: 'center', marginTop: 12 },

  // Reel builder
  reelTakeItem: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    backgroundColor: '#0a0a0f', borderRadius: 10, marginBottom: 8,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  reelTakeSelected: { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)' },
  checkCircle: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2,
    borderColor: '#374151', alignItems: 'center', justifyContent: 'center',
  },
  checkCircleActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  checkNum: { color: '#fff', fontSize: 13, fontWeight: '700' },
  reelTakeName: { fontSize: 15, fontWeight: '500', color: '#fff' },
  reelTakeMeta: { fontSize: 12, color: '#6b7280' },
  reorderBtns: { gap: 2 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 8, backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(245, 158, 11, 0.2)',
  },
  errorBannerText: { fontSize: 13, color: '#f59e0b', fontWeight: '500' },
});
