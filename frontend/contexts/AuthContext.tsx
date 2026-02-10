import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
// TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated
// import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const BACKEND_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
                    process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Storage keys
const AUTH_USER_KEY = '@scriptmate_auth_user';
const AUTH_TOKEN_KEY = '@scriptmate_auth_token';
const DEVICE_ID_KEY = '@scriptmate_device_id';

interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  subscriptionTier: string;
  isAuthenticated: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  deviceId: string;
  // TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated
  // signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  syncData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Configure Google Sign-In
GoogleSignin.configure({
  webClientId: 'YOUR_WEB_CLIENT_ID', // Will need to be configured
  iosClientId: 'YOUR_IOS_CLIENT_ID',
  offlineAccess: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deviceId, setDeviceId] = useState('');

  // Generate or retrieve device ID
  useEffect(() => {
    const initDeviceId = async () => {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      }
      setDeviceId(id);
    };
    initDeviceId();
  }, []);

  // Check for existing auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const storedUser = await AsyncStorage.getItem(AUTH_USER_KEY);
        const storedToken = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
        
        if (storedUser && storedToken) {
          const parsedUser = JSON.parse(storedUser);
          setUser({ ...parsedUser, isAuthenticated: true });
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  // TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated
  // const signInWithApple = async () => {
  //   try {
  //     // Check if Apple Sign-In is available
  //     const isAvailable = await AppleAuthentication.isAvailableAsync();
  //     if (!isAvailable) {
  //       throw new Error('Apple Sign-In is not available on this device');
  //     }

  //     const credential = await AppleAuthentication.signInAsync({
  //       requestedScopes: [
  //         AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
  //         AppleAuthentication.AppleAuthenticationScope.EMAIL,
  //       ],
  //     });

  //     // Send to backend
  //     const response = await fetch(`${BACKEND_URL}/api/auth/apple`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         identity_token: credential.identityToken,
  //         authorization_code: credential.authorizationCode,
  //         user_identifier: credential.user,
  //         email: credential.email,
  //         full_name: credential.fullName 
  //           ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
  //           : null,
  //         device_id: deviceId,
  //       }),
  //     });

  //     if (!response.ok) {
  //       const error = await response.json();
  //       throw new Error(error.detail || 'Sign-in failed');
  //     }

  //     const data = await response.json();
      
  //     const authUser: AuthUser = {
  //       id: data.user_id,
  //       email: data.email,
  //       name: data.name,
  //       subscriptionTier: data.subscription_tier,
  //       isAuthenticated: true,
  //     };

  //     await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(authUser));
  //     await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
  //     setUser(authUser);

  //     // Sync data after sign-in
  //     await syncData();
  //   } catch (error: any) {
  //     if (error.code === 'ERR_REQUEST_CANCELED') {
  //       // User cancelled - not an error
  //       return;
  //     }
  //     console.error('Apple Sign-In error:', error);
  //     throw error;
  //   }
  // };

  const signInWithGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();

      // Send to backend
      const response = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_token: tokens.idToken,
          device_id: deviceId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Sign-in failed');
      }

      const data = await response.json();
      
      const authUser: AuthUser = {
        id: data.user_id,
        email: data.email,
        name: data.name,
        subscriptionTier: data.subscription_tier,
        isAuthenticated: true,
      };

      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(authUser));
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, data.access_token);
      setUser(authUser);

      // Sync data after sign-in
      await syncData();
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled - not an error
        return;
      }
      console.error('Google Sign-In error:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      // Sign out from Google if signed in
      try {
        await GoogleSignin.signOut();
      } catch {}

      // Clear local storage
      await AsyncStorage.multiRemove([AUTH_USER_KEY, AUTH_TOKEN_KEY]);
      setUser(null);
    } catch (error) {
      console.error('Sign-out error:', error);
    }
  };

  const syncData = async () => {
    if (!user?.id) return;

    try {
      // Pull latest data from server
      const response = await fetch(`${BACKEND_URL}/api/sync/pull/${user.id}`);
      if (response.ok) {
        const data = await response.json();
        
        // Store synced data locally
        if (data.settings) {
          await AsyncStorage.setItem('@scriptmate_settings', JSON.stringify(data.settings));
        }
        if (data.performance_stats) {
          await AsyncStorage.setItem('@scriptmate_performance_stats', JSON.stringify({
            global: data.performance_stats,
            scripts: data.performance_stats.script_stats || []
          }));
        }
      }
    } catch (error) {
      console.error('Sync error:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user?.isAuthenticated,
        deviceId,
        signInWithApple,
        signInWithGoogle,
        signOut,
        syncData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
