/**
 * API Configuration — HARDCODED backend URL
 * Single source of truth. No environment variables. No switches.
 */

// THE ONLY BACKEND URL - DO NOT CHANGE WITHOUT TESTING
export const API_BASE_URL = 'https://script-recovery-1.preview.emergentagent.com';

export const API_TIMEOUT = 15000;

// For diagnostics display
export const API_CONFIG_SOURCE = 'apiConfig.ts (hardcoded)';

/**
 * Build a full API endpoint URL.
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
