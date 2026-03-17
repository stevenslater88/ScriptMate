/**
 * API Configuration — HARDCODED production backend URL.
 * 
 * IMPORTANT: This is the single source of truth for the backend URL.
 * Do NOT use environment variables or dynamic resolution here.
 * This ensures the URL is always available at module load time.
 */

export const API_BASE_URL = 'https://script-recovery-1.preview.emergentagent.com';
export const API_TIMEOUT = 15000;

/**
 * Build a full API endpoint URL.
 * Usage: apiUrl('/api/scripts') → 'https://…/api/scripts'
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
