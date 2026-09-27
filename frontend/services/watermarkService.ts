import AsyncStorage from '@react-native-async-storage/async-storage';

const WATERMARK_KEY = '@scriptm8_watermark_enabled';

export const WATERMARK_TEXT = 'Recorded with ScriptM8';
export const WATERMARK_SUBTEXT = 'AI Training Studio for Actors';

export const isWatermarkEnabled = async (): Promise<boolean> => {
  try {
    const val = await AsyncStorage.getItem(WATERMARK_KEY);
    // Default: enabled for all users
    return val !== 'false';
  } catch {
    return true;
  }
};

export const setWatermarkEnabled = async (enabled: boolean): Promise<void> => {
  await AsyncStorage.setItem(WATERMARK_KEY, enabled ? 'true' : 'false');
};
