import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router';
import { useScriptStore } from '../../store/scriptStore';
import Slider from '../../components/FabricSafeSlider';
import { C, RADIUS, TYPE, tint } from '../../constants/cinematicTheme';
import { GradientButton, IconButton, ScreenGlow } from '../../components/cinematic';

export default function PrepScreen() {
  const { scriptId } = useLocalSearchParams<{ scriptId: string }>();
  const { scripts } = useScriptStore();
  const script = scripts.find(s => s.id === scriptId);
  
  const [selectedScene, setSelectedScene] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [hideOthers, setHideOthers] = useState(false);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  // NOTE: The old prep-screen "Enable Teleprompter" toggle + speed slider
  // were removed. The single teleprompter entry point is now
  // Self Tape Studio → Teleprompter Mode NEW → /selftape/teleprompter
  // (Route B, converged to the proven JS-driven scroll architecture in
  // commit 6e21ef7). Route A record.tsx retains its in-screen teleprompter
  // controls for continuity, but is no longer pre-configured from prep.

  useEffect(() => {
    if (script?.characters?.length) {
      setSelectedCharacter(script.characters[0].name);
    }
  }, [script]);

  if (!script) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorState} testID="prep-script-not-found">
          <Ionicons name="alert-circle" size={48} color="#FF5C7A" />
          <Text style={styles.errorText}>Script not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="prep-error-back-btn">
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const scenes = script.scenes || [{ name: 'Full Script', lines: script.lines || [] }];
  const currentScene = scenes[selectedScene];

  const handleStartRecording = () => {
    router.push({
      pathname: '/selftape/record',
      params: {
        scriptId,
        sceneIndex: selectedScene.toString(),
        character: selectedCharacter || '',
        fontSize: fontSize.toString(),
        hideOthers: hideOthers.toString(),
        countdown: countdownEnabled.toString(),
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenGlow />
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} testID="prep-back-btn" />
        <View style={styles.headerCenter}>
          <Text style={styles.headerEyebrow}>Self-Tape Setup</Text>
          <Text style={styles.headerTitle} numberOfLines={1} testID="prep-script-title">{script.title}</Text>
        </View>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* Scene Selection */}
        {scenes.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Scene</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sceneScroll}>
              {scenes.map((scene, index) => (
                <TouchableOpacity
                  key={index}
                  testID={`prep-scene-chip-${index}`}
                  style={[styles.sceneChip, selectedScene === index && styles.sceneChipActive]}
                  onPress={() => setSelectedScene(index)}
                >
                  <Text style={[styles.sceneChipText, selectedScene === index && styles.sceneChipTextActive]}>
                    {scene.name || `Scene ${index + 1}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Character Selection */}
        {script.characters && script.characters.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Character</Text>
            <Text style={styles.sectionSubtitle}>Lines for this character will be highlighted</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.characterScroll}>
              {script.characters.map((char) => (
                <TouchableOpacity
                  key={char.name}
                  testID={`prep-character-chip-${char.name}`}
                  style={[styles.characterChip, selectedCharacter === char.name && styles.characterChipActive]}
                  onPress={() => setSelectedCharacter(char.name)}
                >
                  <Text style={[styles.characterChipText, selectedCharacter === char.name && styles.characterChipTextActive]}>
                    {char.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Display Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Display Settings</Text>
          
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Font Size</Text>
            <Text style={styles.settingValue} testID="prep-font-size-value">{fontSize}pt</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={12}
            maximumValue={28}
            step={2}
            value={fontSize}
            onValueChange={setFontSize}
            minimumTrackTintColor="#7C5CFF"
            maximumTrackTintColor="#2A2650"
            thumbTintColor="#7C5CFF"
          />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Hide Other Characters</Text>
              <Text style={styles.toggleDescription}>Only show your lines and cues</Text>
            </View>
            <Switch
              testID="prep-hide-others-switch"
              value={hideOthers}
              onValueChange={setHideOthers}
              trackColor={{ false: '#2A2650', true: '#7C5CFF' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Recording Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recording Options</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>3-Second Countdown</Text>
              <Text style={styles.toggleDescription}>Get ready before recording starts</Text>
            </View>
            <Switch
              testID="prep-countdown-switch"
              value={countdownEnabled}
              onValueChange={setCountdownEnabled}
              trackColor={{ false: '#2A2650', true: '#7C5CFF' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/*
          Teleprompter Settings — REMOVED.
          The old prep-screen "Enable Teleprompter" toggle and speed
          slider were removed to leave a single, clear teleprompter
          entry point: Self Tape Studio → Teleprompter Mode NEW.
        */}

        {/* Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Script Preview</Text>
          <View style={styles.previewBox} testID="prep-script-preview">
            <Text style={[styles.previewText, { fontSize }]}>
              {currentScene?.lines?.slice(0, 3).map((line: any, idx: number) => {
                const isMyLine = line.character === selectedCharacter;
                if (hideOthers && !isMyLine) {
                  return `[${line.character}]\n`;
                }
                return `${line.character}: ${line.text}\n\n`;
              }).join('') || 'No lines in this scene'}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Start Button */}
      <View style={styles.footer}>
        <GradientButton label="Start Recording" icon="videocam" onPress={handleStartRecording} testID="prep-start-recording-btn" />
      </View>
    </SafeAreaView>
  );
}

const chip = { backgroundColor: C.surface, paddingVertical: 9, paddingHorizontal: 16, borderRadius: RADIUS.pill, marginRight: 8, borderWidth: 1, borderColor: C.line };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 },
  headerButton: { width: 40 },
  headerCenter: { flex: 1, alignItems: 'center', marginHorizontal: 8 },
  headerEyebrow: { ...TYPE.label, fontSize: 10 },
  headerTitle: { ...TYPE.heading, fontSize: 16, marginTop: 2, textAlign: 'center' },
  content: { flex: 1 },
  section: { marginHorizontal: 18, marginTop: 14, padding: 16, backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.line },
  sectionTitle: { ...TYPE.label, marginBottom: 4 },
  sectionSubtitle: { ...TYPE.caption, marginTop: 2, marginBottom: 10 },
  sceneScroll: { marginTop: 10 },
  sceneChip: chip,
  sceneChipActive: { backgroundColor: tint(C.violet, 0.22), borderColor: C.violet },
  sceneChipText: { fontSize: 14, color: C.muted, fontWeight: '600' },
  sceneChipTextActive: { color: C.text, fontWeight: '700' },
  characterScroll: { marginTop: 6 },
  characterChip: chip,
  characterChipActive: { backgroundColor: tint(C.violet, 0.22), borderColor: C.violet },
  characterChipText: { fontSize: 14, color: C.muted, fontWeight: '600' },
  characterChipTextActive: { color: C.text, fontWeight: '700' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  settingLabel: { fontSize: 14, color: C.text, fontWeight: '600' },
  settingValue: { fontSize: 13, color: C.violetSoft, fontWeight: '700' },
  slider: { marginTop: 8, height: 40 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  toggleInfo: { flex: 1, marginRight: 16 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: C.text },
  toggleDescription: { ...TYPE.caption, marginTop: 2 },
  previewBox: { backgroundColor: C.ink, borderRadius: RADIUS.md, padding: 16, marginTop: 12, maxHeight: 150, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: C.violet },
  previewText: { color: C.text, lineHeight: 24 },
  footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.ink },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: C.danger, marginTop: 12, fontWeight: '600' },
  backButton: { backgroundColor: C.surface2, paddingVertical: 12, paddingHorizontal: 24, borderRadius: RADIUS.md, marginTop: 20, borderWidth: 1, borderColor: C.line },
  backButtonText: { fontSize: 14, color: C.text, fontWeight: '600' },
});
