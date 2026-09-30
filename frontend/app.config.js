/**
 * Dynamic Expo config — runs at BUILD TIME during `expo prebuild` / `eas build`.
 *
 * BACKEND URL IS HARDCODED - NO ENV OVERRIDE ALLOWED
 * The single source of truth is apiConfig.ts for runtime code.
 * This file only provides the value for Constants.expoConfig.extra for reference.
 */

// Backend URL — reads from EXPO_PUBLIC_BACKEND_URL, falls back to production
const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || 'https://scriptmate-8.emergent.host';

const REVENUECAT_GOOGLE_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY ||
  'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT';

const REVENUECAT_APPLE_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY ||
  'appl_YOUR_IOS_KEY_HERE';

const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  'https://141660e463cc23c1c29fef7403bcb3d6@o4510914410840064.ingest.de.sentry.io/4510914414116944';

// ElevenLabs API keys begin with `sk_`. A 64-char hex value is the
// API-key ID (NOT the key) and produces HTTP 400 invalid_api_key on
// every synthesis request. There is NO safe hard-coded fallback — if
// EXPO_PUBLIC_ELEVENLABS_API_KEY is not exported to the prebuild
// environment, we intentionally emit an empty string so the strict
// validator in services/appConfig.ts + services/elevenLabsService.ts
// treats ElevenLabs as UNAVAILABLE. The rehearsal falls back to
// expo-speech cleanly and the on-device diagnostic reports the
// misconfiguration precisely.
const ELEVENLABS_API_KEY =
  process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';

module.exports = ({ config }) => {
  // Log during prebuild so we can verify in the build logs
  console.log('[app.config.js] Building with config:');
  console.log(`  BACKEND_URL: ${BACKEND_URL} (HARDCODED - NOT FROM ENV)`);
  console.log(`  RC_GOOGLE: ${REVENUECAT_GOOGLE_API_KEY.substring(0, 5)}***`);
  console.log(`  RC_APPLE: ${REVENUECAT_APPLE_API_KEY.substring(0, 5)}***`);
  console.log(`  SENTRY: ${SENTRY_DSN ? 'Set' : 'MISSING'}`);
  // ElevenLabs credential shape check at prebuild time. Never logs
  // the value itself. If the value is present but lacks the `sk_`
  // prefix, this line prints INVALID_FORMAT so the build log flags
  // the misconfiguration BEFORE the APK ships.
  const elFormat = !ELEVENLABS_API_KEY
    ? 'MISSING'
    : ELEVENLABS_API_KEY.startsWith('sk_') && ELEVENLABS_API_KEY.length >= 20
      ? `Set (sk_ ok, len=${ELEVENLABS_API_KEY.length})`
      : `INVALID_FORMAT (len=${ELEVENLABS_API_KEY.length}, prefix ok=${ELEVENLABS_API_KEY.startsWith('sk_')})`;
  console.log(`  ELEVENLABS: ${elFormat}`);

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
