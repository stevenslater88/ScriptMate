import type { PurchasesStoreProduct } from 'react-native-purchases';

type TrialProduct = Pick<PurchasesStoreProduct, 'introPrice' | 'defaultOption' | 'subscriptionOptions'>;

// True only for a FREE trial that `purchasePackage` will actually apply.
// Google Play: the SDK buys `defaultOption`; a paid intro (introPhase) is not a trial.
export const hasFreeTrialOffer = (product: TrialProduct | null | undefined): boolean => {
  if (!product) return false;
  if (product.defaultOption || product.subscriptionOptions) {
    return !!product.defaultOption?.freePhase;
  }
  return product.introPrice?.price === 0;
};

// Diagnostic snapshot of the Google Play options RevenueCat returned.
export const summarizeSubscriptionOptions = (product: TrialProduct | null | undefined) => ({
  defaultOptionId: product?.defaultOption?.id ?? null,
  defaultOptionHasFreePhase: !!product?.defaultOption?.freePhase,
  defaultOptionFreePhasePeriod: product?.defaultOption?.freePhase?.billingPeriod?.iso8601 ?? null,
  subscriptionOptions: (product?.subscriptionOptions ?? []).map((o) => ({
    id: o.id,
    isBasePlan: o.isBasePlan,
    hasFreePhase: !!o.freePhase,
    hasIntroPhase: !!o.introPhase,
    tags: o.tags,
  })),
});
