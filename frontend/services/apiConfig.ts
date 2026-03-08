/**
 * Centralized API Configuration
 * Single source of truth for backend URL with hardcoded production fallback.
 * Resolves the "undefined EXPO_PUBLIC_BACKEND_URL" issue in production builds.
 */
import Constants from 'expo-constants';

// Resolution order:
// 1. process.env (inlined by Metro at build time for EXPO_PUBLIC_* vars)
// 2. Constants.expoConfig.extra (from app.json / app.config.js)
// 3. Hardcoded production fallback (ensures the app NEVER ships with undefined URL)
const PRODUCTION_FALLBACK = 'https://production-ready-94.preview.emergentagent.com';

function resolveBackendUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (fromEnv) return fromEnv;

  const fromExtra = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL;
  if (fromExtra) return fromExtra as string;

  return PRODUCTION_FALLBACK;
}

export const API_BASE_URL = resolveBackendUrl();
export const API_TIMEOUT = 15000;

/**
 * Build a full API endpoint URL.
 * Usage: apiUrl('/api/scripts') → 'https://…/api/scripts'
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
