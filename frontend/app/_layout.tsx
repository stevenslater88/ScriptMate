import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
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
import { DebugLog } from '../services/debugLogService';

// BUILD FINGERPRINT — unique string to prove this code is in the compiled build.
// If you see this on the debug screen, the code is present. If not, the build is stale.
export const BUILD_FINGERPRINT = 'SM8-1110-QA';

// ─── STABLE REVENUECAT APP USER ID ────────────────────────────────────
// 2026-02 Physical QA Blocker — the previous build called
// `Purchases.configure({ apiKey })` with no appUserID, so RevenueCat
// generated a brand-new `$RCAnonymousID:<uuid>` on every reinstall.
// That broke restorePurchases(): the Google Play subscription stays
// attached to the ORIGINAL anonymous id, and the fresh install's new
// anonymous id has no entitlements → "No Purchases Found".
//
// Fix: use the same `device_id` the rest of the app already treats as
// the user identifier (same key as `store/scriptStore.ts::getDeviceId`,
// and the key the backend expects as `revenuecat_app_user_id`). This
// is stable across normal app restarts.
//
// LIMITATION — intentionally documented: AsyncStorage is wiped on
// uninstall / Clear App Data. A reinstall will mint a new device_id
// (and therefore a new RC id). Recovering a subscription attached to
// the previous device_id requires either (a) RevenueCat dashboard
// transfer_behavior = TRANSFER_TO_CURRENT_USER, or (b) a stable
// cross-install login (Google Sign-In) which is out of scope for
// this patch per the standing "no new auth architecture" rule.
async function getStableRevenueCatAppUserId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem('device_id');
    if (existing) return existing;
    // First launch — mint a device id with the same shape used by
    // scriptStore so a later getDeviceId() call reads this very row.
    const uniq = Device.modelId || Device.deviceName || 'unknown';
    const fresh = `${uniq}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem('device_id', fresh);
    return fresh;
  } catch {
    // AsyncStorage unavailable (edge case) — return a fallback so the
    // RC configure call still succeeds; the next launch will retry.
    return `fallback-${Date.now()}`;
  }
}

// ─── GLOBAL ERROR HANDLERS ───────────────────────────────────────────────
// Install once at module load. Captures uncaught JS errors and unhandled
// promise rejections so they appear in the diagnostic report BEFORE the
// app crashes. If the app does crash natively, the last error is still
// persisted via DebugLog.addLog -> AsyncStorage.
let globalHandlersInstalled = false;
function installGlobalHandlers() {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  // 1. JS engine uncaught errors
  try {
    // @ts-ignore - ErrorUtils exists on RN globals
    const errorUtils = (global as any).ErrorUtils;
    if (errorUtils?.setGlobalHandler) {
      const prev = errorUtils.getGlobalHandler ? errorUtils.getGlobalHandler() : null;
      errorUtils.setGlobalHandler((err: any, isFatal: boolean) => {
        try {
          DebugLog.errorCaught('GLOBAL_JS_ERROR', err, { isFatal: !!isFatal });
        } catch { /* never let logging crash */ }
        // Delegate to original handler so RedBox / crash reporting still fires
        if (typeof prev === 'function') {
          try { prev(err, isFatal); } catch { /* ignore */ }
        }
      });
    }
  } catch { /* ignore */ }

  // 2. Unhandled promise rejections
  try {
    // @ts-ignore - HermesInternal exists on Hermes engine
    if (typeof (global as any).HermesInternal !== 'undefined') {
      // Hermes: react-native ships promise/setimmediate/rejection-tracking
      // We hook via the global "unhandledrejection" event when available.
      // Fallback: just log via ErrorUtils above.
    }
    // Best-effort: hook the Promise.prototype for tracking
    // (React Native's rejection tracker will call our handler.)
    // @ts-ignore
    if (typeof (global as any).addEventListener === 'function') {
      // @ts-ignore
      (global as any).addEventListener('unhandledrejection', (event: any) => {
        try {
          const reason = event?.reason || event;
          DebugLog.errorCaught('UNHANDLED_PROMISE_REJECTION', reason);
        } catch { /* ignore */ }
      });
    }
  } catch { /* ignore */ }
}

installGlobalHandlers();

export default function RootLayout() {
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
  //
  // 2026-02 Overnight RC investigation (S23 Ultra "No Purchases Found"):
  // the physical diagnostic report contained ZERO RevenueCat events.
  // The `rcDebugLog` helper mirrors every operational step into
  // `DebugLog` so the next exported report shows the exact point
  // where configure / logIn / offerings / customerInfo breaks.
  // Behaviour is unchanged — the helper is a wrapper around
  // `DebugLog.log('PURCHASE_EVENT', 'RevenueCat', ...)` and swallows
  // its own errors so it cannot destabilise RC init.
  const rcDebugLog = (event: string, metadata?: Record<string, unknown>): void => {
    try {
      DebugLog.log('PURCHASE_EVENT', 'RevenueCat', event, metadata);
    } catch { /* never crash init */ }
  };
  useEffect(() => {
    const initRevenueCat = async () => {
      // Skip on web
      if (Platform.OS === 'web') {
        console.log('[RevenueCat] Web platform - skipping initialization');
        rcDebugLog('INIT_SKIPPED_WEB', { platform: Platform.OS });
        return;
      }

      rcDebugLog('INIT_START', {
        platform: Platform.OS,
        buildFingerprint: BUILD_FINGERPRINT,
        buildId: BUILD_ID,
      });

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
          rcDebugLog('INIT_INVALID_API_KEY', {
            platform: Platform.OS,
            keyLength: apiKey?.length ?? 0,
          });
          logRevenueCatInitError('Invalid or missing API key');
          return;
        }

        // Configure RevenueCat with the stable, device-persisted app
        // user id so purchases survive app restarts and are picked up
        // by restorePurchases() under the SAME identity the backend
        // uses for /revenuecat/sync. Idempotent on normal relaunch:
        // the deviceId is read from the same AsyncStorage row every
        // time, so the RC customer never flaps.
        const stableAppUserId = await getStableRevenueCatAppUserId();
        rcDebugLog('CONFIGURE_START', {
          platform: Platform.OS,
          apiKeyPrefix: apiKey.substring(0, 5),
          apiKeyLength: apiKey.length,
          stableAppUserId,
        });
        await Purchases.configure({ apiKey, appUserID: stableAppUserId });
        markRevenueCatConfigured();
        rcDebugLog('CONFIGURE_SUCCESS', { stableAppUserId });

        // Idempotency safety net: on some SDK versions `configure`
        // is a no-op when called twice, so if a previous launch had
        // already configured anonymously, the current RC customer
        // may still be `$RCAnonymousID:*`. In that case issue a one
        // -shot `logIn(stableAppUserId)` to alias the anonymous
        // subscriber onto the stable id (RC's alias semantics
        // migrate the anonymous purchases automatically).
        try {
          const currentId = await Purchases.getAppUserID();
          rcDebugLog('APPUSERID_AFTER_CONFIGURE', {
            currentId,
            stableAppUserId,
            matchesStable: currentId === stableAppUserId,
            isAnonymous: typeof currentId === 'string' && currentId.startsWith('$RCAnonymousID'),
          });
          if (currentId && currentId !== stableAppUserId) {
            console.log(`[RevenueCat] Aliasing anonymous ${currentId.substring(0, 20)}... -> stable id`);
            rcDebugLog('LOGIN_ALIAS_START', { fromId: currentId, toId: stableAppUserId });
            const loginResult = await Purchases.logIn(stableAppUserId);
            rcDebugLog('LOGIN_ALIAS_RESULT', {
              created: loginResult.created,
              resolvedAppUserId: loginResult.customerInfo?.originalAppUserId,
              activeEntitlementIds: Object.keys(loginResult.customerInfo?.entitlements?.active || {}),
            });
          }
        } catch (loginErr) {
          console.warn('[RevenueCat] logIn fallback failed (non-fatal):', loginErr);
          rcDebugLog('LOGIN_ALIAS_ERROR', {
            errorMessage: loginErr instanceof Error ? loginErr.message : String(loginErr),
          });
        }

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

          const currentOfferingId = offerings.current?.identifier;
          const currentPkgs = offerings.current?.availablePackages?.map(p => ({
            packageId: p.identifier,
            productId: p.product?.identifier,
            priceString: p.product?.priceString,
            subscriptionPeriod: p.product?.subscriptionPeriod,
          })) ?? [];
          rcDebugLog('OFFERINGS_LOADED', {
            currentOfferingId,
            currentPackagesCount: currentPkgs.length,
            currentPackages: currentPkgs,
            allOfferingIds: Object.keys(offerings.all || {}),
          });

          // Check product availability
          const productCheck = await checkProductAvailability();
          if (!productCheck.allPresent) {
            console.warn('[RevenueCat] Missing products:', productCheck.missing);
            rcDebugLog('PRODUCTS_MISSING', { missing: productCheck.missing });
          }
        } catch (offeringsError) {
          console.warn('[RevenueCat] Failed to fetch offerings:', offeringsError);
          rcDebugLog('OFFERINGS_ERROR', {
            errorMessage: offeringsError instanceof Error ? offeringsError.message : String(offeringsError),
          });
        }

        // Get customer info
        try {
          const customerInfo = await Purchases.getCustomerInfo();
          updateCustomerInfoCache(customerInfo);
          rcDebugLog('CUSTOMERINFO_LOADED', {
            originalAppUserId: customerInfo.originalAppUserId,
            activeEntitlementIds: Object.keys(customerInfo.entitlements?.active || {}),
            allEntitlementIds: Object.keys(customerInfo.entitlements?.all || {}),
            activeSubscriptionsCount: Array.isArray(customerInfo.activeSubscriptions)
              ? customerInfo.activeSubscriptions.length
              : 0,
            activeSubscriptions: Array.isArray(customerInfo.activeSubscriptions)
              ? customerInfo.activeSubscriptions
              : [],
            firstSeen: customerInfo.firstSeen,
            requestDate: customerInfo.requestDate,
          });
        } catch (e) {
          console.warn('[RevenueCat] Failed to get customer info:', e);
          rcDebugLog('CUSTOMERINFO_ERROR', {
            errorMessage: e instanceof Error ? e.message : String(e),
          });
        }
        
      } catch (error) {
        // Log error but don't crash the app
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[RevenueCat] Configuration error:', errorMessage);
        rcDebugLog('INIT_ERROR', { errorMessage });
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
          <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal' }} />
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
