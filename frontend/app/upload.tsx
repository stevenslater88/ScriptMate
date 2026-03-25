import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function UploadScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const saveScript = async () => {
    if (!title.trim() || !content.trim()) {
      Alert.alert('Error', 'Please enter both title and script content');
      return;
    }

    try {
      const script = {
        id: Date.now().toString(),
        title: title.trim(),
        content: content.trim(),
        createdAt: new Date().toISOString(),
      };

      const existing = await AsyncStorage.getItem('scripts');
      const scripts = existing ? JSON.parse(existing) : [];
      scripts.push(script);
      await AsyncStorage.setItem('scripts', JSON.stringify(scripts));

      Alert.alert('Success', 'Script saved!', [
        { text: 'OK', onPress: () => router.push('/scripts') }
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save script');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter script title"
        placeholderTextColor="#666"
        value={title}
        onChangeText={setTitle}
      />

      <Text style={styles.label}>Script Content</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Paste your script here..."
        placeholderTextColor="#666"
        value={content}
        onChangeText={setContent}
        multiline
        textAlignVertical="top"
      />

      <TouchableOpacity style={styles.button} onPress={saveScript}>
        <Text style={styles.buttonText}>Save Script</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#0f0f1a',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
  },
  textArea: {
    backgroundColor: '#1a1a2e',
    color: '#fff',
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    height: 200,
  },
  button: {
    backgroundColor: '#4a90d9',
    paddingVertical: 15,
    borderRadius: 8,
    marginTop: 30,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
