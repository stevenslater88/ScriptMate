import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import * as Application from 'expo-application';

// Initialize Sentry
export const initSentry = () => {
  try {
    Sentry.init({
      dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 1.0,
      
      // Set release and environment
      release: `scriptmate@${Application.nativeApplicationVersion || '1.0.0'}`,
      dist: Application.nativeBuildVersion || '1',
      environment: __DEV__ ? 'development' : 'production',
      
      // Only report in production by default
      enabled: !__DEV__,
      
      // Attach stack traces
      attachStacktrace: true,
      
      // Configure before send hook
      beforeSend: (event) => {
        // Add platform info
        event.tags = {
          ...event.tags,
          platform: Platform.OS,
          build_number: Application.nativeBuildVersion || 'unknown',
        };
        
        return event;
      },
    });

    // Set initial context
    Sentry.setContext('app', {
      app_name: Application.applicationName || 'ScriptMate',
      app_version: Application.nativeApplicationVersion || 'unknown',
      build_number: Application.nativeBuildVersion || 'unknown',
      bundle_id: Application.applicationId || 'unknown',
    });

    console.log('[Sentry] Initialized successfully');
  } catch (error) {
    console.error('[Sentry] Failed to initialize:', error);
  }
};

// Set RevenueCat user ID
export const setSentryUserId = (userId: string) => {
  try {
    Sentry.setUser({ id: userId });
    Sentry.setTag('rc_app_user_id', userId);
  } catch (error) {
    console.error('[Sentry] Failed to set user:', error);
  }
};

// Capture RevenueCat error
export const captureRevenueCatError = (
  error: Error | string,
  context?: Record<string, unknown>
) => {
  try {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    Sentry.withScope((scope) => {
      scope.setTag('category', 'revenuecat');
      scope.setTag('error_type', 'iap');
      
      if (context) {
        scope.setContext('revenuecat', context);
      }
      
      Sentry.captureException(errorObj);
    });
  } catch (e) {
    console.error('[Sentry] Failed to capture RevenueCat error:', e);
  }
};

// Capture paywall error
export const capturePaywallError = (
  error: Error | string,
  paywallId?: string
) => {
  try {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    Sentry.withScope((scope) => {
      scope.setTag('category', 'paywall');
      scope.setTag('error_type', 'ui');
      
      if (paywallId) {
        scope.setTag('paywall_id', paywallId);
      }
      
      Sentry.captureException(errorObj);
    });
  } catch (e) {
    console.error('[Sentry] Failed to capture paywall error:', e);
  }
};

// Capture IAP error
export const captureIAPError = (
  error: Error | string,
  productId?: string,
  errorCode?: string
) => {
  try {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    Sentry.withScope((scope) => {
      scope.setTag('category', 'iap');
      scope.setTag('error_type', 'purchase');
      
      if (productId) {
        scope.setTag('product_id', productId);
      }
      if (errorCode) {
        scope.setTag('iap_error_code', errorCode);
      }
      
      Sentry.captureException(errorObj);
    });
  } catch (e) {
    console.error('[Sentry] Failed to capture IAP error:', e);
  }
};

// Capture generic error with tags
export const captureError = (
  error: Error | string,
  tags?: Record<string, string>,
  context?: Record<string, unknown>
) => {
  try {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    Sentry.withScope((scope) => {
      if (tags) {
        Object.entries(tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }
      
      if (context) {
        scope.setContext('additional', context);
      }
      
      Sentry.captureException(errorObj);
    });
  } catch (e) {
    console.error('[Sentry] Failed to capture error:', e);
  }
};

// Add breadcrumb for tracking user actions
export const addBreadcrumb = (
  message: string,
  category: string,
  data?: Record<string, unknown>
) => {
  try {
    Sentry.addBreadcrumb({
      message,
      category,
      level: 'info',
      data,
    });
  } catch (e) {
    console.error('[Sentry] Failed to add breadcrumb:', e);
  }
};

// Log info event
export const logEvent = (
  eventName: string,
  data?: Record<string, unknown>
) => {
  try {
    Sentry.addBreadcrumb({
      message: eventName,
      category: 'event',
      level: 'info',
      data,
    });
  } catch (e) {
    console.error('[Sentry] Failed to log event:', e);
  }
};

export default {
  initSentry,
  setSentryUserId,
  captureRevenueCatError,
  capturePaywallError,
  captureIAPError,
  captureError,
  addBreadcrumb,
  logEvent,
};
