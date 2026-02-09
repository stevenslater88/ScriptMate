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

const FREE_FEATURES = [
  { icon: 'document-text', text: '3 scripts max', included: true },
  { icon: 'mic', text: '1 AI voice', included: true },
  { icon: 'chatbubbles', text: 'Full Read & Cue modes', included: true },
  { icon: 'time', text: '5 rehearsals/day', included: true },
  { icon: 'trophy', text: 'Performance mode', included: false },
  { icon: 'videocam', text: 'Recording & playback', included: false },
  { icon: 'analytics', text: 'Smart line tracking', included: false },
  { icon: 'cloud', text: 'Cloud storage', included: false },
];

const PREMIUM_FEATURES = [
  { icon: 'infinite', text: 'Unlimited scripts', highlight: true },
  { icon: 'mic', text: '6 AI voices & accents', highlight: true },
  { icon: 'flash', text: 'All training modes', highlight: true },
  { icon: 'trophy', text: 'Performance mode', highlight: true },
  { icon: 'videocam', text: 'Recording & playback', highlight: true },
  { icon: 'analytics', text: 'Smart weak line tracking', highlight: true },
  { icon: 'cloud', text: 'Cloud storage', highlight: true },
  { icon: 'remove-circle', text: 'No ads', highlight: true },
  { icon: 'star', text: 'Priority support', highlight: false },
  { icon: 'rocket', text: 'Early access to features', highlight: false },
];

export default function PremiumScreen() {
  // RevenueCat hook for native platforms
  const {
    isConfigured: rcConfigured,
    isLoading: rcLoading,
    currentOffering,
    isPremium: rcIsPremium,
    monthlyPackage,
    yearlyPackage,
    lifetimePackage,
    purchase,
    restore,
    presentPaywall,
    error: rcError,
  } = useRevenueCat();

  // Fallback store for web/development
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

  // Use RevenueCat on native, fallback to store on web
  const isNative = Platform.OS !== 'web';
  const isPremium = isNative ? rcIsPremium : storeIsPremium;
  const error = isNative ? rcError : storeError;

  // Fallback pricing from store

  // Fallback pricing from store
  const monthlyPlan = subscriptionPlans?.monthly;
  const yearlyPlan = subscriptionPlans?.yearly;

  // Auto-detect region on mount (for fallback pricing)
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
        if (deviceRegion === 'GB') {
          pricingRegion = 'GB';
        } else if (EU_COUNTRIES.includes(deviceRegion)) {
          pricingRegion = 'EU';
        }
        
        setRegion(pricingRegion);
      } catch (e) {
        fetchSubscriptionPlans('US');
      }
    };
    
    detectRegion();
  }, []);

  // Handle purchase with RevenueCat or fallback
  const handlePurchase = async (packageType: 'monthly' | 'yearly' | 'lifetime') => {
    setLoading(true);

    if (isNative && offerings) {
      // Use RevenueCat for native platforms
      let selectedPackage: PurchasesPackage | undefined;
      if (packageType === 'monthly') {
        selectedPackage = monthlyPackage;
      } else if (packageType === 'yearly') {
        selectedPackage = yearlyPackage;
      } else if (packageType === 'lifetime') {
        selectedPackage = lifetimePackage;
      }
      
      if (!selectedPackage) {
        Alert.alert('Error', 'Selected plan not available. Please try again.');
        setLoading(false);
        return;
      }

      const result = await purchase(selectedPackage);
      
      if (result.success) {
        Alert.alert(
          'Welcome to Premium!',
          'Thank you for subscribing. Enjoy all premium features!',
          [{ text: 'Start Rehearsing', onPress: () => router.back() }]
        );
      } else if (!result.cancelled) {
        Alert.alert('Purchase Failed', result.error || 'Please try again.');
      }
    } else {
      // Fallback for web/development
      const success = await subscribe(packageType);
      
      if (success) {
        Alert.alert(
          'Welcome to Premium!',
          'Thank you for subscribing. Enjoy all premium features!',
          [{ text: 'Start Rehearsing', onPress: () => router.back() }]
        );
      } else {
        Alert.alert('Error', storeError || 'Failed to subscribe');
      }
    }
    
    setLoading(false);
  };

  // Handle trial start
  const handleStartTrial = async () => {
    if (user?.trial_used) {
      Alert.alert('Trial Used', 'You have already used your free trial. Subscribe to continue with Premium.');
      return;
    }
    
    setLoading(true);
    const success = await startTrial();
    setLoading(false);
    
    if (success) {
      Alert.alert(
        'Welcome to Premium!',
        'Your 3-day free trial has started. Enjoy all premium features!',
        [{ text: 'Start Rehearsing', onPress: () => router.back() }]
      );
    } else {
      Alert.alert('Error', storeError || 'Failed to start trial');
    }
  };

  // Handle restore purchases
  const handleRestore = async () => {
    if (!isNative) {
      Alert.alert('Restore Purchases', 'Please contact support to restore your subscription.');
      return;
    }

    setLoading(true);
    const result = await restore();
    setLoading(false);

    if (result.success) {
      Alert.alert(
        'Purchases Restored!',
        'Your premium subscription has been restored.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } else {
      Alert.alert('No Purchases Found', result.error || 'No previous purchases to restore.');
    }
  };

  // Get display price - prefer RevenueCat, fallback to store
  const getMonthlyPrice = (): string => {
    if (isNative && monthlyPackage) {
      return monthlyPackage.product.priceString;
    }
    return `${currencySymbol}${monthlyPlan?.price || 9.99}`;
  };

  const getYearlyPrice = (): string => {
    if (isNative && yearlyPackage) {
      return yearlyPackage.product.priceString;
    }
    return `${currencySymbol}${yearlyPlan?.price || 79.99}`;
  };

  const getYearlyMonthlyPrice = (): string => {
    if (isNative && yearlyPackage) {
      const yearlyPrice = yearlyPackage.product.price;
      return `${yearlyPackage.product.currencyCode === 'USD' ? '$' : yearlyPackage.product.currencyCode === 'GBP' ? '£' : '€'}${(yearlyPrice / 12).toFixed(2)}`;
    }
    return `${currencySymbol}${((yearlyPlan?.price || 79.99) / 12).toFixed(2)}`;
  };

  const getLifetimePrice = (): string => {
    if (isNative && lifetimePackage) {
      return lifetimePackage.product.priceString;
    }
    // Fallback lifetime price (typically 2-3x yearly)
    return `${currencySymbol}199.99`;
  };

  // Check if free trial is available
  const hasFreeTrial = (): boolean => {
    if (isNative && yearlyPackage) {
      return yearlyPackage.product.introPrice !== null;
    }
    return !user?.trial_used;
  };

  // Premium active view
  if (isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Premium</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.premiumActiveContainer}>
          <View style={styles.premiumBadge}>
            <Ionicons name="star" size={48} color="#f59e0b" />
          </View>
          <Text style={styles.premiumActiveTitle}>You're Premium!</Text>
          <Text style={styles.premiumActiveSubtitle}>
            Enjoy unlimited access to all features
          </Text>
          {user?.subscription_end && (
            <Text style={styles.renewalText}>
              Renews: {new Date(user.subscription_end).toLocaleDateString()}
            </Text>
          )}
          <TouchableOpacity style={styles.manageButton} onPress={() => router.back()}>
            <Text style={styles.manageButtonText}>Back to App</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Go Premium</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.crownContainer}>
            <Ionicons name="star" size={48} color="#f59e0b" />
          </View>
          <Text style={styles.heroTitle}>Unlock Your Full Potential</Text>
          <Text style={styles.heroSubtitle}>
            Get unlimited rehearsals, all AI voices, and advanced features
          </Text>
        </View>

        {/* Region Indicator (for web fallback) */}
        {!isNative && (
          <TouchableOpacity 
            style={styles.regionIndicator} 
            onPress={() => {
              const regions = ['US', 'GB', 'EU'];
              const currentIndex = regions.indexOf(region);
              const nextRegion = regions[(currentIndex + 1) % regions.length];
              setRegion(nextRegion);
            }}
          >
            <Ionicons name="globe-outline" size={16} color="#9ca3af" />
            <Text style={styles.regionText}>
              {region === 'GB' ? '🇬🇧 UK' : region === 'EU' ? '🇪🇺 Europe' : '🇺🇸 USA'} • {currencySymbol}
            </Text>
            <Ionicons name="chevron-down" size={14} color="#6b7280" />
          </TouchableOpacity>
        )}

        {/* Plan Selection */}
        <View style={styles.planSection}>
          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'yearly' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('yearly')}
          >
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsText}>BEST VALUE</Text>
            </View>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>Yearly</Text>
              {selectedPlan === 'yearly' && (
                <Ionicons name="checkmark-circle" size={24} color="#6366f1" />
              )}
            </View>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>{getYearlyPrice()}</Text>
              <Text style={styles.planPeriod}>/year</Text>
            </View>
            <Text style={styles.planMonthly}>
              Just {getYearlyMonthlyPrice()}/month
            </Text>
            {hasFreeTrial() && (
              <View style={styles.trialBadge}>
                <Ionicons name="gift" size={14} color="#10b981" />
                <Text style={styles.trialBadgeText}>3-day free trial</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.planCard, selectedPlan === 'monthly' && styles.planCardSelected]}
            onPress={() => setSelectedPlan('monthly')}
          >
            <View style={styles.planHeader}>
              <Text style={styles.planName}>Monthly</Text>
              {selectedPlan === 'monthly' && (
                <Ionicons name="checkmark-circle" size={24} color="#6366f1" />
              )}
            </View>
            <View style={styles.planPriceRow}>
              <Text style={styles.planPrice}>{getMonthlyPrice()}</Text>
              <Text style={styles.planPeriod}>/month</Text>
            </View>
            <Text style={styles.planMonthly}>Flexibility to cancel anytime</Text>
          </TouchableOpacity>

          {/* Lifetime Option */}
          {(lifetimePackage || !isNative) && (
            <TouchableOpacity
              style={[styles.planCard, styles.lifetimeCard, selectedPlan === 'lifetime' && styles.planCardSelected]}
              onPress={() => setSelectedPlan('lifetime')}
            >
              <View style={styles.lifetimeBadge}>
                <Ionicons name="diamond" size={12} color="#fff" />
                <Text style={styles.lifetimeBadgeText}>ONE-TIME</Text>
              </View>
              <View style={styles.planHeader}>
                <Text style={styles.planName}>Lifetime</Text>
                {selectedPlan === 'lifetime' && (
                  <Ionicons name="checkmark-circle" size={24} color="#6366f1" />
                )}
              </View>
              <View style={styles.planPriceRow}>
                <Text style={styles.planPrice}>{getLifetimePrice()}</Text>
                <Text style={styles.planPeriod}> once</Text>
              </View>
              <Text style={styles.planMonthly}>Pay once, own forever</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Features List */}
        <View style={styles.featuresSection}>
          <Text style={styles.featuresTitle}>Everything in Premium</Text>
          {PREMIUM_FEATURES.map((feature, index) => (
            <View key={index} style={styles.featureItem}>
              <View style={[styles.featureIcon, feature.highlight && styles.featureIconHighlight]}>
                <Ionicons
                  name={feature.icon as any}
                  size={18}
                  color={feature.highlight ? '#6366f1' : '#9ca3af'}
                />
              </View>
              <Text style={[styles.featureText, feature.highlight && styles.featureTextHighlight]}>
                {feature.text}
              </Text>
            </View>
          ))}
        </View>

        {/* Restore Purchases */}
        <TouchableOpacity style={styles.restoreButton} onPress={handleRestore}>
          <Text style={styles.restoreButtonText}>Restore Purchases</Text>
        </TouchableOpacity>

        {/* RevenueCat Paywall Option (Native only) */}
        {isNative && rcConfigured && (
          <TouchableOpacity 
            style={styles.paywallButton} 
            onPress={async () => {
              const purchased = await presentPaywall();
              if (purchased) {
                Alert.alert(
                  'Welcome to Premium!',
                  'Thank you for subscribing. Enjoy all premium features!',
                  [{ text: 'OK', onPress: () => router.back() }]
                );
              }
            }}
          >
            <Ionicons name="pricetag" size={16} color="#6366f1" />
            <Text style={styles.paywallButtonText}>View All Offers</Text>
          </TouchableOpacity>
        )}

        {/* Legal Links */}
        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => router.push('/terms')}>
            <Text style={styles.legalLinkText}>Terms of Service</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>•</Text>
          <TouchableOpacity onPress={() => router.push('/privacy')}>
            <Text style={styles.legalLinkText}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Subscribe Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
          onPress={() => handlePurchase(selectedPlan)}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.subscribeButtonText}>
              {selectedPlan === 'lifetime'
                ? `Buy Lifetime for ${getLifetimePrice()}`
                : hasFreeTrial() && selectedPlan === 'yearly'
                  ? 'Start Free Trial'
                  : `Subscribe for ${selectedPlan === 'yearly' ? getYearlyPrice() : getMonthlyPrice()}`}
            </Text>
          )}
        </TouchableOpacity>
        <Text style={styles.termsText}>
          {selectedPlan === 'lifetime'
            ? 'One-time purchase. No subscription required.'
            : hasFreeTrial() && selectedPlan === 'yearly'
              ? '3-day free trial, then auto-renews. Cancel anytime.'
              : 'Subscription auto-renews. Cancel anytime.'}
        </Text>
      </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  placeholder: {
    width: 36,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  crownContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
  },
  regionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: 16,
  },
  regionText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '500',
  },
  planSection: {
    marginBottom: 24,
  },
  planCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#2a2a3e',
    position: 'relative',
    overflow: 'hidden',
  },
  planCardSelected: {
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  lifetimeCard: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderColor: '#8b5cf6',
  },
  lifetimeBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#8b5cf6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lifetimeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  savingsBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#10b981',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  savingsText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  planPrice: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  planPeriod: {
    fontSize: 16,
    color: '#9ca3af',
    marginLeft: 4,
  },
  planMonthly: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  trialBadgeText: {
    fontSize: 13,
    color: '#10b981',
    fontWeight: '500',
  },
  featuresSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureIconHighlight: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  featureText: {
    fontSize: 15,
    color: '#9ca3af',
    flex: 1,
  },
  featureTextHighlight: {
    color: '#e5e7eb',
  },
  restoreButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  restoreButtonText: {
    color: '#6366f1',
    fontSize: 15,
    fontWeight: '500',
  },
  paywallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 4,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    marginHorizontal: 40,
    borderRadius: 10,
  },
  paywallButtonText: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '500',
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  legalLinkText: {
    color: '#6b7280',
    fontSize: 13,
  },
  legalSeparator: {
    color: '#6b7280',
    marginHorizontal: 8,
  },
  bottomSpacer: {
    height: 100,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a0a0f',
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  subscribeButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  subscribeButtonDisabled: {
    opacity: 0.7,
  },
  subscribeButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  termsText: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  premiumActiveContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  premiumBadge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  premiumActiveTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  premiumActiveSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  renewalText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
  },
  manageButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  manageButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
