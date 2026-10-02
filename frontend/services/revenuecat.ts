import { Platform } from 'react-native';
import Purchases, {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
  PurchasesError,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';
import { AppConfig } from './appConfig';
import { DebugLog } from './debugLogService';

// 2026-02 Overnight RC investigation (S23 Ultra "No Purchases Found"):
// the physical diagnostic report contained ZERO RevenueCat events —
// the entire RC chain previously logged only via `console.log`
// (logcat-only) and `Sentry.addBreadcrumb` (dashboard-only), neither
// of which is included in `DebugLog.getLogs()` → `RECENT LOG` in the
// exported ChatGPT report. These `DebugLog.log('PURCHASE_EVENT', ...)`
// calls are PURELY ADDITIVE instrumentation: they do not change any
// RC SDK behaviour, do not add network calls, and `DebugLog` already
// masks `apiKey` / `token` / `purchase_token` / `receipt` fields at
// write time. See
// `backend/tests/test_revenuecat_debuglog_instrumentation_feb2026.py`
// for the regression lock.
const _rcLog = (event: string, metadata?: Record<string, unknown>): void => {
  try {
    DebugLog.log('PURCHASE_EVENT', 'RevenueCat', event, metadata);
  } catch {
    // DebugLog must never crash the RC chain; swallow silently.
  }
};

// RevenueCat API Keys — resolved from centralized config (env → extra → hardcoded)
const REVENUECAT_APPLE_API_KEY = AppConfig.REVENUECAT_APPLE_API_KEY;
const REVENUECAT_GOOGLE_API_KEY = AppConfig.REVENUECAT_GOOGLE_API_KEY;

// Entitlement identifier that unlocks premium features
// MUST match the entitlement identifier configured in the RevenueCat
// dashboard byte-for-byte. Dashboard identifier (verified Feb 2026):
// "ScriptMate Pro". Brand/UI copy may still read "ScriptM8 Pro" —
// that is marketing, not an entitlement reference.
export const PREMIUM_ENTITLEMENT_ID = 'ScriptMate Pro';

// Product identifiers (must match RevenueCat dashboard)
export const PRODUCT_IDS = {
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  LIFETIME: 'lifetime',
} as const;

// Track initialization state
let isConfigured = false;

/**
 * Mark RevenueCat as configured (called from _layout.tsx after successful configure)
 */
export const markRevenueCatConfigured = (): void => {
  isConfigured = true;
};

/**
 * Check if RevenueCat is actually configured and ready to use
 */
export const isRevenueCatConfigured = (): boolean => {
  if (Platform.OS === 'web') return false;
  return isConfigured;
};

/**
 * Configure RevenueCat SDK (called from _layout.tsx)
 * This is a fallback - primary init is in _layout.tsx
 */
export const configureRevenueCat = async (appUserID?: string): Promise<void> => {
  // Skip on web
  if (Platform.OS === 'web') {
    console.log('[RevenueCat] Web platform - skipping configuration');
    return;
  }

  // SDK is already configured in _layout.tsx
  // This function is kept for compatibility
  console.log('[RevenueCat] SDK should already be configured in _layout.tsx');
};

/**
 * Login user with custom ID (useful for cross-platform sync)
 */
export const loginUser = async (appUserID: string): Promise<CustomerInfo> => {
  if (!isRevenueCatConfigured()) {
    throw new Error('RevenueCat not configured');
  }

  const { customerInfo } = await Purchases.logIn(appUserID);
  console.log('[RevenueCat] User logged in:', appUserID);
  return customerInfo;
};

/**
 * Logout user (resets to anonymous)
 */
export const logoutUser = async (): Promise<CustomerInfo> => {
  if (!isRevenueCatConfigured()) {
    throw new Error('RevenueCat not configured');
  }

  const customerInfo = await Purchases.logOut();
  console.log('[RevenueCat] User logged out');
  return customerInfo;
};

/**
 * Get current customer info
 */
export const getCustomerInfo = async (): Promise<CustomerInfo> => {
  if (!isRevenueCatConfigured()) {
    throw new Error('RevenueCat not configured');
  }

  return await Purchases.getCustomerInfo();
};

/**
 * Check if user has active premium entitlement
 */
export const checkPremiumAccess = async (): Promise<boolean> => {
  if (!isRevenueCatConfigured()) {
    return false;
  }

  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
  } catch (error) {
    console.error('[RevenueCat] Error checking premium:', error);
    return false;
  }
};

/**
 * Get premium entitlement details
 */
export const getPremiumEntitlement = async () => {
  if (!isRevenueCatConfigured()) {
    return null;
  }

  const customerInfo = await Purchases.getCustomerInfo();
  return customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] || null;
};

/**
 * Get all available offerings
 */
export const getOfferings = async (): Promise<PurchasesOfferings> => {
  if (!isRevenueCatConfigured()) {
    throw new Error('RevenueCat not configured');
  }

  return await Purchases.getOfferings();
};

/**
 * Get current offering
 */
export const getCurrentOffering = async () => {
  const offerings = await getOfferings();
  return offerings.current;
};

/**
 * Purchase result interface
 */
export interface PurchaseResult {
  success: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
  errorCode?: PURCHASES_ERROR_CODE;
  cancelled?: boolean;
  restored?: boolean;
}

/**
 * Purchase a package.
 *
 * 2026-02: when Google Play / RevenueCat returns a "product already
 * owned" error (typically because the user previously subscribed on
 * this same Play account and the backend row is stale, OR because the
 * SDK's cached customerInfo missed the entitlement) we automatically
 * invoke `restorePurchases()` EXACTLY ONCE and surface the restore
 * outcome instead of the raw error. This prevents the user from
 * seeing "You already own this product" with no recovery path.
 *
 * The recovery is strictly single-shot — the recursive call uses
 * `_isAutoRestoreRetry = true` so restore itself never attempts a
 * further purchase/restore chain. Normal purchases continue
 * unchanged.
 */
export const purchasePackage = async (
  pkg: PurchasesPackage,
  _isAutoRestoreRetry: boolean = false,
): Promise<PurchaseResult> => {
  if (!isRevenueCatConfigured()) {
    return { success: false, error: 'RevenueCat not configured' };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    
    // Verify entitlement is active
    const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
    
    if (isPremium) {
      console.log('[RevenueCat] Purchase successful');
      return { success: true, customerInfo };
    } else {
      return { 
        success: false, 
        error: 'Purchase completed but entitlement not granted. Please contact support.',
        customerInfo 
      };
    }
  } catch (error) {
    const purchaseError = error as PurchasesError;
    
    // Handle specific error types
    if (purchaseError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      console.log('[RevenueCat] Purchase cancelled by user');
      return { success: false, cancelled: true, errorCode: purchaseError.code };
    }

    // 2026-02 Auto-recovery: Google Play says the product is already
    // owned. Try `restorePurchases()` once to re-attach the existing
    // entitlement to the current RC customer. Guarded so we never
    // recurse — the retry flag is only set by this branch.
    const isAlreadyOwned =
      purchaseError.code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR ||
      purchaseError.code === PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR;
    if (isAlreadyOwned && !_isAutoRestoreRetry) {
      console.log('[RevenueCat] Purchase reported already-owned — attempting one-shot restore');
      _rcLog('PURCHASE_ALREADY_OWNED_AUTO_RESTORE_TRIGGERED', {
        productId: pkg.product?.identifier,
        packageId: pkg.identifier,
        errorCode: purchaseError.code,
      });
      try {
        const restored = await restorePurchases();
        if (restored.success && restored.restored && restored.customerInfo) {
          console.log('[RevenueCat] Auto-restore after already-owned succeeded');
          return {
            success: true,
            customerInfo: restored.customerInfo,
            restored: true,
          };
        }
        // Restore ran but found nothing — surface a helpful hint
        // rather than the raw "already own this product" message.
        return {
          success: false,
          error:
            restored.error ||
            'This subscription is attached to a different account. Try signing in with the Google account you originally purchased with.',
          errorCode: purchaseError.code,
        };
      } catch (restoreErr) {
        console.warn('[RevenueCat] Auto-restore after already-owned failed', restoreErr);
        // Fall through to the original error path.
      }
    }

    console.error('[RevenueCat] Purchase error:', purchaseError.message);
    
    // Map error codes to user-friendly messages
    const errorMessages: Record<string, string> = {
      [PURCHASES_ERROR_CODE.NETWORK_ERROR]: 'Network error. Please check your connection.',
      [PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR]: 'App Store error. Please try again later.',
      [PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR]: 'Purchases not allowed on this device.',
      [PURCHASES_ERROR_CODE.PURCHASE_INVALID_ERROR]: 'Invalid purchase. Please try again.',
      [PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR]: 'You already own this product.',
      [PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR]: 'Receipt already in use by another account.',
      [PURCHASES_ERROR_CODE.MISSING_RECEIPT_FILE_ERROR]: 'Receipt not found. Please try again.',
      [PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR]: 'Invalid credentials. Please re-login.',
      [PURCHASES_ERROR_CODE.INELIGIBLE_ERROR]: 'Not eligible for this offer.',
    };

    return {
      success: false,
      error: errorMessages[purchaseError.code] || purchaseError.message,
      errorCode: purchaseError.code,
    };
  }
};

/**
 * Restore previous purchases
 */
export const restorePurchases = async (): Promise<PurchaseResult> => {
  if (!isRevenueCatConfigured()) {
    _rcLog('RESTORE_ABORTED', { reason: 'rc_not_configured' });
    return { success: false, error: 'RevenueCat not configured' };
  }

  _rcLog('RESTORE_START', {});
  try {
    const customerInfo = await Purchases.restorePurchases();
    const activeEntitlementIds = Object.keys(customerInfo.entitlements.active || {});
    const activeSubs = Array.isArray(customerInfo.activeSubscriptions)
      ? customerInfo.activeSubscriptions
      : [];
    const nonSubsTxns = Array.isArray(customerInfo.nonSubscriptionTransactions)
      ? customerInfo.nonSubscriptionTransactions.map(t => ({
          productId: t.productIdentifier,
          purchaseDate: t.purchaseDate,
        }))
      : [];
    const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;

    _rcLog('RESTORE_RESULT', {
      isPremium,
      lookupKey: PREMIUM_ENTITLEMENT_ID,
      originalAppUserId: customerInfo.originalAppUserId,
      activeEntitlementIds,
      activeSubscriptionsCount: activeSubs.length,
      activeSubscriptions: activeSubs,
      nonSubscriptionTransactionsCount: nonSubsTxns.length,
      nonSubscriptionTransactions: nonSubsTxns,
      firstSeen: customerInfo.firstSeen,
      requestDate: customerInfo.requestDate,
    });

    if (isPremium) {
      console.log('[RevenueCat] Purchases restored successfully');
      return { success: true, customerInfo, restored: true };
    } else {
      return { 
        success: true, // Restore itself succeeded, just no purchases found
        restored: false,
        error: 'No previous purchases found.',
        customerInfo 
      };
    }
  } catch (error) {
    const purchaseError = error as PurchasesError;
    console.error('[RevenueCat] Restore error:', purchaseError.message);
    _rcLog('RESTORE_ERROR', {
      errorCode: purchaseError.code,
      errorMessage: purchaseError.message,
      underlyingErrorMessage: (purchaseError as any).underlyingErrorMessage,
      userCancelled: (purchaseError as any).userCancelled,
    });
    return {
      success: false,
      error: purchaseError.message || 'Failed to restore purchases.',
      errorCode: purchaseError.code,
    };
  }
};

/**
 * Add listener for customer info updates
 * Returns cleanup function
 */
export const addCustomerInfoUpdateListener = (
  callback: (customerInfo: CustomerInfo) => void
): (() => void) => {
  if (!isRevenueCatConfigured()) {
    return () => {};
  }

  return Purchases.addCustomerInfoUpdateListener(callback);
};

/**
 * Set user attributes for analytics
 */
export const setUserAttributes = async (attributes: {
  email?: string;
  displayName?: string;
  phoneNumber?: string;
  fcmToken?: string;
  [key: string]: string | undefined;
}): Promise<void> => {
  if (!isRevenueCatConfigured()) return;

  if (attributes.email) await Purchases.setEmail(attributes.email);
  if (attributes.displayName) await Purchases.setDisplayName(attributes.displayName);
  if (attributes.phoneNumber) await Purchases.setPhoneNumber(attributes.phoneNumber);
  if (attributes.fcmToken) await Purchases.setPushToken(attributes.fcmToken);

  // Set custom attributes
  for (const [key, value] of Object.entries(attributes)) {
    if (!['email', 'displayName', 'phoneNumber', 'fcmToken'].includes(key) && value) {
      await Purchases.setAttributes({ [key]: value });
    }
  }
};

/**
 * Get package price string
 */
export const getPackagePrice = (pkg: PurchasesPackage): string => {
  return pkg.product.priceString;
};

/**
 * Get package period string
 */
export const getPackagePeriod = (pkg: PurchasesPackage): string => {
  const period = pkg.product.subscriptionPeriod;
  if (!period) return 'lifetime';
  
  // Parse ISO 8601 duration
  if (period.includes('P1M')) return 'month';
  if (period.includes('P1Y') || period.includes('P12M')) return 'year';
  if (period.includes('P1W')) return 'week';
  if (period.includes('P1D')) return 'day';
  
  return period;
};

/**
 * Check if package has intro/trial offer
 */
export const hasIntroOffer = (pkg: PurchasesPackage): boolean => {
  return pkg.product.introPrice !== null;
};

/**
 * Get intro offer details
 */
export const getIntroOfferDetails = (pkg: PurchasesPackage): string | null => {
  const intro = pkg.product.introPrice;
  if (!intro) return null;

  const periodUnit = intro.periodUnit;
  const periods = intro.periodNumberOfUnits;
  
  if (intro.price === 0) {
    return `${periods}-${periodUnit.toLowerCase()} free trial`;
  }
  
  return `${intro.priceString} for ${periods} ${periodUnit.toLowerCase()}${periods > 1 ? 's' : ''}`;
};

/**
 * Sync purchases (useful after app install transfer)
 */
export const syncPurchases = async (): Promise<void> => {
  if (!isRevenueCatConfigured()) return;
  await Purchases.syncPurchases();
};

/**
 * Present code redemption sheet (iOS only)
 */
export const presentCodeRedemptionSheet = async (): Promise<void> => {
  if (Platform.OS !== 'ios' || !isRevenueCatConfigured()) return;
  await Purchases.presentCodeRedemptionSheet();
};
