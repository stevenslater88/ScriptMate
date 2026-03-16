import { create } from 'zustand';
import axios from 'axios';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_URL, API_TIMEOUT } from '../services/apiConfig';
import { isDevTestMode } from '../services/devTestMode';
import { checkPremiumAccess } from '../services/revenuecat';

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
  
  // Script Actions
  fetchScripts: () => Promise<void>;
  fetchScript: (id: string) => Promise<Script | null>;
  createScript: (title: string, rawText: string) => Promise<Script | null>;
  updateScript: (id: string, data: { user_character?: string; title?: string }) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  
  // Rehearsal Actions
  createRehearsal: (scriptId: string, userCharacter: string, mode: string, voiceType: string) => Promise<RehearsalSession | null>;
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
      set({ 
        limits: response.data.limits,
        isPremium: response.data.is_premium,
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
      const response = await axios.post(`${API_BASE_URL}/api/users/${deviceId}/start-trial`, {}, { timeout: API_TIMEOUT });
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
      const response = await axios.post(`${API_BASE_URL}/api/users/${deviceId}/subscribe`, {
        plan,
      }, { timeout: API_TIMEOUT });
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

  fetchScripts: async () => {
    const deviceId = await getDeviceId();
    set({ loading: true, error: null });
    try {
      const response = await axios.get(`${API_BASE_URL}/api/scripts`, {
        params: { user_id: deviceId },
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
      const response = await axios.get(`${API_BASE_URL}/api/scripts/${id}`, { timeout: API_TIMEOUT });
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
    try {
      const url = `${API_BASE_URL}/api/scripts`;
      console.log(`[ScriptStore] createScript: POST ${url}`);
      console.log(`[ScriptStore] API_BASE_URL = "${API_BASE_URL}"`);
      const response = await axios.post(url, {
        title,
        raw_text: rawText,
        user_id: deviceId,
      }, { timeout: API_TIMEOUT });
      const newScript = response.data;
      console.log(`[ScriptStore] createScript success: id=${newScript?.id}`);
      set((state) => ({
        scripts: [newScript, ...state.scripts],
        currentScript: newScript,
        loading: false,
      }));
      return newScript;
    } catch (error: any) {
      const errorMsg = getErrorMessage(error);
      const requestUrl = error?.config?.url || 'unknown';
      console.error(`[ScriptStore] createScript error: ${errorMsg}, URL: ${requestUrl}`);
      set({ error: errorMsg, loading: false });
      return null;
    }
  },

  updateScript: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const url = `${API_BASE_URL}/api/scripts/${id}`;
      console.log(`[ScriptStore] updateScript: PUT ${url}`);
      console.log(`[ScriptStore] updateScript data:`, JSON.stringify(data));
      const response = await axios.put(url, data, { timeout: API_TIMEOUT });
      console.log(`[ScriptStore] updateScript success for id=${id}`);
      set((state) => ({
        scripts: state.scripts.map((s) => (s.id === id ? response.data : s)),
        currentScript: state.currentScript?.id === id ? response.data : state.currentScript,
        loading: false,
      }));
    } catch (error: any) {
      const errorMsg = getErrorMessage(error);
      const requestUrl = error?.config?.url || 'unknown';
      console.error(`[ScriptStore] updateScript error: ${errorMsg}, URL: ${requestUrl}`);
      set({ error: errorMsg, loading: false });
    }
  },

  deleteScript: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await axios.delete(`${API_BASE_URL}/api/scripts/${id}`, { timeout: API_TIMEOUT });
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

  createRehearsal: async (scriptId: string, userCharacter: string, mode: string, voiceType: string) => {
    const { deviceId } = get();
    set({ loading: true, error: null });
    try {
      const response = await axios.post(`${API_BASE_URL}/api/rehearsals`, {
        script_id: scriptId,
        user_character: userCharacter,
        mode,
        voice_type: voiceType,
        user_id: deviceId || 'default',
      }, { timeout: API_TIMEOUT });
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
      const response = await axios.get(`${API_BASE_URL}/api/rehearsals/${id}`, { timeout: API_TIMEOUT });
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
      const response = await axios.put(`${API_BASE_URL}/api/rehearsals/${id}`, data, { timeout: API_TIMEOUT });
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
