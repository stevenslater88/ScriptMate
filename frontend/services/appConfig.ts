/**
 * Centralized App Configuration — Single Source of Truth
 *
 * ALL critical config values live here with hardcoded production fallbacks.
 * Resolution order: process.env (Metro build-time) → Constants.expoConfig.extra → hardcoded.
 *
 * This guarantees the app NEVER ships with undefined/empty config values,
 * regardless of how EAS/Metro handle environment variables.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ─── Hardcoded production values ───────────────────────────────────────────
// These are the last line of defense. They are always compiled into the JS bundle.
const DEFAULTS = {
  BACKEND_URL: 'https://device-validation.preview.emergentagent.com',
  REVENUECAT_GOOGLE_API_KEY: 'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT',
  REVENUECAT_APPLE_API_KEY: 'appl_YOUR_IOS_KEY_HERE',
  SENTRY_DSN: 'https://141660e463cc23c1c29fef7403bcb3d6@o4510914410840064.ingest.de.sentry.io/4510914414116944',
  ELEVENLABS_API_KEY: 'c73f5731f01c8a7070b87d37254eaa611b68c803168c0d0999654b3bc1becbeb',
  PREMIUM_ENABLED: true,
  SHOW_LIFETIME: true,
  PAYWALL_VARIANT: 'A',
} as const;

// ─── Safe resolution helper ────────────────────────────────────────────────
// Handles undefined, empty string, and the literal string "undefined"
function resolve(envKey: string, hardcoded: string): string {
  try {
    const fromEnv = (process.env as Record<string, string | undefined>)[envKey];
    if (typeof fromEnv === 'string' && fromEnv.length > 0 && fromEnv !== 'undefined') {
      return fromEnv;
    }
  } catch {}

  try {
    const extra = Constants.expoConfig?.extra;
    // Check both the EXPO_PUBLIC_ prefixed key and the short key
    const fromExtra = extra?.[envKey] ?? extra?.[envKey.replace('EXPO_PUBLIC_', '')];
    if (typeof fromExtra === 'string' && fromExtra.length > 0 && fromExtra !== 'undefined') {
      return fromExtra;
    }
  } catch {}

  return hardcoded;
}

function resolveBoolean(envKey: string, hardcoded: boolean): boolean {
  try {
    const fromEnv = (process.env as Record<string, string | undefined>)[envKey];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      return fromEnv !== 'false';
    }
  } catch {}

  try {
    const extra = Constants.expoConfig?.extra;
    const fromExtra = extra?.[envKey] ?? extra?.[envKey.replace('EXPO_PUBLIC_', '')];
    if (typeof fromExtra === 'boolean') return fromExtra;
    if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra !== 'false';
  } catch {}

  return hardcoded;
}

// ─── Exported config ───────────────────────────────────────────────────────
export const AppConfig = {
  BACKEND_URL: resolve('EXPO_PUBLIC_BACKEND_URL', DEFAULTS.BACKEND_URL),
  REVENUECAT_GOOGLE_API_KEY: resolve('EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY', DEFAULTS.REVENUECAT_GOOGLE_API_KEY),
  REVENUECAT_APPLE_API_KEY: resolve('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY', DEFAULTS.REVENUECAT_APPLE_API_KEY),
  SENTRY_DSN: resolve('EXPO_PUBLIC_SENTRY_DSN', DEFAULTS.SENTRY_DSN),
  ELEVENLABS_API_KEY: resolve('EXPO_PUBLIC_ELEVENLABS_API_KEY', DEFAULTS.ELEVENLABS_API_KEY),
  PREMIUM_ENABLED: resolveBoolean('EXPO_PUBLIC_PREMIUM_ENABLED', DEFAULTS.PREMIUM_ENABLED),
  SHOW_LIFETIME: resolveBoolean('EXPO_PUBLIC_SHOW_LIFETIME', DEFAULTS.SHOW_LIFETIME),
  PAYWALL_VARIANT: resolve('EXPO_PUBLIC_PAYWALL_VARIANT', DEFAULTS.PAYWALL_VARIANT),
  get REVENUECAT_API_KEY() {
    return Platform.OS === 'ios'
      ? AppConfig.REVENUECAT_APPLE_API_KEY
      : AppConfig.REVENUECAT_GOOGLE_API_KEY;
  },
} as const;

// ─── Diagnostics: which source resolved each value ─────────────────────────
export type ConfigSource = 'env' | 'extra' | 'hardcoded';

function traceSource(envKey: string): ConfigSource {
  try {
    const fromEnv = (process.env as Record<string, string | undefined>)[envKey];
    if (typeof fromEnv === 'string' && fromEnv.length > 0 && fromEnv !== 'undefined') {
      return 'env';
    }
  } catch {}
  try {
    const extra = Constants.expoConfig?.extra;
    const fromExtra = extra?.[envKey] ?? extra?.[envKey.replace('EXPO_PUBLIC_', '')];
    if (typeof fromExtra === 'string' && fromExtra.length > 0 && fromExtra !== 'undefined') {
      return 'extra';
    }
  } catch {}
  return 'hardcoded';
}

export interface ConfigAudit {
  key: string;
  resolved: string;
  source: ConfigSource;
  present: boolean;
}

export function getConfigAudit(): ConfigAudit[] {
  const mask = (val: string, prefixLen = 5) =>
    val.length > prefixLen ? val.substring(0, prefixLen) + '***' : val;

  return [
    {
      key: 'Backend URL',
      resolved: AppConfig.BACKEND_URL,
      source: traceSource('EXPO_PUBLIC_BACKEND_URL'),
      present: AppConfig.BACKEND_URL.length > 0,
    },
    {
      key: 'RevenueCat Key',
      resolved: mask(AppConfig.REVENUECAT_API_KEY),
      source: traceSource(
        Platform.OS === 'ios'
          ? 'EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY'
          : 'EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY'
      ),
      present: AppConfig.REVENUECAT_API_KEY.length >= 10,
    },
    {
      key: 'Sentry DSN',
      resolved: AppConfig.SENTRY_DSN ? 'Set' : 'Missing',
      source: traceSource('EXPO_PUBLIC_SENTRY_DSN'),
      present: AppConfig.SENTRY_DSN.length > 0,
    },
    {
      key: 'ElevenLabs Key',
      resolved: AppConfig.ELEVENLABS_API_KEY ? mask(AppConfig.ELEVENLABS_API_KEY) : 'Missing',
      source: traceSource('EXPO_PUBLIC_ELEVENLABS_API_KEY'),
      present: AppConfig.ELEVENLABS_API_KEY.length > 0,
    },
  ];
}
