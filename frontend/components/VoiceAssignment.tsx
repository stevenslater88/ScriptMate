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
  fetchAvailableVoices,
  type AvailableVoiceCatalogue,
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
  // 2026-02 SCRIPT M8 — authoritative set of voice KEYS available to the
  // current ElevenLabs account. null = catalogue not yet loaded (fail-open:
  // treat every preset as available until the probe lands). Empty set is a
  // valid "nothing available" state, distinct from null.
  const [availableVoiceKeys, setAvailableVoiceKeys] = useState<Set<string> | null>(null);

  const voicesByGender = getVoicesByGender();

  const isVoiceAvailable = (voiceKey: string): boolean => {
    // Fail-open while the probe is in flight so the UI never flickers.
    if (availableVoiceKeys === null) return true;
    return availableVoiceKeys.has(voiceKey);
  };

  // Load the authoritative available-voice catalogue once. We never block
  // auto-assignment on it (that would delay the first paint); we filter
  // the picker + the auto-assign pools ONCE it resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const catalogue: AvailableVoiceCatalogue | null = await fetchAvailableVoices();
      if (cancelled) return;
      if (!catalogue) {
        // Vendor probe failed or offline — fail-open: all voices stay
        // selectable; /generate still surfaces the structured 422 if a
        // given voice is dead.
        setAvailableVoiceKeys(null);
        return;
      }
      const keys = new Set(
        catalogue.voices.filter(v => v.available).map(v => v.key),
      );
      setAvailableVoiceKeys(keys);
    })();
    return () => { cancelled = true; };
  }, []);

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
    // 2026-02 SCRIPT M8: pools are pre-filtered by account availability
    // so auto-assign cannot pick a dead voice. If the probe hasn't
    // resolved yet, isVoiceAvailable() fails-open and we assign from
    // the full pool exactly like before.
    const malePool = voicesByGender.male.filter(v => isVoiceAvailable(v.key));
    const femalePool = voicesByGender.female.filter(v => isVoiceAvailable(v.key));
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

  const initials = (name: string) =>
    name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  const header = (
    <View style={styles.header}>
      <View style={styles.headerIcon}><Ionicons name="mic" size={16} color="#A993FF" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Multi-Voice</Text>
        <Text style={styles.subtitle}>Assign different AI voices to each character</Text>
      </View>
      {!isPremium && <Ionicons name="lock-closed" size={15} color="#A993FF" />}
    </View>
  );

  const renderVoice = (voice: PresetVoice) => {
    const selected = assignments[selectedCharacter || ''] === voice.key;
    const previewing = previewingVoice === voice.key;
    return (
      <TouchableOpacity
        key={voice.key}
        testID={`voice-option-${voice.key}`}
        style={[styles.voiceOption, selected && styles.voiceOptionSelected]}
        onPress={() => handleSelectVoice(voice.key)}
      >
        <View style={[styles.voiceBadge, voice.gender === 'Female' ? styles.badgeF : styles.badgeM]}>
          <Ionicons name={voice.gender === 'Female' ? 'female' : 'male'} size={14} color={voice.gender === 'Female' ? '#62E0FF' : '#8FAAFF'} />
        </View>
        <View style={styles.voiceInfo}>
          <Text style={styles.voiceName}>{voice.name}</Text>
          <Text style={styles.voiceDetails} numberOfLines={1}>
            {voice.accent} • {voice.description}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.previewButton, previewing && styles.previewButtonActive]}
          onPress={() => handlePreviewVoice(voice)}
          testID={`voice-preview-${voice.key}`}
          accessibilityLabel={`Preview ${voice.name}`}
        >
          {previewing ? (
            <ActivityIndicator size="small" color="#A993FF" />
          ) : (
            <Ionicons name="play" size={16} color="#A993FF" />
          )}
        </TouchableOpacity>
        {selected && (
          <Ionicons name="checkmark-circle" size={22} color="#A993FF" style={{ marginLeft: 8 }} />
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <ActivityIndicator size="small" color="#A993FF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}

      <View style={styles.characterList}>
        {otherCharacters.map((character) => {
          const assignedKey = assignments[character.name];
          const assignedVoice = assignedKey ? getVoiceByKey(assignedKey) : null;

          return (
            <TouchableOpacity
              key={character.id}
              style={styles.characterRow}
              onPress={() => openPicker(character.name)}
              activeOpacity={0.75}
              testID={`character-voice-row-${character.name}`}
            >
              <View style={styles.charTop}>
                <View style={styles.avatar}><Text style={styles.avatarTx}>{initials(character.name)}</Text></View>
                <View style={styles.characterInfo}>
                  <Text style={styles.characterName} numberOfLines={1}>{character.name}</Text>
                  <Text style={styles.characterLines}>{character.line_count} lines</Text>
                </View>
              </View>
              <View style={[styles.voiceSelector, !assignedVoice && styles.voiceSelectorEmpty]}>
                {assignedVoice ? (
                  <View style={styles.selectedVoice}>
                    <Ionicons name={assignedVoice.gender === 'Female' ? 'female' : 'male'} size={14} color={assignedVoice.gender === 'Female' ? '#62E0FF' : '#8FAAFF'} />
                    <Text style={styles.selectedVoiceName}>{assignedVoice.name}</Text>
                    <Text style={styles.selectedVoiceAccent} numberOfLines={1}>{assignedVoice.accent}</Text>
                  </View>
                ) : (
                  <Text style={styles.selectVoiceText}>Select voice</Text>
                )}
                <Ionicons name="chevron-down" size={16} color="#6E6A95" />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Voice Picker Modal */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="voice-picker-modal">
            <View style={styles.modalGrab} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalEyebrow}>VOICE FOR</Text>
                <Text style={styles.modalTitle} numberOfLines={1}>{selectedCharacter}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPicker(false)} style={styles.closeBtn} testID="voice-picker-close">
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>Tap ▶ to preview a voice, then tap the voice to assign it.</Text>

            <ScrollView style={styles.voiceList}>
              {/* Female Voices */}
              <Text style={styles.genderHeader}>Female Voices</Text>
              {voicesByGender.female.filter(v => isVoiceAvailable(v.key)).map(renderVoice)}

              {/* Male Voices */}
              <Text style={styles.genderHeader}>Male Voices</Text>
              {voicesByGender.male.filter(v => isVoiceAvailable(v.key)).map(renderVoice)}
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#14122A', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(124,92,255,0.28)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headerIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(124,92,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: '#F4F3FF' },
  subtitle: { fontSize: 12, color: '#A19DC6', marginTop: 1 },
  characterList: { gap: 10 },
  characterRow: { backgroundColor: '#1C1938', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  charTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(62,107,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarTx: { fontSize: 12, fontWeight: '800', color: '#8FAAFF' },
  characterInfo: { flex: 1 },
  characterName: { fontSize: 15, fontWeight: '800', color: '#F4F3FF' },
  characterLines: { fontSize: 11.5, color: '#A19DC6', marginTop: 1 },
  voiceSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, backgroundColor: '#0B0A1A', borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)' },
  voiceSelectorEmpty: { borderStyle: 'dashed', borderColor: 'rgba(161,157,198,0.4)' },
  selectedVoice: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  selectedVoiceName: { fontSize: 14, fontWeight: '800', color: '#F4F3FF' },
  selectedVoiceAccent: { fontSize: 12, color: '#A19DC6', flexShrink: 1 },
  selectVoiceText: { fontSize: 13.5, fontWeight: '700', color: '#A993FF' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(5,4,12,0.78)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#14122A', borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '82%', paddingHorizontal: 18, paddingTop: 10, borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)' },
  modalGrab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center' },
  modalEyebrow: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, color: '#6E6A95' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#F4F3FF', marginTop: 2 },
  closeBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#1C1938', alignItems: 'center', justifyContent: 'center' },
  modalHint: { fontSize: 12, color: '#A19DC6', marginTop: 8, marginBottom: 6 },
  voiceList: { marginTop: 4 },
  genderHeader: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', color: '#6E6A95', marginTop: 14, marginBottom: 8 },
  voiceOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1938', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  voiceOptionSelected: { borderColor: '#7C5CFF', backgroundColor: 'rgba(124,92,255,0.14)' },
  voiceBadge: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  badgeF: { backgroundColor: 'rgba(98,224,255,0.12)' },
  badgeM: { backgroundColor: 'rgba(62,107,255,0.16)' },
  voiceInfo: { flex: 1 },
  voiceName: { fontSize: 15, fontWeight: '700', color: '#F4F3FF' },
  voiceDetails: { fontSize: 12, color: '#A19DC6', marginTop: 2 },
  previewButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(124,92,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  previewButtonActive: { backgroundColor: 'rgba(124,92,255,0.3)' },
});
