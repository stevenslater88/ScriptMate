import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import {
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

interface UseRevenueCatReturn {
  // State
  isConfigured: boolean;
  isLoading: boolean;
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
  presentPaywall: () => Promise<boolean>;
  presentPaywallIfNeeded: () => Promise<boolean>;
}

/**
 * Custom hook for RevenueCat subscription management
 */
export const useRevenueCat = (userId?: string): UseRevenueCatReturn => {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived state
  const currentOffering = offerings?.current || null;
  const isPremium = customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
  
  // Get packages from current offering
  const monthlyPackage = currentOffering?.availablePackages?.find(
    (pkg) => pkg.packageType === 'MONTHLY' || pkg.identifier === PRODUCT_IDS.MONTHLY || pkg.identifier === '$rc_monthly'
  );
  const yearlyPackage = currentOffering?.availablePackages?.find(
    (pkg) => pkg.packageType === 'ANNUAL' || pkg.identifier === PRODUCT_IDS.YEARLY || pkg.identifier === '$rc_annual'
  );
  const lifetimePackage = currentOffering?.availablePackages?.find(
    (pkg) => pkg.packageType === 'LIFETIME' || pkg.identifier === PRODUCT_IDS.LIFETIME || pkg.identifier === '$rc_lifetime'
  );

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

        // Configure SDK
        await configureRevenueCat(userId);
        setIsConfigured(isRevenueCatConfigured());

        // Fetch initial data
        const [fetchedOfferings, fetchedCustomerInfo] = await Promise.all([
          getOfferings().catch(() => null),
          getCustomerInfo().catch(() => null),
        ]);

        if (fetchedOfferings) setOfferings(fetchedOfferings);
        if (fetchedCustomerInfo) setCustomerInfo(fetchedCustomerInfo);
        
      } catch (err) {
        console.error('[useRevenueCat] Init error:', err);
        setError('Failed to initialize subscriptions');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [userId]);

  // Listen for customer info updates
  useEffect(() => {
    if (Platform.OS === 'web' || !isConfigured) return;

    const unsubscribe = addCustomerInfoUpdateListener((info) => {
      console.log('[useRevenueCat] Customer info updated');
      setCustomerInfo(info);
    });

    return unsubscribe;
  }, [isConfigured]);

  // Purchase a package
  const purchase = useCallback(async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
    if (Platform.OS === 'web') {
      return { success: false, error: 'Purchases not available on web' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await purchasePackage(pkg);
      
      if (result.success && result.customerInfo) {
        setCustomerInfo(result.customerInfo);
      } else if (!result.cancelled && result.error) {
        setError(result.error);
      }
      
      return result;
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
      
      if (result.success && result.customerInfo) {
        setCustomerInfo(result.customerInfo);
      } else if (result.error) {
        setError(result.error);
      }
      
      return result;
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
    presentPaywall,
    presentPaywallIfNeeded,
  };
};

export default useRevenueCat;
export { PREMIUM_ENTITLEMENT_ID, PRODUCT_IDS };
