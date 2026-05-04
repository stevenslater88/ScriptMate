import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ScriptScreen() {
  const { id } = useLocalSearchParams();

  const [script, setScript] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadScript = async () => {
      try {
        const stored = await AsyncStorage.getItem('scripts');
        const scripts = stored ? JSON.parse(stored) : [];

        const found = scripts.find((s) => s.id === id);

        if (found) {
          setScript(found);
        } else {
          console.log('Script not found');
        }
      } catch (err) {
        console.error(err);
      }

      setLoading(false);
    };

    loadScript();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!script) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#fff' }}>Script not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{script.title}</Text>
      <Text style={styles.content}>{script.content}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    padding: 20,
  },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 20,
  },
  content: {
    color: '#ccc',
    fontSize: 16,
    lineHeight: 22,
  },
});