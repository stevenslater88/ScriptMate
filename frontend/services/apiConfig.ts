/**
 * API Configuration — Backend URL Override Patch
 * 
 * QUICK SWITCH: Change ACTIVE_BACKEND below to switch environments instantly.
 * No other code changes needed. Rebuild app after changing.
 */

// ═══════════════════════════════════════════════════════════════════════════
// BACKEND SWITCH - CHANGE THIS VALUE TO SWITCH ENVIRONMENTS
// ═══════════════════════════════════════════════════════════════════════════
const ACTIVE_BACKEND: 'PREVIEW' | 'PRODUCTION' | 'LOCAL' = 'PREVIEW';
// ═══════════════════════════════════════════════════════════════════════════

// Backend URL Options
const BACKENDS = {
  PREVIEW: 'https://script-recovery-1.preview.emergentagent.com',
  PRODUCTION: 'https://script.emergentagent.com',
  LOCAL: 'http://192.168.1.100:4000', // <-- Replace with your local IP
};

// Active URL (DO NOT MODIFY BELOW THIS LINE)
export const API_BASE_URL = BACKENDS[ACTIVE_BACKEND];
export const API_TIMEOUT = 15000;

// Config source for diagnostics
export const API_CONFIG_SOURCE = `apiConfig.ts (${ACTIVE_BACKEND})`;

// Fail-safe validation
if (!API_BASE_URL || API_BASE_URL.includes('undefined')) {
  console.error('FATAL: API_BASE_URL is invalid:', API_BASE_URL);
  throw new Error('FATAL CONFIG ERROR: Backend URL is not configured.');
}

// Log active backend on load
console.log(`[apiConfig] Active backend: ${ACTIVE_BACKEND}`);
console.log(`[apiConfig] URL: ${API_BASE_URL}`);

/**
 * Build a full API endpoint URL.
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
