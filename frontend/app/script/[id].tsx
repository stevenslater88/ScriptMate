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
import useRevenueCat from '../../hooks/useRevenueCat';
import { trackUpgradeTriggered } from '../../services/analyticsService';
import VoiceAssignment from '../../components/VoiceAssignment';
import { DebugLog } from '../../services/debugLogService';

const VOICE_OPTIONS = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced', premium: false },
  { id: 'echo', name: 'Echo', description: 'Male, warm', premium: true },
  { id: 'fable', name: 'Fable', description: 'British accent', premium: true },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative', premium: true },
  { id: 'nova', name: 'Nova', description: 'Female, energetic', premium: true },
  { id: 'shimmer', name: 'Shimmer', description: 'Female, soft', premium: true },
];

const READER_STYLES = [
  { id: 'neutral', name: 'Neutral', icon: 'person', color: '#6366f1', speed: 1.0, description: 'Calm, even delivery' },
  { id: 'emotional', name: 'Emotional', icon: 'heart', color: '#ec4899', speed: 0.9, description: 'Expressive, feeling-driven' },
  { id: 'aggressive', name: 'Intense', icon: 'flame', color: '#ef4444', speed: 1.1, description: 'High energy, forceful' },
];

interface ModeOption {
  id: string;
  name: string;
  icon: string;
  description: string;
  navigable: boolean;
  route?: string;
  premium: boolean;
}

const MODE_OPTIONS: ModeOption[] = [
  { id: 'full_read', name: 'Full Read', icon: 'chatbubbles', description: 'Practice the complete scene with prompts', navigable: false, premium: false },
  { id: 'cue_only', name: 'Cue Only', icon: 'flash', description: 'Recall your lines from memory', navigable: false, premium: false },
  { id: 'recall', name: 'Recall', icon: 'bulb', description: 'Test your memory with hidden lines', navigable: true, route: '/recall', premium: false },
  // NOTE: 'character' mode was removed here — it existed only in the frontend
  // MODE_OPTIONS list and was never registered in FREE_TIER_LIMITS or
  // PREMIUM_TIER_LIMITS on the backend. Selecting it produced the misleading
  // "'character' mode requires Premium" 403 for both free AND premium users
  // (see backend/server.py FREE_TIER_LIMITS / PREMIUM_TIER_LIMITS.available_modes).
  // Its stated behaviour ("focus on your character lines only") is already
  // covered by 'full_read', where the reader speaks non-user characters.
  // Regression: backend/tests/test_phase2_character_mode_gate.py.
  { id: 'performance', name: 'Performance', icon: 'trophy', description: 'No prompts — full performance mode', navigable: false, premium: true },
  { id: 'loop', name: 'Loop', icon: 'repeat', description: 'Repeat weak lines until mastered', navigable: false, premium: true },
];

export default function ScriptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string; autoStart?: string }>();
  const autoStart = useLocalSearchParams<{ autoStart?: string }>().autoStart === 'true';
  const { currentScript, fetchScript, updateScript, createRehearsal, loading, isPremium: isPremiumFromStore } = useScriptStore();
  const { isPremium: isPremiumFromRevenueCat } = useRevenueCat();
  const isPremium = isPremiumFromStore || isPremiumFromRevenueCat;
  
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const [selectedMode, setSelectedMode] = useState('full_read');
  const [selectedReaderStyle, setSelectedReaderStyle] = useState('neutral');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [starting, setStarting] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [autoStartTriggered, setAutoStartTriggered] = useState(false);

  const handleSelfTape = async () => {
    if (!isPremium) {
      trackUpgradeTriggered('script_detail_selftape');
      router.push('/premium');
      return;
    }
    router.push(`/selftape/prep?scriptId=${id}`);
  };

  // Load saved settings on mount
  useEffect(() => {
    const loadSavedSettings = async () => {
      try {
        const savedSettings = await getSettings();
        // Free-tier guard: if saved voice is a premium voice and user isn't premium,
        // fall back to 'alloy' to prevent avoidable 403 on rehearsal creation.
        const savedVoiceEntry = VOICE_OPTIONS.find(v => v.id === savedSettings.default_voice);
        const safeVoice = (savedVoiceEntry?.premium && !isPremium)
          ? 'alloy'
          : savedSettings.default_voice;
        setSelectedVoice(safeVoice);
        setVoiceSpeed(savedSettings.default_voice_speed);
        setSettingsLoaded(true);
      } catch (error) {
        console.error('Error loading settings:', error);
        setSettingsLoaded(true);
      }
    };
    loadSavedSettings();
  }, [isPremium]);

  useEffect(() => {
    if (id) {
      DebugLog.setScreen('ScriptScreen');
      DebugLog.log('SCREEN_VIEW', 'ScriptScreen', 'Opened script screen', { scriptId: id });
      fetchScript(id);
    }
  }, [id]);

  useEffect(() => {
    if (currentScript) {
      const characters = currentScript.characters || [];
      const userChar = characters.find((c) => c.is_user_character);
      DebugLog.log('DIAGNOSTIC', 'ScriptScreen', 'Loaded script', {
        scriptId: currentScript.id,
        title: currentScript.title?.substring(0, 40),
        charactersCount: characters.length,
        linesCount: currentScript.lines?.length || 0,
        hasUserCharacter: !!userChar,
        userCharacterName: userChar?.name,
        firstThreeCharacters: characters.slice(0, 3).map(c => c.name).join(', '),
      });
      if (userChar) {
        setSelectedCharacter(userChar.name);
      }
    }
  }, [currentScript]);

  // Auto-start rehearsal when coming from Quick Rehearse
  useEffect(() => {
    if (autoStart && currentScript && selectedCharacter && !autoStartTriggered && settingsLoaded) {
      setAutoStartTriggered(true);
      handleStartRehearsal();
    }
  }, [autoStart, currentScript, selectedCharacter, settingsLoaded]);

  const handleReaderStyleChange = (styleId: string) => {
    setSelectedReaderStyle(styleId);
    const style = READER_STYLES.find(s => s.id === styleId);
    if (style) {
      setVoiceSpeed(style.speed);
    }
  };

  const handleCharacterSelect = async (characterName: string) => {
    setSelectedCharacter(characterName);
    if (id) {
      await updateScript(id, { user_character: characterName });
    }
  };

  const handleStartRehearsal = async () => {
    // Diagnostic: record the exact state at the moment the Rehearse button was pressed.
    DebugLog.buttonPress('rehearse-btn', 'ScriptScreen');
    const chars = currentScript?.characters || [];
    const userChar = chars.find((c: any) => c.is_user_character);
    DebugLog.setOperation('start-rehearsal', {
      scriptId: id,
      title: currentScript?.title?.substring(0, 40),
      selectedCharacter,
      selectedMode,
      selectedVoice,
      charactersCount: chars.length,
      hasUserCharacterInDb: !!userChar,
      userCharacterInDb: userChar?.name,
      linesCount: currentScript?.lines?.length || 0,
    });

    if (!selectedCharacter) {
      DebugLog.errorCaught('rehearse-no-character', new Error('No character selected'), {
        charactersCount: chars.length,
        firstCharacter: chars[0]?.name,
      });
      Alert.alert('Select Character', 'Please select your character before starting rehearsal');
      DebugLog.clearOperation();
      return;
    }

    setStarting(true);
    try {
      DebugLog.log('API_REQUEST', 'ScriptScreen', 'createRehearsal', {
        scriptId: id, character: selectedCharacter, mode: selectedMode, voice: selectedVoice,
      });
      const rehearsal = await createRehearsal(id!, selectedCharacter, selectedMode, selectedVoice);
      if (rehearsal) {
        DebugLog.log('API_RESPONSE', 'ScriptScreen', 'createRehearsal ok', { rehearsalId: rehearsal.id });
        try {
          DebugLog.navigation('ScriptScreen', `rehearsal/${rehearsal.id}`);
          router.push(`/rehearsal/${rehearsal.id}`);
        } catch (navErr: any) {
          DebugLog.errorCaught('rehearsal-nav', navErr, { rehearsalId: rehearsal.id });
          Alert.alert('Navigation Error', 'Could not open rehearsal screen.');
        }
      } else {
        // createRehearsal returned falsy — surface it as a real error rather than silent
        const storeErr = useScriptStore.getState().error;
        DebugLog.errorCaught('rehearse-null-response', new Error(storeErr || 'createRehearsal returned null'), {
          storeError: storeErr,
        });
        Alert.alert('Error', storeErr || 'Failed to start rehearsal — please try again.');
      }
    } catch (error: any) {
      DebugLog.errorCaught('rehearse-exception', error, { scriptId: id, character: selectedCharacter });
      Alert.alert('Error', error?.message || 'Failed to start rehearsal');
    } finally {
      DebugLog.clearOperation();
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
          {currentScript?.title || 'Untitled'}
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
              <Text style={styles.infoValue}>{(currentScript?.characters || []).length}</Text>
              <Text style={styles.infoLabel}>Characters</Text>
            </View>
            <View style={styles.infoSeparator} />
            <View style={styles.infoItem}>
              <Ionicons name="chatbubble" size={24} color="#10b981" />
              <Text style={styles.infoValue}>{(currentScript?.lines || []).filter((l) => !l.is_stage_direction).length}</Text>
              <Text style={styles.infoLabel}>Lines</Text>
            </View>
            <View style={styles.infoSeparator} />
            <View style={styles.infoItem}>
              <Ionicons name="text" size={24} color="#f59e0b" />
              <Text style={styles.infoValue}>{(currentScript?.lines || []).filter((l) => l.is_stage_direction).length}</Text>
              <Text style={styles.infoLabel}>Directions</Text>
            </View>
          </View>
        </View>

        {/* Character Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Your Character</Text>
          <Text style={styles.sectionSubtitle}>AI will read all other characters</Text>
          <View style={styles.characterList}>
            {(currentScript?.characters || []).map((character) => (
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
            {MODE_OPTIONS.map((mode) => {
              const isLocked = mode.premium && !isPremium;
              return (
                <TouchableOpacity
                  key={mode.id}
                  style={[
                    styles.modeCard,
                    selectedMode === mode.id && !isLocked && styles.modeCardSelected,
                    isLocked && styles.modeCardLocked,
                  ]}
                  onPress={() => {
                    if (isLocked) {
                      trackUpgradeTriggered('script_detail_mode_' + mode.id);
                      router.push('/premium');
                      return;
                    }
                    if (mode.navigable && mode.route) {
                      router.push(`${mode.route}?scriptId=${id}&sceneIndex=0`);
                    } else {
                      setSelectedMode(mode.id);
                    }
                  }}
                >
                  <View
                    style={[
                      styles.modeIconContainer,
                      selectedMode === mode.id && !isLocked && styles.modeIconContainerSelected,
                      isLocked && styles.modeIconContainerLocked,
                    ]}
                  >
                    <Ionicons
                      name={mode.icon as any}
                      size={24}
                      color={isLocked ? '#4a4a5e' : selectedMode === mode.id ? '#fff' : '#6366f1'}
                    />
                    {isLocked && (
                      <Ionicons name="lock-closed" size={12} color="#f59e0b" style={{ position: 'absolute', top: -2, right: -2 }} />
                    )}
                  </View>
                  <View style={styles.modeInfo}>
                    <Text
                      style={[
                        styles.modeName,
                        selectedMode === mode.id && !isLocked && styles.modeNameSelected,
                        isLocked && styles.modeNameLocked,
                      ]}
                    >
                      {mode.name}
                    </Text>
                    <Text style={styles.modeDescription}>
                      {isLocked ? 'Premium' : mode.description}
                    </Text>
                  </View>
                  {isLocked ? (
                    <Ionicons name="lock-closed" size={16} color="#f59e0b" />
                  ) : mode.navigable ? (
                    <Ionicons name="chevron-forward" size={20} color="#6366f1" />
                  ) : selectedMode === mode.id ? (
                    <Ionicons name="checkmark-circle" size={20} color="#6366f1" />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* AI Reader Style */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Reader Style</Text>
          <Text style={styles.sectionSubtitle}>How other characters sound</Text>
          <View style={styles.readerStyleRow}>
            {READER_STYLES.map((style) => (
              <TouchableOpacity
                key={style.id}
                style={[
                  styles.readerStyleCard,
                  selectedReaderStyle === style.id && { borderColor: style.color },
                ]}
                onPress={() => handleReaderStyleChange(style.id)}
                testID={`reader-style-${style.id}`}
              >
                <Ionicons
                  name={style.icon as any}
                  size={24}
                  color={selectedReaderStyle === style.id ? style.color : '#6b7280'}
                />
                <Text style={[
                  styles.readerStyleName,
                  selectedReaderStyle === style.id && { color: style.color },
                ]}>
                  {style.name}
                </Text>
                <Text style={styles.readerStyleDesc}>{style.description}</Text>
                {selectedReaderStyle === style.id && (
                  <Ionicons name="checkmark-circle" size={16} color={style.color} style={{ marginTop: 4 }} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Pacing Control */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pacing</Text>
          <View style={styles.pacingRow}>
            <Text style={styles.pacingLabel}>Slow</Text>
            <Slider
              style={{ flex: 1, height: 40 }}
              minimumValue={0.5}
              maximumValue={1.5}
              step={0.1}
              value={voiceSpeed}
              onValueChange={setVoiceSpeed}
              minimumTrackTintColor="#6366f1"
              maximumTrackTintColor="#2a2a3e"
              thumbTintColor="#6366f1"
            />
            <Text style={styles.pacingLabel}>Fast</Text>
            <Text style={styles.pacingValue}>{voiceSpeed.toFixed(1)}x</Text>
          </View>
        </View>

        {/* Multi-Voice Assignment (Premium) */}
        <View style={styles.section}>
          <VoiceAssignment
            scriptId={id!}
            characters={currentScript.characters}
            userCharacter={selectedCharacter}
            isPremium={isPremium}
            onUpgradePress={async () => {
              trackUpgradeTriggered('script_detail_multivoice');
              router.push('/premium');
            }}
          />
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
        {/* Learn Button — Phase 4 Learn system entry point */}
        <TouchableOpacity
          style={styles.learnButton}
          onPress={() => router.push(`/learn?scriptId=${id}`)}
          testID="script-learn-btn"
        >
          <Ionicons name="school" size={18} color="#22d3ee" />
          <Text style={styles.learnButtonText}>Learn Lines</Text>
        </TouchableOpacity>

        {/* Practice Mode Button */}
        <TouchableOpacity
          style={styles.practiceButton}
          onPress={() => router.push(`/recall?scriptId=${id}&sceneIndex=0`)}
        >
          <Ionicons name="flash" size={18} color="#10b981" />
          <Text style={styles.practiceButtonText}>Practice Mode</Text>
        </TouchableOpacity>
        
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.scenePartnerButton}
            onPress={() => router.push(`/scene-partner?scriptId=${id}`)}
            data-testid="scene-partner-btn"
          >
            <Ionicons name="people" size={20} color="#f59e0b" />
            <Text style={styles.scenePartnerButtonText}>Scene Partner</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.selfTapeButton}
            onPress={handleSelfTape}
          >
            <Ionicons name="videocam" size={22} color="#fff" />
            <Text style={styles.selfTapeButtonText}>Self Tape</Text>
            {!isPremium && (
              <Ionicons name="lock-closed" size={14} color="rgba(255,255,255,0.7)" />
            )}
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
              {VOICE_OPTIONS.map((voice) => {
                const isLocked = voice.premium && !isPremium;
                return (
                  <TouchableOpacity
                    key={voice.id}
                    style={[
                      styles.voiceOption,
                      selectedVoice === voice.id && !isLocked && styles.voiceOptionSelected,
                      isLocked && { opacity: 0.55 },
                    ]}
                    onPress={() => {
                      if (isLocked) {
                        trackUpgradeTriggered('script_detail_voice_' + voice.id);
                        setShowSettings(false);
                        router.push('/premium');
                        return;
                      }
                      setSelectedVoice(voice.id);
                    }}
                  >
                    <View style={styles.voiceInfo}>
                      <Text style={styles.voiceName}>
                        {voice.name}
                        {isLocked ? '  🔒' : ''}
                      </Text>
                      <Text style={styles.voiceDescription}>
                        {isLocked ? 'Premium' : voice.description}
                      </Text>
                    </View>
                    {selectedVoice === voice.id && !isLocked && (
                      <Ionicons name="checkmark-circle" size={24} color="#6366f1" />
                    )}
                    {isLocked && (
                      <Ionicons name="lock-closed" size={16} color="#f59e0b" />
                    )}
                  </TouchableOpacity>
                );
              })}
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
  sectionSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
    marginBottom: 4,
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
  modeCardLocked: {
    opacity: 0.6,
    borderColor: '#2a2a3e',
  },
  modeIconContainerLocked: {
    backgroundColor: '#1a1a2e',
  },
  modeNameLocked: {
    color: '#4a4a5e',
  },
  modeDescription: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  // Reader Style
  readerStyleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  readerStyleCard: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2a2a3e',
  },
  readerStyleName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 6,
  },
  readerStyleDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
    textAlign: 'center',
  },
  // Pacing
  pacingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    gap: 8,
  },
  pacingLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  pacingValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    minWidth: 36,
    textAlign: 'right',
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
  practiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  practiceButtonText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
  },
  // Phase 4 Learn button — visually distinct from Practice Mode.
  learnButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34, 211, 238, 0.10)',
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  learnButtonText: {
    color: '#22d3ee',
    fontSize: 14,
    fontWeight: '700',
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
  scenePartnerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  scenePartnerButtonText: {
    color: '#f59e0b',
    fontSize: 14,
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
