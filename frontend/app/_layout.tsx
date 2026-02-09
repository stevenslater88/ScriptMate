import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// RevenueCat API Keys
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || 'test_DoejpADdRIFOhYLImArlqaAfLpz';
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY || 'test_DoejpADdRIFOhYLImArlqaAfLpz';

export default function RootLayout() {
  // Initialize RevenueCat on app start
  useEffect(() => {
    const initRevenueCat = async () => {
      // Skip on web
      if (Platform.OS === 'web') {
        console.log('[RevenueCat] Web platform - skipping initialization');
        return;
      }

      try {
        // Enable verbose logging in development
        if (__DEV__) {
          Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
        }

        // Platform-specific configuration
        if (Platform.OS === 'ios') {
          await Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
          console.log('[RevenueCat] iOS configured successfully');
        } else if (Platform.OS === 'android') {
          await Purchases.configure({ apiKey: REVENUECAT_ANDROID_API_KEY });
          console.log('[RevenueCat] Android configured successfully');
        }
      } catch (error) {
        console.error('[RevenueCat] Configuration error:', error);
      }
    };

    initRevenueCat();
  }, []);

  return (
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
        <Stack.Screen name="scripts" />
        <Stack.Screen name="upload" />
        <Stack.Screen name="premium" />
        <Stack.Screen name="support" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="terms" />
        <Stack.Screen name="script/[id]" />
        <Stack.Screen name="rehearsal/[id]" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
});
