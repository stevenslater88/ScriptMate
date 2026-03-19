import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { getRecordings, deleteRecording, SelfTapeRecording } from '../../services/selfTapeStorage';

export default function LibraryScreen() {
  const [recordings, setRecordings] = useState<SelfTapeRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecordings = async () => {
    const recs = await getRecordings();
    setRecordings(recs);
    setLoading(false);
  };

  // Reload when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadRecordings();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecordings();
    setRefreshing(false);
  };

  const handleDelete = (recording: SelfTapeRecording) => {
    Alert.alert(
      'Delete Recording?',
      `Delete "${recording.scriptTitle}" take?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteRecording(recording.id);
            await loadRecordings();
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderItem = ({ item }: { item: SelfTapeRecording }) => (
    <TouchableOpacity
      style={styles.recordingItem}
      onPress={() => router.push(`/selftape/review?id=${item.id}`)}
    >
      <View style={styles.recordingThumbnail}>
        <Ionicons name="videocam" size={28} color="#6366f1" />
      </View>
      <View style={styles.recordingInfo}>
        <Text style={styles.recordingTitle} numberOfLines={1}>{item.scriptTitle}</Text>
        <Text style={styles.recordingScene} numberOfLines={1}>{item.sceneName}</Text>
        <View style={styles.recordingMeta}>
          <Text style={styles.recordingDuration}>{formatDuration(item.duration)}</Text>
          <Text style={styles.recordingDate}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
      <TouchableOpacity 
        style={styles.deleteButton}
        onPress={() => handleDelete(item)}
      >
        <Ionicons name="trash-outline" size={20} color="#ef4444" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Ionicons name="folder-open-outline" size={64} color="#4b5563" />
      <Text style={styles.emptyTitle}>No Recordings Yet</Text>
      <Text style={styles.emptyText}>
        Your self-tape recordings will appear here.
        Start by selecting a script to record!
      </Text>
      <TouchableOpacity 
        style={styles.startButton}
        onPress={() => router.push('/selftape')}
      >
        <Text style={styles.startButtonText}>Record Self-Tape</Text>
      </TouchableOpacity>
    </View>
  );

  // Group recordings by script
  const groupedRecordings = recordings.reduce((acc, rec) => {
    if (!acc[rec.scriptId]) {
      acc[rec.scriptId] = {
        title: rec.scriptTitle,
        recordings: [],
      };
    }
    acc[rec.scriptId].recordings.push(rec);
    return acc;
  }, {} as Record<string, { title: string; recordings: SelfTapeRecording[] }>);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Takes</Text>
        <Text style={styles.recordingCount}>{recordings.length}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={recordings}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={recordings.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={renderEmpty}
          refreshing={refreshing}
          onRefresh={onRefresh}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600', color: '#fff', marginLeft: 8 },
  recordingCount: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginTop: 20 },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  startButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginTop: 24,
  },
  startButtonText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  recordingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  recordingThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingInfo: { flex: 1, marginLeft: 12 },
  recordingTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  recordingScene: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  recordingMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 12 },
  recordingDuration: { fontSize: 12, color: '#6366f1', fontWeight: '500' },
  recordingDate: { fontSize: 11, color: '#6b7280' },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
});
