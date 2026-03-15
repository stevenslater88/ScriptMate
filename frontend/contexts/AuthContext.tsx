import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { syncAllDataToServer, pullAllDataFromServer } from '../services/syncService';
import { AppConfig } from '../services/appConfig';

const BACKEND_URL = AppConfig.BACKEND_URL;

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
  // TEMPORARILY DISABLED: Sign-In disabled - will be enabled in future update
  // signInWithApple: () => Promise<void>;
  // signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  syncData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    const loadUser = async () => {
      try {
        const userStr = await AsyncStorage.getItem(AUTH_USER_KEY);
        if (userStr) {
          const savedUser = JSON.parse(userStr);
          setUser(savedUser);
        }
      } catch (error) {
        console.error('Error loading user:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadUser();
  }, []);

  const signOut = async () => {
    await AsyncStorage.removeItem(AUTH_USER_KEY);
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  };

  const syncData = async () => {
    if (!user?.id) return;

    try {
      // Use the sync service to pull latest data from server
      await pullAllDataFromServer();
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
        // TEMPORARILY DISABLED: Sign-In will be enabled in future update
        // signInWithApple,
        // signInWithGoogle,
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
