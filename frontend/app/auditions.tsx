import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import useRevenueCat from '../hooks/useRevenueCat';
import {
  Audition,
  AuditionStatus,
  AuditionStats,
  getFilteredAuditions,
  createAudition,
  updateAudition,
  deleteAudition,
  getAuditionStats,
  getAuditionCount,
  AuditionFilters,
} from '../services/auditionService';

const STATUS_CONFIG: Record<AuditionStatus, { label: string; color: string; icon: string }> = {
  submitted: { label: 'Submitted', color: '#3b82f6', icon: 'paper-plane' },
  callback: { label: 'Callback', color: '#f59e0b', icon: 'call' },
  booked: { label: 'Booked', color: '#10b981', icon: 'checkmark-circle' },
  passed: { label: 'Passed', color: '#6b7280', icon: 'close-circle' },
};

const FREE_AUDITION_LIMIT = 10;

export default function AuditionsScreen() {
  const { isPremium, presentPaywall } = useRevenueCat();
  const [auditions, setAuditions] = useState<Audition[]>([]);
  const [stats, setStats] = useState<AuditionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [editingAudition, setEditingAudition] = useState<Audition | null>(null);
  
  // Filters
  const [filters, setFilters] = useState<AuditionFilters>({ sortBy: 'date', sortOrder: 'desc' });
  const [statusFilter, setStatusFilter] = useState<AuditionStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form state
  const [projectName, setProjectName] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<AuditionStatus>('submitted');
  const [dateSubmitted, setDateSubmitted] = useState(new Date());
  const [followUpDate, setFollowUpDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [auditionList, auditionStats] = await Promise.all([
        getFilteredAuditions({
          ...filters,
          status: statusFilter || undefined,
          searchQuery: searchQuery || undefined,
        }),
        getAuditionStats(),
      ]);
      setAuditions(auditionList);
      setStats(auditionStats);
    } catch (error) {
      console.error('Error loading auditions:', error);
    } finally {
      setLoading(false);
    }
  }, [filters, statusFilter, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const resetForm = () => {
    setProjectName('');
    setRole('');
    setNotes('');
    setStatus('submitted');
    setDateSubmitted(new Date());
    setFollowUpDate(null);
    setEditingAudition(null);
  };

  const handleAddAudition = async () => {
    // Check free limit - Natural, value-driven prompt
    const count = await getAuditionCount();
    if (!isPremium && count >= FREE_AUDITION_LIMIT) {
      Alert.alert(
        'Upgrade Your Career Toolkit',
        'Track unlimited auditions, follow-ups, and performance stats in one place.\n\nSee your callback and booking rates to understand what is working.',
        [
          { text: 'Maybe Later', style: 'cancel' },
          { text: 'Unlock Pro Tools', onPress: () => router.push('/premium') },
        ]
      );
      return;
    }
    
    resetForm();
    setShowAddModal(true);
  };

  const handleEditAudition = (audition: Audition) => {
    setEditingAudition(audition);
    setProjectName(audition.projectName);
    setRole(audition.role);
    setNotes(audition.notes);
    setStatus(audition.status);
    setDateSubmitted(new Date(audition.dateSubmitted));
    setFollowUpDate(audition.followUpDate ? new Date(audition.followUpDate) : null);
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!projectName.trim() || !role.trim()) {
      Alert.alert('Missing Info', 'Please enter project name and role.');
      return;
    }

    try {
      if (editingAudition) {
        await updateAudition(editingAudition.id, {
          projectName: projectName.trim(),
          role: role.trim(),
          notes: notes.trim(),
          status,
          dateSubmitted: dateSubmitted.toISOString(),
          followUpDate: followUpDate?.toISOString(),
        });
      } else {
        await createAudition({
          projectName: projectName.trim(),
          role: role.trim(),
          notes: notes.trim(),
          status,
          dateSubmitted: dateSubmitted.toISOString(),
          followUpDate: followUpDate?.toISOString(),
        });
      }
      
      setShowAddModal(false);
      resetForm();
      loadData();
    } catch (error) {
      Alert.alert('Error', 'Failed to save audition.');
    }
  };

  const handleDelete = (audition: Audition) => {
    Alert.alert(
      'Delete Audition',
      `Delete "${audition.projectName}" audition?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteAudition(audition.id);
            loadData();
          },
        },
      ]
    );
  };

  const handleShowStats = () => {
    // Always show stats modal - it will show upgrade prompt inside if not premium
    setShowStatsModal(true);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Audition Tracker</Text>
        <TouchableOpacity onPress={handleShowStats} style={styles.statsButton} data-testid="stats-button">
          <Ionicons name="bar-chart" size={24} color="#6366f1" />
        </TouchableOpacity>
      </View>

      {/* Quick Stats */}
      {stats && (
        <View style={styles.quickStats}>
          <View style={styles.quickStatItem}>
            <Text style={styles.quickStatValue}>{stats.totalAuditions}</Text>
            <Text style={styles.quickStatLabel}>Total</Text>
          </View>
          <View style={styles.quickStatItem}>
            <Text style={[styles.quickStatValue, { color: '#3b82f6' }]}>{stats.submittedCount}</Text>
            <Text style={styles.quickStatLabel}>Pending</Text>
          </View>
          <View style={styles.quickStatItem}>
            <Text style={[styles.quickStatValue, { color: '#f59e0b' }]}>{stats.callbackCount}</Text>
            <Text style={styles.quickStatLabel}>Callbacks</Text>
          </View>
          <View style={styles.quickStatItem}>
            <Text style={[styles.quickStatValue, { color: '#10b981' }]}>{stats.bookedCount}</Text>
            <Text style={styles.quickStatLabel}>Booked</Text>
          </View>
        </View>
      )}

      {/* Status Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !statusFilter && styles.filterChipActive]}
            onPress={() => setStatusFilter(null)}
          >
            <Text style={[styles.filterChipText, !statusFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {(Object.keys(STATUS_CONFIG) as AuditionStatus[]).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.filterChip, statusFilter === s && { backgroundColor: `${STATUS_CONFIG[s].color}20`, borderColor: STATUS_CONFIG[s].color }]}
              onPress={() => setStatusFilter(statusFilter === s ? null : s)}
            >
              <Ionicons name={STATUS_CONFIG[s].icon as any} size={14} color={statusFilter === s ? STATUS_CONFIG[s].color : '#6b7280'} />
              <Text style={[styles.filterChipText, statusFilter === s && { color: STATUS_CONFIG[s].color }]}>
                {STATUS_CONFIG[s].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color="#6b7280" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search projects or roles..."
          placeholderTextColor="#6b7280"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#6b7280" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Auditions List */}
      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {auditions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="clipboard-outline" size={48} color="#4b5563" />
            <Text style={styles.emptyTitle}>No auditions yet</Text>
            <Text style={styles.emptySubtitle}>Start tracking your auditions to see your progress</Text>
          </View>
        ) : (
          auditions.map((audition) => (
            <TouchableOpacity
              key={audition.id}
              style={styles.auditionCard}
              onPress={() => handleEditAudition(audition)}
              onLongPress={() => handleDelete(audition)}
            >
              <View style={[styles.statusIndicator, { backgroundColor: STATUS_CONFIG[audition.status].color }]} />
              <View style={styles.auditionContent}>
                <Text style={styles.projectName} numberOfLines={1}>{audition.projectName}</Text>
                <Text style={styles.roleName}>{audition.role}</Text>
                <Text style={styles.dateText}>{formatDate(audition.dateSubmitted)}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: `${STATUS_CONFIG[audition.status].color}20` }]}>
                <Ionicons name={STATUS_CONFIG[audition.status].icon as any} size={14} color={STATUS_CONFIG[audition.status].color} />
                <Text style={[styles.statusText, { color: STATUS_CONFIG[audition.status].color }]}>
                  {STATUS_CONFIG[audition.status].label}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
        
        {/* Backup placeholder */}
        <View style={styles.backupPlaceholder}>
          <Ionicons name="cloud-outline" size={20} color="#4b5563" />
          <Text style={styles.backupText}>Backup & Sync (coming soon)</Text>
        </View>
      </ScrollView>

      {/* Add Button */}
      <TouchableOpacity style={styles.addButton} onPress={handleAddAudition}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add/Edit Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingAudition ? 'Edit Audition' : 'New Audition'}</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalForm}>
              <Text style={styles.inputLabel}>Project Name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., Breaking Bad S2"
                placeholderTextColor="#6b7280"
                value={projectName}
                onChangeText={setProjectName}
              />

              <Text style={styles.inputLabel}>Role *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g., Walter White"
                placeholderTextColor="#6b7280"
                value={role}
                onChangeText={setRole}
              />

              <Text style={styles.inputLabel}>Status</Text>
              <View style={styles.statusPicker}>
                {(Object.keys(STATUS_CONFIG) as AuditionStatus[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusOption, status === s && { backgroundColor: `${STATUS_CONFIG[s].color}20`, borderColor: STATUS_CONFIG[s].color }]}
                    onPress={() => setStatus(s)}
                  >
                    <Ionicons name={STATUS_CONFIG[s].icon as any} size={18} color={status === s ? STATUS_CONFIG[s].color : '#6b7280'} />
                    <Text style={[styles.statusOptionText, status === s && { color: STATUS_CONFIG[s].color }]}>
                      {STATUS_CONFIG[s].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Date Submitted</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="calendar" size={18} color="#6366f1" />
                <Text style={styles.dateButtonText}>{formatDate(dateSubmitted.toISOString())}</Text>
              </TouchableOpacity>

              <Text style={styles.inputLabel}>Follow-up Reminder (optional)</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => setShowFollowUpPicker(true)}>
                <Ionicons name="alarm" size={18} color={followUpDate ? '#10b981' : '#6b7280'} />
                <Text style={[styles.dateButtonText, !followUpDate && { color: '#6b7280' }]}>
                  {followUpDate ? formatDate(followUpDate.toISOString()) : 'Set reminder'}
                </Text>
                {followUpDate && (
                  <TouchableOpacity onPress={() => setFollowUpDate(null)}>
                    <Ionicons name="close-circle" size={18} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              <Text style={styles.inputLabel}>Notes</Text>
              <TextInput
                style={[styles.textInput, styles.notesInput]}
                placeholder="Casting director, notes, etc."
                placeholderTextColor="#6b7280"
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </ScrollView>

            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>{editingAudition ? 'Save Changes' : 'Add Audition'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={dateSubmitted}
            mode="date"
            onChange={(e, date) => {
              setShowDatePicker(false);
              if (date) setDateSubmitted(date);
            }}
          />
        )}
        {showFollowUpPicker && (
          <DateTimePicker
            value={followUpDate || new Date()}
            mode="date"
            minimumDate={new Date()}
            onChange={(e, date) => {
              setShowFollowUpPicker(false);
              if (date) setFollowUpDate(date);
            }}
          />
        )}
      </Modal>

      {/* Stats Modal */}
      <Modal visible={showStatsModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.statsModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Your Stats</Text>
              <TouchableOpacity onPress={() => setShowStatsModal(false)} data-testid="close-stats-modal">
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            {stats ? (
              <>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxValue}>{stats.auditionsThisMonth}</Text>
                    <Text style={styles.statBoxLabel}>This Month</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statBoxValue}>{stats.auditionsLastMonth}</Text>
                    <Text style={styles.statBoxLabel}>Last Month</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={[styles.statBoxValue, { color: '#f59e0b' }]}>{stats.callbackRate}%</Text>
                    <Text style={styles.statBoxLabel}>Callback Rate</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={[styles.statBoxValue, { color: '#10b981' }]}>{stats.bookingRate}%</Text>
                    <Text style={styles.statBoxLabel}>Booking Rate</Text>
                  </View>
                </View>

                <View style={[styles.momentumCard, stats.momentum === 'rising' ? styles.momentumRising : stats.momentum === 'declining' ? styles.momentumDeclining : styles.momentumSteady]}>
                  <Ionicons
                    name={stats.momentum === 'rising' ? 'trending-up' : stats.momentum === 'declining' ? 'trending-down' : 'remove'}
                    size={24}
                    color={stats.momentum === 'rising' ? '#10b981' : stats.momentum === 'declining' ? '#ef4444' : '#6b7280'}
                  />
                  <View style={styles.momentumInfo}>
                    <Text style={styles.momentumTitle}>
                      {stats.momentum === 'rising' ? 'Momentum Rising!' : stats.momentum === 'declining' ? 'Keep Pushing!' : 'Steady Progress'}
                    </Text>
                    <Text style={styles.momentumSubtitle}>
                      {stats.momentum === 'rising'
                        ? "You're auditioning more than last month!"
                        : stats.momentum === 'declining'
                        ? 'Your audition pace has slowed down'
                        : 'Consistent effort pays off'}
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Ionicons name="analytics-outline" size={48} color="#6b7280" />
                <Text style={{ color: '#9ca3af', fontSize: 16, marginTop: 12 }}>
                  No stats yet
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
                  Add some auditions to see your stats
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  statsButton: { padding: 4 },
  
  quickStats: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  quickStatItem: { flex: 1, backgroundColor: '#1a1a2e', borderRadius: 10, padding: 12, alignItems: 'center' },
  quickStatValue: { fontSize: 20, fontWeight: '700', color: '#fff' },
  quickStatLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  
  filterScroll: { maxHeight: 50 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e' },
  filterChipActive: { backgroundColor: 'rgba(99, 102, 241, 0.2)', borderColor: '#6366f1' },
  filterChipText: { fontSize: 13, color: '#6b7280' },
  filterChipTextActive: { color: '#6366f1' },
  
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', marginHorizontal: 16, marginVertical: 8, borderRadius: 10, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#fff' },
  
  list: { flex: 1, paddingHorizontal: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  
  auditionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 10 },
  statusIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 12 },
  auditionContent: { flex: 1 },
  projectName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  roleName: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  dateText: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '600' },
  
  backupPlaceholder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 20, marginTop: 10 },
  backupText: { fontSize: 13, color: '#4b5563' },
  
  addButton: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#6366f1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  modalForm: { maxHeight: 400 },
  
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 8, marginTop: 16 },
  textInput: { backgroundColor: '#0a0a0f', borderRadius: 10, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#2a2a3e' },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  
  statusPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusOption: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#2a2a3e' },
  statusOptionText: { fontSize: 13, color: '#6b7280' },
  
  dateButton: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0a0a0f', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#2a2a3e' },
  dateButtonText: { flex: 1, fontSize: 15, color: '#fff' },
  
  saveButton: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  saveButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  
  statsModalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  statBox: { width: '47%', backgroundColor: '#0a0a0f', borderRadius: 12, padding: 16, alignItems: 'center' },
  statBoxValue: { fontSize: 28, fontWeight: '700', color: '#fff' },
  statBoxLabel: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  
  momentumCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, marginTop: 16 },
  momentumRising: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
  momentumDeclining: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  momentumSteady: { backgroundColor: 'rgba(107, 114, 128, 0.15)' },
  momentumInfo: { flex: 1 },
  momentumTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  momentumSubtitle: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
});
