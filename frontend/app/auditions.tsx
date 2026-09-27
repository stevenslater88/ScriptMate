import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Modal, TextInput, Alert, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import useRevenueCat from '../hooks/useRevenueCat';
import {
  Audition, AuditionStatus, SubmissionType, AuditionStats, MonthlyData,
  getFilteredAuditions, createAudition, updateAudition, deleteAudition,
  getAuditionStats, getAuditionCount, getMonthlyStats, AuditionFilters,
} from '../services/auditionService';

const STATUS_CONFIG: Record<AuditionStatus, { label: string; color: string; icon: string }> = {
  submitted: { label: 'Submitted', color: '#3b82f6', icon: 'paper-plane' },
  callback: { label: 'Callback', color: '#f59e0b', icon: 'call' },
  pinned: { label: 'Pinned', color: '#8b5cf6', icon: 'pin' },
  booked: { label: 'Booked', color: '#10b981', icon: 'checkmark-circle' },
  rejected: { label: 'Rejected', color: '#6b7280', icon: 'close-circle' },
};

const SUBMISSION_TYPES: { key: SubmissionType; label: string; icon: string }[] = [
  { key: 'self_tape', label: 'Self Tape', icon: 'videocam' },
  { key: 'in_person', label: 'In Person', icon: 'person' },
  { key: 'voice', label: 'Voice', icon: 'mic' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
];

const FREE_AUDITION_LIMIT = 10;
const { width: SCREEN_W } = Dimensions.get('window');

export default function AuditionsScreen() {
  const { isPremium } = useRevenueCat();
  const [auditions, setAuditions] = useState<Audition[]>([]);
  const [stats, setStats] = useState<AuditionStats | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAudition, setEditingAudition] = useState<Audition | null>(null);
  const [showDashboard, setShowDashboard] = useState(true);

  // Filters
  const [filters, setFilters] = useState<AuditionFilters>({ sortBy: 'date', sortOrder: 'desc' });
  const [statusFilter, setStatusFilter] = useState<AuditionStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form
  const [projectName, setProjectName] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  const [castingCompany, setCastingCompany] = useState('');
  const [submissionType, setSubmissionType] = useState<SubmissionType>('self_tape');
  const [status, setStatus] = useState<AuditionStatus>('submitted');
  const [dateSubmitted, setDateSubmitted] = useState(new Date());
  const [followUpDate, setFollowUpDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [linkedTapeId, setLinkedTapeId] = useState<string | undefined>();
  const [linkedTapeName, setLinkedTapeName] = useState<string | undefined>();

  const loadData = useCallback(async () => {
    try {
      const [list, st, monthly] = await Promise.all([
        getFilteredAuditions({ ...filters, status: statusFilter || undefined, searchQuery: searchQuery || undefined }),
        getAuditionStats(),
        getMonthlyStats(),
      ]);
      setAuditions(list);
      setStats(st);
      setMonthlyData(monthly);
    } catch (e) {
      console.error('Load auditions error:', e);
    } finally {
      setLoading(false);
    }
  }, [filters, statusFilter, searchQuery]);

  useEffect(() => { loadData(); }, [loadData]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const resetForm = () => {
    setProjectName(''); setRole(''); setNotes(''); setCastingCompany('');
    setSubmissionType('self_tape'); setStatus('submitted');
    setDateSubmitted(new Date()); setFollowUpDate(null);
    setLinkedTapeId(undefined); setLinkedTapeName(undefined);
    setEditingAudition(null);
  };

  const handleAddAudition = async () => {
    const count = await getAuditionCount();
    if (!isPremium && count >= FREE_AUDITION_LIMIT) {
      Alert.alert('Upgrade Your Career Toolkit',
        'Track unlimited auditions and view full career analytics.',
        [{ text: 'Maybe Later', style: 'cancel' }, { text: 'Unlock Pro', onPress: () => router.push('/premium') }]
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
    setCastingCompany(audition.castingCompany || '');
    setSubmissionType(audition.submissionType || 'other');
    setStatus(audition.status);
    setDateSubmitted(new Date(audition.dateSubmitted));
    setFollowUpDate(audition.followUpDate ? new Date(audition.followUpDate) : null);
    setLinkedTapeId(audition.linkedTapeId);
    setLinkedTapeName(audition.linkedTapeName);
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!projectName.trim() || !role.trim()) {
      Alert.alert('Missing Info', 'Please enter project name and role.');
      return;
    }
    try {
      const data = {
        projectName: projectName.trim(), role: role.trim(), notes: notes.trim(),
        castingCompany: castingCompany.trim(), submissionType, status,
        dateSubmitted: dateSubmitted.toISOString(),
        followUpDate: followUpDate?.toISOString(),
        linkedTapeId, linkedTapeName,
      };
      if (editingAudition) {
        await updateAudition(editingAudition.id, data);
      } else {
        await createAudition(data as any);
      }
      setShowAddModal(false);
      resetForm();
      loadData();
    } catch {
      Alert.alert('Error', 'Failed to save audition.');
    }
  };

  const handleQuickStatusChange = async (audition: Audition, newStatus: AuditionStatus) => {
    await updateAudition(audition.id, { status: newStatus });
    loadData();
  };

  const handleDelete = (audition: Audition) => {
    Alert.alert('Delete Audition', `Delete "${audition.projectName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteAudition(audition.id); loadData(); } },
    ]);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Graph helper
  const maxCount = Math.max(...monthlyData.map(m => m.count), 1);
  const graphBarWidth = (SCREEN_W - 80) / 6;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} data-testid="auditions-back-btn">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Audition Tracker</Text>
        <TouchableOpacity onPress={() => setShowDashboard(!showDashboard)} data-testid="toggle-dashboard-btn">
          <Ionicons name={showDashboard ? 'chevron-up' : 'stats-chart'} size={22} color="#6366f1" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />}
      >
        {/* ====== CAREER DASHBOARD ====== */}
        {showDashboard && stats && (
          <View style={styles.dashboard}>
            {/* Stat Cards */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statVal}>{stats.totalAuditions}</Text>
                <Text style={styles.statLabel}>Submitted</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statVal, { color: '#f59e0b' }]}>{stats.callbackCount}</Text>
                <Text style={styles.statLabel}>Callbacks</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statVal, { color: '#10b981' }]}>{stats.bookedCount}</Text>
                <Text style={styles.statLabel}>Bookings</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statVal, { color: '#6366f1' }]}>{stats.conversionRate}%</Text>
                <Text style={styles.statLabel}>Conversion</Text>
              </View>
            </View>

            {/* Rates Row */}
            <View style={styles.ratesRow}>
              <View style={styles.rateChip}>
                <Text style={styles.rateLabel}>Callback Rate</Text>
                <Text style={[styles.rateVal, { color: '#f59e0b' }]}>{stats.callbackRate}%</Text>
              </View>
              <View style={styles.rateChip}>
                <Text style={styles.rateLabel}>Booking Rate</Text>
                <Text style={[styles.rateVal, { color: '#10b981' }]}>{stats.bookingRate}%</Text>
              </View>
              <View style={[styles.rateChip, styles.momentumChip,
                stats.momentum === 'rising' ? { borderColor: '#10b981' } :
                stats.momentum === 'declining' ? { borderColor: '#ef4444' } : {}
              ]}>
                <Ionicons
                  name={stats.momentum === 'rising' ? 'trending-up' : stats.momentum === 'declining' ? 'trending-down' : 'remove'}
                  size={16}
                  color={stats.momentum === 'rising' ? '#10b981' : stats.momentum === 'declining' ? '#ef4444' : '#6b7280'}
                />
                <Text style={styles.rateLabel}>
                  {stats.momentum === 'rising' ? 'Rising' : stats.momentum === 'declining' ? 'Slow' : 'Steady'}
                </Text>
              </View>
            </View>

            {/* Monthly Graph */}
            <View style={styles.graphCard}>
              <Text style={styles.graphTitle}>Monthly Auditions</Text>
              <View style={styles.graphContainer}>
                {monthlyData.map((m, i) => (
                  <View key={i} style={styles.graphCol}>
                    <Text style={styles.graphCount}>{m.count}</Text>
                    <View style={styles.graphBarTrack}>
                      <View style={[
                        styles.graphBar,
                        { height: `${Math.max((m.count / maxCount) * 100, 4)}%` },
                      ]}>
                        {m.booked > 0 && (
                          <View style={[styles.graphBarBooked, {
                            height: `${(m.booked / m.count) * 100}%`,
                          }]} />
                        )}
                      </View>
                    </View>
                    <Text style={styles.graphMonth}>{m.month}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.graphLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#6366f1' }]} />
                  <Text style={styles.legendText}>Submitted</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                  <Text style={styles.legendText}>Booked</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Status Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, !statusFilter && styles.filterChipActive]}
              onPress={() => setStatusFilter(null)}
              data-testid="filter-all"
            >
              <Text style={[styles.filterChipText, !statusFilter && styles.filterChipTextActive]}>All</Text>
            </TouchableOpacity>
            {(Object.keys(STATUS_CONFIG) as AuditionStatus[]).map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.filterChip, statusFilter === s && { backgroundColor: `${STATUS_CONFIG[s].color}20`, borderColor: STATUS_CONFIG[s].color }]}
                onPress={() => setStatusFilter(statusFilter === s ? null : s)}
                data-testid={`filter-${s}`}
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
            placeholder="Search projects, roles, studios..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
            data-testid="search-input"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#6b7280" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Audition Cards */}
        {auditions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="clipboard-outline" size={48} color="#374151" />
            <Text style={styles.emptyTitle}>No auditions yet</Text>
            <Text style={styles.emptySubtitle}>Track your submissions and see your career grow</Text>
            <TouchableOpacity style={styles.emptyCTA} onPress={handleAddAudition} data-testid="empty-add-btn">
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.emptyCTAText}>Add First Audition</Text>
            </TouchableOpacity>
          </View>
        ) : (
          auditions.map(audition => (
            <TouchableOpacity
              key={audition.id}
              style={styles.auditionCard}
              onPress={() => handleEditAudition(audition)}
              onLongPress={() => handleDelete(audition)}
              data-testid={`audition-card-${audition.id}`}
            >
              <View style={[styles.statusStripe, { backgroundColor: STATUS_CONFIG[audition.status].color }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardProject} numberOfLines={1}>{audition.projectName}</Text>
                    <Text style={styles.cardRole}>{audition.role}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: `${STATUS_CONFIG[audition.status].color}18` }]}>
                    <Ionicons name={STATUS_CONFIG[audition.status].icon as any} size={13} color={STATUS_CONFIG[audition.status].color} />
                    <Text style={[styles.statusBadgeText, { color: STATUS_CONFIG[audition.status].color }]}>
                      {STATUS_CONFIG[audition.status].label}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardMeta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-outline" size={13} color="#6b7280" />
                    <Text style={styles.metaText}>{formatDate(audition.dateSubmitted)}</Text>
                  </View>
                  {audition.castingCompany ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="business-outline" size={13} color="#6b7280" />
                      <Text style={styles.metaText} numberOfLines={1}>{audition.castingCompany}</Text>
                    </View>
                  ) : null}
                  {audition.submissionType && audition.submissionType !== 'other' ? (
                    <View style={styles.metaItem}>
                      <Ionicons
                        name={SUBMISSION_TYPES.find(t => t.key === audition.submissionType)?.icon as any || 'ellipsis-horizontal'}
                        size={13} color="#6b7280"
                      />
                      <Text style={styles.metaText}>
                        {SUBMISSION_TYPES.find(t => t.key === audition.submissionType)?.label || 'Other'}
                      </Text>
                    </View>
                  ) : null}
                  {audition.linkedTapeName ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="film-outline" size={13} color="#8b5cf6" />
                      <Text style={[styles.metaText, { color: '#8b5cf6' }]}>{audition.linkedTapeName}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Quick Status Change */}
                <View style={styles.quickStatusRow}>
                  {(Object.keys(STATUS_CONFIG) as AuditionStatus[]).map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.quickStatusBtn,
                        audition.status === s && { backgroundColor: `${STATUS_CONFIG[s].color}25`, borderColor: STATUS_CONFIG[s].color },
                      ]}
                      onPress={() => handleQuickStatusChange(audition, s)}
                      data-testid={`quick-status-${audition.id}-${s}`}
                    >
                      <Ionicons name={STATUS_CONFIG[s].icon as any} size={12}
                        color={audition.status === s ? STATUS_CONFIG[s].color : '#4b5563'} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={handleAddAudition} data-testid="add-audition-fab">
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* ====== ADD/EDIT MODAL ====== */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingAudition ? 'Edit Audition' : 'New Audition'}</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }} data-testid="close-modal-btn">
                <Ionicons name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalForm} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Project Name *</Text>
              <TextInput style={styles.input} placeholder="e.g., Breaking Bad S2" placeholderTextColor="#6b7280"
                value={projectName} onChangeText={setProjectName} data-testid="project-name-input" />

              <Text style={styles.inputLabel}>Role *</Text>
              <TextInput style={styles.input} placeholder="e.g., Walter White" placeholderTextColor="#6b7280"
                value={role} onChangeText={setRole} data-testid="role-input" />

              <Text style={styles.inputLabel}>Casting Company / Studio</Text>
              <TextInput style={styles.input} placeholder="e.g., Sony Pictures" placeholderTextColor="#6b7280"
                value={castingCompany} onChangeText={setCastingCompany} data-testid="casting-company-input" />

              <Text style={styles.inputLabel}>Submission Type</Text>
              <View style={styles.typeRow}>
                {SUBMISSION_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typeBtn, submissionType === t.key && styles.typeBtnActive]}
                    onPress={() => setSubmissionType(t.key)}
                    data-testid={`type-${t.key}`}
                  >
                    <Ionicons name={t.icon as any} size={16}
                      color={submissionType === t.key ? '#fff' : '#9ca3af'} />
                    <Text style={[styles.typeBtnText, submissionType === t.key && { color: '#fff' }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Status</Text>
              <View style={styles.statusPicker}>
                {(Object.keys(STATUS_CONFIG) as AuditionStatus[]).map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusOption, status === s && { backgroundColor: `${STATUS_CONFIG[s].color}20`, borderColor: STATUS_CONFIG[s].color }]}
                    onPress={() => setStatus(s)}
                    data-testid={`status-${s}`}
                  >
                    <Ionicons name={STATUS_CONFIG[s].icon as any} size={16} color={status === s ? STATUS_CONFIG[s].color : '#6b7280'} />
                    <Text style={[styles.statusOptionText, status === s && { color: STATUS_CONFIG[s].color }]}>
                      {STATUS_CONFIG[s].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Date Submitted</Text>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)} data-testid="date-picker-btn">
                <Ionicons name="calendar" size={18} color="#6366f1" />
                <Text style={styles.dateBtnText}>{formatDate(dateSubmitted.toISOString())}</Text>
              </TouchableOpacity>

              <Text style={styles.inputLabel}>Follow-up Reminder</Text>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowFollowUpPicker(true)}>
                <Ionicons name="alarm" size={18} color={followUpDate ? '#10b981' : '#6b7280'} />
                <Text style={[styles.dateBtnText, !followUpDate && { color: '#6b7280' }]}>
                  {followUpDate ? formatDate(followUpDate.toISOString()) : 'Set reminder'}
                </Text>
                {followUpDate && (
                  <TouchableOpacity onPress={() => setFollowUpDate(null)}>
                    <Ionicons name="close-circle" size={18} color="#6b7280" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              {/* Self Tape Link */}
              <Text style={styles.inputLabel}>Linked Self Tape</Text>
              {linkedTapeName ? (
                <View style={styles.linkedTape}>
                  <Ionicons name="film" size={18} color="#8b5cf6" />
                  <Text style={styles.linkedTapeText}>{linkedTapeName}</Text>
                  <TouchableOpacity onPress={() => { setLinkedTapeId(undefined); setLinkedTapeName(undefined); }}>
                    <Ionicons name="close-circle" size={18} color="#6b7280" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.attachBtn} data-testid="attach-tape-btn"
                  onPress={() => Alert.alert('Attach Self Tape', 'Record a self tape first, then link it here from the self tape review screen.')}>
                  <Ionicons name="attach" size={18} color="#6b7280" />
                  <Text style={styles.attachBtnText}>Attach a Self Tape recording</Text>
                </TouchableOpacity>
              )}

              <Text style={styles.inputLabel}>Notes</Text>
              <TextInput
                style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                placeholder="Casting director notes, callbacks, etc."
                placeholderTextColor="#6b7280"
                value={notes} onChangeText={setNotes} multiline
                data-testid="notes-input"
              />
            </ScrollView>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} data-testid="save-audition-btn">
              <Text style={styles.saveBtnText}>{editingAudition ? 'Save Changes' : 'Add Audition'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showDatePicker && (
          <DateTimePicker value={dateSubmitted} mode="date"
            onChange={(_, d) => { setShowDatePicker(false); if (d) setDateSubmitted(d); }} />
        )}
        {showFollowUpPicker && (
          <DateTimePicker value={followUpDate || new Date()} mode="date" minimumDate={new Date()}
            onChange={(_, d) => { setShowFollowUpPicker(false); if (d) setFollowUpDate(d); }} />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  scrollView: { flex: 1 },

  // Dashboard
  dashboard: { paddingHorizontal: 16, paddingTop: 12 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1, backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3e',
  },
  statVal: { fontSize: 22, fontWeight: '700', color: '#fff' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  ratesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  rateChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: '#1a1a2e', borderRadius: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  momentumChip: {},
  rateLabel: { fontSize: 11, color: '#9ca3af' },
  rateVal: { fontSize: 14, fontWeight: '700' },

  // Graph
  graphCard: {
    backgroundColor: '#1a1a2e', borderRadius: 14, padding: 16, marginTop: 12,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  graphTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 14 },
  graphContainer: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around',
    height: 120,
  },
  graphCol: { alignItems: 'center', flex: 1 },
  graphCount: { fontSize: 11, color: '#9ca3af', marginBottom: 4 },
  graphBarTrack: {
    width: 28, height: 90, backgroundColor: '#0a0a0f', borderRadius: 6,
    justifyContent: 'flex-end', overflow: 'hidden',
  },
  graphBar: {
    width: '100%', backgroundColor: '#6366f1', borderRadius: 6,
    justifyContent: 'flex-end', overflow: 'hidden', minHeight: 4,
  },
  graphBarBooked: {
    width: '100%', backgroundColor: '#10b981', borderBottomLeftRadius: 6, borderBottomRightRadius: 6,
  },
  graphMonth: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  graphLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#6b7280' },

  // Filters
  filterScroll: { maxHeight: 50 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e',
  },
  filterChipActive: { backgroundColor: 'rgba(99, 102, 241, 0.2)', borderColor: '#6366f1' },
  filterChipText: { fontSize: 13, color: '#6b7280' },
  filterChipTextActive: { color: '#6366f1' },

  // Search
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e',
    marginHorizontal: 16, marginVertical: 8, borderRadius: 10, paddingHorizontal: 12, gap: 8,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: '#fff' },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#6b7280', marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: '#4b5563', marginTop: 4, textAlign: 'center', paddingHorizontal: 40 },
  emptyCTA: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10,
  },
  emptyCTAText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Card
  auditionCard: {
    flexDirection: 'row', backgroundColor: '#1a1a2e', borderRadius: 14,
    marginHorizontal: 16, marginBottom: 10, overflow: 'hidden',
  },
  statusStripe: { width: 4 },
  cardBody: { flex: 1, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardProject: { fontSize: 16, fontWeight: '600', color: '#fff' },
  cardRole: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginLeft: 8,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 12, color: '#6b7280' },
  quickStatusRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  quickStatusBtn: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#2a2a3e',
  },

  // FAB
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#6366f1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '92%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  modalForm: { maxHeight: 500 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#9ca3af', marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: '#0a0a0f', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#2a2a3e',
  },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#2a2a3e', gap: 4,
  },
  typeBtnActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  typeBtnText: { fontSize: 11, color: '#9ca3af', fontWeight: '500' },
  statusPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusOption: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#0a0a0f', borderWidth: 1, borderColor: '#2a2a3e',
  },
  statusOptionText: { fontSize: 13, color: '#6b7280' },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0a0a0f', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#2a2a3e',
  },
  dateBtnText: { flex: 1, fontSize: 15, color: '#fff' },
  linkedTape: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(139,92,246,0.1)', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#8b5cf6',
  },
  linkedTapeText: { flex: 1, color: '#8b5cf6', fontSize: 14, fontWeight: '500' },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0a0a0f', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#2a2a3e', borderStyle: 'dashed',
  },
  attachBtnText: { color: '#6b7280', fontSize: 14 },
  saveBtn: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
