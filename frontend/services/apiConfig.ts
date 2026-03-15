/**
 * API Configuration — Re-exports from appConfig for backward compatibility.
 * 
 * SINGLE SOURCE OF TRUTH: appConfig.ts
 * All backend URL references now flow through AppConfig.BACKEND_URL
 */
import { AppConfig } from './appConfig';

export const API_BASE_URL = AppConfig.BACKEND_URL;
export const API_TIMEOUT = 15000;

/**
 * Build a full API endpoint URL.
 * Usage: apiUrl('/api/scripts') → 'https://…/api/scripts'
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
