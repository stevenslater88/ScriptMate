/**
 * authClient.ts
 * -----------------------------------------------------------------
 * Thin shared helpers for attaching the ScriptMate bearer token to
 * protected backend requests. The bearer-minting logic itself lives
 * in `./elevenLabsService.ts::ensureTtsBearerToken` — this file is a
 * convenience layer so the scripts, notes, stats and daily-drill
 * callers do not each have to:
 *
 *   1) know about `/api/auth/device-session`
 *   2) remember to call `ensureTtsBearerToken` before each request
 *   3) know the exact Authorization header syntax
 *
 * SEC-002 (2026-02): the backend now gates every protected route
 * on this bearer. Any caller that previously relied on the backend
 * accepting a bare `?user_id=` must switch to one of the helpers
 * exported below; otherwise the server responds 401.
 *
 * The bearer is reused across all protected endpoints — it is NOT
 * scoped to TTS. Minting a single device session unlocks the whole
 * authenticated surface for that device.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

import { ensureTtsBearerToken } from './elevenLabsService';

/**
 * Resolve the current bearer, minting a new device-session if needed.
 * Returns `null` only when the backend was unreachable during minting
 * (same semantics as `ensureTtsBearerToken`). Callers that treat the
 * backend as optional should fall back to local-only behaviour when
 * this returns `null`; callers that require the backend should surface
 * an auth error to the user.
 */
export async function getAuthBearerToken(): Promise<string | null> {
  return ensureTtsBearerToken();
}

/**
 * Build an `Authorization: Bearer <token>` header, or `{}` if no bearer
 * is available. Never throws — the returned object can be spread into
 * any `headers` map safely.
 */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getAuthBearerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * `fetch` wrapper that attaches the bearer header automatically. Falls
 * back to a bearer-less request only when minting failed (same
 * tolerance as the pre-SEC-002 code).
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const authHeader = await getAuthHeader();
  const mergedHeaders: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    ...authHeader,
  };
  return fetch(input, { ...(init ?? {}), headers: mergedHeaders });
}

/**
 * `axios` wrapper that attaches the bearer header automatically. Keeps
 * the rest of the existing axios config (timeout, params, etc.)
 * unchanged. Returns the raw axios response so callers can continue
 * using `response.data`, `response.status`, etc.
 */
export async function authAxios<T = any>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  config?: AxiosRequestConfig,
  data?: any,
): Promise<AxiosResponse<T>> {
  const authHeader = await getAuthHeader();
  const mergedConfig: AxiosRequestConfig = {
    ...(config ?? {}),
    headers: {
      ...(config?.headers as Record<string, string> | undefined),
      ...authHeader,
    },
  };
  if (method === 'GET' || method === 'DELETE') {
    return axios.request<T>({ ...mergedConfig, method, url });
  }
  return axios.request<T>({ ...mergedConfig, method, url, data });
}
