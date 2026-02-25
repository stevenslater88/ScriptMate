import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Animated,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { getScenes, analyzePerformance, Scene } from '../services/actingCoachService';
import useRevenueCat from '../hooks/useRevenueCat';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const EMOTIONS = [
  { id: 'neutral', label: 'Neutral', icon: 'remove-circle-outline', color: '#94a3b8' },
  { id: 'angry', label: 'Angry', icon: 'flame-outline', color: '#ef4444' },
  { id: 'emotional', label: 'Emotional', icon: 'water-outline', color: '#3b82f6' },
  { id: 'confident', label: 'Confident', icon: 'shield-checkmark-outline', color: '#f59e0b' },
  { id: 'nervous', label: 'Nervous', icon: 'pulse-outline', color: '#10b981' },
  { id: 'vulnerable', label: 'Vulnerable', icon: 'heart-outline', color: '#ec4899' },
];

const STYLES = [
  { id: 'natural_tv', label: 'Natural TV', icon: 'tv-outline' },
  { id: 'dramatic', label: 'Dramatic', icon: 'megaphone-outline' },
  { id: 'film_subtle', label: 'Film Subtle', icon: 'film-outline' },
  { id: 'social_media', label: 'Social Media', icon: 'phone-portrait-outline' },
];

const ENERGY_LABELS = ['Calm', 'Calm', 'Calm', 'Balanced', 'Balanced', 'Balanced', 'Balanced', 'Intense', 'Intense', 'Intense'];

export default function ActingCoachScreen() {
  const { isPremium, presentPaywall } = useRevenueCat();
  
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [selectedEmotion, setSelectedEmotion] = useState('neutral');
  const [selectedStyle, setSelectedStyle] = useState('natural_tv');
  const [energy, setEnergy] = useState(5);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Animations
  const glowAnims = useRef(EMOTIONS.map(() => new Animated.Value(0))).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadScenes();
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  // Glow animation for selected emotion
  useEffect(() => {
    const idx = EMOTIONS.findIndex(e => e.id === selectedEmotion);
    glowAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i === idx ? 1 : 0,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  }, [selectedEmotion]);

  const loadScenes = async () => {
    try {
      const data = await getScenes();
      setScenes(data);
    } catch {
      // Fallback scenes
      setScenes([
        { title: 'The Breakup', context: "You're ending a long relationship.", genre: 'Drama' },
        { title: 'The Job Interview', context: 'You need this job but must stay composed.', genre: 'Drama' },
        { title: 'The Confession', context: "Admitting a secret you've kept for years.", genre: 'Drama' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const shuffleScene = () => {
    const next = (selectedSceneIndex + 1) % scenes.length;
    setSelectedSceneIndex(next);
  };

  const handleCoachMe = async () => {
    if (!isPremium) {
      presentPaywall();
      return;
    }

    if (scenes.length === 0) return;

    setIsAnalyzing(true);
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 100, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();

    try {
      const scene = scenes[selectedSceneIndex];
      const analysis = await analyzePerformance({
        scene_title: scene.title,
        scene_context: scene.context,
        emotion: selectedEmotion,
        style: selectedStyle,
        energy,
      });

      router.push({
        pathname: '/acting-feedback',
        params: { analysis: JSON.stringify(analysis), scene: scene.title },
      });
    } catch (err: any) {
      Alert.alert('Analysis Failed', err.message || 'Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const currentScene = scenes[selectedSceneIndex];
  const energyLabel = ENERGY_LABELS[energy - 1] || 'Balanced';
  const selectedEmotionData = EMOTIONS.find(e => e.id === selectedEmotion);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.animatedContainer, { opacity: fadeIn }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} data-testid="acting-coach-back-btn">
            <Ionicons name="arrow-back" size={24} color="#e2e8f0" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Acting Coach</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Scene Overview Card */}
          {currentScene && (
            <LinearGradient
              colors={['#1e1b4b', '#172554']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sceneCard}
            >
              <View style={styles.sceneHeader}>
                <View style={styles.sceneGenreBadge}>
                  <Text style={styles.sceneGenreText}>{currentScene.genre}</Text>
                </View>
                <TouchableOpacity onPress={shuffleScene} data-testid="shuffle-scene-btn">
                  <Ionicons name="shuffle-outline" size={22} color="#a5b4fc" />
                </TouchableOpacity>
              </View>
              <Text style={styles.sceneTitle} data-testid="scene-title">{currentScene.title}</Text>
              <Text style={styles.sceneContext}>{currentScene.context}</Text>
            </LinearGradient>
          )}

          {/* Emotion Selector */}
          <Text style={styles.sectionLabel}>Choose Your Emotion</Text>
          <View style={styles.emotionGrid}>
            {EMOTIONS.map((emotion, index) => {
              const isSelected = selectedEmotion === emotion.id;
              return (
                <Animated.View
                  key={emotion.id}
                  style={[
                    styles.emotionButtonWrapper,
                    {
                      shadowColor: emotion.color,
                      shadowOpacity: glowAnims[index].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 0.6],
                      }),
                      shadowRadius: glowAnims[index].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 12],
                      }),
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.emotionButton,
                      isSelected && { borderColor: emotion.color, backgroundColor: `${emotion.color}18` },
                    ]}
                    onPress={() => setSelectedEmotion(emotion.id)}
                    data-testid={`emotion-${emotion.id}-btn`}
                  >
                    <Ionicons
                      name={emotion.icon as any}
                      size={26}
                      color={isSelected ? emotion.color : '#64748b'}
                    />
                    <Text style={[styles.emotionLabel, isSelected && { color: emotion.color }]}>
                      {emotion.label}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>

          {/* Performance Style Selector */}
          <Text style={styles.sectionLabel}>Performance Style</Text>
          <View style={styles.styleRow}>
            {STYLES.map((style) => {
              const isSelected = selectedStyle === style.id;
              return (
                <TouchableOpacity
                  key={style.id}
                  style={[styles.styleButton, isSelected && styles.styleButtonSelected]}
                  onPress={() => setSelectedStyle(style.id)}
                  data-testid={`style-${style.id}-btn`}
                >
                  <Ionicons
                    name={style.icon as any}
                    size={20}
                    color={isSelected ? '#c4b5fd' : '#64748b'}
                  />
                  <Text style={[styles.styleLabel, isSelected && styles.styleLabelSelected]}>
                    {style.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Energy Slider */}
          <Text style={styles.sectionLabel}>Energy Level</Text>
          <View style={styles.energyContainer}>
            <View style={styles.energyHeader}>
              <Text style={styles.energyEndLabel}>Low</Text>
              <View style={styles.energyValueBadge}>
                <Text style={styles.energyValueText}>{energyLabel}</Text>
              </View>
              <Text style={styles.energyEndLabel}>High</Text>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={10}
              step={1}
              value={energy}
              onValueChange={setEnergy}
              minimumTrackTintColor="#8b5cf6"
              maximumTrackTintColor="#1e293b"
              thumbTintColor="#a78bfa"
              data-testid="energy-slider"
            />
            <View style={styles.energyDots}>
              {Array.from({ length: 10 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.energyDot,
                    i < energy && { backgroundColor: '#8b5cf6' },
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Preview tip for free users */}
          {!isPremium && (
            <View style={styles.previewTipCard}>
              <Ionicons name="bulb-outline" size={20} color="#f59e0b" />
              <View style={styles.previewTipContent}>
                <Text style={styles.previewTipTitle}>Free Tip</Text>
                <Text style={styles.previewTipText}>
                  {selectedEmotionData?.id === 'angry'
                    ? "Channel anger through controlled tension in your jaw and hands, not volume."
                    : selectedEmotionData?.id === 'emotional'
                    ? "Let the emotion build naturally. Start lower than you think you need to."
                    : selectedEmotionData?.id === 'confident'
                    ? "Confidence lives in stillness. Reduce fidgeting and own the pauses."
                    : selectedEmotionData?.id === 'nervous'
                    ? "Nervousness shows in breathing. Use quick, shallow breaths to sell it."
                    : selectedEmotionData?.id === 'vulnerable'
                    ? "Vulnerability means letting the audience see you think before you speak."
                    : "Neutral doesn't mean empty. Find the quiet intensity beneath the calm."}
                </Text>
              </View>
            </View>
          )}

          {/* Coach Me Button */}
          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <TouchableOpacity
              onPress={handleCoachMe}
              disabled={isAnalyzing}
              activeOpacity={0.85}
              data-testid="coach-my-performance-btn"
            >
              <LinearGradient
                colors={isPremium ? ['#7c3aed', '#6366f1'] : ['#4b5563', '#374151']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaButton}
              >
                {isAnalyzing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons
                      name={isPremium ? 'sparkles' : 'lock-closed'}
                      size={22}
                      color="#fff"
                    />
                    <Text style={styles.ctaText}>
                      {isPremium ? 'Coach My Performance' : 'Unlock Acting Coach'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  animatedContainer: {
    flex: 1,
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
    letterSpacing: 0.3,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  // Scene Card
  sceneCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  sceneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sceneGenreBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sceneGenreText: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '600',
  },
  sceneTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f1f5f9',
    marginBottom: 6,
  },
  sceneContext: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  // Section Labels
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 14,
  },
  // Emotion Grid
  emotionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
  },
  emotionButtonWrapper: {
    width: (SCREEN_WIDTH - 60) / 3 - 2,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  emotionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  emotionLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  // Style Selector
  styleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  styleButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    gap: 4,
  },
  styleButtonSelected: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
  },
  styleLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  styleLabelSelected: {
    color: '#c4b5fd',
  },
  // Energy Slider
  energyContainer: {
    marginBottom: 28,
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  energyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  energyEndLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  energyValueBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
  },
  energyValueText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '700',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  energyDots: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    marginTop: -4,
  },
  energyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1e293b',
  },
  // Preview Tip
  previewTipCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.15)',
    gap: 12,
  },
  previewTipContent: {
    flex: 1,
  },
  previewTipTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f59e0b',
    marginBottom: 4,
  },
  previewTipText: {
    fontSize: 13,
    color: '#d1d5db',
    lineHeight: 19,
  },
  // CTA Button
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
    marginTop: 4,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.3,
  },
});
