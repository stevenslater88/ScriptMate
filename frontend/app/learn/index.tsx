/**
 * Learn Hub — /learn?scriptId=…
 *
 * Entry point for the Learn system. Reached from
 *   Library → Script → Learn
 * Reuses the existing scriptStore and navigation. No new script model,
 * no duplicate character model.
 *
 * From here the actor picks:
 *   * a character (defaults to the currently selected user character)
 *   * a session mode:  Full script | This scene | Weak lines only
 *
 * Then taps Start to enter /learn/session.
 *
 * All persistence is local (services/learnStorage). No backend calls.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useScriptStore } from '../../store/scriptStore';
import {
  aggregateProgress,
  createSession,
  extractLearnItems,
  type LearnItem,
  type SessionType,
} from '../../services/learnEngine';
import {
  loadAllRecords,
  saveActiveSession,
} from '../../services/learnStorage';

export default function LearnHubScreen() {
  const { scriptId } = useLocalSearchParams<{ scriptId?: string }>();
  const { scripts } = useScriptStore();

  const script = scripts.find((s) => s.id === scriptId);
  const characters = script?.characters ?? [];

  // Default to the script's flagged user_character, otherwise the
  // first available character.
  const initialCharacterId = useMemo(() => {
    const flagged = characters.find((c) => c.is_user_character);
    if (flagged) return flagged.id;
    return characters[0]?.id ?? '';
  }, [characters]);

  const [characterId, setCharacterId] = useState(initialCharacterId);
  const [items, setItems] = useState<LearnItem[]>([]);
  const [mode, setMode] = useState<SessionType>('full');
  const [sceneNumber, setSceneNumber] = useState<number | null>(null);

  useEffect(() => {
    setCharacterId(initialCharacterId);
  }, [initialCharacterId]);

  useEffect(() => {
    let cancelled = false;
    async function loadItems() {
      if (!script || !characterId) {
        setItems([]);
        return;
      }
      const records = await loadAllRecords();
      const extracted = extractLearnItems(script, characterId, records);
      if (!cancelled) setItems(extracted);
    }
    loadItems();
    return () => {
      cancelled = true;
    };
  }, [script?.id, characterId]);

  const availableScenes = useMemo(() => {
    const s = new Set<number>();
    for (const it of items) s.add(it.sceneNumber);
    return Array.from(s).sort((a, b) => a - b);
  }, [items]);

  const filteredItems = useMemo(() => {
    if (mode === 'weak') return items.filter((it) => it.record.isWeak);
    if (mode === 'scene' && sceneNumber != null) {
      return items.filter((it) => it.sceneNumber === sceneNumber);
    }
    return items;
  }, [items, mode, sceneNumber]);

  const progress = useMemo(() => aggregateProgress(items), [items]);

  async function handleStart() {
    if (!script || !characterId || filteredItems.length === 0) return;
    const session = createSession({
      scriptId: script.id,
      characterId,
      type: mode,
      itemIds: filteredItems.map((it) => it.id),
      sceneNumber: mode === 'scene' ? sceneNumber : null,
      nowIso: new Date().toISOString(),
    });
    await saveActiveSession(session);
    router.push(`/learn/session?sessionId=${encodeURIComponent(session.id)}`);
  }

  if (!script) {
    return (
      <SafeAreaView style={styles.root} testID="learn-hub-missing-script">
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle" size={40} color="#f59e0b" />
          <Text style={styles.emptyTitle}>Script not found</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.back()}
            testID="learn-hub-back"
          >
            <Text style={styles.primaryButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} testID="learn-hub">
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconButton}
          testID="learn-hub-close"
          accessibilityLabel="Close Learn"
        >
          <Ionicons name="close" size={24} color="#e5e7eb" />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>Learn</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.scriptTitle} numberOfLines={2}>
          {script.title}
        </Text>

        {/* Character picker */}
        <Text style={styles.sectionLabel}>Character</Text>
        <View style={styles.chipRow} testID="learn-hub-character-row">
          {characters.length === 0 ? (
            <Text style={styles.hint}>No characters found in this script.</Text>
          ) : (
            characters.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.chip,
                  characterId === c.id && styles.chipActive,
                ]}
                onPress={() => setCharacterId(c.id)}
                testID={`learn-hub-character-${c.id}`}
              >
                <Text
                  style={[
                    styles.chipText,
                    characterId === c.id && styles.chipTextActive,
                  ]}
                >
                  {c.name}
                </Text>
                <Text
                  style={[
                    styles.chipSub,
                    characterId === c.id && styles.chipSubActive,
                  ]}
                >
                  {c.line_count} line{c.line_count === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Session mode */}
        <Text style={styles.sectionLabel}>Practice mode</Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.modeChip, mode === 'full' && styles.modeChipActive]}
            onPress={() => setMode('full')}
            testID="learn-hub-mode-full"
          >
            <Ionicons
              name="library"
              size={16}
              color={mode === 'full' ? '#0a0a0f' : '#e5e7eb'}
            />
            <Text
              style={[
                styles.modeChipText,
                mode === 'full' && styles.modeChipTextActive,
              ]}
            >
              Full script
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeChip, mode === 'scene' && styles.modeChipActive]}
            onPress={() => {
              setMode('scene');
              if (sceneNumber == null && availableScenes.length > 0) {
                setSceneNumber(availableScenes[0]);
              }
            }}
            testID="learn-hub-mode-scene"
            disabled={availableScenes.length <= 1}
          >
            <Ionicons
              name="film"
              size={16}
              color={mode === 'scene' ? '#0a0a0f' : '#e5e7eb'}
            />
            <Text
              style={[
                styles.modeChipText,
                mode === 'scene' && styles.modeChipTextActive,
              ]}
            >
              Scene
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeChip, mode === 'weak' && styles.modeChipActive]}
            onPress={() => setMode('weak')}
            testID="learn-hub-mode-weak"
            disabled={progress.weak === 0}
          >
            <Ionicons
              name="pulse"
              size={16}
              color={mode === 'weak' ? '#0a0a0f' : '#e5e7eb'}
            />
            <Text
              style={[
                styles.modeChipText,
                mode === 'weak' && styles.modeChipTextActive,
              ]}
            >
              Weak lines
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'scene' && availableScenes.length > 1 && (
          <View style={styles.scenePickerRow}>
            {availableScenes.map((n) => (
              <TouchableOpacity
                key={n}
                style={[
                  styles.sceneChip,
                  sceneNumber === n && styles.sceneChipActive,
                ]}
                onPress={() => setSceneNumber(n)}
                testID={`learn-hub-scene-${n}`}
              >
                <Text
                  style={[
                    styles.sceneChipText,
                    sceneNumber === n && styles.sceneChipTextActive,
                  ]}
                >
                  Scene {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Progress card */}
        <View style={styles.progressCard} testID="learn-hub-progress">
          <Text style={styles.progressTitle}>Your progress</Text>
          <View style={styles.progressRow}>
            <ProgressStat label="Lines" value={String(progress.totalItems)} />
            <ProgressStat label="Practiced" value={String(progress.practiced)} />
            <ProgressStat
              label="Strong+"
              value={String(progress.strongOrMastered)}
            />
            <ProgressStat label="Weak" value={String(progress.weak)} />
          </View>
        </View>

        <View style={styles.selectionHint} testID="learn-hub-selection-hint">
          <Ionicons name="information-circle-outline" size={16} color="#9ca3af" />
          <Text style={styles.selectionHintText}>
            {filteredItems.length} line
            {filteredItems.length === 1 ? '' : 's'} in this session
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            filteredItems.length === 0 && styles.primaryButtonDisabled,
          ]}
          onPress={handleStart}
          disabled={filteredItems.length === 0}
          testID="learn-hub-start"
        >
          <Ionicons name="play" size={20} color="#0a0a0f" />
          <Text style={styles.primaryButtonText}>Start learning</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ProgressStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.progressStat}>
      <Text style={styles.progressStatValue}>{value}</Text>
      <Text style={styles.progressStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
  },
  topTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, gap: 18, paddingBottom: 40 },
  scriptTitle: { color: '#f3f4f6', fontSize: 22, fontWeight: '700' },
  sectionLabel: { color: '#9ca3af', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  chipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { color: '#e5e7eb', fontSize: 15, fontWeight: '600' },
  chipTextActive: { color: '#0a0a0f' },
  chipSub: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  chipSubActive: { color: '#0a0a0f' },
  hint: { color: '#9ca3af', fontSize: 13 },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modeChipActive: { backgroundColor: '#22d3ee', borderColor: '#22d3ee' },
  modeChipText: { color: '#e5e7eb', fontSize: 14, fontWeight: '600' },
  modeChipTextActive: { color: '#0a0a0f' },
  scenePickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -6 },
  sceneChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  sceneChipActive: { backgroundColor: '#a78bfa', borderColor: '#a78bfa' },
  sceneChipText: { color: '#e5e7eb', fontSize: 13, fontWeight: '600' },
  sceneChipTextActive: { color: '#0a0a0f' },
  progressCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 10,
  },
  progressTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' },
  progressRow: { flexDirection: 'row', gap: 12 },
  progressStat: { flex: 1, alignItems: 'center' },
  progressStatValue: { color: '#f3f4f6', fontSize: 22, fontWeight: '700' },
  progressStatLabel: { color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  selectionHint: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  selectionHintText: { color: '#9ca3af', fontSize: 13 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1f2937' },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22d3ee',
  },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { color: '#0a0a0f', fontSize: 16, fontWeight: '700' },
  emptyTitle: { color: '#e5e7eb', fontSize: 18, fontWeight: '700' },
});
