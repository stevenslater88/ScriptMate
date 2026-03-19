/**
 * Dynamic Expo config — runs at BUILD TIME during `expo prebuild` / `eas build`.
 *
 * BACKEND URL IS HARDCODED - NO ENV OVERRIDE ALLOWED
 * The single source of truth is apiConfig.ts for runtime code.
 * This file only provides the value for Constants.expoConfig.extra for reference.
 */

// HARDCODED - DO NOT USE process.env FOR BACKEND URL
const BACKEND_URL = 'https://script-recovery-1.preview.emergentagent.com';

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
  // Log during prebuild so we can verify in the build logs
  console.log('[app.config.js] Building with config:');
  console.log(`  BACKEND_URL: ${BACKEND_URL} (HARDCODED - NOT FROM ENV)`);
  console.log(`  RC_GOOGLE: ${REVENUECAT_GOOGLE_API_KEY.substring(0, 5)}***`);
  console.log(`  RC_APPLE: ${REVENUECAT_APPLE_API_KEY.substring(0, 5)}***`);
  console.log(`  SENTRY: ${SENTRY_DSN ? 'Set' : 'MISSING'}`);
  console.log(`  ELEVENLABS: ${ELEVENLABS_API_KEY ? 'Set' : 'MISSING'}`);

  return {
    ...config,
    extra: {
      // Preserve existing extra (eas.projectId, router, etc.)
      ...(config.extra || {}),
      // BACKEND_URL is HARDCODED - single source of truth
      EXPO_PUBLIC_BACKEND_URL: BACKEND_URL,
      BACKEND_URL: BACKEND_URL,
      // Other config values
      EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: REVENUECAT_GOOGLE_API_KEY,
      EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: REVENUECAT_APPLE_API_KEY,
      EXPO_PUBLIC_SENTRY_DSN: SENTRY_DSN,
      EXPO_PUBLIC_ELEVENLABS_API_KEY: ELEVENLABS_API_KEY,
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
