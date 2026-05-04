import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';

export default function ScriptsScreen() {
  const [scripts, setScripts] = useState([]);

  const loadScripts = async () => {
    const stored = await AsyncStorage.getItem('scripts');

    if (!stored) {
      setScripts([]);
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setScripts(parsed);
      } else {
        setScripts([]);
      }
    } catch {
      setScripts([]);
    }
  };

  // 🔥 KEY FIX: reload EVERY time screen opens
  useFocusEffect(
    React.useCallback(() => {
      loadScripts();
    }, [])
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Your Scripts</Text>

      <FlatList
        data={scripts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.preview}>
              {item.content?.slice(0, 80)}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No scripts yet</Text>
        }
      />

      <TouchableOpacity
        style={styles.addButton}
        onPress={() => router.push('/upload')}
      >
        <Text style={styles.addText}>+ Add Script</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    padding: 20,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#1a1a2e',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  preview: {
    color: '#aaa',
    marginTop: 6,
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  addButton: {
    backgroundColor: '#6366f1',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  addText: {
    color: '#fff',
    fontWeight: '600',
  },
});