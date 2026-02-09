import { Platform } from 'react-native';
import Purchases, {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
  PurchasesError,
  ErrorCode,
} from 'react-native-purchases';

// RevenueCat API Keys - these should be set in environment variables
const REVENUECAT_APPLE_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || '';
const REVENUECAT_GOOGLE_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY || '';

// Entitlement identifier that unlocks premium features
export const PREMIUM_ENTITLEMENT_ID = 'premium';

// Track initialization state
let isInitialized = false;

/**
 * Initialize RevenueCat SDK
 * Call this once when app starts
 */
export const initializeRevenueCat = async (userId?: string): Promise<void> => {
  if (isInitialized) {
    console.log('RevenueCat already initialized');
    return;
  }

  try {
    // Set log level for debugging (disable in production)
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.VERBOSE);
    }

    // Configure based on platform
    const apiKey = Platform.select({
      ios: REVENUECAT_APPLE_API_KEY,
      android: REVENUECAT_GOOGLE_API_KEY,
      default: '',
    });

    if (!apiKey) {
      console.warn('RevenueCat API key not configured for this platform');
      return;
    }

    // Configure RevenueCat
    await Purchases.configure({
      apiKey,
      appUserID: userId || undefined, // Let RevenueCat generate anonymous ID if not provided
    });

    isInitialized = true;
    console.log('RevenueCat initialized successfully');
  } catch (error) {
    console.error('Failed to initialize RevenueCat:', error);
  }
};

/**
 * Login user to RevenueCat with custom user ID
 * Use this when user authenticates in your app
 */
export const loginUser = async (userId: string): Promise<CustomerInfo | null> => {
  try {
    const { customerInfo } = await Purchases.logIn(userId);
    console.log('User logged into RevenueCat:', userId);
    return customerInfo;
  } catch (error) {
    console.error('Failed to login user to RevenueCat:', error);
    return null;
  }
};

/**
 * Logout user from RevenueCat
 * Resets to anonymous user
 */
export const logoutUser = async (): Promise<CustomerInfo | null> => {
  try {
    const customerInfo = await Purchases.logOut();
    console.log('User logged out from RevenueCat');
    return customerInfo;
  } catch (error) {
    console.error('Failed to logout user from RevenueCat:', error);
    return null;
  }
};

/**
 * Get available subscription offerings
 */
export const getOfferings = async (): Promise<PurchasesOfferings | null> => {
  try {
    const offerings = await Purchases.getOfferings();
    console.log('Fetched offerings:', offerings);
    return offerings;
  } catch (error) {
    console.error('Failed to fetch offerings:', error);
    return null;
  }
};

/**
 * Get current customer info (subscription status)
 */
export const getCustomerInfo = async (): Promise<CustomerInfo | null> => {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (error) {
    console.error('Failed to fetch customer info:', error);
    return null;
  }
};

/**
 * Check if user has active premium entitlement
 */
export const checkPremiumStatus = async (): Promise<boolean> => {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
    return isPremium;
  } catch (error) {
    console.error('Failed to check premium status:', error);
    return false;
  }
};

/**
 * Get premium entitlement expiration date
 */
export const getPremiumExpirationDate = async (): Promise<Date | null> => {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const premiumEntitlement = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID];
    if (premiumEntitlement?.expirationDate) {
      return new Date(premiumEntitlement.expirationDate);
    }
    return null;
  } catch (error) {
    console.error('Failed to get expiration date:', error);
    return null;
  }
};

/**
 * Purchase result type
 */
export interface PurchaseResult {
  success: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
  cancelled?: boolean;
}

/**
 * Purchase a subscription package
 */
export const purchasePackage = async (
  package_: PurchasesPackage
): Promise<PurchaseResult> => {
  try {
    const { customerInfo } = await Purchases.purchasePackage(package_);

    // Check if premium entitlement is now active
    const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;

    if (isPremium) {
      console.log('Purchase successful, premium access granted');
      return { success: true, customerInfo };
    } else {
      return {
        success: false,
        error: 'Purchase completed but premium access not granted. Please contact support.',
      };
    }
  } catch (error) {
    const purchaseError = error as PurchasesError;

    // Handle specific error types
    switch (purchaseError.code) {
      case ErrorCode.PurchaseCancelledError:
        console.log('User cancelled purchase');
        return {
          success: false,
          cancelled: true,
          error: 'Purchase cancelled',
        };

      case ErrorCode.NetworkError:
        return {
          success: false,
          error: 'Network connection error. Please check your internet and try again.',
        };

      case ErrorCode.StoreProblemError:
        return {
          success: false,
          error: 'There was a problem with the store. Please try again later.',
        };

      case ErrorCode.PurchaseNotAllowedError:
        return {
          success: false,
          error: 'Purchases are not allowed on this device.',
        };

      case ErrorCode.PurchaseInvalidError:
        return {
          success: false,
          error: 'Invalid purchase. Please try again.',
        };

      case ErrorCode.ProductAlreadyPurchasedError:
        return {
          success: false,
          error: 'You already have an active subscription.',
        };

      default:
        console.error('Purchase error:', purchaseError.message);
        return {
          success: false,
          error: purchaseError.message || 'An error occurred during purchase. Please try again.',
        };
    }
  }
};

/**
 * Restore previous purchases
 * Use this for "Restore Purchases" button
 */
export const restorePurchases = async (): Promise<PurchaseResult> => {
  try {
    const customerInfo = await Purchases.restorePurchases();
    const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;

    if (isPremium) {
      return {
        success: true,
        customerInfo,
      };
    } else {
      return {
        success: false,
        error: 'No previous purchases found to restore.',
      };
    }
  } catch (error) {
    const purchaseError = error as PurchasesError;
    console.error('Failed to restore purchases:', purchaseError.message);
    return {
      success: false,
      error: 'Failed to restore purchases. Please try again.',
    };
  }
};

/**
 * Add listener for customer info updates
 * Returns cleanup function
 */
export const addCustomerInfoListener = (
  callback: (customerInfo: CustomerInfo) => void
): (() => void) => {
  const listener = Purchases.addCustomerInfoUpdateListener(callback);
  return listener;
};

/**
 * Get package price string formatted for display
 */
export const getPackagePriceString = (package_: PurchasesPackage): string => {
  return package_.product.priceString;
};

/**
 * Get package billing period
 */
export const getPackagePeriod = (package_: PurchasesPackage): string => {
  const period = package_.product.subscriptionPeriod;
  if (!period) return '';
  
  if (period.includes('P1M')) return 'month';
  if (period.includes('P1Y')) return 'year';
  if (period.includes('P1W')) return 'week';
  return period;
};

/**
 * Check if package has a free trial
 */
export const hasFreeTrial = (package_: PurchasesPackage): boolean => {
  return package_.product.introPrice !== null;
};

/**
 * Get free trial duration string
 */
export const getFreeTrialString = (package_: PurchasesPackage): string | null => {
  const introPrice = package_.product.introPrice;
  if (!introPrice) return null;
  
  // Format based on trial period
  const period = introPrice.periodNumberOfUnits;
  const unit = introPrice.periodUnit;
  
  if (unit === 'DAY') {
    return `${period}-day free trial`;
  } else if (unit === 'WEEK') {
    return `${period}-week free trial`;
  } else if (unit === 'MONTH') {
    return `${period}-month free trial`;
  }
  
  return 'Free trial available';
};
