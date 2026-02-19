import { Alert } from 'react-native';
import Constants from 'expo-constants';

// Debug state storage
interface LastRequest {
  endpoint: string;
  method: string;
  status: string;
  timestamp: string;
  error?: string;
}

interface DebugError {
  timestamp: string;
  context: string;
  message: string;
}

interface DebugState {
  lastRequest: LastRequest;
  recentErrors: DebugError[];
  backendStatus: 'unknown' | 'connected' | 'error';
}

const debugState: DebugState = {
  lastRequest: {
    endpoint: '',
    method: '',
    status: '',
    timestamp: '',
  },
  recentErrors: [],
  backendStatus: 'unknown',
};

// Get environment
const getEnvironment = (): string => {
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  if (backendUrl.includes('preview.emergentagent.com')) return 'development';
  if (backendUrl.includes('emergent.host')) return 'production';
  if (backendUrl.includes('localhost')) return 'local';
  return 'unknown';
};

// Log API request
export const logApiRequest = (
  endpoint: string,
  method: string,
  status: number | string,
  error?: string
) => {
  debugState.lastRequest = {
    endpoint,
    method,
    status: String(status),
    timestamp: new Date().toISOString(),
    error,
  };
  
  if (status === 200 || status === 201) {
    debugState.backendStatus = 'connected';
  } else if (error) {
    debugState.backendStatus = 'error';
  }
};

// Log error
export const logError = (context: string, error: Error | string) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  debugState.recentErrors.unshift({
    timestamp: new Date().toISOString(),
    context,
    message: errorMessage,
  });
  
  // Keep only last 20 errors
  if (debugState.recentErrors.length > 20) {
    debugState.recentErrors = debugState.recentErrors.slice(0, 20);
  }
};

// Clear debug logs
export const clearDebugLogs = () => {
  debugState.lastRequest = {
    endpoint: '',
    method: '',
    status: '',
    timestamp: '',
  };
  debugState.recentErrors = [];
  debugState.backendStatus = 'unknown';
};

// Get debug info
export const getDebugInfo = () => {
  const expoConfig = Constants.expoConfig;
  
  return {
    appVersion: expoConfig?.version || 'Unknown',
    buildNumber: expoConfig?.ios?.buildNumber || expoConfig?.android?.versionCode?.toString() || 'Unknown',
    environment: getEnvironment(),
    expoSdk: expoConfig?.sdkVersion || 'Unknown',
    apiBaseUrl: process.env.EXPO_PUBLIC_BACKEND_URL || 'Not configured',
    backendStatus: debugState.backendStatus,
    lastRequest: debugState.lastRequest,
    recentErrors: debugState.recentErrors,
  };
};

// Safe button handler wrapper
export const safeHandler = (
  handler: () => void | Promise<void>,
  context: string = 'Button Handler'
) => {
  return async () => {
    try {
      await handler();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(context, error instanceof Error ? error : new Error(errorMessage));
      
      Alert.alert(
        'Error',
        `Something went wrong: ${errorMessage}`,
        [{ text: 'OK' }]
      );
      
      console.error(`[${context}] Error:`, error);
    }
  };
};

// Safe async handler (for use with async operations)
export const safeAsync = async <T>(
  operation: () => Promise<T>,
  context: string = 'Async Operation'
): Promise<T | null> => {
  try {
    return await operation();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(context, error instanceof Error ? error : new Error(errorMessage));
    
    Alert.alert(
      'Error',
      `Something went wrong: ${errorMessage}`,
      [{ text: 'OK' }]
    );
    
    console.error(`[${context}] Error:`, error);
    return null;
  }
};
