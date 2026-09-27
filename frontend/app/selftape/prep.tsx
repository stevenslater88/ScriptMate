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
import Slider from '@react-native-community/slider';

export default function PrepScreen() {
  const { scriptId } = useLocalSearchParams<{ scriptId: string }>();
  const { scripts } = useScriptStore();
  const script = scripts.find(s => s.id === scriptId);
  
  const [selectedScene, setSelectedScene] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const [hideOthers, setHideOthers] = useState(false);
  const [countdownEnabled, setCountdownEnabled] = useState(true);
  const [teleprompterEnabled, setTeleprompterEnabled] = useState(false);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(3);

  useEffect(() => {
    if (script?.characters?.length) {
      setSelectedCharacter(script.characters[0].name);
    }
  }, [script]);

  if (!script) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle" size={48} color="#ef4444" />
          <Text style={styles.errorText}>Script not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
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
        teleprompter: teleprompterEnabled.toString(),
        teleprompterSpeed: teleprompterSpeed.toString(),
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{script.title}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Scene Selection */}
        {scenes.length > 1 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Scene</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sceneScroll}>
              {scenes.map((scene, index) => (
                <TouchableOpacity
                  key={index}
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
            <Text style={styles.settingValue}>{fontSize}pt</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={12}
            maximumValue={28}
            step={2}
            value={fontSize}
            onValueChange={setFontSize}
            minimumTrackTintColor="#6366f1"
            maximumTrackTintColor="#374151"
            thumbTintColor="#6366f1"
          />

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Hide Other Characters</Text>
              <Text style={styles.toggleDescription}>Only show your lines and cues</Text>
            </View>
            <Switch
              value={hideOthers}
              onValueChange={setHideOthers}
              trackColor={{ false: '#374151', true: '#6366f1' }}
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
              value={countdownEnabled}
              onValueChange={setCountdownEnabled}
              trackColor={{ false: '#374151', true: '#6366f1' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Teleprompter Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Teleprompter</Text>

          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Enable Teleprompter</Text>
              <Text style={styles.toggleDescription}>Auto-scroll script during recording</Text>
            </View>
            <Switch
              value={teleprompterEnabled}
              onValueChange={setTeleprompterEnabled}
              trackColor={{ false: '#374151', true: '#6366f1' }}
              thumbColor="#fff"
            />
          </View>

          {teleprompterEnabled && (
            <>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Scroll Speed</Text>
                <Text style={styles.settingValue}>{['Slow', 'Medium-Slow', 'Medium', 'Medium-Fast', 'Fast'][teleprompterSpeed - 1]}</Text>
              </View>
              <Slider
                style={styles.slider}
                minimumValue={1}
                maximumValue={5}
                step={1}
                value={teleprompterSpeed}
                onValueChange={setTeleprompterSpeed}
                minimumTrackTintColor="#6366f1"
                maximumTrackTintColor="#374151"
                thumbTintColor="#6366f1"
              />
            </>
          )}
        </View>

        {/* Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Script Preview</Text>
          <View style={styles.previewBox}>
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
        <TouchableOpacity style={styles.startButton} onPress={handleStartRecording}>
          <Ionicons name="videocam" size={24} color="#fff" />
          <Text style={styles.startButtonText}>Start Recording</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  headerButton: { width: 36 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: '#fff', textAlign: 'center' },
  content: { flex: 1 },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: '#9ca3af', marginBottom: 12 },
  sceneScroll: { marginTop: 12 },
  sceneChip: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginRight: 10,
  },
  sceneChipActive: { backgroundColor: '#6366f1' },
  sceneChipText: { fontSize: 14, color: '#9ca3af' },
  sceneChipTextActive: { color: '#fff', fontWeight: '600' },
  characterScroll: { marginTop: 8 },
  characterChip: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginRight: 10,
  },
  characterChipActive: { backgroundColor: '#6366f1' },
  characterChipText: { fontSize: 14, color: '#9ca3af' },
  characterChipTextActive: { color: '#fff', fontWeight: '600' },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  settingLabel: { fontSize: 14, color: '#e5e7eb' },
  settingValue: { fontSize: 14, color: '#6366f1', fontWeight: '600' },
  slider: { marginTop: 8, height: 40 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  toggleInfo: { flex: 1, marginRight: 16 },
  toggleLabel: { fontSize: 14, fontWeight: '500', color: '#e5e7eb' },
  toggleDescription: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  previewBox: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    maxHeight: 150,
  },
  previewText: { color: '#e5e7eb', lineHeight: 24 },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  startButtonText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 16, color: '#ef4444', marginTop: 12 },
  backButton: {
    backgroundColor: '#374151',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 20,
  },
  backButtonText: { fontSize: 14, color: '#fff' },
});
