import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import Purchases from 'react-native-purchases';
import { PREMIUM_ENTITLEMENT_ID } from '../services/revenuecat';

/**
 * Paywall Screen - Presents RevenueCat's native paywall
 * 
 * On native devices (iOS/Android), this will show the RevenueCat paywall
 * configured in your RevenueCat dashboard.
 * 
 * On web, it redirects to the custom premium screen.
 */
export default function PaywallScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    presentPaywall();
  }, []);

  const presentPaywall = async () => {
    // On web, redirect to custom premium screen
    if (Platform.OS === 'web') {
      router.replace('/premium');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Present the RevenueCat paywall
      const result = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: PREMIUM_ENTITLEMENT_ID,
      });

      console.log('[Paywall] Result:', result);

      switch (result) {
        case PAYWALL_RESULT.PURCHASED:
          Alert.alert(
            '🎉 Welcome to Premium!',
            'Thank you for subscribing. Enjoy all premium features!',
            [{ text: 'Start Rehearsing', onPress: () => router.back() }]
          );
          break;

        case PAYWALL_RESULT.RESTORED:
          Alert.alert(
            '✅ Purchases Restored',
            'Your premium subscription has been restored.',
            [{ text: 'Continue', onPress: () => router.back() }]
          );
          break;

        case PAYWALL_RESULT.NOT_PRESENTED:
          // User already has premium - go back
          router.back();
          break;

        case PAYWALL_RESULT.ERROR:
          setError('Something went wrong. Please try again.');
          break;

        case PAYWALL_RESULT.CANCELLED:
        default:
          // User dismissed paywall - go back
          router.back();
          break;
      }
    } catch (err) {
      console.error('[Paywall] Error:', err);
      setError('Failed to load subscription options.');
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading or error state
  if (Platform.OS !== 'web') {
    return (
      <SafeAreaView style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle" size={48} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={presentPaywall}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  // Web fallback - should redirect, but show loading just in case
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Redirecting...</Text>
      </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#6b7280',
    fontSize: 14,
  },
});
