import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  SafeAreaView,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import * as Speech from 'expo-speech';
import { registerRootComponent } from 'expo';

const API_URL = 'https://save-script-verify.preview.emergentagent.com';
const BUILD_ID = 'SM8-SINGLE-FILE-V1';

console.log('APP STARTED');
console.log('BUILD ID:', BUILD_ID);
console.log('API URL:', API_URL);

function App() {
  const [text, setText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  const playText = () => {
    if (!text.trim()) return;
    
    if (isPlaying) {
      Speech.stop();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      Speech.speak(text, {
        onDone: () => setIsPlaying(false),
        onStopped: () => setIsPlaying(false),
        onError: () => setIsPlaying(false),
      });
    }
  };

  const stopText = () => {
    Speech.stop();
    setIsPlaying(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* DEBUG OVERLAY - ALWAYS VISIBLE */}
      <View style={styles.debugOverlay}>
        <Text style={styles.debugTitle}>DEBUG MODE ACTIVE</Text>
        <Text style={styles.debugText}>Build: {BUILD_ID}</Text>
        <Text style={styles.debugText}>API: {API_URL}</Text>
      </View>

      <KeyboardAvoidingView 
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>ScriptM8</Text>
          <Text style={styles.subtitle}>Paste text and press Play</Text>

          <TextInput
            style={styles.textInput}
            placeholder="Paste your script here..."
            placeholderTextColor="#555"
            value={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity 
              style={[styles.button, styles.playButton, isPlaying && styles.playingButton]} 
              onPress={playText}
            >
              <Text style={styles.buttonText}>
                {isPlaying ? 'Playing...' : 'Play'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.stopButton]} 
              onPress={stopText}
            >
              <Text style={styles.buttonText}>Stop</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  debugOverlay: {
    backgroundColor: '#ff0000',
    padding: 10,
    alignItems: 'center',
  },
  debugTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  debugText: {
    color: '#ffff00',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  content: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 20,
  },
  subtitle: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
  },
  textInput: {
    backgroundColor: '#111',
    color: '#fff',
    padding: 15,
    borderRadius: 10,
    fontSize: 16,
    minHeight: 200,
    borderWidth: 1,
    borderColor: '#333',
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  playButton: {
    backgroundColor: '#4a90d9',
  },
  playingButton: {
    backgroundColor: '#2a5a99',
  },
  stopButton: {
    backgroundColor: '#d94a4a',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

registerRootComponent(App);

export default App;
