import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useAuth } from '../contexts/AuthContext';
import { useScriptStore } from '../store/scriptStore';
import { isWatermarkEnabled, setWatermarkEnabled } from '../services/watermarkService';

export default function ProfileScreen() {
  const { user, isAuthenticated, signOut, syncData, deviceId } = useAuth();
  const { isPremium } = useScriptStore();
  const [syncing, setSyncing] = useState(false);
  const [watermarkOn, setWatermarkOn] = useState(true);

  useEffect(() => {
    isWatermarkEnabled().then(setWatermarkOn);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncData();
      Alert.alert('Sync Complete', 'Your data has been synced across all devices.');
    } catch (error) {
      Alert.alert('Sync Failed', 'Please try again later.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out? Your local data will remain on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Sign Out', 
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/');
          }
        },
      ]
    );
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.placeholder} />
        </View>
        
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View style={styles.signInPromptFixed}>
            <Ionicons name="person-circle-outline" size={64} color="#4a4a5e" />
            <Text style={styles.signInTitle}>Not Signed In</Text>
            <Text style={styles.signInSubtitle}>
              Sign in to sync your scripts, notes, and progress across all your devices.
            </Text>
            <TouchableOpacity 
              style={styles.signInButton}
              onPress={() => router.push('/signin')}
            >
              <Text style={styles.signInButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>

          {/* Watermark Settings - pinned to bottom */}
          <View style={styles.watermarkBottom}>
          <View style={styles.watermarkCard}>
            <View style={styles.watermarkInfo}>
              <Ionicons name="water" size={22} color="#6366f1" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.watermarkTitle}>ScriptM8 Watermark</Text>
                <Text style={styles.watermarkSub}>
                  Appears on exported self tapes, demo reels, and casting share pages
                </Text>
              </View>
            </View>
            <View style={styles.watermarkToggle}>
              <Switch
                value={watermarkOn}
                onValueChange={(val) => {
                  if (!val) {
                    Alert.alert(
                      'ScriptM8 Pro',
                      'Remove watermark is available with ScriptM8 Pro.',
                      [
                        { text: 'Maybe Later', style: 'cancel' },
                        { text: 'Unlock Pro', onPress: () => router.push('/premium') },
                      ]
                    );
                    return;
                  }
                  setWatermarkOn(val);
                  setWatermarkEnabled(val);
                }}
                trackColor={{ false: '#374151', true: '#6366f1' }}
                thumbColor="#fff"
              />
              <Text style={styles.proLabel}>Pro</Text>
            </View>
          </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* User Info Card */}
        <View style={styles.userCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person-circle" size={72} color="#6366f1" />
            {isPremium && (
              <View style={styles.premiumBadge}>
                <Ionicons name="star" size={12} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.userName}>{user?.name || 'ScriptM8 User'}</Text>
          <Text style={styles.userEmail}>{user?.email || 'No email'}</Text>
          <View style={styles.tierBadge}>
            <Text style={[
              styles.tierText,
              isPremium && styles.tierTextPremium
            ]}>
              {isPremium ? 'Premium' : 'Free'}
            </Text>
          </View>
        </View>

        {/* Sync Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cloud Sync</Text>
          <View style={styles.syncCard}>
            <View style={styles.syncStatus}>
              <Ionicons name="cloud-done" size={24} color="#10b981" />
              <View style={styles.syncInfo}>
                <Text style={styles.syncTitle}>Sync Enabled</Text>
                <Text style={styles.syncSubtitle}>
                  Your data syncs across all devices
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={styles.syncButton}
              onPress={handleSync}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#6366f1" />
              ) : (
                <>
                  <Ionicons name="sync" size={18} color="#6366f1" />
                  <Text style={styles.syncButtonText}>Sync Now</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Devices */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>This Device</Text>
          <View style={styles.deviceCard}>
            <Ionicons name="phone-portrait" size={24} color="#6b7280" />
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>Current Device</Text>
              <Text style={styles.deviceId}>ID: {deviceId.slice(0, 20)}...</Text>
            </View>
            <Ionicons name="checkmark-circle" size={24} color="#10b981" />
          </View>
        </View>

        {/* Watermark Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Media Settings</Text>
          <View style={styles.watermarkCard}>
            <View style={styles.watermarkInfo}>
              <Ionicons name="water" size={22} color="#6366f1" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.watermarkTitle}>ScriptM8 Watermark</Text>
                <Text style={styles.watermarkSub}>
                  Appears on exported self tapes, demo reels, and casting share pages
                </Text>
              </View>
            </View>
            <View style={styles.watermarkToggle}>
              <Switch
                value={watermarkOn}
                onValueChange={(val) => {
                  if (!val && !isPremium) {
                    Alert.alert(
                      'ScriptM8 Pro',
                      'Remove watermark is available with ScriptM8 Pro.',
                      [
                        { text: 'Maybe Later', style: 'cancel' },
                        { text: 'Unlock Pro', onPress: () => router.push('/premium') },
                      ]
                    );
                    return;
                  }
                  setWatermarkOn(val);
                  setWatermarkEnabled(val);
                }}
                trackColor={{ false: '#374151', true: '#6366f1' }}
                thumbColor="#fff"
              />
              {!isPremium && (
                <Text style={styles.proLabel}>Pro</Text>
              )}
            </View>
          </View>
        </View>

        {/* Account Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          
          {!isPremium && (
            <TouchableOpacity 
              style={styles.actionItem}
              onPress={() => router.push('/premium')}
            >
              <View style={styles.actionLeft}>
                <Ionicons name="star" size={22} color="#f59e0b" />
                <Text style={styles.actionText}>Upgrade to Premium</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6b7280" />
            </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            style={styles.actionItem}
            onPress={() => router.push('/support')}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="help-circle" size={22} color="#6b7280" />
              <Text style={styles.actionText}>Help & Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6b7280" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionItem}
            onPress={() => router.push('/privacy')}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="shield-checkmark" size={22} color="#6b7280" />
              <Text style={styles.actionText}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6b7280" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionItem, styles.signOutItem]}
            onPress={handleSignOut}
          >
            <View style={styles.actionLeft}>
              <Ionicons name="log-out" size={22} color="#ef4444" />
              <Text style={[styles.actionText, styles.signOutText]}>Sign Out</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Build Stamp */}
        <Text style={styles.buildStamp} data-testid="build-stamp">
          ScriptM8 v{Constants.expoConfig?.version || '1.1.0'} ({Constants.expoConfig?.android?.versionCode || Constants.expoConfig?.ios?.buildNumber || '---'})
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  placeholder: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  signInPrompt: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    paddingTop: 60,
  },
  signInPromptFixed: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  watermarkBottom: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  signInTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  signInSubtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  signInButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  signInButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  userCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  avatarContainer: {
    position: 'relative',
  },
  premiumBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#f59e0b',
    borderRadius: 10,
    padding: 4,
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 12,
  },
  userEmail: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  tierBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
  },
  tierText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  tierTextPremium: {
    color: '#6366f1',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  syncCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  syncInfo: {
    marginLeft: 12,
    flex: 1,
  },
  syncTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  syncSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  syncButtonText: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '600',
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  deviceInfo: {
    flex: 1,
    marginLeft: 12,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  deviceId: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a2e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionText: {
    fontSize: 15,
    color: '#fff',
  },
  signOutItem: {
    marginTop: 8,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  signOutText: {
    color: '#ef4444',
  },
  watermarkCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  watermarkInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  watermarkTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  watermarkSub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  watermarkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  proLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  buildStamp: {
    textAlign: 'center',
    color: '#4b5563',
    fontSize: 11,
    marginTop: 24,
    marginBottom: 16,
  },
});
