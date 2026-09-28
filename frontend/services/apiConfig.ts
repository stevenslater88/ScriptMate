/**
 * API Configuration — HARDCODED backend URL
 * Single source of truth. No environment variables. No switches.
 * 
 * BUILD 1106 - DIAGNOSTIC VERSION
 */

// Backend URL — reads from EXPO_PUBLIC_BACKEND_URL at build/runtime, falls back to production
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || 'https://scriptmate-8.emergent.host';

export const API_TIMEOUT = 15000;

// Extended timeout for endpoints whose latency is dominated by an upstream
// LLM call (currently: POST /api/scripts, which parses via GPT-4o).
// Empirically observed: median ~4s, P99 bursts up to ~25s. A 15s Axios
// timeout was aborting these requests intermittently on real devices with
// "Network Error / no HTTP status" (reproduced under concurrent burst load).
// See regression: backend/tests/test_scripts_create_timeout.py
export const API_TIMEOUT_LLM = 60000;

// For diagnostics display
export const API_CONFIG_SOURCE = 'apiConfig.ts (hardcoded)';

// Build identifier for tracking
export const BUILD_ID = '1110-QA';

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
//
// The previous check hard-coded the substring 'script-recovery-1' (an
// obsolete preview subdomain). ScriptMate's live backend now runs on the
// Emergent production host (e.g. https://scriptmate-8.emergent.host)
// and Emergent preview hosts (*.preview.emergentagent.com). Both are
// legitimate. Accept either; still flag genuinely wrong values (empty,
// or the retired android-upload-test host).
const LEGITIMATE_BACKEND_HOST_SUFFIXES = [
  '.emergent.host',           // production Emergent hosts
  '.preview.emergentagent.com', // Emergent preview environments
];

function isLegitimateBackendUrl(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return LEGITIMATE_BACKEND_HOST_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

if (!API_BASE_URL) {
  console.error('FATAL: API_BASE_URL is empty or undefined!');
}
if (API_BASE_URL.includes('android-upload-test')) {
  console.error('WARNING: API_BASE_URL contains OLD android-upload-test domain!');
}
if (!isLegitimateBackendUrl(API_BASE_URL)) {
  console.error('WARNING: API_BASE_URL is not a recognised Emergent backend host!');
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
    isCorrectDomain: isLegitimateBackendUrl(API_BASE_URL),
    timestamp: new Date().toISOString(),
  };
}
