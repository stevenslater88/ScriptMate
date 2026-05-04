import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function UploadScreen() {
  const [title, setTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    console.log('SAVE BUTTON PRESSED'); // 🔥 DEBUG LINE

    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a script title');
      return;
    }

    if (!scriptText.trim()) {
      Alert.alert('Missing Script', 'Please paste your script');
      return;
    }

    setLoading(true);

    try {
      const stored = await AsyncStorage.getItem('scripts');
      console.log('RAW STORAGE:', stored);

      let scripts = [];

      if (stored) {
        try {
          scripts = JSON.parse(stored);
        } catch (e) {
          console.log('Storage corrupted, resetting...');
          scripts = [];
        }
      }

      if (!Array.isArray(scripts)) {
        console.log('Storage not array, resetting...');
        scripts = [];
      }

      const newScript = {
        id: Date.now().toString(),
        title: title.trim(),
        content: scriptText.trim(),
        createdAt: new Date().toISOString(),
      };

      const updatedScripts = [newScript, ...scripts];

      await AsyncStorage.setItem('scripts', JSON.stringify(updatedScripts));

      console.log('SCRIPT SAVED:', newScript);

      Alert.alert('Success', 'Script saved!');

      // 🔥 CLEAN NAVIGATION RESET
      router.replace('/scripts');

      // Reset state (safe)
      setTitle('');
      setScriptText('');
    } catch (err) {
      console.error('Save error:', err);
      Alert.alert('Error', 'Failed to save script');
    }

    setLoading(false);
  };

  const sampleScript = `SARAH
I can't believe you're leaving tomorrow.

MIKE
I have to. The job starts Monday.`;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.title}>Add Script</Text>

          <View style={{ width: 28 }} />
        </View>

        <ScrollView style={{ padding: 20 }}>
          {/* Title */}
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Script title"
            placeholderTextColor="#555"
          />

          {/* Script */}
          <View style={styles.row}>
            <Text style={styles.label}>Script</Text>
            <TouchableOpacity onPress={() => setScriptText(sampleScript)}>
              <Text style={styles.sample}>Use Sample</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.textArea}
            value={scriptText}
            onChangeText={setScriptText}
            placeholder="Paste your script here..."
            placeholderTextColor="#555"
            multiline
          />

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.button, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Save Script</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    justifyContent: 'space-between',
    padding: 16,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  label: {
    color: '#aaa',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 10,
    color: '#fff',
    marginBottom: 20,
  },
  textArea: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 10,
    color: '#fff',
    height: 200,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sample: {
    color: '#6366f1',
  },
  button: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});