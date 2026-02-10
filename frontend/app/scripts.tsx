import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';

export default function ScriptsScreen() {
  const { scripts, fetchScripts, deleteScript, loading } = useScriptStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchScripts();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchScripts();
    setRefreshing(false);
  };

  const handleDelete = (id: string, title: string) => {
    Alert.alert(
      'Delete Script',
      `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteScript(id),
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
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Scripts</Text>
        <TouchableOpacity
          onPress={() => router.push('/upload')}
          style={styles.addButton}
        >
          <Ionicons name="add" size={28} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
      >
        {loading && scripts.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.loadingText}>Loading scripts...</Text>
          </View>
        ) : scripts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color="#3a3a4e" />
            <Text style={styles.emptyTitle}>No Scripts Yet</Text>
            <Text style={styles.emptySubtitle}>
              Upload your first script to start rehearsing
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push('/upload')}
            >
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={styles.emptyButtonText}>Add Script</Text>
            </TouchableOpacity>
          </View>
        ) : (
          scripts.map((script) => (
            <TouchableOpacity
              key={script.id}
              style={styles.scriptCard}
              onPress={() => router.push(`/script/${script.id}`)}
              activeOpacity={0.8}
            >
              <View style={styles.scriptIcon}>
                <Ionicons name="document-text" size={28} color="#6366f1" />
              </View>
              <View style={styles.scriptInfo}>
                <Text style={styles.scriptTitle} numberOfLines={1}>
                  {script.title}
                </Text>
                <View style={styles.scriptMeta}>
                  <Text style={styles.scriptMetaText}>
                    {script.characters?.length || 0} characters
                  </Text>
                  <Text style={styles.scriptMetaDot}>•</Text>
                  <Text style={styles.scriptMetaText}>
                    {script.lines?.length || 0} lines
                  </Text>
                  <Text style={styles.scriptMetaDot}>•</Text>
                  <Text style={styles.scriptMetaText}>
                    {formatDate(script.created_at)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(script.id, script.title)}
              >
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  addButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  loadingText: {
    color: '#6b7280',
    marginTop: 16,
    fontSize: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#6b7280',
    marginTop: 8,
    textAlign: 'center',
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 24,
    gap: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scriptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  scriptIcon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scriptInfo: {
    flex: 1,
    marginLeft: 14,
  },
  scriptTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  scriptMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scriptMetaText: {
    fontSize: 13,
    color: '#6b7280',
  },
  scriptMetaDot: {
    color: '#3a3a4e',
    marginHorizontal: 6,
  },
  deleteButton: {
    padding: 8,
  },
});
