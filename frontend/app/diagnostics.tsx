import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { API_BASE_URL, BUILD_ID } from '../services/apiConfig';

export default function DiagnosticsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Diagnostics Active</Text>
      
      <View style={styles.infoBox}>
        <Text style={styles.label}>API BASE URL:</Text>
        <Text style={styles.value}>{API_BASE_URL}</Text>
      </View>
      
      <View style={styles.infoBox}>
        <Text style={styles.label}>BUILD ID:</Text>
        <Text style={styles.value}>{BUILD_ID}</Text>
      </View>
      
      <View style={styles.infoBox}>
        <Text style={styles.label}>TIMESTAMP:</Text>
        <Text style={styles.value}>{new Date().toISOString()}</Text>
      </View>

      <TouchableOpacity 
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Text style={styles.backButtonText}>GO BACK</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    color: '#00ff00',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
  },
  infoBox: {
    backgroundColor: '#1a1a2e',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  label: {
    color: '#888',
    fontSize: 12,
    marginBottom: 5,
  },
  value: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  backButton: {
    backgroundColor: '#333',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  backButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});
