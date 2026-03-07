import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const VOICE_DIR = `${FileSystem.documentDirectory}voice-studio/`;
const TAKES_INDEX_KEY = 'voice_studio_takes';
const REELS_INDEX_KEY = 'voice_studio_reels';

export interface VoiceTake {
  id: string;
  name: string;
  uri: string;
  duration: number; // seconds
  scriptId?: string;
  scriptTitle?: string;
  createdAt: string;
  processedUri?: string; // trimmed/normalized version
}

export interface DemoReel {
  id: string;
  name: string;
  uri: string;
  duration: number;
  takeIds: string[];
  createdAt: string;
}

const ensureDir = async () => {
  const info = await FileSystem.getInfoAsync(VOICE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(VOICE_DIR, { intermediates: true });
  }
};

export const saveTake = async (
  tempUri: string,
  name: string,
  duration: number,
  scriptId?: string,
  scriptTitle?: string,
): Promise<VoiceTake> => {
  await ensureDir();
  const id = `take_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const ext = tempUri.includes('.wav') ? 'wav' : 'm4a';
  const filename = `${id}.${ext}`;
  const permanentUri = `${VOICE_DIR}${filename}`;

  await FileSystem.copyAsync({ from: tempUri, to: permanentUri });

  const take: VoiceTake = {
    id,
    name,
    uri: permanentUri,
    duration,
    scriptId,
    scriptTitle,
    createdAt: new Date().toISOString(),
  };

  const takes = await getTakes();
  takes.unshift(take);
  await AsyncStorage.setItem(TAKES_INDEX_KEY, JSON.stringify(takes));
  return take;
};

export const getTakes = async (): Promise<VoiceTake[]> => {
  try {
    const data = await AsyncStorage.getItem(TAKES_INDEX_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const updateTake = async (id: string, updates: Partial<VoiceTake>): Promise<void> => {
  const takes = await getTakes();
  const idx = takes.findIndex(t => t.id === id);
  if (idx >= 0) {
    takes[idx] = { ...takes[idx], ...updates };
    await AsyncStorage.setItem(TAKES_INDEX_KEY, JSON.stringify(takes));
  }
};

export const deleteTake = async (id: string): Promise<void> => {
  const takes = await getTakes();
  const take = takes.find(t => t.id === id);
  if (take) {
    try { await FileSystem.deleteAsync(take.uri, { idempotent: true }); } catch {}
    if (take.processedUri) {
      try { await FileSystem.deleteAsync(take.processedUri, { idempotent: true }); } catch {}
    }
    await AsyncStorage.setItem(TAKES_INDEX_KEY, JSON.stringify(takes.filter(t => t.id !== id)));
  }
};

export const saveReel = async (uri: string, name: string, duration: number, takeIds: string[]): Promise<DemoReel> => {
  await ensureDir();
  const id = `reel_${Date.now()}`;
  const filename = `${id}.mp3`;
  const permanentUri = `${VOICE_DIR}${filename}`;

  await FileSystem.copyAsync({ from: uri, to: permanentUri });

  const reel: DemoReel = { id, name, uri: permanentUri, duration, takeIds, createdAt: new Date().toISOString() };
  const reels = await getReels();
  reels.unshift(reel);
  await AsyncStorage.setItem(REELS_INDEX_KEY, JSON.stringify(reels));
  return reel;
};

export const getReels = async (): Promise<DemoReel[]> => {
  try {
    const data = await AsyncStorage.getItem(REELS_INDEX_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const deleteReel = async (id: string): Promise<void> => {
  const reels = await getReels();
  const reel = reels.find(r => r.id === id);
  if (reel) {
    try { await FileSystem.deleteAsync(reel.uri, { idempotent: true }); } catch {}
    await AsyncStorage.setItem(REELS_INDEX_KEY, JSON.stringify(reels.filter(r => r.id !== id)));
  }
};
