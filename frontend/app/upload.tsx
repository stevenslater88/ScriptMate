import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function UploadScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const saveScript = async () => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your script');
      return;
    }
    if (!content.trim()) {
      Alert.alert('Missing Content', 'Please paste your script content');
      return;
    }

    setSaving(true);
    try {
      const script = {
        id: Date.now().toString(),
        title: title.trim(),
        content: content.trim(),
        createdAt: new Date().toISOString(),
      };

      const existing = await AsyncStorage.getItem('scripts');
      const scripts = existing ? JSON.parse(existing) : [];
      scripts.unshift(script); // Add to beginning
      await AsyncStorage.setItem('scripts', JSON.stringify(scripts));

      setTitle('');
      setContent('');
      
      Alert.alert('Saved!', 'Your script has been saved.', [
        { text: 'View Scripts', onPress: () => router.push('/scripts') },
        { text: 'Add Another', style: 'cancel' }
      ]);
    } catch (error) {
      console.log('Save error:', error);
      Alert.alert('Error', 'Failed to save script. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Script Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Hamlet Act 3 Scene 1"
          placeholderTextColor="#555"
          value={title}
          onChangeText={setTitle}
          returnKeyType="next"
        />

        <Text style={styles.label}>Script Content</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Paste your script here...

Example:
HAMLET: To be, or not to be, that is the question.

OPHELIA: My lord, I have remembrances of yours."
          placeholderTextColor="#555"
          value={content}
          onChangeText={setContent}
          multiline
          textAlignVertical="top"
        />

        <TouchableOpacity 
          style={[styles.button, saving && styles.buttonDisabled]} 
          onPress={saveScript}
          disabled={saving}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Saving...' : 'Save Script'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#111111',
    color: '#fff',
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  textArea: {
    backgroundColor: '#111111',
    color: '#fff',
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    minHeight: 250,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    backgroundColor: '#4a90d9',
    paddingVertical: 16,
    borderRadius: 8,
    marginTop: 30,
    marginBottom: 40,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#333',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
