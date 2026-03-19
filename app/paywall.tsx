import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

/**
 * Paywall Screen - Redirects to the custom ScriptM8 premium screen.
 * 
 * Previously used RevenueCatUI.presentPaywallIfNeeded() which showed
 * the RevenueCat SDK's native paywall (with template/placeholder content).
 * Now all paywall paths go through our custom /premium screen.
 */
export default function PaywallScreen() {
  useEffect(() => {
    router.replace('/premium');
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading...</Text>
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
});
