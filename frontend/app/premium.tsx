// Premium Value Page - Professional, Value-Driven Design
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';
import { useRevenueCat } from '../hooks/useRevenueCat';
import * as Localization from 'expo-localization';
import { PurchasesPackage } from 'react-native-purchases';

// ═══════════════════════════════════════════════════════════════════════════
// PREMIUM FEATURES - Value-Driven Copy
// ═══════════════════════════════════════════════════════════════════════════

const PREMIUM_BENEFITS = [
  {
    icon: 'flash',
    title: 'Advanced Recall & Mastery',
    description: 'Full difficulty control, timed challenges, XP tracking',
    color: '#6366f1',
  },
  {
    icon: 'videocam',
    title: 'Director Mode Self-Tape',
    description: 'Pro framing guides and performance feedback',
    color: '#10b981',
  },
  {
    icon: 'clipboard',
    title: 'Unlimited Audition Tracking',
    description: 'Track all auditions, reminders, and stats',
    color: '#f59e0b',
  },
  {
    icon: 'stats-chart',
    title: 'Progress & Momentum Stats',
    description: 'Callback rates, booking rates, career trends',
    color: '#3b82f6',
  },
];

const FEATURE_CHECKLIST = [
  'Advanced Recall & mastery tracking',
  'Director Mode self-tape feedback',
  'Unlimited auditions & reminders',
  'Progress stats & momentum tracking',
  'Full difficulty range (0-100%)',
  'Timer challenge mode',
  'Scene-by-scene XP tracking',
  'Framing scores & guides',
];

export default function PremiumScreen() {
  const {
    isConfigured: rcConfigured,
    isLoading: rcLoading,
    offeringsReady,
    currentOffering,
    isPremium: rcIsPremium,
    monthlyPackage,
    yearlyPackage,
    lifetimePackage,
    purchase,
    restore,
    retryLoadOfferings,
    error: rcError,
  } = useRevenueCat();

  const {
    subscriptionPlans,
    user,
    isPremium: storeIsPremium,
    startTrial,
    subscribe,
    fetchSubscriptionPlans,
    error: storeError,
    region,
    currencySymbol,
    setRegion,
  } = useScriptStore();

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly' | 'lifetime'>('yearly');
  const [loading, setLoading] = useState(false);

  const isNative = Platform.OS !== 'web';
  const isPremium = isNative ? rcIsPremium : storeIsPremium;
  const error = isNative ? rcError : storeError;

  const monthlyPlan = subscriptionPlans?.monthly;
  const yearlyPlan = subscriptionPlans?.yearly;

  // Show lifetime option based on env config
  const showLifetime = process.env.EXPO_PUBLIC_SHOW_LIFETIME === 'true';

  // Check if offerings are available (crash-safe check)
  const hasOfferings = isNative 
    ? offeringsReady && (monthlyPackage || yearlyPackage || lifetimePackage)
    : true;

  useEffect(() => {
    const detectRegion = () => {
      try {
        const locales = Localization.getLocales();
        const deviceRegion = locales?.[0]?.regionCode || 'US';
        
        const EU_COUNTRIES = [
          'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
          'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
          'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
        ];
        
        let pricingRegion = 'US';
        if (deviceRegion === 'GB') pricingRegion = 'GB';
        else if (EU_COUNTRIES.includes(deviceRegion)) pricingRegion = 'EU';
        
        setRegion(pricingRegion);
      } catch (e) {
        fetchSubscriptionPlans('US');
      }
    };
    detectRegion();
  }, []);

  const handlePurchase = async (packageType: 'monthly' | 'yearly' | 'lifetime') => {
    setLoading(true);

    if (isNative && hasOfferings) {
      let selectedPackage: PurchasesPackage | undefined;
      if (packageType === 'monthly') selectedPackage = monthlyPackage;
      else if (packageType === 'yearly') selectedPackage = yearlyPackage;
      else if (packageType === 'lifetime') selectedPackage = lifetimePackage;
      
      if (!selectedPackage) {
        Alert.alert('Error', 'Selected plan not available. Please try again.');
        setLoading(false);
        return;
      }

      const result = await purchase(selectedPackage);
      
      if (result.success) {
        Alert.alert(
          'Welcome to Pro!',
          'You now have access to all ScriptMate Pro features.',
          [{ text: 'Get Started', onPress: () => router.back() }]
        );
      } else if (!result.cancelled) {
        Alert.alert('Purchase Failed', result.error || 'Please try again.');
      }
    } else {
      const success = await subscribe(packageType);
      
      if (success) {
        Alert.alert(
          'Welcome to Pro!',
          'You now have access to all ScriptMate Pro features.',
          [{ text: 'Get Started', onPress: () => router.back() }]
        );
      } else {
        Alert.alert('Error', storeError || 'Failed to subscribe');
      }
    }
    
    setLoading(false);
  };

  const handleStartTrial = async () => {
    if (user?.trial_used) {
      Alert.alert('Trial Used', 'You have already used your free trial.');
      return;
    }
    
    setLoading(true);
    const success = await startTrial();
    setLoading(false);
    
    if (success) {
      Alert.alert(
        'Trial Activated!',
        'Enjoy 7 days of Pro features free.',
        [{ text: 'Start Exploring', onPress: () => router.back() }]
      );
    } else {
      Alert.alert('Error', storeError || 'Failed to start trial');
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    const result = await restore();
    setLoading(false);
    
    if (result.success && result.restored) {
      Alert.alert('Restored!', 'Your purchase has been restored.');
    } else if (result.success) {
      Alert.alert('No Purchases Found', 'No previous purchases found for this account.');
    } else {
      Alert.alert('Error', result.error || 'Failed to restore purchases');
    }
  };

  const getPriceDisplay = (plan: 'monthly' | 'yearly' | 'lifetime') => {
    if (isNative && offerings) {
      if (plan === 'monthly' && monthlyPackage) {
        return monthlyPackage.product.priceString;
      } else if (plan === 'yearly' && yearlyPackage) {
        return yearlyPackage.product.priceString;
      } else if (plan === 'lifetime' && lifetimePackage) {
        return lifetimePackage.product.priceString;
      }
    }
    
    // Fallback pricing
    if (plan === 'monthly' && monthlyPlan) return `${currencySymbol}${monthlyPlan.price}`;
    if (plan === 'yearly' && yearlyPlan) return `${currencySymbol}${yearlyPlan.price}`;
    if (plan === 'lifetime') return `${currencySymbol}49.99`;
    
    return plan === 'monthly' ? '$4.99' : plan === 'yearly' ? '$29.99' : '$49.99';
  };

  if (isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.premiumActiveContainer}>
          <View style={styles.premiumActiveIcon}>
            <Ionicons name="star" size={48} color="#f59e0b" />
          </View>
          <Text style={styles.premiumActiveTitle}>You're a Pro!</Text>
          <Text style={styles.premiumActiveSubtitle}>
            You have access to all ScriptMate Pro features
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Back to App</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.restoreButton} onPress={handleRestore}>
            <Text style={styles.restoreText}>Restore</Text>
          </TouchableOpacity>
        </View>
        
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="star" size={32} color="#f59e0b" />
          </View>
          <Text style={styles.heroTitle}>Go Pro with ScriptMate</Text>
          <Text style={styles.heroSubtitle}>
            Unlock your full potential as an actor
          </Text>
        </View>

        {/* Features Checklist */}
        <View style={styles.checklistCard}>
          {FEATURE_CHECKLIST.map((feature, index) => (
            <View key={index} style={styles.checklistItem}>
              <View style={styles.checkIcon}>
                <Ionicons name="checkmark" size={14} color="#10b981" />
              </View>
              <Text style={styles.checklistText}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* Plan Selection */}
        <View style={styles.plansContainer}>
          {/* Yearly - Best Value */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'yearly' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('yearly')}
            data-testid="yearly-plan-card"
          >
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>BEST VALUE</Text>
            </View>
            <View style={styles.planRadio}>
              <View style={[styles.radioOuter, selectedPlan === 'yearly' && styles.radioOuterSelected]}>
                {selectedPlan === 'yearly' && <View style={styles.radioInner} />}
              </View>
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Yearly</Text>
              <Text style={styles.planPrice}>{getPriceDisplay('yearly')}</Text>
              <Text style={styles.planPeriod}>per year</Text>
            </View>
            {yearlyPlan && (
              <View style={styles.savingsBadge}>
                <Text style={styles.savingsText}>Save 50%</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('monthly')}
            data-testid="monthly-plan-card"
          >
            <View style={styles.planRadio}>
              <View style={[styles.radioOuter, selectedPlan === 'monthly' && styles.radioOuterSelected]}>
                {selectedPlan === 'monthly' && <View style={styles.radioInner} />}
              </View>
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Monthly</Text>
              <Text style={styles.planPrice}>{getPriceDisplay('monthly')}</Text>
              <Text style={styles.planPeriod}>per month</Text>
            </View>
          </TouchableOpacity>

          {/* Lifetime */}
          {showLifetime && lifetimePackage && (
            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'lifetime' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('lifetime')}
              data-testid="lifetime-plan-card"
            >
              <View style={[styles.planBadge, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                <Text style={[styles.planBadgeText, { color: '#8b5cf6' }]}>ONE-TIME</Text>
              </View>
              <View style={styles.planRadio}>
                <View style={[styles.radioOuter, selectedPlan === 'lifetime' && styles.radioOuterSelected]}>
                  {selectedPlan === 'lifetime' && <View style={styles.radioInner} />}
                </View>
              </View>
              <View style={styles.planContent}>
                <Text style={styles.planName}>Lifetime</Text>
                <Text style={styles.planPrice}>{getPriceDisplay('lifetime')}</Text>
                <Text style={styles.planPeriod}>one-time payment</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={styles.ctaButton}
          onPress={() => handlePurchase(selectedPlan)}
          disabled={loading}
          data-testid="upgrade-cta-button"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaButtonText}>Upgrade to Pro</Text>
          )}
        </TouchableOpacity>

        {/* Trial CTA */}
        {!user?.trial_used && (
          <TouchableOpacity
            style={styles.trialButton}
            onPress={handleStartTrial}
            disabled={loading}
          >
            <Text style={styles.trialButtonText}>Start 7-Day Free Trial</Text>
          </TouchableOpacity>
        )}

        {/* Footer */}
        <Text style={styles.footerText}>
          Cancel anytime. Built for working actors.
        </Text>
        
        <View style={styles.footerLinks}>
          <TouchableOpacity onPress={() => router.push('/terms')}>
            <Text style={styles.footerLink}>Terms</Text>
          </TouchableOpacity>
          <Text style={styles.footerDivider}>•</Text>
          <TouchableOpacity onPress={() => router.push('/privacy')}>
            <Text style={styles.footerLink}>Privacy</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  
  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
  backButton: { padding: 8, marginLeft: -8 },
  restoreButton: { padding: 8 },
  restoreText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  
  // Hero
  hero: { alignItems: 'center', paddingVertical: 24 },
  heroIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: 'rgba(245, 158, 11, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  heroTitle: { fontSize: 28, fontWeight: '700', color: '#fff', letterSpacing: -0.5, marginBottom: 8 },
  heroSubtitle: { fontSize: 16, color: '#9ca3af', textAlign: 'center' },
  
  // Checklist
  checklistCard: { backgroundColor: '#111118', borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: '#1a1a2e' },
  checklistItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  checkIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(16, 185, 129, 0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  checklistText: { fontSize: 15, color: '#e5e7eb', flex: 1 },
  
  // Plans
  plansContainer: { gap: 12, marginBottom: 24 },
  planCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111118', borderRadius: 14, padding: 18, borderWidth: 2, borderColor: '#1a1a2e', position: 'relative' },
  planCardSelected: { borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.06)' },
  planBadge: { position: 'absolute', top: -10, right: 16, backgroundColor: 'rgba(245, 158, 11, 0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  planBadgeText: { fontSize: 10, fontWeight: '700', color: '#f59e0b', letterSpacing: 0.5 },
  planRadio: { marginRight: 16 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  radioOuterSelected: { borderColor: '#6366f1' },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#6366f1' },
  planContent: { flex: 1 },
  planName: { fontSize: 17, fontWeight: '600', color: '#fff', marginBottom: 2 },
  planPrice: { fontSize: 22, fontWeight: '700', color: '#fff' },
  planPeriod: { fontSize: 13, color: '#6b7280' },
  savingsBadge: { backgroundColor: 'rgba(16, 185, 129, 0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  savingsText: { fontSize: 12, fontWeight: '600', color: '#10b981' },
  
  // CTA
  ctaButton: { backgroundColor: '#6366f1', borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  ctaButtonText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  trialButton: { borderWidth: 1, borderColor: '#374151', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 20 },
  trialButtonText: { fontSize: 15, fontWeight: '600', color: '#9ca3af' },
  
  // Footer
  footerText: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: 12 },
  footerLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  footerLink: { fontSize: 13, color: '#6b7280' },
  footerDivider: { color: '#374151' },
  bottomSpacer: { height: 40 },
  
  // Premium Active State
  premiumActiveContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  premiumActiveIcon: { width: 96, height: 96, borderRadius: 28, backgroundColor: 'rgba(245, 158, 11, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  premiumActiveTitle: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 8 },
  premiumActiveSubtitle: { fontSize: 16, color: '#9ca3af', textAlign: 'center', marginBottom: 32 },
  primaryButton: { backgroundColor: '#6366f1', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
