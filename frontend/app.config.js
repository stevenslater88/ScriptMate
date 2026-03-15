/**
 * Dynamic Expo config — runs at BUILD TIME during `expo prebuild` / `eas build`.
 *
 * Reads EXPO_PUBLIC_* from the build machine environment (set by eas.json "env" block)
 * and embeds them into the app config under "extra".
 * At runtime the app reads Constants.expoConfig.extra.*.
 *
 * Every value has a hardcoded fallback so the app works even if env vars are missing.
 */
module.exports = ({ config }) => {
  return {
    ...config,
    extra: {
      ...(config.extra || {}),
      // Backend
      BACKEND_URL:
        process.env.EXPO_PUBLIC_BACKEND_URL ||
        'https://device-validation.preview.emergentagent.com',
      // RevenueCat
      REVENUECAT_GOOGLE_API_KEY:
        process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY ||
        'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT',
      REVENUECAT_APPLE_API_KEY:
        process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY ||
        'appl_YOUR_IOS_KEY_HERE',
      // Sentry
      SENTRY_DSN:
        process.env.EXPO_PUBLIC_SENTRY_DSN ||
        'https://141660e463cc23c1c29fef7403bcb3d6@o4510914410840064.ingest.de.sentry.io/4510914414116944',
      // ElevenLabs
      ELEVENLABS_API_KEY:
        process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ||
        'c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb',
      // Feature flags
      PREMIUM_ENABLED: process.env.EXPO_PUBLIC_PREMIUM_ENABLED !== 'false',
      SHOW_LIFETIME: process.env.EXPO_PUBLIC_SHOW_LIFETIME !== 'false',
      PAYWALL_VARIANT: process.env.EXPO_PUBLIC_PAYWALL_VARIANT || 'A',
    },
  };
};
