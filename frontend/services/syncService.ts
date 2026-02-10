/**
 * Sync Service - Handles cross-device data synchronization
 * When user is authenticated, data is synced to the server
 * When user is not authenticated, data is stored locally
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const BACKEND_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
                    process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Storage Keys
const STORAGE_KEYS = {
  AUTH_TOKEN: '@scriptmate_auth_token',
  AUTH_USER: '@scriptmate_auth_user',
  DIRECTOR_NOTES: '@scriptmate_director_notes',
  SETTINGS: '@scriptmate_settings',
  PERFORMANCE_STATS: '@scriptmate_performance_stats',
};

export interface DirectorNote {
  id: string;
  script_id: string;
  line_index: number;
  note_type: string;
  content: string;
  color?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UserSettings {
  default_voice: string;
  default_voice_speed: number;
  auto_advance_enabled: boolean;
  hide_lines_by_default: boolean;
  theme: string;
  notifications_enabled: boolean;
}

export interface PerformanceStats {
  total_rehearsals: number;
  total_lines_completed: number;
  total_practice_time: number;
  average_accuracy: number;
  streak_days: number;
  last_practice_date: string | null;
  script_stats: Array<{
    script_id: string;
    script_title: string;
    total_rehearsals: number;
    total_lines_completed: number;
    average_accuracy: number;
    weak_lines: number[];
    last_practiced: string;
  }>;
}

// Helper to get auth token
async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
}

// Helper to get user ID
async function getUserId(): Promise<string | null> {
  const userStr = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_USER);
  if (userStr) {
    const user = JSON.parse(userStr);
    return user.id;
  }
  return null;
}

// ==================== DIRECTOR NOTES ====================

/**
 * Get all notes for a script
 */
export async function getNotesForScript(scriptId: string): Promise<DirectorNote[]> {
  const userId = await getUserId();
  
  // If authenticated, try server first
  if (userId && BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/notes/${scriptId}?user_id=${userId}`);
      if (response.ok) {
        const serverNotes = await response.json();
        // Cache locally
        await cacheNotesLocally(scriptId, serverNotes);
        return serverNotes;
      }
    } catch (error) {
      console.log('Failed to fetch notes from server, using local cache');
    }
  }
  
  // Fall back to local storage
  return getNotesFromLocal(scriptId);
}

/**
 * Save a note (to server if authenticated, otherwise locally)
 */
export async function saveNote(note: DirectorNote): Promise<DirectorNote> {
  const userId = await getUserId();
  
  // Always save locally first
  await saveNoteLocally(note);
  
  // If authenticated, sync to server
  if (userId && BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/notes?user_id=${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: note.id,
          script_id: note.script_id,
          line_index: note.line_index,
          note_type: note.note_type,
          content: note.content,
          color: note.color,
        }),
      });
      
      if (response.ok) {
        const savedNote = await response.json();
        return savedNote;
      }
    } catch (error) {
      console.error('Failed to sync note to server:', error);
    }
  }
  
  return note;
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: string, scriptId: string): Promise<void> {
  const userId = await getUserId();
  
  // Always delete locally
  await deleteNoteLocally(noteId, scriptId);
  
  // If authenticated, delete from server
  if (userId && BACKEND_URL) {
    try {
      await fetch(`${BACKEND_URL}/api/notes/${noteId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Failed to delete note from server:', error);
    }
  }
}

// Local storage helpers for notes
async function getNotesFromLocal(scriptId: string): Promise<DirectorNote[]> {
  try {
    const allNotesStr = await AsyncStorage.getItem(STORAGE_KEYS.DIRECTOR_NOTES);
    if (allNotesStr) {
      const allNotes = JSON.parse(allNotesStr);
      return allNotes[scriptId] || [];
    }
  } catch (error) {
    console.error('Error getting local notes:', error);
  }
  return [];
}

async function saveNoteLocally(note: DirectorNote): Promise<void> {
  try {
    const allNotesStr = await AsyncStorage.getItem(STORAGE_KEYS.DIRECTOR_NOTES);
    const allNotes = allNotesStr ? JSON.parse(allNotesStr) : {};
    
    if (!allNotes[note.script_id]) {
      allNotes[note.script_id] = [];
    }
    
    // Update or add note
    const existingIndex = allNotes[note.script_id].findIndex((n: DirectorNote) => n.id === note.id);
    if (existingIndex >= 0) {
      allNotes[note.script_id][existingIndex] = note;
    } else {
      allNotes[note.script_id].push(note);
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.DIRECTOR_NOTES, JSON.stringify(allNotes));
  } catch (error) {
    console.error('Error saving note locally:', error);
  }
}

async function deleteNoteLocally(noteId: string, scriptId: string): Promise<void> {
  try {
    const allNotesStr = await AsyncStorage.getItem(STORAGE_KEYS.DIRECTOR_NOTES);
    if (allNotesStr) {
      const allNotes = JSON.parse(allNotesStr);
      if (allNotes[scriptId]) {
        allNotes[scriptId] = allNotes[scriptId].filter((n: DirectorNote) => n.id !== noteId);
        await AsyncStorage.setItem(STORAGE_KEYS.DIRECTOR_NOTES, JSON.stringify(allNotes));
      }
    }
  } catch (error) {
    console.error('Error deleting note locally:', error);
  }
}

async function cacheNotesLocally(scriptId: string, notes: DirectorNote[]): Promise<void> {
  try {
    const allNotesStr = await AsyncStorage.getItem(STORAGE_KEYS.DIRECTOR_NOTES);
    const allNotes = allNotesStr ? JSON.parse(allNotesStr) : {};
    allNotes[scriptId] = notes;
    await AsyncStorage.setItem(STORAGE_KEYS.DIRECTOR_NOTES, JSON.stringify(allNotes));
  } catch (error) {
    console.error('Error caching notes locally:', error);
  }
}

// ==================== USER SETTINGS ====================

const DEFAULT_SETTINGS: UserSettings = {
  default_voice: 'alloy',
  default_voice_speed: 1.0,
  auto_advance_enabled: true,
  hide_lines_by_default: false,
  theme: 'dark',
  notifications_enabled: true,
};

/**
 * Get user settings
 */
export async function getSettings(): Promise<UserSettings> {
  const userId = await getUserId();
  
  // If authenticated, try server first
  if (userId && BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/sync/pull/${userId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          // Cache locally
          await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));
          return { ...DEFAULT_SETTINGS, ...data.settings };
        }
      }
    } catch (error) {
      console.log('Failed to fetch settings from server, using local cache');
    }
  }
  
  // Fall back to local storage
  try {
    const settingsStr = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (settingsStr) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(settingsStr) };
    }
  } catch (error) {
    console.error('Error getting local settings:', error);
  }
  
  return DEFAULT_SETTINGS;
}

/**
 * Save user settings
 */
export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const userId = await getUserId();
  
  // Get current settings and merge
  const currentSettings = await getSettings();
  const newSettings = { ...currentSettings, ...settings };
  
  // Always save locally
  await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
  
  // If authenticated, sync to server
  if (userId && BACKEND_URL) {
    try {
      await fetch(`${BACKEND_URL}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          settings: newSettings,
        }),
      });
    } catch (error) {
      console.error('Failed to sync settings to server:', error);
    }
  }
}

// ==================== PERFORMANCE STATS ====================

const DEFAULT_STATS: PerformanceStats = {
  total_rehearsals: 0,
  total_lines_completed: 0,
  total_practice_time: 0,
  average_accuracy: 0,
  streak_days: 0,
  last_practice_date: null,
  script_stats: [],
};

/**
 * Get performance stats
 */
export async function getPerformanceStats(): Promise<PerformanceStats> {
  const userId = await getUserId();
  
  // If authenticated, try server first
  if (userId && BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/stats/${userId}`);
      if (response.ok) {
        const serverStats = await response.json();
        // Cache locally
        await AsyncStorage.setItem(STORAGE_KEYS.PERFORMANCE_STATS, JSON.stringify({
          global: serverStats,
          scripts: serverStats.script_stats || []
        }));
        return { ...DEFAULT_STATS, ...serverStats };
      }
    } catch (error) {
      console.log('Failed to fetch stats from server, using local cache');
    }
  }
  
  // Fall back to local storage
  try {
    const statsStr = await AsyncStorage.getItem(STORAGE_KEYS.PERFORMANCE_STATS);
    if (statsStr) {
      const parsed = JSON.parse(statsStr);
      return { ...DEFAULT_STATS, ...parsed.global, script_stats: parsed.scripts || [] };
    }
  } catch (error) {
    console.error('Error getting local stats:', error);
  }
  
  return DEFAULT_STATS;
}

/**
 * Update performance stats after a rehearsal
 */
export async function updatePerformanceStats(update: {
  rehearsals_delta?: number;
  lines_delta?: number;
  time_delta?: number;
  accuracy?: number;
  script_id?: string;
  script_title?: string;
}): Promise<void> {
  const userId = await getUserId();
  
  // Update locally
  const currentStats = await getPerformanceStats();
  const today = new Date().toISOString().split('T')[0];
  
  // Calculate streak
  let newStreak = currentStats.streak_days;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  if (currentStats.last_practice_date === yesterdayStr) {
    newStreak += 1;
  } else if (currentStats.last_practice_date !== today) {
    newStreak = 1;
  }
  
  // Calculate new average accuracy
  let newAvgAccuracy = currentStats.average_accuracy;
  if (update.accuracy !== undefined) {
    const totalRehearsals = currentStats.total_rehearsals;
    newAvgAccuracy = ((currentStats.average_accuracy * totalRehearsals) + update.accuracy) / (totalRehearsals + 1);
  }
  
  const updatedStats: PerformanceStats = {
    total_rehearsals: currentStats.total_rehearsals + (update.rehearsals_delta || 0),
    total_lines_completed: currentStats.total_lines_completed + (update.lines_delta || 0),
    total_practice_time: currentStats.total_practice_time + (update.time_delta || 0),
    average_accuracy: Math.round(newAvgAccuracy * 10) / 10,
    streak_days: newStreak,
    last_practice_date: today,
    script_stats: currentStats.script_stats,
  };
  
  // Update script-specific stats if provided
  if (update.script_id && update.script_title) {
    const existingIndex = updatedStats.script_stats.findIndex(s => s.script_id === update.script_id);
    if (existingIndex >= 0) {
      const existing = updatedStats.script_stats[existingIndex];
      const newAccuracy = update.accuracy !== undefined 
        ? ((existing.average_accuracy * existing.total_rehearsals) + update.accuracy) / (existing.total_rehearsals + 1)
        : existing.average_accuracy;
      
      updatedStats.script_stats[existingIndex] = {
        ...existing,
        total_rehearsals: existing.total_rehearsals + (update.rehearsals_delta || 0),
        total_lines_completed: existing.total_lines_completed + (update.lines_delta || 0),
        average_accuracy: Math.round(newAccuracy * 10) / 10,
        last_practiced: today,
      };
    } else {
      updatedStats.script_stats.push({
        script_id: update.script_id,
        script_title: update.script_title,
        total_rehearsals: update.rehearsals_delta || 1,
        total_lines_completed: update.lines_delta || 0,
        average_accuracy: update.accuracy || 0,
        weak_lines: [],
        last_practiced: today,
      });
    }
  }
  
  // Save locally
  await AsyncStorage.setItem(STORAGE_KEYS.PERFORMANCE_STATS, JSON.stringify({
    global: updatedStats,
    scripts: updatedStats.script_stats
  }));
  
  // If authenticated, sync to server
  if (userId && BACKEND_URL) {
    try {
      await fetch(`${BACKEND_URL}/api/stats/${userId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
    } catch (error) {
      console.error('Failed to sync stats to server:', error);
    }
  }
}

/**
 * Sync all local data to server (call after sign-in)
 */
export async function syncAllDataToServer(): Promise<void> {
  const userId = await getUserId();
  if (!userId || !BACKEND_URL) return;
  
  try {
    // Get all local data
    const notesStr = await AsyncStorage.getItem(STORAGE_KEYS.DIRECTOR_NOTES);
    const settingsStr = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
    const statsStr = await AsyncStorage.getItem(STORAGE_KEYS.PERFORMANCE_STATS);
    
    // Flatten notes into array
    const allNotes: DirectorNote[] = [];
    if (notesStr) {
      const notesObj = JSON.parse(notesStr);
      Object.values(notesObj).forEach((scriptNotes: any) => {
        allNotes.push(...scriptNotes);
      });
    }
    
    // Push to server
    await fetch(`${BACKEND_URL}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        director_notes: allNotes.length > 0 ? allNotes : undefined,
        settings: settingsStr ? JSON.parse(settingsStr) : undefined,
        performance_stats: statsStr ? JSON.parse(statsStr).global : undefined,
      }),
    });
    
    console.log('Successfully synced all local data to server');
  } catch (error) {
    console.error('Failed to sync all data to server:', error);
  }
}

/**
 * Pull all data from server (call after sign-in)
 */
export async function pullAllDataFromServer(): Promise<void> {
  const userId = await getUserId();
  if (!userId || !BACKEND_URL) return;
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/sync/pull/${userId}`);
    if (response.ok) {
      const data = await response.json();
      
      // Store notes
      if (data.director_notes && data.director_notes.length > 0) {
        const notesObj: Record<string, DirectorNote[]> = {};
        data.director_notes.forEach((note: DirectorNote) => {
          if (!notesObj[note.script_id]) {
            notesObj[note.script_id] = [];
          }
          notesObj[note.script_id].push(note);
        });
        await AsyncStorage.setItem(STORAGE_KEYS.DIRECTOR_NOTES, JSON.stringify(notesObj));
      }
      
      // Store settings
      if (data.settings) {
        await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));
      }
      
      // Store stats
      if (data.performance_stats) {
        await AsyncStorage.setItem(STORAGE_KEYS.PERFORMANCE_STATS, JSON.stringify({
          global: data.performance_stats,
          scripts: data.performance_stats.script_stats || []
        }));
      }
      
      console.log('Successfully pulled all data from server');
    }
  } catch (error) {
    console.error('Failed to pull data from server:', error);
  }
}
