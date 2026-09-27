import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Analysis {
  performance_score: number;
  score_label: string;
  what_works: string[];
  improvement_tips: string[];
  example_delivery: string;
  director_note: string;
}

export default function ActingFeedbackScreen() {
  const params = useLocalSearchParams<{ analysis: string; scene: string }>();
  const analysis: Analysis = JSON.parse(params.analysis || '{}');
  const sceneTitle = params.scene || 'Scene';

  const scoreAnim = useRef(new Animated.Value(0)).current;
  const fadeAnims = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Animate score ring
    Animated.timing(scoreAnim, {
      toValue: analysis.performance_score || 0,
      duration: 1200,
      useNativeDriver: false,
    }).start();

    // Stagger fade-in for sections
    fadeAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: 1,
        duration: 400,
        delay: 300 + i * 150,
        useNativeDriver: true,
      }).start();
    });
  }, []);

  const score = analysis.performance_score || 7;
  const scoreColor = score >= 8 ? '#10b981' : score >= 6 ? '#f59e0b' : '#ef4444';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} data-testid="feedback-back-btn">
          <Ionicons name="arrow-back" size={24} color="#e2e8f0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Coaching</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Score Section */}
        <Animated.View style={[styles.scoreSection, { opacity: fadeAnims[0] }]}>
          <LinearGradient
            colors={['#1e1b4b', '#0f172a']}
            style={styles.scoreCard}
          >
            <Text style={styles.sceneLabel} data-testid="feedback-scene-title">{sceneTitle}</Text>
            <View style={styles.scoreRing}>
              <Animated.Text
                style={[styles.scoreNumber, { color: scoreColor }]}
                data-testid="performance-score"
              >
                {scoreAnim.interpolate({
                  inputRange: [0, 10],
                  outputRange: ['0', '10'],
                  extrapolate: 'clamp',
                })}
              </Animated.Text>
              <Text style={styles.scoreMax}>/10</Text>
            </View>
            <View style={[styles.scoreLabelBadge, { backgroundColor: `${scoreColor}18` }]}>
              <Text style={[styles.scoreLabelText, { color: scoreColor }]}>
                {analysis.score_label || 'Great Effort!'}
              </Text>
            </View>
            {/* Score bar */}
            <View style={styles.scoreBar}>
              <Animated.View
                style={[
                  styles.scoreBarFill,
                  {
                    backgroundColor: scoreColor,
                    width: scoreAnim.interpolate({
                      inputRange: [0, 10],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
          </LinearGradient>
        </Animated.View>

        {/* What Went Well */}
        <Animated.View style={[styles.section, { opacity: fadeAnims[1] }]}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
              <Ionicons name="checkmark-circle" size={20} color="#10b981" />
            </View>
            <Text style={styles.sectionTitle}>What Went Well</Text>
          </View>
          {(analysis.what_works || []).map((item, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: '#10b981' }]} />
              <Text style={styles.bulletText} data-testid={`what-works-${i}`}>{item}</Text>
            </View>
          ))}
        </Animated.View>

        {/* What to Improve */}
        <Animated.View style={[styles.section, { opacity: fadeAnims[2] }]}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
              <Ionicons name="bulb" size={20} color="#f59e0b" />
            </View>
            <Text style={styles.sectionTitle}>Tips to Improve</Text>
          </View>
          {(analysis.improvement_tips || []).map((tip, i) => (
            <View key={i} style={styles.tipCard}>
              <Text style={styles.tipNumber}>{i + 1}</Text>
              <Text style={styles.tipText} data-testid={`improvement-tip-${i}`}>{tip}</Text>
            </View>
          ))}
        </Animated.View>

        {/* Example Delivery */}
        <Animated.View style={[styles.section, { opacity: fadeAnims[3] }]}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.12)' }]}>
              <Ionicons name="mic" size={20} color="#8b5cf6" />
            </View>
            <Text style={styles.sectionTitle}>Example Delivery</Text>
          </View>
          <View style={styles.exampleCard}>
            <Text style={styles.exampleQuote} data-testid="example-delivery">
              "{analysis.example_delivery || ''}"
            </Text>
          </View>
        </Animated.View>

        {/* Director Note */}
        <Animated.View style={[styles.section, { opacity: fadeAnims[4] }]}>
          <LinearGradient
            colors={['rgba(139, 92, 246, 0.08)', 'rgba(99, 102, 241, 0.04)']}
            style={styles.directorCard}
          >
            <Ionicons name="videocam" size={18} color="#a78bfa" />
            <Text style={styles.directorLabel}>Director's Note</Text>
            <Text style={styles.directorText} data-testid="director-note">
              {analysis.director_note || ''}
            </Text>
          </LinearGradient>
        </Animated.View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.tryAgainButton}
            onPress={() => router.back()}
            data-testid="try-again-btn"
          >
            <Ionicons name="refresh" size={20} color="#a78bfa" />
            <Text style={styles.tryAgainText}>Try Different Settings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.replace('/dashboard')}
            data-testid="back-to-dashboard-btn"
          >
            <LinearGradient
              colors={['#7c3aed', '#6366f1']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.dashboardButton}
            >
              <Ionicons name="home" size={20} color="#fff" />
              <Text style={styles.dashboardButtonText}>Back to Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  // Score Section
  scoreSection: {
    marginBottom: 24,
  },
  scoreCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.12)',
  },
  sceneLabel: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '600',
    marginBottom: 16,
  },
  scoreRing: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  scoreNumber: {
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
  },
  scoreMax: {
    fontSize: 24,
    color: '#475569',
    fontWeight: '600',
    marginLeft: 2,
  },
  scoreLabelBadge: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 18,
  },
  scoreLabelText: {
    fontSize: 15,
    fontWeight: '700',
  },
  scoreBar: {
    width: '100%',
    height: 6,
    backgroundColor: '#1e293b',
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  // Sections
  section: {
    marginBottom: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  // Bullet Items
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
    paddingLeft: 4,
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 21,
  },
  // Tip Cards
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  tipNumber: {
    fontSize: 14,
    fontWeight: '800',
    color: '#f59e0b',
    width: 20,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 21,
  },
  // Example
  exampleCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 18,
    borderLeftWidth: 3,
    borderLeftColor: '#8b5cf6',
  },
  exampleQuote: {
    fontSize: 15,
    color: '#e2e8f0',
    lineHeight: 23,
    fontStyle: 'italic',
  },
  // Director Note
  directorCard: {
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.12)',
    gap: 6,
  },
  directorLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#a78bfa',
    letterSpacing: 0.5,
  },
  directorText: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 21,
  },
  // Actions
  actions: {
    gap: 12,
    marginTop: 8,
  },
  tryAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#7c3aed',
    gap: 8,
  },
  tryAgainText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#a78bfa',
  },
  dashboardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  dashboardButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
