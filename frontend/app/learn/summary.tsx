/**
 * Learn Summary — /learn/summary
 *
 * Shown after a session completes. Reads the most-recent history entry
 * plus the current record snapshot to display actor-focused metrics.
 * No AI, no backend calls, no analytics.
 */

import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useScriptStore } from '../../store/scriptStore';
import {
  aggregateProgress,
  extractLearnItems,
  type LearningSession,
} from '../../services/learnEngine';
import {
  loadAllRecords,
  loadHistory,
} from '../../services/learnStorage';

export default function LearnSummaryScreen() {
  const { scripts } = useScriptStore();
  const [session, setSession] = useState<LearningSession | null>(null);
  const [scriptTitle, setScriptTitle] = useState<string>('');
  const [aggregate, setAggregate] = useState<{
    strongOrMastered: number;
    weak: number;
    practiced: number;
    totalItems: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const history = await loadHistory();
      const latest = history[0] ?? null;
      if (!latest) {
        if (!cancelled) {
          setSession(null);
          setAggregate(null);
        }
        return;
      }
      const script = scripts.find((s) => s.id === latest.scriptId);
      const records = await loadAllRecords();
      if (script) {
        const items = extractLearnItems(script, latest.characterId, records);
        if (!cancelled) {
          setSession(latest);
          setScriptTitle(script.title);
          setAggregate(aggregateProgress(items));
        }
        return;
      }
      if (!cancelled) {
        setSession(latest);
        setScriptTitle('(script unavailable)');
        setAggregate(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [scripts]);

  if (!session) {
    return (
      <SafeAreaView style={styles.root} testID="learn-summary-empty">
        <View style={styles.centerBox}>
          <Ionicons name="documents-outline" size={40} color="#9ca3af" />
          <Text style={styles.emptyTitle}>No sessions yet</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace('/')}
            testID="learn-summary-home"
          >
            <Text style={styles.primaryButtonText}>Back to Library</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const duration = session.completedAt
    ? Math.max(0, Math.round((+new Date(session.completedAt) - +new Date(session.startedAt)) / 1000))
    : 0;
  const durationLabel = duration >= 60
    ? `${Math.floor(duration / 60)}m ${duration % 60}s`
    : `${duration}s`;
  const successRate = session.attempts === 0 ? 0 : Math.round((session.successes / session.attempts) * 100);

  return (
    <SafeAreaView style={styles.root} testID="learn-summary">
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.replace('/')}
          style={styles.iconButton}
          testID="learn-summary-close"
        >
          <Ionicons name="close" size={24} color="#e5e7eb" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Session summary</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Ionicons name="trophy" size={40} color="#22d3ee" />
          <Text style={styles.heroTitle}>Great work</Text>
          <Text style={styles.heroSubtitle} numberOfLines={2}>{scriptTitle}</Text>
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Lines practised" value={String(session.attempts)} />
          <StatCard label="Got it" value={String(session.successes)} />
          <StatCard label="Missed" value={String(session.misses)} />
          <StatCard label="Success" value={`${successRate}%`} />
          <StatCard label="Duration" value={durationLabel} />
          <StatCard label="Mode" value={sessionTypeLabel(session)} />
        </View>

        {aggregate && (
          <View style={styles.overallCard} testID="learn-summary-overall">
            <Text style={styles.overallTitle}>Overall for this character</Text>
            <View style={styles.overallRow}>
              <OverallStat label="Strong+" value={aggregate.strongOrMastered} />
              <OverallStat label="Weak" value={aggregate.weak} />
              <OverallStat label="Practised" value={aggregate.practiced} />
              <OverallStat label="Total" value={aggregate.totalItems} />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace(`/learn?scriptId=${encodeURIComponent(session.scriptId)}`)}
          testID="learn-summary-again"
        >
          <Ionicons name="refresh" size={18} color="#0a0a0f" />
          <Text style={styles.primaryButtonText}>Practice again</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function sessionTypeLabel(s: LearningSession): string {
  if (s.type === 'weak') return 'Weak lines';
  if (s.type === 'scene') return `Scene ${s.sceneNumber ?? ''}`.trim();
  if (s.type === 'custom') return 'Custom';
  return 'Full script';
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function OverallStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.overallStat}>
      <Text style={styles.overallStatValue}>{value}</Text>
      <Text style={styles.overallStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#1f2937',
  },
  topTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, gap: 20, paddingBottom: 40 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  heroTitle: { color: '#f3f4f6', fontSize: 26, fontWeight: '700' },
  heroSubtitle: { color: '#9ca3af', fontSize: 14 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    width: '48%', padding: 14, borderRadius: 12,
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937',
  },
  statValue: { color: '#f3f4f6', fontSize: 24, fontWeight: '700' },
  statLabel: { color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  overallCard: { padding: 16, borderRadius: 12, backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937', gap: 10 },
  overallTitle: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' },
  overallRow: { flexDirection: 'row', gap: 8 },
  overallStat: { flex: 1, alignItems: 'center' },
  overallStatValue: { color: '#f3f4f6', fontSize: 20, fontWeight: '700' },
  overallStatLabel: { color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1f2937' },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12, backgroundColor: '#22d3ee',
  },
  primaryButtonText: { color: '#0a0a0f', fontSize: 16, fontWeight: '700' },
  emptyTitle: { color: '#e5e7eb', fontSize: 18, fontWeight: '700' },
});
