/**
 * VoiceAssignment Component
 * Allows users to assign different AI voices to each character in a script
 * Premium feature using ElevenLabs
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import {
  PresetVoice,
  PRESET_VOICES,
  getVoicesByGender,
  getVoiceByKey,
  saveVoiceAssignments,
  loadVoiceAssignments,
  CharacterVoiceAssignment,
  playSpeech,
  isElevenLabsConfigured,
  inferGenderFromScript,
  type GenderInferenceLine,
} from '../services/elevenLabsService';
import { DebugLog } from '../services/debugLogService';

interface Character {
  id: string;
  name: string;
  line_count: number;
  is_user_character: boolean;
}

interface VoiceAssignmentProps {
  scriptId: string;
  characters: Character[];
  userCharacter: string | null;
  isPremium: boolean;
  onUpgradePress: () => void;
  // 2026-02 Physical QA Blocker 2 — the dialogue lines feed the
  // deterministic gender inference used for auto-assignment so a
  // male character doesn't get a female voice (and vice versa).
  // Optional for backwards compat: callers that don't pass `lines`
  // get the old mixed-gender round-robin.
  lines?: GenderInferenceLine[];
}

export default function VoiceAssignment({
  scriptId,
  characters,
  userCharacter,
  isPremium,
  onUpgradePress,
  lines,
}: VoiceAssignmentProps) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [showPicker, setShowPicker] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [loading, setLoading] = useState(true);

  const voicesByGender = getVoicesByGender();

  // Auto-assign voices to characters that don't have assignments.
  // 2026-02 Physical QA Blocker 2: picks from the gender-matched pool
  // using a deterministic inference over the script dialogue. If the
  // inference returns 'unknown' (no clear signal) we fall back to the
  // pre-existing mixed-gender round-robin so a conservative classifier
  // can never block assignment.
  const autoAssignVoices = async () => {
    const otherChars = characters.filter(c => c.name !== userCharacter);
    const existingAssignments = await loadVoiceAssignments(scriptId);
    const existingMap: Record<string, string> = {};
    existingAssignments.forEach(a => {
      existingMap[a.characterName] = a.voiceKey;
    });

    // Check if we need to auto-assign
    const needsAssignment = otherChars.some(c => !existingMap[c.name]);
    if (!needsAssignment && existingAssignments.length > 0) {
      // All characters already have assignments
      setAssignments(existingMap);
      setLoading(false);
      return;
    }

    // Get used voice keys to avoid duplicates
    const usedVoices = new Set(Object.values(existingMap));

    // Per-gender rotation pointers so male characters cycle through
    // the male pool (and vice versa) rather than every character
    // sharing one global index.
    const malePool = voicesByGender.male;
    const femalePool = voicesByGender.female;
    const mixedPool = [...femalePool, ...malePool];
    let maleIdx = 0;
    let femaleIdx = 0;
    let mixedIdx = 0;

    // Helper: pick the next voice from a pool, skipping already-used
    // voices. Falls through to the mixed pool when the preferred pool
    // is exhausted so we never crash on a cast of 15 women.
    const nextVoiceFromPool = (
      pool: PresetVoice[],
      startIdx: number,
    ): { voice: PresetVoice; nextIdx: number } | null => {
      if (pool.length === 0) return null;
      for (let i = 0; i < pool.length; i++) {
        const idx = (startIdx + i) % pool.length;
        const v = pool[idx];
        if (!usedVoices.has(v.key)) {
          return { voice: v, nextIdx: (idx + 1) % pool.length };
        }
      }
      return null;
    };

    const newAssignments: Record<string, string> = { ...existingMap };
    const scriptLines: GenderInferenceLine[] = Array.isArray(lines) ? lines : [];

    for (const char of otherChars) {
      if (newAssignments[char.name]) continue;

      const inference = inferGenderFromScript(char.name, scriptLines);
      let chosen: PresetVoice | null = null;

      if (inference.gender === 'male') {
        const picked = nextVoiceFromPool(malePool, maleIdx);
        if (picked) {
          chosen = picked.voice;
          maleIdx = picked.nextIdx;
        }
      } else if (inference.gender === 'female') {
        const picked = nextVoiceFromPool(femalePool, femaleIdx);
        if (picked) {
          chosen = picked.voice;
          femaleIdx = picked.nextIdx;
        }
      }

      // Fallback 1: inferred pool is exhausted (all voices used)
      // Fallback 2: inference returned 'unknown'
      if (!chosen) {
        const picked = nextVoiceFromPool(mixedPool, mixedIdx);
        if (picked) {
          chosen = picked.voice;
          mixedIdx = picked.nextIdx;
        }
      }

      // Last resort: all 26 voices already used — reuse the first
      // voice in the mixed pool (should essentially never happen).
      if (!chosen && mixedPool.length > 0) {
        chosen = mixedPool[0];
      }

      if (chosen) {
        newAssignments[char.name] = chosen.key;
        usedVoices.add(chosen.key);
        DebugLog.log('DIAGNOSTIC', 'VoiceAssignment', 'VOICE_AUTO_ASSIGN', {
          scriptId,
          character: char.name,
          inferredGender: inference.gender,
          inferenceConfidence: inference.confidence,
          inferenceSignals: inference.signals,
          chosenVoiceKey: chosen.key,
          chosenVoiceGender: chosen.gender,
        });
      }
    }

    setAssignments(newAssignments);

    // Save the auto-assigned voices
    const assignmentList: CharacterVoiceAssignment[] = Object.entries(newAssignments).map(
      ([characterName, vKey]) => {
        const v = getVoiceByKey(vKey);
        return {
          characterName,
          voiceKey: vKey,
          voiceId: v?.id || '',
        };
      }
    );
    await saveVoiceAssignments(scriptId, assignmentList);
    setLoading(false);
  };

  // Load saved assignments on mount (and auto-assign if needed)
  useEffect(() => {
    autoAssignVoices();
  }, [scriptId, userCharacter, characters]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, [currentSound]);

  const handleSelectVoice = async (voiceKey: string) => {
    if (!selectedCharacter) return;

    const voice = getVoiceByKey(voiceKey);
    if (!voice) return;

    // 2026-02: VOICE_PICKER_SELECTION diagnostic — proves which voice
    // was chosen for which character (before any storage/rehearsal
    // stage), so a downstream mismatch can be traced back to the exact
    // pick. Uses the stable internal voiceKey + ElevenLabs voiceId
    // rather than the display name.
    DebugLog.log('DIAGNOSTIC', 'VoiceAssignment', 'VOICE_PICKER_SELECTION', {
      scriptId,
      character: selectedCharacter,
      displayName: voice.name,
      provider: 'elevenlabs',
      voiceKey: voice.key,
      voiceId: voice.id,
    });

    // Update local state
    const newAssignments = {
      ...assignments,
      [selectedCharacter]: voiceKey,
    };
    setAssignments(newAssignments);

    // Save to storage
    const assignmentList: CharacterVoiceAssignment[] = Object.entries(newAssignments).map(
      ([characterName, vKey]) => {
        const v = getVoiceByKey(vKey);
        return {
          characterName,
          voiceKey: vKey,
          voiceId: v?.id || '',
        };
      }
    );
    await saveVoiceAssignments(scriptId, assignmentList);
    
    setShowPicker(false);
    setSelectedCharacter(null);
  };

  const handlePreviewVoice = async (voice: PresetVoice) => {
    if (!isElevenLabsConfigured()) return;
    
    // Stop any playing audio
    if (currentSound) {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      setCurrentSound(null);
    }

    if (previewingVoice === voice.key) {
      setPreviewingVoice(null);
      return;
    }

    setPreviewingVoice(voice.key);
    try {
      const sound = await playSpeech(
        "Hello, I'm ready to help you rehearse your lines.",
        voice.id
      );
      if (sound) {
        setCurrentSound(sound);
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPreviewingVoice(null);
          }
        });
      }
    } catch (error) {
      console.error('Preview error:', error);
      setPreviewingVoice(null);
    }
  };

  const openPicker = (characterName: string) => {
    if (!isPremium) {
      onUpgradePress();
      return;
    }
    setSelectedCharacter(characterName);
    setShowPicker(true);
  };

  // Filter out user's character - they don't need a voice
  const otherCharacters = characters.filter(c => c.name !== userCharacter);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="mic" size={20} color="#8b5cf6" />
          <Text style={styles.title}>Multi-Voice</Text>
          {!isPremium && <Ionicons name="lock-closed" size={14} color="#8b5cf6" />}
        </View>
        <ActivityIndicator size="small" color="#8b5cf6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="mic" size={20} color="#8b5cf6" />
        <Text style={styles.title}>Multi-Voice</Text>
        {!isPremium && <Ionicons name="lock-closed" size={14} color="#8b5cf6" />}
      </View>
      <Text style={styles.subtitle}>
        Assign different AI voices to each character
      </Text>

      <View style={styles.characterList}>
        {otherCharacters.map((character) => {
          const assignedKey = assignments[character.name];
          const assignedVoice = assignedKey ? getVoiceByKey(assignedKey) : null;

          return (
            <TouchableOpacity
              key={character.id}
              style={styles.characterRow}
              onPress={() => openPicker(character.name)}
              activeOpacity={0.7}
            >
              <View style={styles.characterInfo}>
                <Text style={styles.characterName}>{character.name}</Text>
                <Text style={styles.characterLines}>{character.line_count} lines</Text>
              </View>
              <View style={styles.voiceSelector}>
                {assignedVoice ? (
                  <View style={styles.selectedVoice}>
                    <Text style={styles.selectedVoiceName}>{assignedVoice.name}</Text>
                    <Text style={styles.selectedVoiceAccent}>{assignedVoice.accent}</Text>
                  </View>
                ) : (
                  <Text style={styles.selectVoiceText}>Select voice</Text>
                )}
                <Ionicons name="chevron-forward" size={18} color="#6b7280" />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Voice Picker Modal */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Voice for {selectedCharacter}
              </Text>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.voiceList}>
              {/* Female Voices */}
              <Text style={styles.genderHeader}>Female Voices</Text>
              {voicesByGender.female.map((voice) => (
                <TouchableOpacity
                  key={voice.key}
                  style={[
                    styles.voiceOption,
                    assignments[selectedCharacter || ''] === voice.key && styles.voiceOptionSelected,
                  ]}
                  onPress={() => handleSelectVoice(voice.key)}
                >
                  <View style={styles.voiceInfo}>
                    <Text style={styles.voiceName}>{voice.name}</Text>
                    <Text style={styles.voiceDetails}>
                      {voice.accent} • {voice.description}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.previewButton}
                    onPress={() => handlePreviewVoice(voice)}
                  >
                    {previewingVoice === voice.key ? (
                      <ActivityIndicator size="small" color="#8b5cf6" />
                    ) : (
                      <Ionicons name="play-circle" size={28} color="#8b5cf6" />
                    )}
                  </TouchableOpacity>
                  {assignments[selectedCharacter || ''] === voice.key && (
                    <Ionicons name="checkmark-circle" size={24} color="#8b5cf6" />
                  )}
                </TouchableOpacity>
              ))}

              {/* Male Voices */}
              <Text style={styles.genderHeader}>Male Voices</Text>
              {voicesByGender.male.map((voice) => (
                <TouchableOpacity
                  key={voice.key}
                  style={[
                    styles.voiceOption,
                    assignments[selectedCharacter || ''] === voice.key && styles.voiceOptionSelected,
                  ]}
                  onPress={() => handleSelectVoice(voice.key)}
                >
                  <View style={styles.voiceInfo}>
                    <Text style={styles.voiceName}>{voice.name}</Text>
                    <Text style={styles.voiceDetails}>
                      {voice.accent} • {voice.description}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.previewButton}
                    onPress={() => handlePreviewVoice(voice)}
                  >
                    {previewingVoice === voice.key ? (
                      <ActivityIndicator size="small" color="#8b5cf6" />
                    ) : (
                      <Ionicons name="play-circle" size={28} color="#8b5cf6" />
                    )}
                  </TouchableOpacity>
                  {assignments[selectedCharacter || ''] === voice.key && (
                    <Ionicons name="checkmark-circle" size={24} color="#8b5cf6" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },
  characterList: {
    gap: 10,
  },
  characterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  characterInfo: {
    flex: 1,
  },
  characterName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  characterLines: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  voiceSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedVoice: {
    alignItems: 'flex-end',
  },
  selectedVoiceName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8b5cf6',
  },
  selectedVoiceAccent: {
    fontSize: 11,
    color: '#6b7280',
  },
  selectVoiceText: {
    fontSize: 14,
    color: '#6b7280',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  voiceList: {
    maxHeight: 500,
  },
  genderHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8b5cf6',
    marginTop: 16,
    marginBottom: 10,
    paddingLeft: 4,
  },
  voiceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a0f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  voiceOptionSelected: {
    borderColor: '#8b5cf6',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  voiceInfo: {
    flex: 1,
  },
  voiceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  voiceDetails: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  previewButton: {
    padding: 8,
    marginRight: 8,
  },
});
