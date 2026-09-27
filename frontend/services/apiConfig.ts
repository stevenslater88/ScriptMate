/**
 * API Configuration — HARDCODED backend URL
 * Single source of truth. No environment variables. No switches.
 * 
 * BUILD 1106 - DIAGNOSTIC VERSION
 */

// THE ONLY BACKEND URL - DO NOT CHANGE WITHOUT TESTING
export const API_BASE_URL = 'https://script-recovery-1.preview.emergentagent.com';

export const API_TIMEOUT = 15000;

// For diagnostics display
export const API_CONFIG_SOURCE = 'apiConfig.ts (hardcoded)';

// Build identifier for tracking
export const BUILD_ID = '1107-DIAG';

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC: Log URL on module load (will appear in device logs)
// ═══════════════════════════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║           SCRIPTM8 API CONFIG LOADED                          ║');
console.log('╠═══════════════════════════════════════════════════════════════╣');
console.log(`║ BUILD_ID:     ${BUILD_ID}`);
console.log(`║ API_BASE_URL: ${API_BASE_URL}`);
console.log(`║ CONFIG_SRC:   ${API_CONFIG_SOURCE}`);
console.log(`║ TIMESTAMP:    ${new Date().toISOString()}`);
console.log('╚═══════════════════════════════════════════════════════════════╝');

// DIAGNOSTIC: Validate URL on load
if (!API_BASE_URL) {
  console.error('FATAL: API_BASE_URL is empty or undefined!');
}
if (API_BASE_URL.includes('android-upload-test')) {
  console.error('WARNING: API_BASE_URL contains OLD android-upload-test domain!');
}
if (!API_BASE_URL.includes('script-recovery-1')) {
  console.error('WARNING: API_BASE_URL does not contain expected script-recovery-1 domain!');
  console.error('ACTUAL URL:', API_BASE_URL);
}

/**
 * Build a full API endpoint URL with logging.
 */
export function apiUrl(path: string): string {
  const fullUrl = `${API_BASE_URL}${path}`;
  console.log(`[apiConfig] apiUrl("${path}") => "${fullUrl}"`);
  return fullUrl;
}

/**
 * Get diagnostic info about API config
 */
export function getApiDiagnostics(): {
  baseUrl: string;
  configSource: string;
  buildId: string;
  isCorrectDomain: boolean;
  timestamp: string;
} {
  return {
    baseUrl: API_BASE_URL,
    configSource: API_CONFIG_SOURCE,
    buildId: BUILD_ID,
    isCorrectDomain: API_BASE_URL.includes('script-recovery-1'),
    timestamp: new Date().toISOString(),
  };
}
