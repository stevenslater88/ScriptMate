import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';

export default function PlayerScreen() {
  const { title, content } = useLocalSearchParams<{ id: string; title: string; content: string }>();
  const [isPlaying, setIsPlaying] = useState(false);

  const playScript = () => {
    if (isPlaying) {
      Speech.stop();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      Speech.speak(content || '', {
        onDone: () => setIsPlaying(false),
        onStopped: () => setIsPlaying(false),
        onError: () => setIsPlaying(false),
      });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      
      <ScrollView style={styles.contentContainer}>
        <Text style={styles.content}>{content}</Text>
      </ScrollView>

      <TouchableOpacity
        style={[styles.playButton, isPlaying && styles.playButtonActive]}
        onPress={playScript}
      >
        <Text style={styles.playButtonText}>
          {isPlaying ? 'Stop' : 'Play AI Voice'}
        </Text>
      </TouchableOpacity>
    </View>
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
  contentContainer: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  content: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 24,
  },
  playButton: {
    backgroundColor: '#4a90d9',
    paddingVertical: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  playButtonActive: {
    backgroundColor: '#d94a4a',
  },
  playButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
});
