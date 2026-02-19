import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useScriptStore, Script, Character } from '../../store/scriptStore';
import { getSettings, saveSettings } from '../../services/syncService';

const VOICE_OPTIONS = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced' },
  { id: 'echo', name: 'Echo', description: 'Male, warm' },
  { id: 'fable', name: 'Fable', description: 'British accent' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative' },
  { id: 'nova', name: 'Nova', description: 'Female, energetic' },
  { id: 'shimmer', name: 'Shimmer', description: 'Female, soft' },
];

const MODE_OPTIONS = [
  { id: 'full_read', name: 'Full Read', icon: 'chatbubbles', description: 'Practice with AI partner reading all other lines' },
  { id: 'cue_only', name: 'Cue Only', icon: 'flash', description: 'Only hear the line before yours' },
  { id: 'performance', name: 'Performance', icon: 'trophy', description: 'No prompts - simulate real audition' },
];

export default function ScriptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentScript, fetchScript, updateScript, createRehearsal, loading, isPremium } = useScriptStore();
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const [selectedMode, setSelectedMode] = useState('full_read');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [starting, setStarting] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load saved settings on mount
  useEffect(() => {
    const loadSavedSettings = async () => {
      try {
        const savedSettings = await getSettings();
        setSelectedVoice(savedSettings.default_voice);
        setVoiceSpeed(savedSettings.default_voice_speed);
        setSettingsLoaded(true);
      } catch (error) {
        console.error('Error loading settings:', error);
        setSettingsLoaded(true);
      }
    };
    loadSavedSettings();
  }, []);

  useEffect(() => {
    if (id) {
      fetchScript(id);
    }
  }, [id]);

  useEffect(() => {
    if (currentScript) {
      const userChar = currentScript.characters.find((c) => c.is_user_character);
      if (userChar) {
        setSelectedCharacter(userChar.name);
      }
    }
  }, [currentScript]);

  const handleCharacterSelect = async (characterName: string) => {
    setSelectedCharacter(characterName);
    if (id) {
      await updateScript(id, { user_character: characterName });
    }
  };

  const handleStartRehearsal = async () => {
    if (!selectedCharacter) {
      Alert.alert('Select Character', 'Please select your character before starting rehearsal');
      return;
    }

    setStarting(true);
    try {
      const rehearsal = await createRehearsal(id!, selectedCharacter, selectedMode, selectedVoice);
      if (rehearsal) {
        router.push(`/rehearsal/${rehearsal.id}`);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to start rehearsal');
    } finally {
      setStarting(false);
    }
  };

  if (loading && !currentScript) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
          <Text style={styles.loadingText}>Loading script...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentScript) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#ef4444" />
          <Text style={styles.errorText}>Script not found</Text>
          <TouchableOpacity style={styles.backButtonLarge} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {currentScript.title}
        </Text>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.settingsButton}>
          <Ionicons name="settings-outline" size={24} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Script Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Ionicons name="people" size={24} color="#6366f1" />
              <Text style={styles.infoValue}>{currentScript.characters.length}</Text>
              <Text style={styles.infoLabel}>Characters</Text>
            </View>
            <View style={styles.infoSeparator} />
            <View style={styles.infoItem}>
              <Ionicons name="chatbubble" size={24} color="#10b981" />
              <Text style={styles.infoValue}>{currentScript.lines.filter((l) => !l.is_stage_direction).length}</Text>
              <Text style={styles.infoLabel}>Lines</Text>
            </View>
            <View style={styles.infoSeparator} />
            <View style={styles.infoItem}>
              <Ionicons name="text" size={24} color="#f59e0b" />
              <Text style={styles.infoValue}>{currentScript.lines.filter((l) => l.is_stage_direction).length}</Text>
              <Text style={styles.infoLabel}>Directions</Text>
            </View>
          </View>
        </View>

        {/* Character Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Your Character</Text>
          <Text style={styles.sectionSubtitle}>AI will read all other characters</Text>
          <View style={styles.characterList}>
            {currentScript.characters.map((character) => (
              <TouchableOpacity
                key={character.id}
                style={[
                  styles.characterCard,
                  selectedCharacter === character.name && styles.characterCardSelected,
                ]}
                onPress={() => handleCharacterSelect(character.name)}
              >
                <View style={styles.characterIconContainer}>
                  <Ionicons
                    name="person"
                    size={24}
                    color={selectedCharacter === character.name ? '#fff' : '#6366f1'}
                  />
                </View>
                <View style={styles.characterInfo}>
                  <Text
                    style={[
                      styles.characterName,
                      selectedCharacter === character.name && styles.characterNameSelected,
                    ]}
                  >
                    {character.name}
                  </Text>
                  <Text style={styles.characterLines}>{character.line_count} lines</Text>
                </View>
                {selectedCharacter === character.name && (
                  <Ionicons name="checkmark-circle" size={24} color="#fff" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Training Mode Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Training Mode</Text>
          <View style={styles.modeList}>
            {MODE_OPTIONS.map((mode) => (
              <TouchableOpacity
                key={mode.id}
                style={[
                  styles.modeCard,
                  selectedMode === mode.id && styles.modeCardSelected,
                ]}
                onPress={() => setSelectedMode(mode.id)}
              >
                <View
                  style={[
                    styles.modeIconContainer,
                    selectedMode === mode.id && styles.modeIconContainerSelected,
                  ]}
                >
                  <Ionicons
                    name={mode.icon as any}
                    size={24}
                    color={selectedMode === mode.id ? '#fff' : '#6366f1'}
                  />
                </View>
                <View style={styles.modeInfo}>
                  <Text
                    style={[
                      styles.modeName,
                      selectedMode === mode.id && styles.modeNameSelected,
                    ]}
                  >
                    {mode.name}
                  </Text>
                  <Text style={styles.modeDescription}>{mode.description}</Text>
                </View>
                {selectedMode === mode.id && (
                  <Ionicons name="checkmark-circle" size={20} color="#6366f1" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Preview Script */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Script Preview</Text>
            {/* Director Notes Button */}
            <TouchableOpacity 
              style={styles.directorNotesButton}
              onPress={() => router.push(`/script/notes/${id}`)}
            >
              <Ionicons name="pencil" size={16} color="#f59e0b" />
              <Text style={styles.directorNotesText}>Director Notes</Text>
              {!isPremium && <Ionicons name="lock-closed" size={12} color="#f59e0b" />}
            </TouchableOpacity>
          </View>
          <View style={styles.previewContainer}>
            {currentScript.lines.slice(0, 10).map((line, index) => (
              <View
                key={line.id}
                style={[
                  styles.previewLine,
                  line.is_stage_direction && styles.previewDirection,
                  line.character === selectedCharacter && styles.previewUserLine,
                ]}
              >
                {line.is_stage_direction ? (
                  <Text style={styles.previewDirectionText}>{line.text}</Text>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.previewCharacter,
                        line.character === selectedCharacter && styles.previewUserCharacter,
                      ]}
                    >
                      {line.character}
                    </Text>
                    <Text style={styles.previewText}>{line.text}</Text>
                  </>
                )}
              </View>
            ))}
            {currentScript.lines.length > 10 && (
              <Text style={styles.previewMore}>
                + {currentScript.lines.length - 10} more lines...
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Bottom Action Buttons */}
      <View style={styles.bottomBar}>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.selfTapeButton}
            onPress={() => router.push(`/selftape/prep?scriptId=${id}`)}
          >
            <Ionicons name="videocam" size={22} color="#fff" />
            <Text style={styles.selfTapeButtonText}>Self Tape</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.startButton, (!selectedCharacter || starting) && styles.startButtonDisabled]}
            onPress={handleStartRehearsal}
            disabled={!selectedCharacter || starting}
          >
            {starting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="play-circle" size={22} color="#fff" />
                <Text style={styles.startButtonText}>Rehearse</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Voice Settings</Text>
              <TouchableOpacity onPress={() => setShowSettings(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll}>
              {/* Voice Speed Slider */}
              <View style={styles.speedSection}>
                <View style={styles.speedHeader}>
                  <Text style={styles.modalSectionTitle}>Voice Speed</Text>
                  <View style={styles.speedBadge}>
                    <Text style={styles.speedValue}>{voiceSpeed.toFixed(1)}x</Text>
                  </View>
                </View>
                <View style={styles.speedSliderContainer}>
                  <Text style={styles.speedLabel}>0.5x</Text>
                  <Slider
                    style={styles.speedSlider}
                    minimumValue={0.5}
                    maximumValue={2.0}
                    step={0.1}
                    value={voiceSpeed}
                    onValueChange={setVoiceSpeed}
                    minimumTrackTintColor="#6366f1"
                    maximumTrackTintColor="#2a2a3e"
                    thumbTintColor="#6366f1"
                  />
                  <Text style={styles.speedLabel}>2.0x</Text>
                </View>
                <View style={styles.speedPresets}>
                  {[0.75, 1.0, 1.25, 1.5].map((speed) => (
                    <TouchableOpacity
                      key={speed}
                      style={[
                        styles.speedPresetButton,
                        voiceSpeed === speed && styles.speedPresetButtonActive,
                      ]}
                      onPress={() => setVoiceSpeed(speed)}
                    >
                      <Text style={[
                        styles.speedPresetText,
                        voiceSpeed === speed && styles.speedPresetTextActive,
                      ]}>
                        {speed}x
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <Text style={styles.modalSectionTitle}>AI Voice</Text>
              {VOICE_OPTIONS.map((voice) => (
                <TouchableOpacity
                  key={voice.id}
                  style={[
                    styles.voiceOption,
                    selectedVoice === voice.id && styles.voiceOptionSelected,
                  ]}
                  onPress={() => setSelectedVoice(voice.id)}
                >
                  <View style={styles.voiceInfo}>
                    <Text style={styles.voiceName}>{voice.name}</Text>
                    <Text style={styles.voiceDescription}>{voice.description}</Text>
                  </View>
                  {selectedVoice === voice.id && (
                    <Ionicons name="checkmark-circle" size={24} color="#6366f1" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalDoneButton}
              onPress={async () => {
                // Save settings when closing the modal
                try {
                  await saveSettings({
                    default_voice: selectedVoice,
                    default_voice_speed: voiceSpeed,
                  });
                } catch (error) {
                  console.error('Error saving settings:', error);
                }
                setShowSettings(false);
              }}
            >
              <Text style={styles.modalDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#6b7280',
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 16,
  },
  backButtonLarge: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  settingsButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  infoCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  infoItem: {
    alignItems: 'center',
  },
  infoSeparator: {
    width: 1,
    height: 40,
    backgroundColor: '#2a2a3e',
  },
  infoValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 8,
  },
  infoLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  directorNotesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  directorNotesText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  characterList: {
    gap: 10,
  },
  characterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  characterCardSelected: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  characterIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  characterInfo: {
    flex: 1,
    marginLeft: 14,
  },
  characterName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  characterNameSelected: {
    color: '#fff',
  },
  characterLines: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  modeList: {
    gap: 10,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  modeCardSelected: {
    borderColor: '#6366f1',
  },
  modeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIconContainerSelected: {
    backgroundColor: '#6366f1',
  },
  modeInfo: {
    flex: 1,
    marginLeft: 12,
  },
  modeName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modeNameSelected: {
    color: '#6366f1',
  },
  modeDescription: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  previewContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  previewLine: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  previewDirection: {
    opacity: 0.7,
  },
  previewUserLine: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#6366f1',
  },
  previewDirectionText: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  previewCharacter: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    marginBottom: 4,
  },
  previewUserCharacter: {
    color: '#6366f1',
  },
  previewText: {
    fontSize: 15,
    color: '#e5e7eb',
    lineHeight: 22,
  },
  previewMore: {
    textAlign: 'center',
    color: '#6b7280',
    marginTop: 16,
    fontSize: 14,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#0a0a0f',
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  selfTapeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  selfTapeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  startButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  startButtonDisabled: {
    opacity: 0.5,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 12,
    marginTop: 8,
  },
  speedSection: {
    marginBottom: 20,
  },
  speedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  speedBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  speedValue: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '700',
  },
  speedSliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  speedSlider: {
    flex: 1,
    height: 40,
  },
  speedLabel: {
    color: '#6b7280',
    fontSize: 12,
    width: 32,
    textAlign: 'center',
  },
  speedPresets: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    gap: 8,
  },
  speedPresetButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0a0a0f',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  speedPresetButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderColor: '#6366f1',
  },
  speedPresetText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  speedPresetTextActive: {
    color: '#6366f1',
  },
  voiceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  voiceOptionSelected: {
    borderColor: '#6366f1',
  },
  voiceInfo: {
    flex: 1,
  },
  voiceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  voiceDescription: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  modalDoneButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  modalDoneText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
