/**
 * AIComingSoonSection
 * -------------------
 * Presents ScriptMate's upcoming AI capabilities as an intentional
 * public roadmap — not as broken/incomplete features. Each card:
 *
 *   • Is decorative only (no navigation, no API calls, no backend).
 *   • Carries a clear COMING SOON badge in the top-right.
 *   • Uses accessibilityLabel + testID so QA/screen readers can hit it.
 *
 * The 5 features listed here are the ones the product team publicly
 * committed to for the AI roadmap:
 *
 *   1. AI Rehearsal Partner
 *   2. AI Line Coach
 *   3. AI Scene Coach
 *   4. AI Script Assistant
 *   5. World-Class Dialect Coach
 *
 * This component intentionally has no dependency on any AI SDK,
 * network layer, or paywall — it is a pure static presentation.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type IonName = keyof typeof Ionicons.glyphMap;

interface AIFeature {
  id: string;
  title: string;
  description: string;
  icon: IonName;
  color: string;
}

// Public roadmap — additions/edits here should be intentional product
// decisions, not one-off tweaks. Order below is the order rendered.
export const AI_ROADMAP: readonly AIFeature[] = Object.freeze([
  {
    id: 'ai-rehearsal-partner',
    title: 'AI Rehearsal Partner',
    description: 'Run lines with a responsive on-device scene partner.',
    icon: 'people',
    color: '#6366f1',
  },
  {
    id: 'ai-line-coach',
    title: 'AI Line Coach',
    description: 'Instant, actor-specific feedback on delivery and intent.',
    icon: 'sparkles',
    color: '#8b5cf6',
  },
  {
    id: 'ai-scene-coach',
    title: 'AI Scene Coach',
    description: 'Beat-by-beat breakdowns and blocking suggestions.',
    icon: 'film',
    color: '#ec4899',
  },
  {
    id: 'ai-script-assistant',
    title: 'AI Script Assistant',
    description: 'Character analysis, subtext, and objectives at a glance.',
    icon: 'document-text',
    color: '#10b981',
  },
  {
    id: 'world-class-dialect-coach',
    title: 'World-Class Dialect Coach',
    description: 'Studio-grade accent training with per-phoneme feedback.',
    icon: 'mic',
    color: '#f59e0b',
  },
]);

export function AIComingSoonSection() {
  return (
    <View style={styles.section} testID="ai-coming-soon-section">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name="rocket" size={16} color="#a78bfa" />
          </View>
          <View>
            <Text style={styles.headerTitle}>ScriptMate AI</Text>
            <Text style={styles.headerSubtitle}>Coming soon · Actor-first tools</Text>
          </View>
        </View>
        <View style={styles.roadmapPill}>
          <Ionicons name="map" size={11} color="#a78bfa" />
          <Text style={styles.roadmapPillText}>ROADMAP</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {AI_ROADMAP.map((feature) => (
          <View
            key={feature.id}
            style={styles.card}
            testID={`ai-coming-soon-${feature.id}`}
            accessible
            accessibilityLabel={`${feature.title}. Coming soon.`}
          >
            <View style={styles.cardRow}>
              <View style={[styles.cardIcon, { backgroundColor: feature.color + '18' }]}>
                <Ionicons name={feature.icon} size={20} color={feature.color} />
              </View>
              <View style={styles.badge} testID={`ai-coming-soon-badge-${feature.id}`}>
                <Text style={styles.badgeText}>COMING SOON</Text>
              </View>
            </View>
            <Text style={styles.cardTitle}>{feature.title}</Text>
            <Text style={styles.cardDescription}>{feature.description}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default AIComingSoonSection;

const CARD_BG = '#12121e';
const BORDER = '#1c1c2e';

const styles = StyleSheet.create({
  section: {
    marginTop: 8,
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(167,139,250,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 1,
  },
  roadmapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(167,139,250,0.10)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roadmapPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#a78bfa',
    letterSpacing: 1,
  },
  grid: {
    gap: 10,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#f59e0b',
    letterSpacing: 0.8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  cardDescription: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 3,
    lineHeight: 16,
  },
});
