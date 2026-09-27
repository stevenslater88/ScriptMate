// Quick Tutorial Onboarding Flow
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ONBOARDING_KEY = '@scriptmate_onboarding_seen';

interface OnboardingStep {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
  features: string[];
  tip?: string;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    icon: 'mic',
    iconColor: '#6366f1',
    title: 'Welcome to ScriptM8',
    subtitle: 'Your AI-powered script learning partner',
    features: [
      'Practice scripts with AI scene partners',
      'Record professional self-tape auditions',
      'Track your audition journey',
      'Level up your memorization skills',
    ],
    tip: 'Swipe to explore your new actor tools',
  },
  {
    icon: 'calendar',
    iconColor: '#f59e0b',
    title: 'Audition Tracker',
    subtitle: 'Never lose track of an opportunity',
    features: [
      'Log auditions with project & role details',
      'Track status: Submitted → Callback → Booked',
      'Set follow-up reminders',
      'View your callback & booking rates',
    ],
    tip: 'Free: 10 auditions • Premium: Unlimited + Stats',
  },
  {
    icon: 'flash',
    iconColor: '#10b981',
    title: 'Adaptive Recall',
    subtitle: 'Gamified script memorization',
    features: [
      'Words hide progressively as you practice',
      'Adjust difficulty from 10% to 100%',
      'Beat the timer challenge mode',
      'Earn XP and level up your mastery',
    ],
    tip: 'Free: Up to 50% difficulty • Premium: Full range + Timer',
  },
  {
    icon: 'grid',
    iconColor: '#3b82f6',
    title: 'Shot Coach',
    subtitle: 'Professional framing for self-tapes',
    features: [
      'Rule of thirds grid overlay',
      'Eye-line positioning guide',
      'Headroom boundary indicator',
      'Frame your shots like a pro',
    ],
    tip: 'Toggle overlays while recording',
  },
  {
    icon: 'stats-chart',
    iconColor: '#8b5cf6',
    title: 'Your Dashboard',
    subtitle: 'Track your daily progress',
    features: [
      'See practice time & streaks',
      'Monitor pending auditions',
      'Track XP & mastery level',
      'Quick access to all tools',
    ],
    tip: "You're all set! Start your actor journey",
  },
];

interface OnboardingTutorialProps {
  onComplete: () => void;
  isModal?: boolean;
}

export default function OnboardingTutorial({ onComplete, isModal = false }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const step = Math.round(offsetX / SCREEN_WIDTH);
    if (step !== currentStep && step >= 0 && step < ONBOARDING_STEPS.length) {
      setCurrentStep(step);
    }
  };

  const goToStep = (step: number) => {
    scrollViewRef.current?.scrollTo({ x: step * SCREEN_WIDTH, animated: true });
    setCurrentStep(step);
  };

  const handleComplete = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => onComplete());
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    onComplete();
  };

  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Skip Button */}
      {!isLastStep && (
        <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Steps Carousel */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
      >
        {ONBOARDING_STEPS.map((step, index) => (
          <View key={index} style={styles.stepContainer}>
            {/* Icon */}
            <View style={[styles.iconContainer, { backgroundColor: `${step.iconColor}20` }]}>
              <Ionicons name={step.icon as any} size={64} color={step.iconColor} />
            </View>

            {/* Content */}
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.subtitle}>{step.subtitle}</Text>

            {/* Features List */}
            <View style={styles.featuresList}>
              {step.features.map((feature, fIndex) => (
                <View key={fIndex} style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={18} color={step.iconColor} />
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>

            {/* Tip */}
            {step.tip && (
              <View style={styles.tipContainer}>
                <Ionicons name="information-circle" size={16} color="#9ca3af" />
                <Text style={styles.tipText}>{step.tip}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Pagination Dots */}
      <View style={styles.pagination}>
        {ONBOARDING_STEPS.map((_, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => goToStep(index)}
            style={[
              styles.dot,
              currentStep === index && styles.dotActive,
              currentStep === index && { backgroundColor: ONBOARDING_STEPS[index].iconColor },
            ]}
          />
        ))}
      </View>

      {/* Action Button */}
      <View style={styles.footer}>
        {isLastStep ? (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#10b981' }]}
            onPress={handleComplete}
          >
            <Ionicons name="rocket" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Get Started</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => goToStep(currentStep + 1)}
          >
            <Text style={styles.actionButtonText}>Next</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

// Helper to check if onboarding should be shown
export const shouldShowOnboarding = async (): Promise<boolean> => {
  try {
    const seen = await AsyncStorage.getItem(ONBOARDING_KEY);
    return seen !== 'true';
  } catch {
    return true;
  }
};

// Helper to reset onboarding (for testing or "Show Tutorial" button)
export const resetOnboarding = async (): Promise<void> => {
  await AsyncStorage.removeItem(ONBOARDING_KEY);
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  skipButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  skipText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  stepContainer: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 30,
    paddingTop: 100,
    alignItems: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 32,
  },
  featuresList: {
    width: '100%',
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 10,
    marginBottom: 8,
  },
  featureText: {
    fontSize: 14,
    color: '#e5e7eb',
    flex: 1,
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(156, 163, 175, 0.1)',
    borderRadius: 8,
  },
  tipText: {
    fontSize: 13,
    color: '#9ca3af',
    flex: 1,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#374151',
  },
  dotActive: {
    width: 24,
  },
  footer: {
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366f1',
    borderRadius: 14,
    paddingVertical: 16,
  },
  actionButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});
