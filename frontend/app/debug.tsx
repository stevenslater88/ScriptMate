import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { getDebugInfo, clearDebugLogs } from '../services/debugService';

export default function DebugScreen() {
  const [debugInfo, setDebugInfo] = useState(getDebugInfo());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setDebugInfo(getDebugInfo());
  }, [refreshKey]);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleClearLogs = () => {
    Alert.alert(
      'Clear Debug Logs',
      'Are you sure you want to clear all debug logs?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearDebugLogs();
            handleRefresh();
          },
        },
      ]
    );
  };

  const InfoRow = ({ label, value, isError = false }: { label: string; value: string; isError?: boolean }) => (
    <View style={styles.infoRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, isError && styles.errorValue]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🔧 Debug Info</Text>
        <TouchableOpacity onPress={handleRefresh} style={styles.refreshButton}>
          <Ionicons name="refresh" size={24} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* App Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📱 App Info</Text>
          <InfoRow label="App Version" value={debugInfo.appVersion} />
          <InfoRow label="Build Number" value={debugInfo.buildNumber} />
          <InfoRow label="Environment" value={debugInfo.environment} />
          <InfoRow label="Expo SDK" value={debugInfo.expoSdk} />
        </View>

        {/* API Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🌐 API Configuration</Text>
          <InfoRow label="Base URL" value={debugInfo.apiBaseUrl} />
          <InfoRow label="Backend Status" value={debugInfo.backendStatus} />
        </View>

        {/* Last Request Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📡 Last API Request</Text>
          <InfoRow label="Endpoint" value={debugInfo.lastRequest.endpoint || 'None'} />
          <InfoRow label="Method" value={debugInfo.lastRequest.method || 'N/A'} />
          <InfoRow label="Status" value={debugInfo.lastRequest.status || 'N/A'} />
          <InfoRow label="Timestamp" value={debugInfo.lastRequest.timestamp || 'N/A'} />
          {debugInfo.lastRequest.error && (
            <InfoRow label="Error" value={debugInfo.lastRequest.error} isError />
          )}
        </View>

        {/* Recent Errors Section */}
        {debugInfo.recentErrors.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>❌ Recent Errors ({debugInfo.recentErrors.length})</Text>
            {debugInfo.recentErrors.slice(0, 5).map((error, index) => (
              <View key={index} style={styles.errorItem}>
                <Text style={styles.errorTimestamp}>{error.timestamp}</Text>
                <Text style={styles.errorContext}>{error.context}</Text>
                <Text style={styles.errorMessage}>{error.message}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Clear Logs Button */}
        <TouchableOpacity style={styles.clearButton} onPress={handleClearLogs}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
          <Text style={styles.clearButtonText}>Clear Debug Logs</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Tap logo 5x on home screen to access this page</Text>
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
    borderBottomColor: '#1f2937',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  refreshButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  label: {
    fontSize: 14,
    color: '#9ca3af',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: '#ffffff',
    flex: 2,
    textAlign: 'right',
  },
  errorValue: {
    color: '#ef4444',
  },
  errorItem: {
    backgroundColor: '#1f0a0a',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  errorTimestamp: {
    fontSize: 10,
    color: '#6b7280',
    marginBottom: 4,
  },
  errorContext: {
    fontSize: 12,
    color: '#f87171',
    fontWeight: '600',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    color: '#fca5a5',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f0a0a',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  clearButtonText: {
    fontSize: 14,
    color: '#ef4444',
    marginLeft: 8,
    fontWeight: '600',
  },
  footer: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
});
