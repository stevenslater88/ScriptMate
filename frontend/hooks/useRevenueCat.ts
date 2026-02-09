import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import {
  PurchasesOfferings,
  PurchasesPackage,
  CustomerInfo,
} from 'react-native-purchases';
import {
  initializeRevenueCat,
  getOfferings,
  getCustomerInfo,
  purchasePackage,
  restorePurchases,
  addCustomerInfoListener,
  PREMIUM_ENTITLEMENT_ID,
  PRODUCT_IDS,
  PurchaseResult,
} from '../services/revenuecat';

interface UseRevenueCatReturn {
  // State
  isInitialized: boolean;
  isLoading: boolean;
  offerings: PurchasesOfferings | null;
  customerInfo: CustomerInfo | null;
  isPremium: boolean;
  error: string | null;
  
  // Actions
  purchase: (package_: PurchasesPackage) => Promise<PurchaseResult>;
  restore: () => Promise<PurchaseResult>;
  refresh: () => Promise<void>;
}

/**
 * Custom hook for RevenueCat subscription management
 */
export const useRevenueCat = (userId?: string): UseRevenueCatReturn => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if user has premium entitlement
  const isPremium = customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;

  // Initialize RevenueCat and fetch initial data
  useEffect(() => {
    const init = async () => {
      // Skip on web platform for now
      if (Platform.OS === 'web') {
        setIsLoading(false);
        setIsInitialized(true);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Initialize SDK
        await initializeRevenueCat(userId);
        setIsInitialized(true);

        // Fetch offerings and customer info in parallel
        const [fetchedOfferings, fetchedCustomerInfo] = await Promise.all([
          getOfferings(),
          getCustomerInfo(),
        ]);

        setOfferings(fetchedOfferings);
        setCustomerInfo(fetchedCustomerInfo);
      } catch (err) {
        console.error('Failed to initialize RevenueCat:', err);
        setError('Failed to load subscription options');
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [userId]);

  // Listen for customer info updates
  useEffect(() => {
    if (Platform.OS === 'web' || !isInitialized) return;

    const cleanup = addCustomerInfoListener((newCustomerInfo) => {
      console.log('Customer info updated');
      setCustomerInfo(newCustomerInfo);
    });

    return cleanup;
  }, [isInitialized]);

  // Purchase a package
  const purchase = useCallback(async (package_: PurchasesPackage): Promise<PurchaseResult> => {
    if (Platform.OS === 'web') {
      return { success: false, error: 'Purchases not available on web' };
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await purchasePackage(package_);
      
      if (result.success && result.customerInfo) {
        setCustomerInfo(result.customerInfo);
      } else if (!result.cancelled) {
        setError(result.error || 'Purchase failed');
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
      } else {
        setError(result.error || 'No purchases to restore');
      }
      
      return result;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refresh offerings and customer info
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
      console.error('Failed to refresh:', err);
      setError('Failed to refresh subscription data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isInitialized,
    isLoading,
    offerings,
    customerInfo,
    isPremium,
    error,
    purchase,
    restore,
    refresh,
  };
};

export default useRevenueCat;
