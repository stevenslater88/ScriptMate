/**
 * Centralized App Configuration — Single Source of Truth
 *
 * WHY THIS EXISTS:
 * Expo SDK 54 has a known regression (GitHub #36503) where process.env.EXPO_PUBLIC_*
 * fails to inline correctly in production builds. The Metro bundler may replace
 * these references with broken code like `_env2.env.EXPO_PUBLIC_*` that evaluates
 * to undefined or a non-string value at runtime.
 *
 * Additionally, the Emergent platform modifies app.json during the build process
 * (setting package name, etc.), which can strip the `extra` field.
 *
 * RESOLUTION ORDER (most reliable first):
 * 1. Constants.expoConfig.extra — populated by app.config.js at prebuild time (Node.js context)
 * 2. process.env — Metro build-time inlining (unreliable in SDK 53+)
 * 3. Hardcoded production values — always compiled into the JS bundle
 *
 * The hardcoded values ARE the production values. They are not "fallbacks" —
 * they are the guaranteed-correct values that will always work.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ─── Hardcoded production values ───────────────────────────────────────────
// These are ALWAYS compiled into the JS bundle by Metro. No env var needed.
const DEFAULTS = {
  // Post-Phase-3 deployment-readiness fix (2026-02): the previous literal
  // pointed at `https://script-recovery-1.preview.emergentagent.com`, a
  // stale preview host from an old fork that no longer resolves to this
  // instance. Aligned with the other two hardcoded fallbacks in
  // frontend/services/apiConfig.ts and frontend/app.config.js
  // (`https://scriptmate-8.emergent.host` — the currently deployed
  // production backend). The RevenueCat / Sentry / ElevenLabs fallbacks
  // below are intentionally retained per the documented SDK 54 Metro
  // inlining regression (see file header). Future architecture: move
  // ElevenLabs credentials backend-side, consolidate RevenueCat / Sentry
  // config, adopt a single source of truth for env resolution.
  BACKEND_URL: 'https://scriptmate-8.emergent.host',
  REVENUECAT_GOOGLE_API_KEY: 'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT',
  REVENUECAT_APPLE_API_KEY: 'appl_YOUR_IOS_KEY_HERE',
  SENTRY_DSN: 'https://141660e463cc23c1c29fef7403bcb3d6@o4510914410840064.ingest.de.sentry.io/4510914414116944',
  // 2026-02 SCRIPT M8 (Option A): ELEVENLABS_API_KEY was intentionally
  // removed from the client. All ElevenLabs synthesis is proxied
  // through the ScriptMate backend at POST /api/tts/elevenlabs/generate
  // — the credential exists only in backend/.env, never in the APK.
  PREMIUM_ENABLED: true,
  SHOW_LIFETIME: false,
  PAYWALL_VARIANT: 'A',
} as const;

// ─── Strict validation helper ──────────────────────────────────────────────
// Returns true ONLY if value is a non-empty string that isn't "undefined"/"null"
function isValidString(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0 && val !== 'undefined' && val !== 'null';
}

// ─── Safe resolution: extra → env → hardcoded ──────────────────────────────
// Checks Constants.expoConfig.extra FIRST because app.config.js runs in Node.js
// context at prebuild time, making it immune to Metro's SDK 53+ regression.
function resolve(envKey: string, hardcoded: string): { value: string; source: ConfigSource } {
  // 1. Constants.expoConfig.extra (from app.config.js — most reliable in production)
  try {
    const extra = Constants.expoConfig?.extra;
    if (extra) {
      // Check full key (EXPO_PUBLIC_BACKEND_URL) and short key (BACKEND_URL)
      const fullKey = extra[envKey];
      const shortKey = extra[envKey.replace('EXPO_PUBLIC_', '')];
      if (isValidString(fullKey)) return { value: fullKey, source: 'extra' };
      if (isValidString(shortKey)) return { value: shortKey, source: 'extra' };
    }
  } catch {}

  // 2. process.env (Metro build-time inlined — unreliable in SDK 53+)
  try {
    const fromEnv = (process.env as Record<string, unknown>)[envKey];
    if (isValidString(fromEnv)) return { value: fromEnv, source: 'env' };
  } catch {}

  // 3. Hardcoded — this literal string is always in the JS bundle
  return { value: hardcoded, source: 'hardcoded' };
}

function resolveBoolean(envKey: string, hardcoded: boolean): boolean {
  try {
    const extra = Constants.expoConfig?.extra;
    if (extra) {
      const fullKey = extra[envKey];
      const shortKey = extra[envKey.replace('EXPO_PUBLIC_', '')];
      if (typeof fullKey === 'boolean') return fullKey;
      if (isValidString(fullKey)) return fullKey !== 'false';
      if (typeof shortKey === 'boolean') return shortKey;
      if (isValidString(shortKey)) return shortKey !== 'false';
    }
  } catch {}

  try {
    const fromEnv = (process.env as Record<string, unknown>)[envKey];
    if (isValidString(fromEnv)) return fromEnv !== 'false';
  } catch {}

  return hardcoded;
}

// ─── Resolve all config values at module load time ─────────────────────────
// BACKEND_URL: HARDCODED ONLY — no env resolution to prevent stale env overrides
const _backendUrl = { value: DEFAULTS.BACKEND_URL, source: 'hardcoded' as ConfigSource };
const _rcGoogleKey = resolve('EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY', DEFAULTS.REVENUECAT_GOOGLE_API_KEY);
const _rcAppleKey = resolve('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY', DEFAULTS.REVENUECAT_APPLE_API_KEY);
const _sentryDsn = resolve('EXPO_PUBLIC_SENTRY_DSN', DEFAULTS.SENTRY_DSN);
// 2026-02 SCRIPT M8 (Option A) — ELEVENLABS_API_KEY resolution
// removed. Client no longer holds an ElevenLabs credential; all
// synthesis is proxied through the backend.

// ─── Exported config ───────────────────────────────────────────────────────
export const AppConfig = {
  BACKEND_URL: _backendUrl.value,
  REVENUECAT_GOOGLE_API_KEY: _rcGoogleKey.value,
  REVENUECAT_APPLE_API_KEY: _rcAppleKey.value,
  SENTRY_DSN: _sentryDsn.value,
  PREMIUM_ENABLED: resolveBoolean('EXPO_PUBLIC_PREMIUM_ENABLED', DEFAULTS.PREMIUM_ENABLED),
  SHOW_LIFETIME: resolveBoolean('EXPO_PUBLIC_SHOW_LIFETIME', DEFAULTS.SHOW_LIFETIME),
  PAYWALL_VARIANT: resolve('EXPO_PUBLIC_PAYWALL_VARIANT', DEFAULTS.PAYWALL_VARIANT).value,
  get REVENUECAT_API_KEY() {
    return Platform.OS === 'ios'
      ? AppConfig.REVENUECAT_APPLE_API_KEY
      : AppConfig.REVENUECAT_GOOGLE_API_KEY;
  },
} as const;

// ─── Startup log — fires at module load ────────────────────────────────────
// This prints to logcat/device console so the user can verify config resolution.
const mask = (v: string) => (v.length > 8 ? v.substring(0, 5) + '***' : v);
console.log('[AppConfig] ===== CONFIG AUDIT =====');
console.log(`[AppConfig] Backend URL: ${AppConfig.BACKEND_URL} [${_backendUrl.source}]`);
console.log(`[AppConfig] RC Key (${Platform.OS}): ${mask(AppConfig.REVENUECAT_API_KEY)} [${Platform.OS === 'ios' ? _rcAppleKey.source : _rcGoogleKey.source}]`);
console.log(`[AppConfig] Sentry: ${AppConfig.SENTRY_DSN ? 'Set' : 'MISSING'} [${_sentryDsn.source}]`);
console.log(`[AppConfig] ElevenLabs: routed server-side via /api/tts/elevenlabs/*`);
console.log(`[AppConfig] Premium: ${AppConfig.PREMIUM_ENABLED}, Lifetime: ${AppConfig.SHOW_LIFETIME}`);
console.log(`[AppConfig] Constants.expoConfig present: ${!!Constants.expoConfig}`);
console.log(`[AppConfig] Constants.expoConfig.extra keys: ${JSON.stringify(Object.keys(Constants.expoConfig?.extra || {}))}`);
console.log('[AppConfig] ===== END AUDIT =====');

// ─── Diagnostics export ────────────────────────────────────────────────────
export type ConfigSource = 'env' | 'extra' | 'hardcoded';

/**
 * Strict format validator for ElevenLabs API keys.
 *
 * Real keys begin with the `sk_` prefix followed by a long token.
 * The physical S23 Ultra QA build (Feb-2026) hit HTTP 400
 * "authentication_error / invalid_api_key: API key ID used as API
 * key" because a 64-char hex string (an API key ID, NOT the actual
 * key) was configured. This validator rejects that class of value
 * up-front so `isElevenLabsConfigured()` never lies about readiness.
 *
 * Format spec derived from the ElevenLabs API 400 error message
 * itself: "API keys start with 'sk_'".
 */
export function isValidElevenLabsApiKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith('sk_')) return false;
  // A real key has token bytes after the prefix — a bare `sk_` or
  // very short value is clearly a placeholder.
  if (trimmed.length < 20) return false;
  return true;
}

/**
 * Classify why an ElevenLabs credential is invalid — used by the
 * ELEVENLABS_CONFIG_INVALID diagnostic to give physical testers a
 * precise, actionable reason without ever logging the value itself.
 */
export function classifyElevenLabsKey(key: unknown):
  | 'missing'
  | 'not-a-string'
  | 'wrong-prefix'
  | 'too-short'
  | 'looks-like-api-key-id'
  | 'valid' {
  if (key === undefined || key === null || key === '') return 'missing';
  if (typeof key !== 'string') return 'not-a-string';
  const trimmed = key.trim();
  if (!trimmed) return 'missing';
  // A 64-char pure hex value is the ElevenLabs API key *ID* format.
  // This is exactly the credential that produced the physical QA
  // failure. Report it with a specific reason so the reader knows
  // to fetch the actual key, not the ID.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return 'looks-like-api-key-id';
  if (!trimmed.startsWith('sk_')) return 'wrong-prefix';
  if (trimmed.length < 20) return 'too-short';
  return 'valid';
}

export interface ConfigAudit {
  key: string;
  resolved: string;
  source: ConfigSource;
  present: boolean;
}

export function getConfigAudit(): ConfigAudit[] {
  return [
    {
      key: 'Backend URL',
      resolved: _backendUrl.value,
      source: _backendUrl.source,
      present: _backendUrl.value.length > 0,
    },
    {
      key: `RevenueCat Key (${Platform.OS})`,
      resolved: mask(Platform.OS === 'ios' ? _rcAppleKey.value : _rcGoogleKey.value),
      source: Platform.OS === 'ios' ? _rcAppleKey.source : _rcGoogleKey.source,
      present: (Platform.OS === 'ios' ? _rcAppleKey.value : _rcGoogleKey.value).length >= 10,
    },
    {
      key: 'Sentry DSN',
      resolved: _sentryDsn.value ? 'Set' : 'Missing',
      source: _sentryDsn.source,
      present: _sentryDsn.value.length > 0,
    },
    {
      // 2026-02 SCRIPT M8 (Option A) — ElevenLabs credential lives
      // server-side only. Reported here for completeness so the audit
      // never suggests the client is misconfigured.
      key: 'ElevenLabs',
      resolved: 'routed server-side via /api/tts/elevenlabs/*',
      source: 'hardcoded' as ConfigSource,
      present: true,
    },
  ];
}
