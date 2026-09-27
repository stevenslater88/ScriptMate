/**
 * Dev Test Mode
 * When enabled, bypasses RevenueCat and unlocks all premium features.
 * Toggle from the hidden debug screen (tap logo 5x on home).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'SCRIPTM8_DEV_TEST_MODE';

let _cached: boolean | null = null;

export async function isDevTestMode(): Promise<boolean> {
  if (_cached !== null) return _cached;
  try {
    const v = await AsyncStorage.getItem(KEY);
    _cached = v === 'true';
    return _cached;
  } catch {
    return false;
  }
}

export async function setDevTestMode(enabled: boolean): Promise<void> {
  _cached = enabled;
  await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false');
}

export function getCachedDevTestMode(): boolean {
  return _cached === true;
}
