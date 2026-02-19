import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SELF_TAPE_DIR = `${FileSystem.documentDirectory}selftapes/`;
const SELF_TAPE_INDEX_KEY = 'selftape_recordings';

export interface SelfTapeRecording {
  id: string;
  scriptId: string;
  scriptTitle: string;
  sceneIndex: number;
  sceneName: string;
  uri: string;
  duration: number;
  createdAt: string;
  thumbnail?: string;
  filename: string;
}

// Generate formatted filename
const generateFilename = (scriptTitle: string, sceneName: string): string => {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .split('.')[0];
  
  // Sanitize names for filesystem
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  
  return `ScriptMate_${sanitize(scriptTitle)}_${sanitize(sceneName)}_${timestamp}.mp4`;
};

// Ensure directory exists
export const ensureDirectory = async (): Promise<void> => {
  const dirInfo = await FileSystem.getInfoAsync(SELF_TAPE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(SELF_TAPE_DIR, { intermediates: true });
  }
};

// Save recording with proper filename
export const saveRecording = async (
  tempUri: string,
  scriptId: string,
  scriptTitle: string,
  sceneIndex: number,
  sceneName: string,
  duration: number
): Promise<SelfTapeRecording> => {
  await ensureDirectory();
  
  const id = `selftape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const filename = generateFilename(scriptTitle, sceneName);
  const permanentUri = `${SELF_TAPE_DIR}${filename}`;
  
  // Copy from temp to permanent location
  await FileSystem.copyAsync({
    from: tempUri,
    to: permanentUri,
  });
  
  const recording: SelfTapeRecording = {
    id,
    scriptId,
    scriptTitle,
    sceneIndex,
    sceneName,
    uri: permanentUri,
    duration,
    createdAt: new Date().toISOString(),
    filename,
  };
  
  // Update index
  const recordings = await getRecordings();
  recordings.unshift(recording);
  await AsyncStorage.setItem(SELF_TAPE_INDEX_KEY, JSON.stringify(recordings));
  
  return recording;
};

// Get all recordings
export const getRecordings = async (): Promise<SelfTapeRecording[]> => {
  try {
    const data = await AsyncStorage.getItem(SELF_TAPE_INDEX_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Get recordings for a script
export const getRecordingsForScript = async (scriptId: string): Promise<SelfTapeRecording[]> => {
  const all = await getRecordings();
  return all.filter(r => r.scriptId === scriptId);
};

// Delete recording
export const deleteRecording = async (id: string): Promise<void> => {
  const recordings = await getRecordings();
  const recording = recordings.find(r => r.id === id);
  
  if (recording) {
    try {
      await FileSystem.deleteAsync(recording.uri, { idempotent: true });
    } catch (e) {
      console.warn('Failed to delete file:', e);
    }
    
    const updated = recordings.filter(r => r.id !== id);
    await AsyncStorage.setItem(SELF_TAPE_INDEX_KEY, JSON.stringify(updated));
  }
};

// Save to device gallery
export const saveToGallery = async (uri: string): Promise<boolean> => {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return false;
    }
    
    await MediaLibrary.saveToLibraryAsync(uri);
    return true;
  } catch (error) {
    console.error('Failed to save to gallery:', error);
    return false;
  }
};

// Check available storage
export const checkStorageAvailable = async (): Promise<{ available: boolean; freeSpace?: number }> => {
  try {
    const info = await FileSystem.getFreeDiskStorageAsync();
    const freeSpaceMB = info / (1024 * 1024);
    return {
      available: freeSpaceMB > 100, // Need at least 100MB
      freeSpace: freeSpaceMB,
    };
  } catch {
    return { available: true };
  }
};
