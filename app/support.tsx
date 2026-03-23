const loadDiagnostics = async () => {
  setLoadingDiagnostics(true);

  try {
    let diag = null;

    try {
      diag = await getDiagnostics();
    } catch (innerError) {
      console.log("Diagnostics fetch failed:", innerError);

      // SAFE FALLBACK
      diag = {
        appVersion: "unknown",
        buildNumber: "unknown",
        bundleId: "unknown",
        platform: Platform.OS,
        deviceModel: "unknown",
        osVersion: "unknown",
        installSource: "unknown",
        isPremium: false,
        rcAppUserId: "error",
        rcApiKeyPrefix: "error",
        currentOfferingId: "error",
        rcInitError: "Diagnostics failed",
        products: [],
        missingProducts: [],
        featureFlags: {
          PREMIUM_ENABLED: false,
          SHOW_LIFETIME: false,
          PAYWALL_VARIANT: "unknown",
        },
      };
    }

    setDiagnostics(diag);

  } catch (error) {
    console.error("Critical diagnostics error:", error);

    // FINAL FALLBACK (guarantees UI renders)
    setDiagnostics({
      appVersion: "error",
      buildNumber: "error",
      bundleId: "error",
      platform: Platform.OS,
      deviceModel: "error",
      osVersion: "error",
      installSource: "error",
      isPremium: false,
      rcAppUserId: "error",
      rcApiKeyPrefix: "error",
      currentOfferingId: "error",
      rcInitError: "Fatal diagnostics error",
      products: [],
      missingProducts: [],
      featureFlags: {
        PREMIUM_ENABLED: false,
        SHOW_LIFETIME: false,
        PAYWALL_VARIANT: "error",
      },
    });
  } finally {
    setLoadingDiagnostics(false);
  }
};