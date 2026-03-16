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
import { parseScript, ParsedLine, DetectedCharacter, ParseResult, LineType } from '../services/smartScriptParser';
import { useScriptStore } from '../store/scriptStore';

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
  const { createScript } = useScriptStore();

  const [step, setStep] = useState<Step>('characters');
  const [myCharacter, setMyCharacter] = useState<string | null>(null);
  const [includeHeadings, setIncludeHeadings] = useState(false);
  const [showActions, setShowActions] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable parsed lines
  const [editedLines, setEditedLines] = useState<ParsedLine[] | null>(null);

  // Parse on mount (memoized)
  const parseResult: ParseResult = useMemo(
    () => parseScript(rawText, { includeHeadings }),
    [rawText, includeHeadings]
  );

  const lines = editedLines || parseResult.parsedLines;
  const characters = parseResult.detectedCharacters;
  const lowConfidence = characters.length === 0 || characters.every(c => c.avgConfidence < 0.5);

  // Reclassify a line
  const reclassifyLine = useCallback((lineId: string, newType: LineType) => {
    const current = editedLines || [...parseResult.parsedLines];
    setEditedLines(current.map(l => l.id === lineId ? { ...l, type: newType, confidence: 1 } : l));
  }, [editedLines, parseResult.parsedLines]);

  // Merge character names
  const mergeCharacter = useCallback((oldName: string, newName: string) => {
    const current = editedLines || [...parseResult.parsedLines];
    setEditedLines(current.map(l =>
      l.characterName === oldName
        ? { ...l, characterName: newName, text: l.type === 'CHARACTER' ? newName : l.text }
        : l
    ));
  }, [editedLines, parseResult.parsedLines]);

  // Save to backend
  const handleSave = async () => {
    if (!myCharacter) {
      Alert.alert('Select Character', 'Please choose your character first.');
      return;
    }

    console.log(`[ScriptParser] handleSave: title="${title?.substring(0, 30)}", char="${myCharacter}", textLen=${rawText?.length || 0}`);
    setSaving(true);
    try {
      // Save parser preferences
      await AsyncStorage.setItem('parser_prefs', JSON.stringify({
        includeHeadings,
        showActions,
        lastMyCharacter: myCharacter,
      }));

      // Convert parsed lines to the backend format and create script
      console.log('[ScriptParser] Calling createScript...');
      const script = await createScript(title, rawText);
      console.log(`[ScriptParser] createScript returned: ${script ? `id=${script.id}` : 'null'}`);

      if (script) {
        // Update with the user character selection
        const { updateScript } = useScriptStore.getState();
        console.log(`[ScriptParser] Calling updateScript for id=${script.id} with character=${myCharacter}`);
        await updateScript(script.id, { user_character: myCharacter });
        console.log(`[ScriptParser] updateScript completed`);

        Alert.alert('Script Ready!', `"${title}" saved with ${myCharacter} as your character.`, [
          { text: 'Start Rehearsal', onPress: () => router.replace(`/script/${script.id}`) },
        ]);
      } else {
        const storeError = useScriptStore.getState().error;
        console.error(`[ScriptParser] createScript returned null. Store error: ${storeError}`);
        Alert.alert('Save Failed', storeError || 'Could not save script. Please check your connection and try again.');
      }
    } catch (err: any) {
      console.error(`[ScriptParser] handleSave error: ${err?.message || err}`);
      Alert.alert('Error', err.message || 'Failed to save script');
    } finally {
      setSaving(false);
    }
  };

  // --- Step 1: Detected Characters ---
  const renderCharactersStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Detected Characters</Text>
      <Text style={styles.stepSubtitle}>
        {characters.length} character{characters.length !== 1 ? 's' : ''} found — tap yours
      </Text>

      {lowConfidence && (
        <View style={styles.warningCard} testID="low-confidence-warning">
          <Ionicons name="warning" size={18} color="#f59e0b" />
          <Text style={styles.warningText}>
            Low confidence detection. Review the preview and fix any issues.
          </Text>
        </View>
      )}

      {parseResult.warnings.map((w, i) => (
        <View key={i} style={styles.warningCard}>
          <Ionicons name="information-circle" size={16} color="#60a5fa" />
          <Text style={styles.warningText}>{w}</Text>
        </View>
      ))}

      <View style={styles.characterGrid}>
        {characters.map(char => (
          <TouchableOpacity
            key={char.name}
            style={[
              styles.charCard,
              myCharacter === char.name && styles.charCardSelected,
            ]}
            onPress={() => setMyCharacter(char.name)}
            testID={`char-select-${char.name}`}
          >
            <View style={styles.charCardHeader}>
              <Ionicons
                name={myCharacter === char.name ? 'person' : 'person-outline'}
                size={22}
                color={myCharacter === char.name ? '#a78bfa' : '#64748b'}
              />
              {myCharacter === char.name && (
                <View style={styles.myBadge}>
                  <Text style={styles.myBadgeText}>ME</Text>
                </View>
              )}
            </View>
            <Text style={[
              styles.charName,
              myCharacter === char.name && styles.charNameSelected,
            ]}>
              {char.name}
            </Text>
            <Text style={styles.charCount}>{char.count} line{char.count !== 1 ? 's' : ''}</Text>
            <View style={styles.confidenceBar}>
              <View style={[styles.confidenceFill, { width: `${char.avgConfidence * 100}%` }]} />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {characters.length === 0 && (
        <TouchableOpacity
          style={styles.manualButton}
          onPress={() => {
            Alert.alert('Manual Mode', 'Switching to AI parser for better detection.', [
              { text: 'Cancel' },
              { text: 'Use AI Parser', onPress: () => router.back() },
            ]);
          }}
          testID="switch-manual-btn"
        >
          <Ionicons name="hand-left-outline" size={18} color="#a78bfa" />
          <Text style={styles.manualButtonText}>Switch to Manual Assign</Text>
        </TouchableOpacity>
      )}

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{parseResult.stats.dialogueLines}</Text>
          <Text style={styles.statLabel}>Dialogue</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{parseResult.stats.actionLines}</Text>
          <Text style={styles.statLabel}>Action</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{parseResult.stats.parentheticalLines}</Text>
          <Text style={styles.statLabel}>Parens</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{parseResult.stats.totalLines}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
      </View>
    </View>
  );

  // --- Step 2: Preview & Fix ---
  const renderPreviewStep = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Preview & Fix</Text>
      <Text style={styles.stepSubtitle}>Tap any line to reclassify</Text>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Include scene headings</Text>
        <Switch
          value={includeHeadings}
          onValueChange={setIncludeHeadings}
          trackColor={{ false: '#1e293b', true: '#7c3aed' }}
          thumbColor="#fff"
        />
      </View>

      <ScrollView style={styles.previewScroll} nestedScrollEnabled>
        {lines.map((line) => {
          const isMe = line.characterName === myCharacter;
          return (
            <TouchableOpacity
              key={line.id}
              style={[
                styles.previewLine,
                line.type === 'ACTION' && styles.previewLineAction,
                isMe && styles.previewLineMe,
              ]}
              onPress={() => {
                const types: LineType[] = ['CHARACTER', 'DIALOGUE', 'ACTION', 'PARENTHETICAL'];
                const currentIdx = types.indexOf(line.type);
                const next = types[(currentIdx + 1) % types.length];
                reclassifyLine(line.id, next);
              }}
              testID={`preview-line-${line.id}`}
            >
              <View style={styles.previewLineHeader}>
                <View style={[styles.typeBadge, { backgroundColor: `${TYPE_COLORS[line.type]}20` }]}>
                  <Text style={[styles.typeBadgeText, { color: TYPE_COLORS[line.type] }]}>
                    {line.type}
                  </Text>
                </View>
                {isMe && (
                  <Text style={styles.meTag}>ME</Text>
                )}
              </View>
              <Text style={[
                styles.previewText,
                { color: TYPE_COLORS[line.type] },
                line.type === 'PARENTHETICAL' && styles.previewItalic,
                line.type === 'CHARACTER' && styles.previewBold,
              ]}>
                {line.text}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  // --- Step 3: Assign Lines ---
  const renderAssignStep = () => {
    const myLines = lines.filter(l => l.type === 'DIALOGUE' && l.characterName === myCharacter);
    const readerChars = characters.filter(c => c.name !== myCharacter);
    const readerLines = lines.filter(l => l.type === 'DIALOGUE' && l.characterName !== myCharacter && l.characterName);
    const actionLines = lines.filter(l => l.type === 'ACTION' || l.type === 'HEADING');

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepTitle}>Line Assignment</Text>
        <Text style={styles.stepSubtitle}>Auto-assigned based on your selection</Text>

        {/* My Character */}
        <View style={styles.assignCard}>
          <View style={styles.assignHeader}>
            <Ionicons name="person" size={20} color="#a78bfa" />
            <Text style={styles.assignRole}>ME — {myCharacter}</Text>
          </View>
          <Text style={styles.assignCount}>{myLines.length} dialogue line{myLines.length !== 1 ? 's' : ''}</Text>
          <Text style={styles.assignNote}>Displayed fullscreen during run</Text>
        </View>

        {/* Reader Characters */}
        <View style={styles.assignCard}>
          <View style={styles.assignHeader}>
            <Ionicons name="volume-high" size={20} color="#6366f1" />
            <Text style={styles.assignRole}>READER</Text>
          </View>
          {readerChars.map(c => (
            <View key={c.name} style={styles.readerRow}>
              <Text style={styles.readerName}>{c.name}</Text>
              <Text style={styles.readerCount}>
                {lines.filter(l => l.type === 'DIALOGUE' && l.characterName === c.name).length} lines
              </Text>
            </View>
          ))}
          <Text style={styles.assignNote}>Spoken by TTS during run</Text>
        </View>

        {/* Action Lines */}
        <View style={styles.assignCard}>
          <View style={styles.assignHeader}>
            <Ionicons name="film" size={20} color="#64748b" />
            <Text style={styles.assignRole}>ACTION / STAGE</Text>
          </View>
          <Text style={styles.assignCount}>{actionLines.length} line{actionLines.length !== 1 ? 's' : ''}</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Show during run</Text>
            <Switch
              value={showActions}
              onValueChange={setShowActions}
              trackColor={{ false: '#1e293b', true: '#7c3aed' }}
              thumbColor="#fff"
            />
          </View>
          <Text style={styles.assignNote}>Not spoken — displayed lightly</Text>
        </View>
      </View>
    );
  };

  const steps: Step[] = ['characters', 'preview', 'assign'];
  const stepIdx = steps.indexOf(step);
  const canProceed = step === 'characters' ? !!myCharacter : true;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="parser-back-btn">
          <Ionicons name="arrow-back" size={24} color="#e2e8f0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.stepIndicator}>{stepIdx + 1}/3</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((stepIdx + 1) / 3) * 100}%` }]} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {step === 'characters' && renderCharactersStep()}
        {step === 'preview' && renderPreviewStep()}
        {step === 'assign' && renderAssignStep()}
      </ScrollView>

      {/* Bottom Nav */}
      <View style={styles.bottomNav}>
        {stepIdx > 0 ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setStep(steps[stepIdx - 1])}
            testID="step-back-btn"
          >
            <Ionicons name="chevron-back" size={20} color="#a78bfa" />
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        ) : <View />}

        {stepIdx < 2 ? (
          <TouchableOpacity
            style={[styles.nextBtn, !canProceed && styles.nextBtnDisabled]}
            onPress={() => canProceed && setStep(steps[stepIdx + 1])}
            disabled={!canProceed}
            testID="step-next-btn"
          >
            <Text style={styles.nextBtnText}>
              {step === 'characters' ? 'Preview' : 'Assign Lines'}
            </Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
            disabled={saving}
            testID="save-script-btn"
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.saveBtnText}>Save & Start</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#e2e8f0', flex: 1, marginHorizontal: 12 },
  stepIndicator: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  progressBar: { height: 3, backgroundColor: '#1e293b', marginHorizontal: 20 },
  progressFill: { height: '100%', backgroundColor: '#7c3aed', borderRadius: 2 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 100 },

  // Steps
  stepContainer: { gap: 16 },
  stepTitle: { fontSize: 22, fontWeight: '800', color: '#f1f5f9' },
  stepSubtitle: { fontSize: 14, color: '#94a3b8', marginTop: -8 },

  // Warnings
  warningCard: {
    flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)',
  },
  warningText: { flex: 1, fontSize: 13, color: '#d1d5db', lineHeight: 19 },

  // Character grid
  characterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  charCard: {
    width: '48%', backgroundColor: '#0f172a', borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: '#1e293b', gap: 4,
  },
  charCardSelected: { borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.08)' },
  charCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  myBadge: {
    backgroundColor: '#7c3aed', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  myBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  charName: { fontSize: 15, fontWeight: '700', color: '#cbd5e1', marginTop: 4 },
  charNameSelected: { color: '#a78bfa' },
  charCount: { fontSize: 12, color: '#64748b' },
  confidenceBar: { height: 3, backgroundColor: '#1e293b', borderRadius: 2, marginTop: 6 },
  confidenceFill: { height: '100%', backgroundColor: '#7c3aed', borderRadius: 2 },

  // Manual button
  manualButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: '#7c3aed',
  },
  manualButtonText: { fontSize: 15, fontWeight: '600', color: '#a78bfa' },

  // Stats
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 8 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: '#e2e8f0' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },

  // Preview
  toggleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  toggleLabel: { fontSize: 14, color: '#94a3b8' },
  previewScroll: { maxHeight: 500 },
  previewLine: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4,
    backgroundColor: '#0f172a',
  },
  previewLineAction: { backgroundColor: '#0a0f1a' },
  previewLineMe: { borderLeftWidth: 3, borderLeftColor: '#7c3aed' },
  previewLineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  meTag: { fontSize: 10, fontWeight: '800', color: '#7c3aed' },
  previewText: { fontSize: 14, lineHeight: 20 },
  previewItalic: { fontStyle: 'italic' },
  previewBold: { fontWeight: '700' },

  // Assign
  assignCard: {
    backgroundColor: '#0f172a', borderRadius: 14, padding: 16, gap: 8,
    borderWidth: 1, borderColor: '#1e293b',
  },
  assignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  assignRole: { fontSize: 16, fontWeight: '700', color: '#e2e8f0' },
  assignCount: { fontSize: 14, color: '#94a3b8' },
  assignNote: { fontSize: 12, color: '#475569', fontStyle: 'italic' },
  readerRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  readerName: { fontSize: 14, fontWeight: '600', color: '#cbd5e1' },
  readerCount: { fontSize: 13, color: '#64748b' },

  // Bottom nav
  bottomNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#1e293b', backgroundColor: '#0a0a0f',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backBtnText: { fontSize: 15, fontWeight: '600', color: '#a78bfa' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#7c3aed', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#10b981', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
