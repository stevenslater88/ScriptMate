/**
 * API Configuration — HARDCODED production backend URL.
 * No process.env, no Constants.expoConfig, no resolve function.
 * This literal string is compiled directly into the JS bundle.
 */

export const API_BASE_URL = 'https://android-upload-test.preview.emergentagent.com';
export const API_TIMEOUT = 15000;

/**
 * Build a full API endpoint URL.
 * Usage: apiUrl('/api/scripts') → 'https://…/api/scripts'
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
