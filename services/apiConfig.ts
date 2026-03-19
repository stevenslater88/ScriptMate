/**
 * API Configuration — HARDCODED production backend URL.
 * 
 * SINGLE SOURCE OF TRUTH for the backend URL.
 * NO environment variables. NO dynamic resolution. NO overrides.
 * This ensures the URL is always correct and cannot be changed at build time.
 */

export const API_BASE_URL = 'https://script-recovery-1.preview.emergentagent.com';
export const API_TIMEOUT = 15000;

// HARD FAIL-SAFE: Crash app if wrong URL is somehow injected
if (API_BASE_URL.includes('android-upload-test')) {
  console.error('FATAL: API_BASE_URL contains incorrect domain: android-upload-test');
  console.error('Expected: script-recovery-1.preview.emergentagent.com');
  throw new Error('FATAL CONFIG ERROR: Backend URL is incorrect. Build is corrupted.');
}

// Config source indicator for diagnostics
export const API_CONFIG_SOURCE = 'apiConfig.ts (hardcoded)';

/**
 * Build a full API endpoint URL.
 * Usage: apiUrl('/api/scripts') → 'https://…/api/scripts'
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
