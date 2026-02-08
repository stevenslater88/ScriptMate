import { create } from 'zustand';
import axios from 'axios';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

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
  created_at: string;
  updated_at: string;
}

export interface RehearsalSession {
  id: string;
  script_id: string;
  user_character: string;
  current_line_index: number;
  completed_lines: number[];
  missed_lines: number[];
  total_lines: number;
  mode: string;
  voice_type: string;
  created_at: string;
  updated_at: string;
}

interface ScriptStore {
  scripts: Script[];
  currentScript: Script | null;
  currentRehearsal: RehearsalSession | null;
  loading: boolean;
  error: string | null;
  
  fetchScripts: () => Promise<void>;
  fetchScript: (id: string) => Promise<Script | null>;
  createScript: (title: string, rawText: string) => Promise<Script | null>;
  updateScript: (id: string, data: { user_character?: string; title?: string }) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  
  createRehearsal: (scriptId: string, userCharacter: string, mode: string, voiceType: string) => Promise<RehearsalSession | null>;
  fetchRehearsal: (id: string) => Promise<RehearsalSession | null>;
  updateRehearsal: (id: string, data: Partial<RehearsalSession>) => Promise<void>;
  
  setCurrentScript: (script: Script | null) => void;
  setCurrentRehearsal: (rehearsal: RehearsalSession | null) => void;
  setError: (error: string | null) => void;
}

export const useScriptStore = create<ScriptStore>((set, get) => ({
  scripts: [],
  currentScript: null,
  currentRehearsal: null,
  loading: false,
  error: null,

  fetchScripts: async () => {
    set({ loading: true, error: null });
    try {
      const response = await axios.get(`${BACKEND_URL}/api/scripts`);
      set({ scripts: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error fetching scripts:', error);
    }
  },

  fetchScript: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.get(`${BACKEND_URL}/api/scripts/${id}`);
      set({ currentScript: response.data, loading: false });
      return response.data;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error fetching script:', error);
      return null;
    }
  },

  createScript: async (title: string, rawText: string) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.post(`${BACKEND_URL}/api/scripts`, {
        title,
        raw_text: rawText,
      });
      const newScript = response.data;
      set((state) => ({
        scripts: [newScript, ...state.scripts],
        currentScript: newScript,
        loading: false,
      }));
      return newScript;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error creating script:', error);
      return null;
    }
  },

  updateScript: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.put(`${BACKEND_URL}/api/scripts/${id}`, data);
      set((state) => ({
        scripts: state.scripts.map((s) => (s.id === id ? response.data : s)),
        currentScript: state.currentScript?.id === id ? response.data : state.currentScript,
        loading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error updating script:', error);
    }
  },

  deleteScript: async (id: string) => {
    set({ loading: true, error: null });
    try {
      await axios.delete(`${BACKEND_URL}/api/scripts/${id}`);
      set((state) => ({
        scripts: state.scripts.filter((s) => s.id !== id),
        currentScript: state.currentScript?.id === id ? null : state.currentScript,
        loading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error deleting script:', error);
    }
  },

  createRehearsal: async (scriptId: string, userCharacter: string, mode: string, voiceType: string) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.post(`${BACKEND_URL}/api/rehearsals`, {
        script_id: scriptId,
        user_character: userCharacter,
        mode,
        voice_type: voiceType,
      });
      set({ currentRehearsal: response.data, loading: false });
      return response.data;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error creating rehearsal:', error);
      return null;
    }
  },

  fetchRehearsal: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.get(`${BACKEND_URL}/api/rehearsals/${id}`);
      set({ currentRehearsal: response.data, loading: false });
      return response.data;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error fetching rehearsal:', error);
      return null;
    }
  },

  updateRehearsal: async (id: string, data) => {
    set({ loading: true, error: null });
    try {
      const response = await axios.put(`${BACKEND_URL}/api/rehearsals/${id}`, data);
      set({ currentRehearsal: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
      console.error('Error updating rehearsal:', error);
    }
  },

  setCurrentScript: (script) => set({ currentScript: script }),
  setCurrentRehearsal: (rehearsal) => set({ currentRehearsal: rehearsal }),
  setError: (error) => set({ error }),
}));
