import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'https://save-script-verify.preview.emergentagent.com';
const BUILD_ID = 'SM8-MINIMAL-CORE';

export default function DebugScreen() {
  const [scriptCount, setScriptCount] = useState(0);
  const [apiStatus, setApiStatus] = useState('Not tested');
  const [storageData, setStorageData] = useState('');

  useEffect(() => {
    checkStorage();
  }, []);

  const checkStorage = async () => {
    try {
      const scripts = await AsyncStorage.getItem('scripts');
      if (scripts) {
        const parsed = JSON.parse(scripts);
        setScriptCount(parsed.length);
        setStorageData(JSON.stringify(parsed, null, 2).substring(0, 500));
      } else {
        setScriptCount(0);
        setStorageData('No scripts stored');
      }
    } catch (e) {
      setStorageData('Error reading storage');
    }
  };

  const testApi = async () => {
    setApiStatus('Testing...');
    try {
      const response = await fetch(`${API_URL}/api/health`, { 
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        setApiStatus(`OK (${response.status})`);
      } else {
        setApiStatus(`Error (${response.status})`);
      }
    } catch (e) {
      setApiStatus(`Failed: ${e.message}`);
    }
  };

  const clearStorage = async () => {
    Alert.alert(
      'Clear All Scripts?',
      'This will delete all saved scripts.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear', 
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('scripts');
            checkStorage();
            Alert.alert('Done', 'All scripts cleared');
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Debug Info</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Build ID</Text>
        <Text style={styles.value}>{BUILD_ID}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>API URL</Text>
        <Text style={styles.value}>{API_URL}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>API Status</Text>
        <Text style={styles.value}>{apiStatus}</Text>
        <TouchableOpacity style={styles.button} onPress={testApi}>
          <Text style={styles.buttonText}>Test API</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Saved Scripts</Text>
        <Text style={styles.value}>{scriptCount} scripts</Text>
        <TouchableOpacity style={styles.button} onPress={checkStorage}>
          <Text style={styles.buttonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Storage Preview</Text>
        <Text style={styles.code}>{storageData}</Text>
      </View>

      <TouchableOpacity style={styles.dangerButton} onPress={clearStorage}>
        <Text style={styles.buttonText}>Clear All Scripts</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 20,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  section: {
    backgroundColor: '#111',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
  },
  label: {
    color: '#888',
    fontSize: 12,
    marginBottom: 5,
  },
  value: {
    color: '#fff',
    fontSize: 16,
  },
  code: {
    color: '#4a90d9',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#333',
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
    alignItems: 'center',
  },
  dangerButton: {
    backgroundColor: '#d94a4a',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
    marginBottom: 40,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
