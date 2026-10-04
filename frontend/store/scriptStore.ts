import { create } from 'zustand';
import axios from 'axios';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { API_BASE_URL, API_TIMEOUT, API_TIMEOUT_LLM, BUILD_ID, getApiDiagnostics } from '../services/apiConfig';
import { getAuthHeader } from '../services/authClient';
import { isDevTestMode } from '../services/devTestMode';
import { checkPremiumAccess } from '../services/revenuecat';
import { DebugLog } from '../services/debugLogService';

// DIAGNOSTIC: Log API config on store load
const apiDiag = getApiDiagnostics();
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║           SCRIPTSTORE LOADED - API CONFIG                     ║');
console.log('╠═══════════════════════════════════════════════════════════════╣');
console.log(`║ BUILD_ID:       ${apiDiag.buildId}`);
console.log(`║ API_BASE_URL:   ${apiDiag.baseUrl}`);
console.log(`║ CORRECT_DOMAIN: ${apiDiag.isCorrectDomain ? 'YES ✓' : 'NO ✗ WRONG!'}`);
console.log('╚═══════════════════════════════════════════════════════════════╝');

function getErrorMessage(error: any): string {
  if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
    return 'Request timed out. Please check your internet connection and try again.';
  }
  if (error?.message === 'Network Error' || !error?.response) {
    return 'Unable to reach server. Please check your internet connection.';
  }
  if (error?.response?.status === 413) {
    return 'File is too large to upload. Please try a smaller file.';
  }
  if (error?.response?.status === 415) {
    return 'Unsupported file type. Please use PDF, DOCX, or TXT files.';
  }
  if (error?.response?.status >= 500) {
    return 'Server error. Please try again in a moment.';
  }
  return error?.response?.data?.detail || error?.message || 'Something went wrong. Please try again.';
}

export interface Character {
  id: string;
  name: string;
  line_count: number;
  is_user_character: boolean;
}

export interface DialogueLine {
  id: string;
  character: string;
  text: string;
  is_stage_direction: boolean;
  line_number: number;
}

export interface Script {
  id: string;
  title: string;
  raw_text: string;
  characters: Character[];
  lines: DialogueLine[];
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface RehearsalSession {
  id: string;
  script_id: string;
  user_id: string;
  user_character: string;
  current_line_index: number;
  completed_lines: number[];
  missed_lines: number[];
  weak_lines: number[];
  total_lines: number;
  mode: string;
  voice_type: string;
  // 2026-02: reader-style wiring. Optional on the type so any legacy
  // rehearsal record fetched from Mongo (pre-migration) doesn't break
  // TypeScript. Backend now always writes these; frontend reads them
  // with `?? 'neutral'` / `?? 1.0` fallbacks.
  reader_style?: string;
  voice_speed?: number;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  device_id: string;
  email?: string;
  name?: string;
  subscription_tier: 'free' | 'premium';
  subscription_plan?: string;
  subscription_start?: string;
  subscription_end?: string;
  trial_used: boolean;
  trial_end?: string;
  scripts_count: number;
  rehearsals_today: number;
  total_rehearsals: number;
  total_lines_practiced: number;
}

export interface TierLimits {
  max_scripts: number;
  max_file_size_mb: number;
  max_rehearsals_per_day: number;
  available_voices: string[];
  available_modes: string[];
  has_performance_mode: boolean;
  has_recording: boolean;
  has_smart_tracking: boolean;
  has_cloud_storage: boolean;
  has_director_notes: boolean;
  show_ads: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  period: string;
  trial_days: number;
  features: string[];
  savings?: string;
}

export interface RegionPricing {
  region: string;
  currency: string;
  currency_symbol: string;
  plans: {
    monthly: SubscriptionPlan;
    yearly: SubscriptionPlan;
  };
}

interface ScriptStore {
  // Scripts
  scripts: Script[];
  currentScript: Script | null;
  
  // Rehearsals
  currentRehearsal: RehearsalSession | null;
  
  // User & Subscription
  user: UserProfile | null;
  deviceId: string | null;
  limits: TierLimits | null;
  subscriptionPlans: { monthly: SubscriptionPlan; yearly: SubscriptionPlan } | null;
  isPremium: boolean;
  region: string;
  currencySymbol: string;
  
  // UI State
  loading: boolean;
  error: string | null;
  
  // User Actions
  initializeUser: () => Promise<void>;
  fetchUserLimits: () => Promise<void>;
  fetchSubscriptionPlans: (region?: string) => Promise<void>;
  startTrial: () => Promise<boolean>;
  subscribe: (plan: string) => Promise<boolean>;
  setRegion: (region: string) => void;
  refreshPremiumStatus: () => Promise<void>; // Refresh after purchase
  syncRevenueCatEntitlement: () => Promise<void>; // Backend self-heal when RC says premium but backend row is stale free
  
  // Script Actions
  fetchScripts: () => Promise<void>;
  fetchScript: (id: string) => Promise<Script | null>;
  createScript: (title: string, rawText: string) => Promise<Script | null>;
  updateScript: (id: string, data: { user_character?: string; title?: string }) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  
  // Rehearsal Actions
  createRehearsal: (
    scriptId: string,
    userCharacter: string,
    mode: string,
    voiceType: string,
    readerStyle?: string,
    voiceSpeed?: number,
  ) => Promise<RehearsalSession | null>;
  fetchRehearsal: (id: string) => Promise<RehearsalSession | null>;
  updateRehearsal: (id: string, data: Partial<RehearsalSession>) => Promise<void>;
  
  // Setters
  setCurrentScript: (script: Script | null) => void;
  setCurrentRehearsal: (rehearsal: RehearsalSession | null) => void;
  setError: (error: string | null) => void;
}

const getDeviceId = async (): Promise<string> => {
  try {
    // Try to get stored device ID
    let deviceId = await AsyncStorage.getItem('device_id');
    if (deviceId) return deviceId;
    
    // Generate new device ID
    const uniqueId = Device.modelId || Device.deviceName || 'unknown';
    deviceId = `${uniqueId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem('device_id', deviceId);
    return deviceId;
  } catch {
    return `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
};

export const useScriptStore = create<ScriptStore>((set, get) => ({
  scripts: [],
  currentScript: null,
  currentRehearsal: null,
  user: null,
  deviceId: null,
  limits: null,
  subscriptionPlans: null,
  isPremium: false,
  region: 'US',
  currencySymbol: '$',
  loading: false,
  error: null,

  initializeUser: async () => {
    try {
      const deviceId = await getDeviceId();
      set({ deviceId });
      
      // Create or get user
      const response = await axios.post(`${API_BASE_URL}/api/users`, {
        device_id: deviceId,
      }, { timeout: API_TIMEOUT });
      
      const user = response.data;
      // Check dev test mode for premium override
      const devMode = await isDevTestMode();
      // Check RevenueCat entitlements (source of truth for purchases)
      const rcPremium = await checkPremiumAccess();
      set({ 
        user, 
        isPremium: devMode || rcPremium || user.subscription_tier === 'premium' 
      });
      
      // Fetch limits and subscription plans
      await get().fetchUserLimits();

      // 2026-02 Physical QA Blocker 2 — if the client-side RevenueCat
      // SDK reports an active entitlement but the backend row has
      // never been marked premium (observed symptom: a user whose
      // purchase pre-dated the ScriptM8 Pro → ScriptMate Pro rename,
      // so /subscribe never completed), ask the backend to self-heal.
      // The backend verifies the entitlement authoritatively via SEC-003
      // RC-REST before writing anything. Fire-and-forget so UI load
      // doesn't block on the extra round-trip.
      if (rcPremium && user.subscription_tier !== 'premium') {
        get().syncRevenueCatEntitlement().catch((err) => {
          console.warn('[ScriptStore] syncRevenueCatEntitlement failed (non-fatal)', err);
        });
      }

      await get().fetchSubscriptionPlans();
    } catch (error: any) {
      console.error('Error initializing user:', error);
      set({ error: getErrorMessage(error) });
    }
  },

  fetchUserLimits: async () => {
    const { deviceId } = get();
    if (!deviceId) return;
    
    try {
      const response = await axios.get(`${API_BASE_URL}/api/users/${deviceId}/limits`, { timeout: API_TIMEOUT });
      const backendIsPremium: boolean = !!response.data.is_premium;

      // ─── 2026-02 Physical QA Blocker — Premium downgrade race ──────────────
      // The backend is the authoritative long-term source of truth for the
      // user's subscription tier, but it can lag RevenueCat when the
      // server-side /subscribe step previously failed (observed symptom
      // post ScriptM8 Pro → ScriptMate Pro entitlement rename: active RC
      // subscription, backend row still 'free'). If we unconditionally
      // overwrite the store's `isPremium` with `backendIsPremium`, a user
      // whose RC entitlement is active but whose backend row is stale will
      // see Performance / Loop locked even though they're paid up.
      //
      // Fix: when the backend says false, re-ask the local RevenueCat SDK
      // (and the dev-test flag) before demoting. If either reports an
      // active entitlement, keep the user premium in the UI. Backend-side
      // feature gates (check_user_limits()) still enforce real access.
      let effectiveIsPremium = backendIsPremium;
      if (!backendIsPremium) {
        const [devMode, rcPremium] = await Promise.all([
          isDevTestMode(),
          checkPremiumAccess(),
        ]);
        effectiveIsPremium = devMode || rcPremium;
      }

      set({
        limits: response.data.limits,
        isPremium: effectiveIsPremium,
      });
    } catch (error: any) {
      console.error('Error fetching limits:', error);
    }
  },

  fetchSubscriptionPlans: async (region?: string) => {
    const currentRegion = region || get().region;
    try {
      const response = await axios.get(`${API_BASE_URL}/api/subscription/plans`, {
        params: { region: currentRegion },
        timeout: API_TIMEOUT,
      });
      set({ 
        subscriptionPlans: response.data.plans,
        region: response.data.region,
        currencySymbol: response.data.currency_symbol,
      });
    } catch (error: any) {
      console.error('Error fetching plans:', error);
    }
  },

  startTrial: async () => {
    const { deviceId } = get();
    if (!deviceId) return false;
    
    try {
      // SEC-003 (Feb 2026): the backend verifies this app_user_id against
      // RevenueCat's REST API before granting Premium. Without a valid id
      // the request is rejected with 400.
      let revenuecat_app_user_id: string | null = null;
      try {
        const Purchases = (await import('react-native-purchases')).default;
        revenuecat_app_user_id = await Purchases.getAppUserID();
      } catch (rcErr) {
        console.warn('[ScriptStore] startTrial: cannot resolve RC app_user_id', rcErr);
      }
      const response = await axios.post(
        `${API_BASE_URL}/api/users/${deviceId}/start-trial`,
        { revenuecat_app_user_id },
        { timeout: API_TIMEOUT },
      );
      set({ 
        user: response.data, 
        isPremium: true 
      });
      await get().fetchUserLimits();
      return true;
    } catch (error: any) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  subscribe: async (plan: string) => {
    const { deviceId } = get();
    if (!deviceId) return false;
    
    try {
      // SEC-003 (Feb 2026): backend requires a RevenueCat app_user_id and
      // independently verifies an active Premium entitlement before
      // writing subscription_tier=premium. 402 is returned if the
      // entitlement is missing/expired.
      let revenuecat_app_user_id: string | null = null;
      try {
        const Purchases = (await import('react-native-purchases')).default;
        revenuecat_app_user_id = await Purchases.getAppUserID();
      } catch (rcErr) {
        console.warn('[ScriptStore] subscribe: cannot resolve RC app_user_id', rcErr);
      }
      const response = await axios.post(
        `${API_BASE_URL}/api/users/${deviceId}/subscribe`,
        { plan, revenuecat_app_user_id },
        { timeout: API_TIMEOUT },
      );
      set({ 
        user: response.data, 
        isPremium: true 
      });
      await get().fetchUserLimits();
      return true;
    } catch (error: any) {
      set({ error: getErrorMessage(error) });
      return false;
    }
  },

  setRegion: (region: string) => {
    const symbols: Record<string, string> = { US: '$', GB: '£', EU: '€' };
    set({ region, currencySymbol: symbols[region] || '$' });
    get().fetchSubscriptionPlans(region);
  },

  // Refresh premium status from RevenueCat - call after any purchase/restore
  refreshPremiumStatus: async () => {
    try {
      const devMode = await isDevTestMode();
      const rcPremium = await checkPremiumAccess();
      // Refresh backend limits so the QA_PREMIUM env bypass (or a real
      // server-side subscription_tier) is honoured after this refresh.
      // Without this, refreshPremiumStatus() would clobber a valid QA
      // premium flag with a plain RC-derived value.
      await get().fetchUserLimits();
      const backendPremium = get().isPremium;
      console.log(`[ScriptStore] refreshPremiumStatus: devMode=${devMode}, rcPremium=${rcPremium}, backendPremium=${backendPremium}`);
      set({ isPremium: backendPremium || devMode || rcPremium });
    } catch (error) {
      console.error('[ScriptStore] Error refreshing premium status:', error);
    }
  },

  // 2026-02 Physical QA Blocker 2 — backend self-heal entry point.
  // Asks the backend to re-fetch this device's RevenueCat entitlement
  // via SEC-003 server-side verification and lift subscription_tier
  // to 'premium' if active. Repairs the stale-free-row state that
  // caused Performance/Loop rehearsal modes to 403 even when the user
  // held an active ScriptMate Pro entitlement.
  //
  // Idempotent and safe to call on every launch — the backend never
  // demotes an already-premium row from this endpoint.
  syncRevenueCatEntitlement: async () => {
    const { deviceId } = get();
    if (!deviceId) return;

    try {
      const Purchases = (await import('react-native-purchases')).default;
      const revenuecat_app_user_id = await Purchases.getAppUserID();
      if (!revenuecat_app_user_id) {
        console.log('[ScriptStore] syncRevenueCatEntitlement: no RC app_user_id, skipping');
        return;
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/users/${deviceId}/revenuecat/sync`,
        { revenuecat_app_user_id },
        // 2026-02 SCRIPT M8 LAUNCH-SAFETY — SEC-002 requires a bearer on
        // every write to the user's own row. The previous call sent no
        // Authorization header, so prod 401-rejected it silently and the
        // backend NEVER persisted `revenuecat_app_user_id`. Without the
        // persisted rcid, the resolver's header-less fallback could not
        // self-heal. Attach the standard auth header + the RC id header.
        { timeout: API_TIMEOUT, headers: await getAuthHeader() },
      );

      if (response.data?.is_premium) {
        console.log('[ScriptStore] syncRevenueCatEntitlement: lifted backend to premium');
        set({ isPremium: true });
        // Re-fetch limits so PREMIUM_TIER_LIMITS (unlimited scripts,
        // all modes, etc.) replace FREE_TIER_LIMITS in the store.
        await get().fetchUserLimits();
      }
    } catch (err: any) {
      // Silent: next launch will retry. Backend 404/503 are both
      // non-fatal — the client-side RC fallback in fetchUserLimits
      // keeps UI unlocked while we wait.
      console.warn('[ScriptStore] syncRevenueCatEntitlement failed', err?.response?.status ?? err?.message);
    }
  },

  fetchScripts: async () => {
    const deviceId = await getDeviceId();
    set({ loading: true, error: null });
    try {
      // SEC-002: bearer required; the backend ignores query/body user_id
      // and keys the list to the authenticated identity.
      const authHeader = await getAuthHeader();
      const response = await axios.get(`${API_BASE_URL}/api/scripts`, {
        headers: authHeader,
        timeout: API_TIMEOUT,
      });
      set({ scripts: response.data, loading: false });
    } catch (error: any) {
      set({ error: getErrorMessage(error), loading: false });
      console.error('Error fetching scripts:', error);
    }
  },

  fetchScript: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const authHeader = await getAuthHeader();
      const response = await axios.get(`${API_BASE_URL}/api/scripts/${id}`, {
        headers: authHeader,
        timeout: API_TIMEOUT,
      });
      const script = response.data;
      set((state) => {
        const exists = state.scripts.some(s => s.id === id);
        return {
          currentScript: script,
          scripts: exists
            ? state.scripts.map(s => s.id === id ? script : s)
            : [script, ...state.scripts],
          loading: false,
        };
      });
      return script;
    } catch (error: any) {
      set({ error: getErrorMessage(error), loading: false });
      console.error('Error fetching script:', error);
      return null;
    }
  },

  createScript: async (title: string, rawText: string) => {
    const deviceId = await getDeviceId();
    set({ loading: true, error: null });
    
    // FORENSIC: Log function start
    DebugLog.functionStart('createScript', { 
      title: title?.substring(0, 50), 
      rawTextLength: rawText?.length || 0,
      deviceId: deviceId?.substring(0, 20),
    });
    
    const startTime = Date.now();
    const endpoint = '/api/scripts';
    const url = `${API_BASE_URL}${endpoint}`;
    
    // FORENSIC: Log API request
    const requestId = DebugLog.apiRequest('POST', API_BASE_URL, endpoint, 
      `title=${title?.substring(0, 30)}, textLen=${rawText?.length}`);
    
    try {
      // DIAGNOSTIC: Log exact URL being used
      console.log(`[ScriptStore] ========== CREATE SCRIPT DEBUG ==========`);
      console.log(`[ScriptStore] createScript: POST ${url}`);
      console.log(`[ScriptStore] API_BASE_URL = "${API_BASE_URL}"`);
      console.log(`[ScriptStore] deviceId = "${deviceId}"`);
      console.log(`[ScriptStore] title = "${title?.substring(0, 50)}"`);
      console.log(`[ScriptStore] rawText length = ${rawText?.length || 0}`);
      console.log(`[ScriptStore] ===========================================`);
      
      // Validate inputs before request
      if (!url || url.includes('undefined')) {
        throw new Error(`Invalid URL: ${url}`);
      }
      if (!deviceId) {
        throw new Error('No device ID available');
      }
      
      const response = await axios.post(url, {
        title,
        raw_text: rawText,
        user_id: deviceId,
      }, {
        headers: await getAuthHeader(),
        timeout: API_TIMEOUT_LLM,
      });
      
      const durationMs = Date.now() - startTime;
      const newScript = response.data;
      
      // FORENSIC: Log API success
      DebugLog.apiResponse(requestId, 'POST', endpoint, response.status, durationMs, 
        `id=${newScript?.id}`);
      DebugLog.functionSuccess('createScript', { scriptId: newScript?.id });
      
      console.log(`[ScriptStore] createScript success: id=${newScript?.id}`);
      set((state) => ({
        scripts: [newScript, ...state.scripts],
        currentScript: newScript,
        loading: false,
      }));
      return newScript;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);
      const requestUrl = error?.config?.url || 'unknown';
      const status = error?.response?.status || 'no status';
      const responseData = JSON.stringify(error?.response?.data || {});
      
      // FORENSIC: Log API error
      DebugLog.apiError(requestId, 'POST', endpoint, status, errorMsg, durationMs);
      DebugLog.functionError('createScript', error);
      
      // DIAGNOSTIC: Enhanced failure logging
      console.error(`[ScriptStore] ========== CREATE SCRIPT FAILED ==========`);
      console.error(`[ScriptStore] Attempted URL: ${requestUrl}`);
      console.error(`[ScriptStore] API_BASE_URL was: ${API_BASE_URL}`);
      console.error(`[ScriptStore] Status: ${status}`);
      console.error(`[ScriptStore] Response: ${responseData}`);
      console.error(`[ScriptStore] Error: ${errorMsg}`);
      console.error(`[ScriptStore] Full error object: ${JSON.stringify(error, null, 2)}`);
      console.error(`[ScriptStore] ===========================================`);
      set({ error: `${errorMsg} [URL: ${requestUrl}, Status: ${status}]`, loading: false });
      return null;
    }
  },

  updateScript: async (id: string, data) => {
    set({ loading: true, error: null });
    
    // Validate ID before making request
    if (!id || id === 'undefined' || id === 'null') {
      console.error(`[ScriptStore] updateScript INVALID ID: "${id}"`);
      set({ error: `Invalid script ID: ${id}`, loading: false });
      return;
    }
    
    try {
      const url = `${API_BASE_URL}/api/scripts/${id}`;
      console.log(`[ScriptStore] updateScript: PUT ${url}`);
      console.log(`[ScriptStore] updateScript id="${id}" (type: ${typeof id})`);
      console.log(`[ScriptStore] updateScript data: ${JSON.stringify(data)}`);
      
      // Check for undefined in URL
      if (url.includes('undefined')) {
        throw new Error(`URL contains undefined: ${url}`);
      }
      
      const response = await axios.put(url, data, {
        headers: await getAuthHeader(),
        timeout: API_TIMEOUT,
      });
      console.log(`[ScriptStore] updateScript success for id=${id}`);
      set((state) => ({
        scripts: state.scripts.map((s) => (s.id === id ? response.data : s)),
        currentScript: state.currentScript?.id === id ? response.data : state.currentScript,
        loading: false,
      }));
    } catch (error: any) {
      const errorMsg = getErrorMessage(error);
      const requestUrl = error?.config?.url || 'unknown';
      const status = error?.response?.status || 'no status';
      const responseData = JSON.stringify(error?.response?.data || {});
      console.error(`[ScriptStore] updateScript FAILED:`);
      console.error(`  ID: ${id}`);
      console.error(`  URL: ${requestUrl}`);
      console.error(`  Status: ${status}`);
      console.error(`  Response: ${responseData}`);
      console.error(`  Error: ${errorMsg}`);
      set({ error: `${errorMsg} [URL: ${requestUrl}, Status: ${status}]`, loading: false });
    }
  },

  deleteScript: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await axios.delete(`${API_BASE_URL}/api/scripts/${id}`, {
        headers: await getAuthHeader(),
        timeout: API_TIMEOUT,
      });
      set((state) => ({
        scripts: state.scripts.filter((s) => s.id !== id),
        currentScript: state.currentScript?.id === id ? null : state.currentScript,
        loading: false,
      }));
    } catch (error: any) {
      set({ error: getErrorMessage(error), loading: false });
      console.error('Error deleting script:', error);
    }
  },

  createRehearsal: async (
    scriptId: string,
    userCharacter: string,
    mode: string,
    voiceType: string,
    readerStyle: string = 'neutral',
    voiceSpeed: number = 1.0,
  ) => {
    const { deviceId } = get();
    set({ loading: true, error: null });
    try {
      const response = await axios.post(`${API_BASE_URL}/api/rehearsals`, {
        script_id: scriptId,
        user_character: userCharacter,
        mode,
        voice_type: voiceType,
        // 2026-02 reader-style wiring. Backend defaults these to
        // 'neutral' / 1.0 if omitted, preserving pre-2026-02
        // client behaviour bit-for-bit.
        reader_style: readerStyle,
        voice_speed: voiceSpeed,
        user_id: deviceId || 'default',
      }, {
        headers: await getAuthHeader(),
        timeout: API_TIMEOUT,
      });
      set({ currentRehearsal: response.data, loading: false });
      return response.data;
    } catch (error: any) {
      const errorMsg = getErrorMessage(error);
      set({ error: errorMsg, loading: false });
      console.error('Error creating rehearsal:', error);
      return null;
    }
  },

  fetchRehearsal: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.get(`${API_BASE_URL}/api/rehearsals/${id}`, {
        headers: await getAuthHeader(),
        timeout: API_TIMEOUT,
      });
      set({ currentRehearsal: response.data, loading: false });
      return response.data;
    } catch (error: any) {
      set({ error: getErrorMessage(error), loading: false });
      console.error('Error fetching rehearsal:', error);
      return null;
    }
  },

  updateRehearsal: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.put(`${API_BASE_URL}/api/rehearsals/${id}`, data, {
        headers: await getAuthHeader(),
        timeout: API_TIMEOUT,
      });
      set({ currentRehearsal: response.data, loading: false });
    } catch (error: any) {
      set({ error: getErrorMessage(error), loading: false });
      console.error('Error updating rehearsal:', error);
    }
  },

  setCurrentScript: (script) => set({ currentScript: script }),
  setCurrentRehearsal: (rehearsal) => set({ currentRehearsal: rehearsal }),
  setError: (error) => set({ error }),
}));
