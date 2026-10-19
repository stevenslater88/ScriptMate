// Premium Value Page - Professional, Value-Driven Design
import React, { useEffect, useRef, useState } from 'react';
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
import { AppConfig } from '../services/appConfig';
import { useScriptStore } from '../store/scriptStore';
import { useRevenueCat } from '../hooks/useRevenueCat';
import { hasIntroOffer, getIntroOfferDetails } from '../services/revenuecat';
import { summarizeSubscriptionOptions } from '../services/trialOffer';
import * as Localization from 'expo-localization';
import { PurchasesPackage } from 'react-native-purchases';
import { DebugLog } from '../services/debugLogService';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRADIENT, RADIUS, TYPE, tint } from '../constants/cinematicTheme';
import { ScreenGlow } from '../components/cinematic';

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
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const isNative = Platform.OS !== 'web';
  const isPremium = isNative ? rcIsPremium : storeIsPremium;
  const error = isNative ? rcError : storeError;

  const monthlyPlan = subscriptionPlans?.monthly;
  const yearlyPlan = subscriptionPlans?.yearly;

  // Show lifetime option based on centralized config
  const showLifetime = AppConfig.SHOW_LIFETIME;

  // Check if offerings are available (crash-safe check)
  const hasOfferings = isNative 
    ? offeringsReady && (monthlyPackage || yearlyPackage || lifetimePackage)
    : true;

  // Timeout: if RevenueCat is still loading after 8s, stop waiting
  useEffect(() => {
    if (!isNative || !rcLoading || hasOfferings) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      if (rcLoading && !hasOfferings) {
        setLoadingTimedOut(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [isNative, rcLoading, hasOfferings]);

  // Diagnostic: record why the trial CTA is shown/hidden (logs only when inputs change).
  const lastTrialCtaDecisionRef = useRef('');
  const trialUsed = !!user?.trial_used;
  const userLoaded = !!user;
  useEffect(() => {
    if (!isNative || !offeringsReady) return;
    const summary = summarizeSubscriptionOptions(yearlyPackage?.product);
    const payload = {
      platform: Platform.OS,
      isPremium,
      userLoaded,
      trialUsed,
      hasYearlyPackage: !!yearlyPackage,
      hasFreeTrial: !!yearlyPackage && hasIntroOffer(yearlyPackage),
      ...summary,
      // Flatten tags: DebugLog masks values nested deeper than 3 levels.
      subscriptionOptions: summary.subscriptionOptions.map((o) => ({ ...o, tags: (o.tags ?? []).join(',') })),
    };
    const key = JSON.stringify(payload);
    if (key === lastTrialCtaDecisionRef.current) return;
    lastTrialCtaDecisionRef.current = key;
    DebugLog.log('PURCHASE_EVENT', 'RevenueCat', 'TRIAL_CTA_DECISION', payload);
  }, [isNative, offeringsReady, isPremium, userLoaded, trialUsed, yearlyPackage]);

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
          'You now have access to all ScriptM8 Pro features.',
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
          'You now have access to all ScriptM8 Pro features.',
          [{ text: 'Get Started', onPress: () => router.back() }]
        );
      } else {
        // 2026-02 SCRIPT M8 — stale-closure fix: read the error that
        // was JUST written by subscribe() instead of the (stale)
        // closure-captured `storeError` from the previous render.
        // Previously this showed "Failed to subscribe" even when the
        // backend returned a specific detail message.
        const freshError = useScriptStore.getState().error;
        Alert.alert('Error', freshError || 'Failed to subscribe');
      }
    }
    
    setLoading(false);
  };

  const handleStartTrial = async () => {
    if (user?.trial_used) {
      Alert.alert('Trial Used', 'You have already used your free trial.');
      return;
    }

    DebugLog.buttonPress('start-trial-btn', 'PremiumScreen');

    // 2026-02 SCRIPT M8 — Purchase-first trial flow.
    //
    // The backend `/start-trial` endpoint is a VERIFICATION endpoint:
    // it checks RevenueCat has already granted an entitlement and
    // sets `trial_used`+`subscription_tier=premium`. It does NOT and
    // CANNOT initiate a Google Play trial itself (Google Play Billing
    // requires an SDK-initiated purchase bound to a user action).
    //
    // Therefore: on native, we invoke the RevenueCat purchase flow
    // for the yearly package. Google Play automatically presents its
    // "7-day free trial, then £X/year" sheet when the subscription
    // has an eligible intro offer configured in Play Console AND the
    // user is eligible. If NO intro offer exists on the product, we
    // report that clearly rather than fake trial activation.
    //
    // Security: we NEVER grant Premium locally. The subsequent
    // `refreshPremiumStatus → fetchUserLimits → resolve_authoritative_tier`
    // chain verifies the RC entitlement server-side (SEC-003 remains
    // enforced end-to-end).
    if (isNative && hasOfferings) {
      if (!yearlyPackage) {
        Alert.alert(
          'Trial Not Available',
          'The trial plan is not currently available. Please try again in a minute or tap Restore Purchases.',
        );
        return;
      }
      const introAvailable = hasIntroOffer(yearlyPackage);
      DebugLog.log('PURCHASE_EVENT', 'RevenueCat', 'TRIAL_INTRO_PROBE', {
        productId: yearlyPackage.product?.identifier,
        introAvailable,
        introDetail: introAvailable ? getIntroOfferDetails(yearlyPackage) : null,
        ...summarizeSubscriptionOptions(yearlyPackage.product),
      });
      if (!introAvailable) {
        // Explicit, non-faking: configuration dependency is on the
        // Google Play/RevenueCat side. Direct the user to the full
        // subscribe path instead.
        Alert.alert(
          'Free Trial Unavailable',
          'A free trial is not currently offered on this device. You can still subscribe directly to ScriptM8 Pro.',
          [{ text: 'OK' }],
        );
        return;
      }

      setLoading(true);
      const result = await purchase(yearlyPackage);
      setLoading(false);

      if (result.success) {
        Alert.alert(
          'Trial Activated!',
          'Enjoy 7 days of Pro features free.',
          [{ text: 'Start Exploring', onPress: () => router.back() }]
        );
      } else if (result.cancelled) {
        // 2026-02 SCRIPT M8 — Google Play purchase sheet dismissed by
        // the user. Not an error; return silently.
        return;
      } else {
        Alert.alert('Trial Failed', result.error || 'Please try again.');
      }
      return;
    }

    // Web / non-native fallback — the old backend-only path. Keep
    // the stale-closure fix here too.
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
      // 2026-02 SCRIPT M8 — stale-closure fix (see handlePurchase).
      const freshError = useScriptStore.getState().error;
      Alert.alert('Error', freshError || 'Failed to start trial');
    }
  };

  const handleRestore = async () => {
    // 2026-02 Overnight RC investigation: anchor the restore chain
    // in `DebugLog` so the diagnostic report shows the user actually
    // pressed Restore AND the subsequent SDK events.
    DebugLog.buttonPress('restore-purchases-btn', 'PremiumScreen');
    DebugLog.log('PURCHASE_EVENT', 'RevenueCat', 'USER_RESTORE_TAPPED', {});
    setLoading(true);
    const result = await restore();
    setLoading(false);
    DebugLog.log('PURCHASE_EVENT', 'RevenueCat', 'USER_RESTORE_ALERT_SHOWN', {
      success: result.success,
      restored: result.restored,
      hasError: !!result.error,
    });
    
    if (result.success && result.restored) {
      Alert.alert('Restored!', 'Your purchase has been restored.');
    } else if (result.success) {
      Alert.alert('No Purchases Found', 'No previous purchases found for this account.');
    } else {
      Alert.alert('Error', result.error || 'Failed to restore purchases');
    }
  };

  // Retry loading offerings when they fail
  const handleRetryLoadOfferings = async () => {
    setLoading(true);
    setLoadingTimedOut(false);
    await retryLoadOfferings();
    setLoading(false);
  };

  const getPriceDisplay = (plan: 'monthly' | 'yearly' | 'lifetime') => {
    if (isNative && hasOfferings) {
      if (plan === 'monthly' && monthlyPackage) {
        return monthlyPackage.product.priceString;
      } else if (plan === 'yearly' && yearlyPackage) {
        return yearlyPackage.product.priceString;
      } else if (plan === 'lifetime' && lifetimePackage) {
        return lifetimePackage.product.priceString;
      }
    }
    
    // Fallback pricing from backend API
    if (plan === 'monthly' && monthlyPlan) return `${currencySymbol}${monthlyPlan.price}`;
    if (plan === 'yearly' && yearlyPlan) return `${currencySymbol}${yearlyPlan.price}`;
    
    // No price available yet — show generic label
    return 'Subscribe';
  };

  if (isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenGlow />
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="premium-back-btn" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={19} color="#CFCBF2" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.premiumActiveContainer} testID="premium-active-state">
          <View style={styles.premiumActiveIcon}>
            <Ionicons name="star" size={44} color={C.violetSoft} />
          </View>
          <Text style={styles.premiumActiveTitle}>You're a Pro!</Text>
          <Text style={styles.premiumActiveSubtitle}>
            You have access to all ScriptM8 Pro features
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()} testID="premium-active-back-btn">
            <Text style={styles.primaryButtonText}>Back to App</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Show loading state while RevenueCat initializes (native only), but not forever
  if (isNative && rcLoading && !hasOfferings && !loadingTimedOut) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenGlow />
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="premium-back-btn" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={19} color="#CFCBF2" />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer} testID="premium-loading-state">
          <ActivityIndicator size="large" color="#7C5CFF" />
          <Text style={styles.loadingText}>Loading subscription options...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show error state with retry button if offerings failed to load or timed out (native only)
  if (isNative && !hasOfferings && (!rcLoading || loadingTimedOut)) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenGlow />
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="premium-back-btn" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={19} color="#CFCBF2" />
          </TouchableOpacity>
        </View>
        <View style={styles.errorContainer} testID="premium-offerings-error-state">
          <View style={styles.errorIcon}>
            <Ionicons name="sync-outline" size={48} color="#FFC37A" />
          </View>
          <Text style={styles.errorTitle}>Premium is Still Syncing</Text>
          <Text style={styles.errorMessage}>
            Please try again in a minute. If this persists, check your internet connection.
          </Text>
          <TouchableOpacity 
            style={styles.retryButton} 
            onPress={handleRetryLoadOfferings}
            disabled={loading}
            data-testid="retry-load-offerings-btn"
            testID="retry-load-offerings-btn"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="refresh" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.retryButtonText}>Retry</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.secondaryButton} 
            onPress={handleRestore}
            disabled={loading}
            testID="premium-error-restore-btn"
          >
            <Text style={styles.secondaryButtonText}>Restore Purchases</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={() => router.back()} testID="premium-error-go-back-btn">
            <Text style={styles.backLinkText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScreenGlow />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="premium-back-btn" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={19} color="#CFCBF2" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.restoreButton} onPress={handleRestore} testID="premium-header-restore-btn">
            <Text style={styles.restoreText}>Restore</Text>
          </TouchableOpacity>
        </View>
        
        {/* Hero */}
        <View style={styles.hero}>
          <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroIcon}>
            <Ionicons name="star" size={30} color="#fff" />
          </LinearGradient>
          <Text style={styles.heroEyebrow}>Premium</Text>
          <Text style={styles.heroTitle} testID="premium-hero-title">ScriptM8 Pro</Text>
          <Text style={styles.heroSubtitle}>
            Unlock Self Tape Studio + Pro Tools
          </Text>
        </View>

        {/* Features Checklist */}
        <View style={styles.checklistCard} testID="premium-feature-checklist">
          {FEATURE_CHECKLIST.map((feature, index) => (
            <View key={index} style={styles.checklistItem}>
              <View style={styles.checkIcon}>
                <Ionicons name="checkmark" size={14} color="#34D399" />
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
            testID="yearly-plan-card"
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
              <Text style={styles.planPrice} testID="yearly-plan-price">{getPriceDisplay('yearly')}</Text>
              <Text style={styles.planPeriod}>per year</Text>
            </View>
          </TouchableOpacity>

          {/* Monthly */}
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('monthly')}
            data-testid="monthly-plan-card"
            testID="monthly-plan-card"
          >
            <View style={styles.planRadio}>
              <View style={[styles.radioOuter, selectedPlan === 'monthly' && styles.radioOuterSelected]}>
                {selectedPlan === 'monthly' && <View style={styles.radioInner} />}
              </View>
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planName}>Monthly</Text>
              <Text style={styles.planPrice} testID="monthly-plan-price">{getPriceDisplay('monthly')}</Text>
              <Text style={styles.planPeriod}>per month</Text>
            </View>
          </TouchableOpacity>

          {/* Lifetime */}
          {showLifetime && lifetimePackage && (
            <TouchableOpacity
              style={[styles.planCard, selectedPlan === 'lifetime' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('lifetime')}
              data-testid="lifetime-plan-card"
            testID="lifetime-plan-card"
            >
              <View style={[styles.planBadge, styles.planBadgeAlt]}>
                <Text style={[styles.planBadgeText, { color: C.violetSoft }]}>ONE-TIME</Text>
              </View>
              <View style={styles.planRadio}>
                <View style={[styles.radioOuter, selectedPlan === 'lifetime' && styles.radioOuterSelected]}>
                  {selectedPlan === 'lifetime' && <View style={styles.radioInner} />}
                </View>
              </View>
              <View style={styles.planContent}>
                <Text style={styles.planName}>Lifetime</Text>
                <Text style={styles.planPrice} testID="lifetime-plan-price">{getPriceDisplay('lifetime')}</Text>
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
          testID="upgrade-cta-button"
        >
          <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaButtonText}>Upgrade to Pro</Text>
          )}
        </TouchableOpacity>

        {/* Restore Purchases Button */}
        <TouchableOpacity
          style={styles.restorePurchasesButton}
          onPress={handleRestore}
          disabled={loading}
          data-testid="restore-purchases-btn"
          testID="restore-purchases-btn"
        >
          <Text style={styles.restorePurchasesText}>Restore Purchases</Text>
        </TouchableOpacity>

        {/* Trial CTA — Android: only when Google Play returned a free-trial option */}
        {!user?.trial_used && (Platform.OS !== 'android' || (!!yearlyPackage && hasIntroOffer(yearlyPackage))) && (
          <TouchableOpacity
            style={styles.trialButton}
            onPress={handleStartTrial}
            disabled={loading}
            testID="start-trial-btn"
          >
            <Text style={styles.trialButtonText}>Start 7-Day Free Trial</Text>
          </TouchableOpacity>
        )}

        {/* Footer */}
        <Text style={styles.footerText}>
          Cancel anytime. Built for working actors.
        </Text>
        
        <View style={styles.footerLinks}>
          <TouchableOpacity onPress={() => router.push('/terms')} testID="premium-terms-link">
            <Text style={styles.footerLink}>Terms</Text>
          </TouchableOpacity>
          <Text style={styles.footerDivider}>•</Text>
          <TouchableOpacity onPress={() => router.push('/privacy')} testID="premium-privacy-link">
            <Text style={styles.footerLink}>Privacy</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  scrollView: { flex: 1, paddingHorizontal: 20 },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, paddingBottom: 8, paddingHorizontal: 20 },
  backButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginLeft: -20 },
  restoreButton: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginRight: -20 },
  restoreText: { fontSize: 13, color: C.muted, fontWeight: '600' },

  // Loading State
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { fontSize: 15, color: C.muted, marginTop: 16, textAlign: 'center' },

  // Error State
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorIcon: { width: 88, height: 88, borderRadius: 26, backgroundColor: tint(C.warning, 0.12), borderWidth: 1, borderColor: tint(C.warning, 0.28), alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  errorTitle: { ...TYPE.title, fontSize: 22, marginBottom: 10, textAlign: 'center' },
  errorMessage: { fontSize: 15, color: C.muted, textAlign: 'center', marginBottom: 28, lineHeight: 22, paddingHorizontal: 16 },
  retryButton: { flexDirection: 'row', backgroundColor: C.violet, borderRadius: RADIUS.md, paddingVertical: 15, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  retryButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  secondaryButton: { borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 24, marginBottom: 14 },
  secondaryButtonText: { fontSize: 14, fontWeight: '600', color: C.text },
  backLink: { padding: 12 },
  backLinkText: { fontSize: 14, color: C.muted, fontWeight: '600' },

  // Restore Purchases Button
  restorePurchasesButton: { borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  restorePurchasesText: { fontSize: 15, fontWeight: '600', color: C.text },

  // Hero
  hero: { alignItems: 'center', paddingTop: 16, paddingBottom: 24 },
  heroIcon: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  heroEyebrow: { ...TYPE.label, color: C.violetSoft, marginBottom: 6 },
  heroTitle: { ...TYPE.display, fontSize: 30, marginBottom: 8 },
  heroSubtitle: { fontSize: 15, color: C.muted, textAlign: 'center' },

  // Checklist
  checklistCard: { backgroundColor: C.surface, borderRadius: RADIUS.lg, paddingHorizontal: 18, paddingVertical: 10, marginBottom: 24, borderWidth: 1, borderColor: C.line },
  checklistItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  checkIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: tint(C.success, 0.15), alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  checklistText: { fontSize: 14.5, color: C.text, flex: 1 },

  // Plans
  plansContainer: { gap: 14, marginBottom: 24 },
  planCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: RADIUS.lg, padding: 18, borderWidth: 2, borderColor: C.line, position: 'relative' },
  planCardSelected: { borderColor: C.violet, backgroundColor: tint(C.violet, 0.1) },
  planBadge: { position: 'absolute', top: -10, right: 16, backgroundColor: C.violet, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  planBadgeAlt: { backgroundColor: tint(C.violet, 0.2), borderWidth: 1, borderColor: tint(C.violet, 0.4) },
  planBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  planRadio: { marginRight: 16 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#3A3666', alignItems: 'center', justifyContent: 'center' },
  radioOuterSelected: { borderColor: C.violet },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.violet },
  planContent: { flex: 1 },
  planName: { ...TYPE.label, color: C.muted, marginBottom: 4 },
  planPrice: { fontSize: 24, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  planPeriod: { fontSize: 13, color: C.dim, marginTop: 1 },
  savingsBadge: { backgroundColor: tint(C.success, 0.15), paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  savingsText: { fontSize: 12, fontWeight: '600', color: C.success },

  // CTA
  ctaButton: { backgroundColor: C.violet, borderRadius: RADIUS.md, paddingVertical: 18, alignItems: 'center', marginBottom: 12, overflow: 'hidden' },
  ctaButtonText: { fontSize: 17, fontWeight: '800', color: '#fff' },
  trialButton: { borderWidth: 1, borderColor: tint(C.violet, 0.45), backgroundColor: tint(C.violet, 0.1), borderRadius: RADIUS.md, paddingVertical: 15, alignItems: 'center', marginBottom: 20 },
  trialButtonText: { fontSize: 15, fontWeight: '700', color: C.violetSoft },

  // Footer
  footerText: { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 12 },
  footerLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  footerLink: { fontSize: 13, color: C.blueSoft, fontWeight: '600' },
  footerDivider: { color: C.dim },
  bottomSpacer: { height: 40 },

  // Premium Active State
  premiumActiveContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  premiumActiveIcon: { width: 92, height: 92, borderRadius: 28, backgroundColor: tint(C.violet, 0.14), borderWidth: 1, borderColor: tint(C.violet, 0.35), alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  premiumActiveTitle: { ...TYPE.display, fontSize: 28, marginBottom: 8 },
  premiumActiveSubtitle: { fontSize: 15, color: C.muted, textAlign: 'center', marginBottom: 32 },
  primaryButton: { backgroundColor: C.violet, borderRadius: RADIUS.md, paddingVertical: 16, paddingHorizontal: 32 },
  primaryButtonText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
