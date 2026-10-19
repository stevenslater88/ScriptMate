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
import { router, useLocalSearchParams } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';
import { C, RADIUS, TYPE, tint } from '../constants/cinematicTheme';
import { GradientButton, IconButton, Pill, ScreenGlow } from '../components/cinematic';

const ACCENTS = [C.violet, C.blue, C.cyan];

// First spoken line, shown as a short screenplay-style preview on the card.
const firstLine = (script: any): string => {
  const l = (script.lines || []).find((x: any) => x && x.character && !x.is_stage_direction);
  return l ? `${l.character}: ${l.text}` : '';
};

// 2026-02 V1 RELEASE: when the library is launched from Recall (no scriptId),
// selecting a script must return to Recall configuration — not open Rehearsal.
// `returnTo=recall` is the only accepted detour value; anything else keeps the
// pre-existing Rehearsal default so My Scripts / Upload flows are unchanged.
const RETURN_TO_RECALL = 'recall';

export default function ScriptsScreen() {
  const { scripts, fetchScripts, deleteScript, loading } = useScriptStore();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [refreshing, setRefreshing] = useState(false);

  const isReturnToRecall = returnTo === RETURN_TO_RECALL;

  const handleSelectScript = (id: string) => {
    if (isReturnToRecall) {
      router.replace({ pathname: '/recall', params: { scriptId: id } });
      return;
    }
    router.push(`/script/${id}`);
  };

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
      <ScreenGlow />
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => router.back()} testID="scripts-back-btn" />
        <IconButton icon="add" primary onPress={() => router.push('/upload')} testID="scripts-add-btn" />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.violet}
          />
        }
      >
        <Text style={styles.headerTitle} testID="scripts-header-title">
          {isReturnToRecall ? 'Pick a Script to Recall' : 'My Scripts'}
        </Text>
        {scripts.length > 0 && (
          <Text style={styles.headerSub}>{scripts.length} {scripts.length === 1 ? 'script' : 'scripts'}</Text>
        )}

        {loading && scripts.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={C.violet} />
            <Text style={styles.loadingText}>Loading scripts...</Text>
          </View>
        ) : scripts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <Ionicons name="document-text-outline" size={40} color={C.violetSoft} />
            </View>
            <Text style={styles.emptyTitle}>No Scripts Yet</Text>
            <Text style={styles.emptySubtitle}>
              Upload your first script to start rehearsing
            </Text>
            <GradientButton
              label="Add Script"
              icon="add-circle"
              onPress={() => router.push('/upload')}
              testID="scripts-empty-add-btn"
              style={styles.emptyButton}
            />
          </View>
        ) : (
          scripts.map((script, i) => (
            <TouchableOpacity
              key={script.id}
              style={styles.scriptCard}
              onPress={() => handleSelectScript(script.id)}
              activeOpacity={0.8}
              testID={isReturnToRecall ? `recall-pick-script-${script.id}` : `open-script-${script.id}`}
            >
              <View style={[styles.accent, { backgroundColor: ACCENTS[i % ACCENTS.length] }]} />
              <View style={styles.scriptInfo}>
                <View style={styles.titleRow}>
                  <Text style={styles.scriptTitle} numberOfLines={1}>
                    {script.title}
                  </Text>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDelete(script.id, script.title)}
                    accessibilityLabel={`Delete ${script.title}`}
                    testID={`delete-script-${script.id}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={C.danger} />
                  </TouchableOpacity>
                </View>
                {firstLine(script) ? (
                  <Text style={styles.preview} numberOfLines={2}>{firstLine(script)}</Text>
                ) : null}
                <View style={styles.scriptMeta}>
                  <Pill label={`${script.characters?.length || 0} characters`} icon="people" color="#CFCBF2" />
                  <Pill label={`${script.lines?.length || 0} lines`} icon="chatbubbles" color="#CFCBF2" />
                  <Text style={styles.scriptMetaText}>
                    {formatDate(script.created_at)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  headerTitle: { ...TYPE.display, fontSize: 26, marginTop: 8 },
  headerSub: { ...TYPE.caption, marginTop: 3 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 40 },
  loadingContainer: { alignItems: 'center', paddingTop: 60 },
  loadingText: { color: C.muted, marginTop: 16, fontSize: 15 },
  emptyContainer: { alignItems: 'center', paddingTop: 70 },
  emptyIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: tint(C.violet, 0.12), borderWidth: 1, borderColor: tint(C.violet, 0.3), alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...TYPE.title, marginTop: 18 },
  emptySubtitle: { fontSize: 14, color: C.muted, marginTop: 8, textAlign: 'center' },
  emptyButton: { marginTop: 24, alignSelf: 'stretch' },
  scriptCard: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: RADIUS.lg, padding: 14, paddingLeft: 12, marginTop: 12, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  accent: { width: 3, borderRadius: 3, marginRight: 12 },
  scriptInfo: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scriptTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: C.text },
  preview: { fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17, color: '#8F8AB8', marginTop: 6 },
  scriptMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 11 },
  scriptMetaText: { fontSize: 11.5, color: C.muted, marginLeft: 'auto' },
  deleteButton: { width: 36, height: 36, borderRadius: 10, marginLeft: 8, backgroundColor: tint(C.danger, 0.1), alignItems: 'center', justifyContent: 'center' },
});
