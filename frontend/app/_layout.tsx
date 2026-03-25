import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform, Alert, Text, TouchableOpacity } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { AuthProvider } from '../contexts/AuthContext';
import { logError } from '../services/debugService';
import { markRevenueCatConfigured } from '../services/revenuecat';
import { isDevTestMode } from '../services/devTestMode';
import { 
  logRevenueCatInitError, 
  updateOfferingsCache, 
  updateCustomerInfoCache,
  checkProductAvailability,
} from '../services/diagnosticsService';
import { initSentry, setSentryUserId, captureRevenueCatError } from '../services/sentryService';
import { AppConfig } from '../services/appConfig';
import { API_BASE_URL, BUILD_ID, getApiDiagnostics } from '../services/apiConfig';

// IMMEDIATE STARTUP LOG
console.log('APP STARTED');
console.log('FINAL API URL:', API_BASE_URL);

// BUILD FINGERPRINT — unique string to prove this code is in the compiled build.
// If you see this on the debug screen, the code is present. If not, the build is stale.
export const BUILD_FINGERPRINT = 'SM8-1108-OVERLAY';

export default function RootLayout() {
  const router = useRouter();

  // Initialize Sentry for crash reporting
  useEffect(() => {
    initSentry();
  }, []);

  // DIAGNOSTIC: Show alert with API config on app start (DEV builds only)
  useEffect(() => {
    const diag = getApiDiagnostics();
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('       SCRIPTM8 APP STARTED - DIAGNOSTIC INFO');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`BUILD_FINGERPRINT: ${BUILD_FINGERPRINT}`);
    console.log(`BUILD_ID:          ${diag.buildId}`);
    console.log(`API_BASE_URL:      ${diag.baseUrl}`);
    console.log(`CORRECT_DOMAIN:    ${diag.isCorrectDomain ? 'YES ✓' : 'NO ✗'}`);
    console.log(`AppConfig.URL:     ${AppConfig.BACKEND_URL}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Show visible alert with URL info (for debugging)
    if (__DEV__ || !diag.isCorrectDomain) {
      setTimeout(() => {
        Alert.alert(
          `Build ${BUILD_ID}`,
          `API: ${diag.baseUrl}\n\nCorrect: ${diag.isCorrectDomain ? 'YES ✓' : 'NO ✗ WRONG URL!'}\n\nFingerprint: ${BUILD_FINGERPRINT}`,
          [{ text: 'OK' }]
        );
      }, 1000);
    }
  }, []);

  // Debug log on startup — includes fingerprint to verify code is present
  useEffect(() => {
    console.log(`[ScriptM8] BUILD_FINGERPRINT: ${BUILD_FINGERPRINT}`);
    console.log(`[ScriptM8] Backend URL: ${AppConfig.BACKEND_URL}`);
    console.log(`[ScriptM8] API_BASE_URL: ${API_BASE_URL}`);
    isDevTestMode().then(dm => console.log(`[ScriptM8] Dev Test Mode: ${dm}`));
  }, []);

  // Initialize RevenueCat on app start
  // ZERO ABSTRACTION: API key is a literal string in this function body.
  // No imports, no resolution functions, no process.env, no Constants.expoConfig.
  useEffect(() => {
    const initRevenueCat = async () => {
      // Skip on web
      if (Platform.OS === 'web') {
        console.log('[RevenueCat] Web platform - skipping initialization');
        return;
      }

      try {
        if (__DEV__) {
          Purchases.setLogLevel(LOG_LEVEL.DEBUG);
        } else {
          Purchases.setLogLevel(LOG_LEVEL.ERROR);
        }

        // HARDCODED API KEY — no env var, no Constants, no resolve function.
        // This string literal is compiled directly into the JS bundle by Metro.
        const apiKey = Platform.OS === 'ios'
          ? 'appl_YOUR_IOS_KEY_HERE'
          : 'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT';
        
        console.log(`[RevenueCat] Platform: ${Platform.OS}, Key: ${apiKey.substring(0, 5)}***, Length: ${apiKey.length}, Fingerprint: ${BUILD_FINGERPRINT}`);

        if (!apiKey || apiKey.length < 10) {
          console.warn('[RevenueCat] Invalid or missing API key');
          logRevenueCatInitError('Invalid or missing API key');
          return;
        }

        // Configure RevenueCat
        await Purchases.configure({ apiKey });
        markRevenueCatConfigured();
        
        console.log(`[RevenueCat] ${Platform.OS} configured successfully (${__DEV__ ? 'DEV' : 'PROD'} mode)`);

        // Set user ID for Sentry tracking
        try {
          const appUserId = await Purchases.getAppUserID();
          if (appUserId) {
            setSentryUserId(appUserId);
          }
        } catch (e) {
          console.warn('[RevenueCat] Failed to get app user ID:', e);
        }

        // Pre-fetch offerings and cache them for diagnostics
        try {
          const offerings = await Purchases.getOfferings();
          updateOfferingsCache(offerings);
          
          // Check product availability
          const productCheck = await checkProductAvailability();
          if (!productCheck.allPresent) {
            console.warn('[RevenueCat] Missing products:', productCheck.missing);
          }
        } catch (offeringsError) {
          console.warn('[RevenueCat] Failed to fetch offerings:', offeringsError);
        }

        // Get customer info
        try {
          const customerInfo = await Purchases.getCustomerInfo();
          updateCustomerInfoCache(customerInfo);
        } catch (e) {
          console.warn('[RevenueCat] Failed to get customer info:', e);
        }
        
      } catch (error) {
        // Log error but don't crash the app
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[RevenueCat] Configuration error:', errorMessage);
        logError('RevenueCat Init', error instanceof Error ? error : new Error(errorMessage));
        logRevenueCatInitError(errorMessage);
        captureRevenueCatError(error instanceof Error ? error : new Error(errorMessage), {
          phase: 'initialization',
          platform: Platform.OS,
        });
        
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
      captureRevenueCatError(
        outerError instanceof Error ? outerError : new Error(String(outerError)),
        { phase: 'critical_init_failure' }
      );
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
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="auditions" />
          <Stack.Screen name="recall" />
          <Stack.Screen name="selftape" />
          <Stack.Screen name="script-parser" />
          <Stack.Screen name="acting-coach" />
          <Stack.Screen name="acting-feedback" />
          <Stack.Screen name="dialect-coach" />
          <Stack.Screen name="daily-drill" />
          <Stack.Screen name="voice-studio" />
          <Stack.Screen name="scene-partner" />
          <Stack.Screen name="debug" />
          <Stack.Screen name="diagnostics" />
          <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal' }} />
        </Stack>
        
        {/* DEBUG OVERLAY - ALWAYS VISIBLE ON TOP - NO CONDITIONS */}
        <View style={styles.debugOverlay}>
          <Text style={styles.debugTitle}>BUILD CHECK</Text>
          <Text style={styles.debugUrl}>API: {API_BASE_URL}</Text>
          <Text style={styles.debugBuild}>Build: {BUILD_ID}</Text>
          <TouchableOpacity 
            style={styles.diagButton}
            onPress={() => {
              try {
                router.push('/diagnostics');
              } catch (e) {
                Alert.alert('Nav Error', String(e));
              }
            }}
          >
            <Text style={styles.diagButtonText}>OPEN DIAGNOSTICS</Text>
          </TouchableOpacity>
        </View>
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  debugOverlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    padding: 15,
    borderRadius: 10,
    zIndex: 9999,
    elevation: 9999,
  },
  debugTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  debugUrl: {
    color: '#ffff00',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlign: 'center',
    marginBottom: 5,
  },
  debugBuild: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  debugButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  diagButton: {
    backgroundColor: '#00ff00',
    padding: 12,
    borderRadius: 5,
  },
  diagButtonText: {
    color: '#000',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 14,
  },
});
