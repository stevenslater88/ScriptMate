import { Platform } from 'react-native';
import Purchases, {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
  PurchasesError,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';

// RevenueCat API Keys from environment
const REVENUECAT_APPLE_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || '';
const REVENUECAT_GOOGLE_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY || '';

// Entitlement identifier that unlocks premium features
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
 * Configure RevenueCat SDK
 * Call this once when app starts (typically in _layout.tsx)
 */
export const configureRevenueCat = async (appUserID?: string): Promise<void> => {
  if (isConfigured) {
    console.log('[RevenueCat] Already configured');
    return;
  }

  // Skip configuration on web
  if (Platform.OS === 'web') {
    console.log('[RevenueCat] Web platform - skipping configuration');
    return;
  }

  try {
    // Enable debug logs in development
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    // Get platform-specific API key
    const apiKey = Platform.select({
      ios: REVENUECAT_APPLE_API_KEY,
      android: REVENUECAT_GOOGLE_API_KEY,
      default: '',
    });

    if (!apiKey) {
      console.warn('[RevenueCat] No API key configured for platform:', Platform.OS);
      return;
    }

    // Configure the SDK
    Purchases.configure({
      apiKey,
      appUserID: appUserID || undefined,
    });

    isConfigured = true;
    console.log('[RevenueCat] Configured successfully');
  } catch (error) {
    console.error('[RevenueCat] Configuration failed:', error);
    throw error;
  }
};

/**
 * Check if RevenueCat is configured
 */
export const isRevenueCatConfigured = (): boolean => {
  return isConfigured && Platform.OS !== 'web';
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
}

/**
 * Purchase a package
 */
export const purchasePackage = async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
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
    return { success: false, error: 'RevenueCat not configured' };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();
    const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;

    if (isPremium) {
      console.log('[RevenueCat] Purchases restored successfully');
      return { success: true, customerInfo };
    } else {
      return { 
        success: false, 
        error: 'No previous purchases found.',
        customerInfo 
      };
    }
  } catch (error) {
    const purchaseError = error as PurchasesError;
    console.error('[RevenueCat] Restore error:', purchaseError.message);
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
