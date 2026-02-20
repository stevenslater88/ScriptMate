import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import Purchases, {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
  PurchasesOffering,
} from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import {
  configureRevenueCat,
  isRevenueCatConfigured,
  getOfferings,
  getCustomerInfo,
  purchasePackage,
  restorePurchases,
  addCustomerInfoUpdateListener,
  checkPremiumAccess,
  PREMIUM_ENTITLEMENT_ID,
  PRODUCT_IDS,
  PurchaseResult,
} from '../services/revenuecat';
import {
  captureRevenueCatError,
  captureIAPError,
  capturePaywallError,
  addBreadcrumb,
} from '../services/sentryService';

// The offering identifier configured in RevenueCat dashboard
const PRODUCTION_OFFERING_ID = 'production';

interface UseRevenueCatReturn {
  // State
  isConfigured: boolean;
  isLoading: boolean;
  offeringsReady: boolean; // NEW: indicates if offerings loaded successfully
  offerings: PurchasesOfferings | null;
  currentOffering: PurchasesOffering | null;
  customerInfo: CustomerInfo | null;
  isPremium: boolean;
  error: string | null;
  
  // Packages
  monthlyPackage: PurchasesPackage | undefined;
  yearlyPackage: PurchasesPackage | undefined;
  lifetimePackage: PurchasesPackage | undefined;
  
  // Actions
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseResult>;
  restore: () => Promise<PurchaseResult>;
  refresh: () => Promise<void>;
  retryLoadOfferings: () => Promise<void>; // NEW: retry mechanism
  presentPaywall: () => Promise<boolean>;
  presentPaywallIfNeeded: () => Promise<boolean>;
}

/**
 * Custom hook for RevenueCat subscription management
 * 
 * CRASH-SAFE: All RevenueCat operations are wrapped in try/catch.
 * Uses the "production" offering from RevenueCat dashboard.
 */
export const useRevenueCat = (userId?: string): UseRevenueCatReturn => {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offeringsReady, setOfferingsReady] = useState(false);
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Safely get the "production" offering from RevenueCat.
   * Falls back to 'current' offering if 'production' is not available.
   * Returns null if no offerings are available.
   */
  const getProductionOffering = useCallback((allOfferings: PurchasesOfferings | null): PurchasesOffering | null => {
    if (!allOfferings) return null;
    
    // Try to get the "production" offering first (configured in RevenueCat dashboard)
    const productionOffering = allOfferings.all?.[PRODUCTION_OFFERING_ID];
    if (productionOffering) {
      console.log('[useRevenueCat] Using "production" offering');
      return productionOffering;
    }
    
    // Fallback to "current" offering if "production" is not found
    if (allOfferings.current) {
      console.log('[useRevenueCat] Falling back to "current" offering');
      return allOfferings.current;
    }
    
    console.warn('[useRevenueCat] No offerings available');
    return null;
  }, []);

  // Derived state - use production offering
  const currentOffering = getProductionOffering(offerings);
  const isPremium = customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
  
  // Get packages from production offering
  // Match by packageType first, then by identifier (for flexibility)
  const monthlyPackage = currentOffering?.availablePackages?.find(
    (pkg) => pkg.packageType === 'MONTHLY' || pkg.identifier === PRODUCT_IDS.MONTHLY || pkg.identifier === '$rc_monthly'
  );
  const yearlyPackage = currentOffering?.availablePackages?.find(
    (pkg) => pkg.packageType === 'ANNUAL' || pkg.identifier === PRODUCT_IDS.YEARLY || pkg.identifier === '$rc_annual'
  );
  const lifetimePackage = currentOffering?.availablePackages?.find(
    (pkg) => pkg.packageType === 'LIFETIME' || pkg.identifier === PRODUCT_IDS.LIFETIME || pkg.identifier === '$rc_lifetime'
  );

  /**
   * Load offerings with error handling
   * Sets offeringsReady to true only if packages are available
   */
  const loadOfferings = useCallback(async (): Promise<void> => {
    try {
      addBreadcrumb('Loading offerings', 'revenuecat', { action: 'load_offerings' });
      const fetchedOfferings = await getOfferings();
      setOfferings(fetchedOfferings);
      
      // Check if production offering has packages
      const productionOffer = getProductionOffering(fetchedOfferings);
      const hasPackages = (productionOffer?.availablePackages?.length ?? 0) > 0;
      
      setOfferingsReady(hasPackages);
      
      if (!hasPackages) {
        console.warn('[useRevenueCat] Production offering has no packages');
        captureRevenueCatError(new Error('Production offering has no packages'), {
          phase: 'load_offerings',
          offeringId: PRODUCTION_OFFERING_ID,
          availableOfferings: Object.keys(fetchedOfferings?.all || {}),
        });
      } else {
        addBreadcrumb('Offerings loaded successfully', 'revenuecat', {
          packageCount: productionOffer?.availablePackages?.length,
        });
      }
    } catch (err) {
      console.error('[useRevenueCat] Failed to load offerings:', err);
      captureRevenueCatError(err instanceof Error ? err : new Error(String(err)), {
        phase: 'load_offerings',
        offeringId: PRODUCTION_OFFERING_ID,
      });
      setOfferingsReady(false);
      // Don't set error here - offerings may still load on retry
    }
  }, [getProductionOffering]);

  /**
   * Load customer info with error handling
   */
  const loadCustomerInfo = useCallback(async (): Promise<void> => {
    try {
      const info = await getCustomerInfo();
      setCustomerInfo(info);
    } catch (err) {
      console.error('[useRevenueCat] Failed to load customer info:', err);
      // Don't crash - premium status will default to false
    }
  }, []);

  // Initialize RevenueCat
  useEffect(() => {
    const init = async () => {
      // Skip on web
      if (Platform.OS === 'web') {
        console.log('[useRevenueCat] Web platform - using fallback');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Configure SDK (already done in _layout.tsx, this is a no-op)
        await configureRevenueCat(userId);
        setIsConfigured(isRevenueCatConfigured());

        // Fetch initial data in parallel (with individual error handling)
        await Promise.all([
          loadOfferings(),
          loadCustomerInfo(),
        ]);
        
      } catch (err) {
        // This should rarely happen since loadOfferings/loadCustomerInfo have their own try/catch
        console.error('[useRevenueCat] Init error:', err);
        setError('Failed to initialize subscriptions. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [userId, loadOfferings, loadCustomerInfo]);

  // Listen for customer info updates
  useEffect(() => {
    if (Platform.OS === 'web' || !isConfigured) return;

    const unsubscribe = addCustomerInfoUpdateListener((info) => {
      console.log('[useRevenueCat] Customer info updated');
      setCustomerInfo(info);
    });

    return unsubscribe;
  }, [isConfigured]);

  /**
   * Retry loading offerings - useful when initial load fails
   * Called from UI retry button
   */
  const retryLoadOfferings = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;

    setIsLoading(true);
    setError(null);

    try {
      await loadOfferings();
      await loadCustomerInfo();
    } catch (err) {
      console.error('[useRevenueCat] Retry failed:', err);
      setError('Unable to load subscription options. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [loadOfferings, loadCustomerInfo]);

  // Purchase a package
  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
    if (Platform.OS === 'web') {
      return { success: false, error: 'Purchases not available on web' };
    }

    setIsLoading(true);
    setError(null);

    // Track purchase attempt
    addBreadcrumb('Purchase initiated', 'revenuecat', {
      packageId: pkg.identifier,
      productId: pkg.product.identifier,
      price: pkg.product.priceString,
    });

    try {
      const result = await purchasePackage(pkg);
      
      if (result.success && result.customerInfo) {
        setCustomerInfo(result.customerInfo);
        addBreadcrumb('Purchase successful', 'revenuecat', {
          packageId: pkg.identifier,
          hasPremium: result.customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined,
        });
      } else if (!result.cancelled && result.error) {
        setError(result.error);
        captureIAPError(new Error(result.error), pkg.product.identifier, result.errorCode?.toString());
      }
      
      return result;
    } catch (err) {
      // Catch any unexpected errors
      console.error('[useRevenueCat] Purchase error (caught):', err);
      const errorMsg = 'Purchase failed. Please try again.';
      setError(errorMsg);
      captureIAPError(
        err instanceof Error ? err : new Error(String(err)),
        pkg.product.identifier,
        'UNEXPECTED_ERROR'
      );
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Restore purchases
  const restore = useCallback(async (): Promise<PurchaseResult> => {
    if (Platform.OS === 'web') {
      return { success: false, error: 'Restore not available on web' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await restorePurchases();
      
      if (result.customerInfo) {
        setCustomerInfo(result.customerInfo);
      }
      
      if (!result.success && result.error) {
        setError(result.error);
      }
      
      return result;
    } catch (err) {
      // Catch any unexpected errors
      console.error('[useRevenueCat] Restore error (caught):', err);
      const errorMsg = 'Failed to restore purchases. Please try again.';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refresh data
  const refresh = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;

    setIsLoading(true);
    setError(null);

    try {
      const [fetchedOfferings, fetchedCustomerInfo] = await Promise.all([
        getOfferings(),
        getCustomerInfo(),
      ]);

      setOfferings(fetchedOfferings);
      setCustomerInfo(fetchedCustomerInfo);
    } catch (err) {
      console.error('[useRevenueCat] Refresh error:', err);
      setError('Failed to refresh subscription data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Present RevenueCat Paywall UI
   * Returns true if purchase was made
   * Protected against crashes from SimulatedStoreErrorDialog
   */
  const presentPaywall = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') {
      console.log('[useRevenueCat] Paywall not available on web');
      return false;
    }

    try {
      const result = await RevenueCatUI.presentPaywall();
      
      console.log('[useRevenueCat] Paywall result:', result);
      
      // Refresh customer info after paywall closes
      try {
        const info = await getCustomerInfo();
        setCustomerInfo(info);
      } catch (refreshError) {
        console.warn('[useRevenueCat] Failed to refresh after paywall:', refreshError);
      }
      
      return result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED;
    } catch (err) {
      // Catch any crash-causing errors including SimulatedStoreErrorDialog
      console.error('[useRevenueCat] Paywall error (handled):', err);
      setError('Unable to show subscription options. Please try again.');
      return false;
    }
  }, []);

  /**
   * Present Paywall only if user doesn't have premium
   * Returns true if user now has premium
   * Protected against crashes
   */
  const presentPaywallIfNeeded = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;

    try {
      const result = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: PREMIUM_ENTITLEMENT_ID,
      });
      
      console.log('[useRevenueCat] PaywallIfNeeded result:', result);
      
      // Refresh customer info
      try {
        const info = await getCustomerInfo();
        setCustomerInfo(info);
      } catch (refreshError) {
        console.warn('[useRevenueCat] Failed to refresh after paywall:', refreshError);
      }
      
      return result === PAYWALL_RESULT.PURCHASED || 
             result === PAYWALL_RESULT.RESTORED ||
             result === PAYWALL_RESULT.NOT_PRESENTED; // Already has entitlement
    } catch (err) {
      // Catch any crash-causing errors including SimulatedStoreErrorDialog
      console.error('[useRevenueCat] PaywallIfNeeded error (handled):', err);
      setError('Unable to check subscription status. Please try again.');
      return false;
    }
  }, []);

  return {
    isConfigured,
    isLoading,
    offeringsReady,
    offerings,
    currentOffering,
    customerInfo,
    isPremium,
    error,
    monthlyPackage,
    yearlyPackage,
    lifetimePackage,
    purchase,
    restore,
    refresh,
    retryLoadOfferings,
    presentPaywall,
    presentPaywallIfNeeded,
  };
};

export default useRevenueCat;
export { PREMIUM_ENTITLEMENT_ID, PRODUCT_IDS };
