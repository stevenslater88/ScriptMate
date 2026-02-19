import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform, Alert } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { AuthProvider } from '../contexts/AuthContext';
import { logError } from '../services/debugService';

// RevenueCat API Keys (from environment - no fallbacks)
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || '';
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY || '';

export default function RootLayout() {
  // Initialize RevenueCat on app start - with crash protection
  useEffect(() => {
    const initRevenueCat = async () => {
      // Skip on web
      if (Platform.OS === 'web') {
        console.log('[RevenueCat] Web platform - skipping initialization');
        return;
      }

      try {
        // IMPORTANT: Only enable verbose logging in true development
        // In release builds (including closed testing), use ERROR level to prevent debug dialogs
        if (__DEV__) {
          Purchases.setLogLevel(LOG_LEVEL.DEBUG);
        } else {
          // Production/closed testing: minimal logging, no debug UI
          Purchases.setLogLevel(LOG_LEVEL.ERROR);
        }

        // Platform-specific configuration with crash protection
        const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;
        
        if (!apiKey || apiKey.length < 10) {
          console.warn('[RevenueCat] Invalid or missing API key - subscriptions will be unavailable');
          return;
        }

        // Configure with production settings
        await Purchases.configure({
          apiKey,
          // Don't use observer mode - we handle purchases directly
          // This helps prevent simulated store errors
        });
        
        console.log(`[RevenueCat] ${Platform.OS} configured successfully (${__DEV__ ? 'DEV' : 'PROD'} mode)`);
        
      } catch (error) {
        // Log error but don't crash the app
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[RevenueCat] Configuration error:', errorMessage);
        logError('RevenueCat Init', error instanceof Error ? error : new Error(errorMessage));
        
        // Only show alert in development
        if (__DEV__) {
          Alert.alert(
            'Subscription Setup',
            'Unable to initialize subscriptions. In-app purchases may be unavailable.',
            [{ text: 'OK' }]
          );
        }
      }
    };

    // Wrap entire init in additional try-catch for extra safety
    try {
      initRevenueCat();
    } catch (outerError) {
      console.error('[RevenueCat] Critical init error:', outerError);
    }
  }, []);

  return (
    <AuthProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0a0a0f' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="signin" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="scripts" />
          <Stack.Screen name="upload" />
          <Stack.Screen name="premium" />
          <Stack.Screen name="stats" />
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
          <Stack.Screen name="support" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="terms" />
          <Stack.Screen name="script/[id]" />
          <Stack.Screen name="rehearsal/[id]" />
        </Stack>
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
});
