import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseScript, ParsedLine, ParseResult, LineType } from '../services/smartScriptParser';

type Step = 'characters' | 'preview' | 'assign';

const TYPE_COLORS: Record<LineType, string> = {
  CHARACTER: '#a78bfa',
  DIALOGUE: '#e2e8f0',
  ACTION: '#64748b',
  PARENTHETICAL: '#94a3b8',
  HEADING: '#f59e0b',
  UNKNOWN: '#475569',
};

export default function ScriptParserScreen() {
  const params = useLocalSearchParams<{ title: string; rawText: string }>();
  const title = params.title || 'Untitled';
  const rawText = params.rawText || '';

  const [step, setStep] = useState<Step>('characters');
  const [myCharacter, setMyCharacter] = useState<string | null>(null);
  const [includeHeadings, setIncludeHeadings] = useState(false);
  const [showActions, setShowActions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedLines, setEditedLines] = useState<ParsedLine[] | null>(null);

  const parseResult: ParseResult = useMemo(
    () => parseScript(rawText, { includeHeadings }),
    [rawText, includeHeadings]
  );

  const lines = editedLines || parseResult.parsedLines;
  const characters = parseResult.detectedCharacters;

  const reclassifyLine = useCallback((lineId: string, newType: LineType) => {
    const current = editedLines || [...parseResult.parsedLines];
    setEditedLines(current.map(l => l.id === lineId ? { ...l, type: newType } : l));
  }, [editedLines, parseResult.parsedLines]);

  // ✅ FIXED SAVE (NO STORE)
  const handleSave = async () => {
    if (!myCharacter) {
      Alert.alert('Select Character', 'Please choose your character first.');
      return;
    }

    setSaving(true);

    try {
      const existing = await AsyncStorage.getItem('scripts');
      const scripts = existing ? JSON.parse(existing) : [];

      const newScript = {
        id: Date.now().toString(),
        title,
        rawText,
        myCharacter,
        createdAt: new Date().toISOString(),
      };

      scripts.push(newScript);

      await AsyncStorage.setItem('scripts', JSON.stringify(scripts));

      Alert.alert('Saved!', `"${title}" saved successfully`, [
        {
          text: 'Start Rehearsal',
          onPress: () => router.replace('/'),
        },
      ]);

    } catch (err: any) {
      Alert.alert('Error', 'Failed to save script');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#e2e8f0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>

      <ScrollView style={styles.scrollView}>
        {characters.map(char => (
          <TouchableOpacity
            key={char.name}
            style={[
              styles.charCard,
              myCharacter === char.name && styles.charCardSelected,
            ]}
            onPress={() => setMyCharacter(char.name)}
          >
            <Text style={styles.charName}>{char.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={styles.saveBtn}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnText}>Save Script</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { flexDirection: 'row', padding: 20 },
  headerTitle: { color: '#fff', fontSize: 18, marginLeft: 10 },
  scrollView: { padding: 20 },
  charCard: {
    padding: 15,
    backgroundColor: '#1e293b',
    marginBottom: 10,
    borderRadius: 10,
  },
  charCardSelected: {
    backgroundColor: '#7c3aed',
  },
  charName: { color: '#fff', fontSize: 16 },
  saveBtn: {
    backgroundColor: '#10b981',
    padding: 20,
    margin: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
});