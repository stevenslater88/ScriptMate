import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Script {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

export default function ScriptsScreen() {
  const router = useRouter();
  const [scripts, setScripts] = useState<Script[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadScripts();
    }, [])
  );

  const loadScripts = async () => {
    try {
      const data = await AsyncStorage.getItem('scripts');
      if (data) {
        setScripts(JSON.parse(data));
      }
    } catch (error) {
      console.log('Failed to load scripts');
    }
  };

  const openScript = (script: Script) => {
    router.push({
      pathname: '/player',
      params: { id: script.id, title: script.title, content: script.content }
    });
  };

  if (scripts.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No scripts yet</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/upload')}
        >
          <Text style={styles.buttonText}>Upload Script</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={scripts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.scriptItem}
            onPress={() => openScript(item)}
          >
            <Text style={styles.scriptTitle}>{item.title}</Text>
            <Text style={styles.scriptDate}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f1a',
  },
  emptyText: {
    color: '#888',
    fontSize: 18,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#4a90d9',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scriptItem: {
    backgroundColor: '#1a1a2e',
    padding: 20,
    marginHorizontal: 15,
    marginVertical: 8,
    borderRadius: 10,
  },
  scriptTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  scriptDate: {
    color: '#888',
    fontSize: 14,
    marginTop: 5,
  },
});
