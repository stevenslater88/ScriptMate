import Constants from 'expo-constants';
import { Platform } from 'react-native';
const DEFAULTS = { BACKEND_URL: "https://android-upload-test.preview.emergentagent.com" };
export const AppConfig = { BACKEND_URL: DEFAULTS.BACKEND_URL };
console.log(`[AppConfig] Backend URL set to: ${AppConfig.BACKEND_URL}`);
