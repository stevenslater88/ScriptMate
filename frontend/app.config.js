/**
 * Dynamic Expo config — runs at BUILD TIME during `expo prebuild` / `eas build`.
 *
 * This runs in a Node.js context on the build machine, NOT in the Metro bundler.
 * So `process.env` here reads real OS environment variables set by the EAS `env` block.
 * This makes it immune to the Metro SDK 53+ EXPO_PUBLIC_* inlining regression.
 *
 * The returned config is serialized and embedded into the native app.
 * At runtime, the app reads `Constants.expoConfig.extra.*`.
 *
 * Every value has a hardcoded fallback that matches production config.
 */

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'https://device-validation.preview.emergentagent.com';

const REVENUECAT_GOOGLE_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY ||
  'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT';

const REVENUECAT_APPLE_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY ||
  'appl_YOUR_IOS_KEY_HERE';

const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  'https://141660e463cc23c1c29fef7403bcb3d6@o4510914410840064.ingest.de.sentry.io/4510914414116944';

const ELEVENLABS_API_KEY =
  process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ||
  'c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb';

module.exports = ({ config }) => {
  // Log during prebuild so we can verify env var resolution in the build logs
  console.log('[app.config.js] Building with config:');
  console.log(`  BACKEND_URL: ${BACKEND_URL}`);
  console.log(`  RC_GOOGLE: ${REVENUECAT_GOOGLE_API_KEY.substring(0, 5)}***`);
  console.log(`  RC_APPLE: ${REVENUECAT_APPLE_API_KEY.substring(0, 5)}***`);
  console.log(`  SENTRY: ${SENTRY_DSN ? 'Set' : 'MISSING'}`);
  console.log(`  ELEVENLABS: ${ELEVENLABS_API_KEY ? 'Set' : 'MISSING'}`);

  return {
    ...config,
    extra: {
      // Preserve existing extra (eas.projectId, router, etc.)
      ...(config.extra || {}),
      // Add config values with BOTH full and short key names for maximum compatibility
      // Full keys (match what was previously in app.json extra)
      EXPO_PUBLIC_BACKEND_URL: BACKEND_URL,
      EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: REVENUECAT_GOOGLE_API_KEY,
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: REVENUECAT_APPLE_API_KEY,
      EXPO_PUBLIC_SENTRY_DSN: SENTRY_DSN,
      EXPO_PUBLIC_ELEVENLABS_API_KEY: ELEVENLABS_API_KEY,
      // Short keys (used by appConfig.ts resolve function)
      BACKEND_URL: BACKEND_URL,
      REVENUECAT_GOOGLE_API_KEY: REVENUECAT_GOOGLE_API_KEY,
      REVENUECAT_APPLE_API_KEY: REVENUECAT_APPLE_API_KEY,
      SENTRY_DSN: SENTRY_DSN,
      ELEVENLABS_API_KEY: ELEVENLABS_API_KEY,
      // Feature flags
      PREMIUM_ENABLED: process.env.EXPO_PUBLIC_PREMIUM_ENABLED !== 'false',
      SHOW_LIFETIME: process.env.EXPO_PUBLIC_SHOW_LIFETIME === 'true',
      PAYWALL_VARIANT: process.env.EXPO_PUBLIC_PAYWALL_VARIANT || 'A',
    },
  };
};
