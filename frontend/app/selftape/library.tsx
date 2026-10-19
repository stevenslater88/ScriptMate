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
import { C, RADIUS, TYPE, tint } from '../../constants/cinematicTheme';
import { GradientButton, IconButton, IconWell, ScreenGlow } from '../../components/cinematic';

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
      activeOpacity={0.85}
      testID={`library-take-${item.id}`}
    >
      <View style={styles.recordingThumbnail}>
        <Ionicons name="play" size={22} color={C.violetSoft} />
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
        testID={`library-delete-${item.id}`}
        accessibilityLabel={`Delete ${item.scriptTitle} take`}
      >
        <Ionicons name="trash-outline" size={18} color="#FF5C7A" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState} testID="library-empty-state">
      <View style={styles.emptyIcon}>
        <IconWell icon="folder-open-outline" color={C.violetSoft} size={56} />
      </View>
      <Text style={styles.emptyTitle}>No Recordings Yet</Text>
      <Text style={styles.emptyText}>
        Your self-tape recordings will appear here.
        Start by selecting a script to record!
      </Text>
      <GradientButton
        label="Record Self-Tape"
        icon="videocam"
        onPress={() => router.push('/selftape')}
        testID="library-record-btn"
        style={styles.startButton}
      />
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
      <ScreenGlow />
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} testID="library-back-btn" />
        <Text style={styles.headerTitle} testID="library-header-title">My Takes</Text>
        <Text style={styles.recordingCount} testID="library-count">{recordings.length}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#7C5CFF" />
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
  container: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 },
  headerTitle: { flex: 1, ...TYPE.title, fontSize: 20, marginLeft: 12 },
  recordingCount: { fontSize: 13, color: C.violetSoft, fontWeight: '700', backgroundColor: tint(C.violet, 0.15), paddingHorizontal: 12, paddingVertical: 4, borderRadius: RADIUS.pill, overflow: 'hidden' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  emptyContainer: { flex: 1 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyIcon: { padding: 12, borderRadius: 24, backgroundColor: tint(C.violet, 0.08), borderWidth: 1, borderColor: tint(C.violet, 0.25) },
  emptyTitle: { ...TYPE.title, marginTop: 18 },
  emptyText: { fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  startButton: { marginTop: 24, alignSelf: 'stretch' },
  recordingItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: RADIUS.lg, padding: 12, marginTop: 10, borderWidth: 1, borderColor: C.line },
  recordingThumbnail: { width: 56, height: 56, borderRadius: RADIUS.md, backgroundColor: tint(C.violet, 0.14), borderWidth: 1, borderColor: tint(C.violet, 0.3), justifyContent: 'center', alignItems: 'center' },
  recordingInfo: { flex: 1, marginLeft: 12 },
  recordingTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  recordingScene: { fontSize: 13, color: C.muted, marginTop: 2 },
  recordingMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 12 },
  recordingDuration: { fontSize: 12, color: C.cyan, fontWeight: '700' },
  recordingDate: { fontSize: 11, color: C.dim },
  deleteButton: { width: 36, height: 36, borderRadius: 10, marginLeft: 8, backgroundColor: tint(C.danger, 0.1), alignItems: 'center', justifyContent: 'center' },
});
