// Audition Tracker Service - Enhanced with career dashboard data
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const AUDITIONS_KEY = '@scriptmate_auditions';

export type AuditionStatus = 'submitted' | 'callback' | 'pinned' | 'booked' | 'rejected';
export type SubmissionType = 'self_tape' | 'in_person' | 'voice' | 'other';

export interface Audition {
  id: string;
  projectName: string;
  role: string;
  dateSubmitted: string;
  status: AuditionStatus;
  notes: string;
  followUpDate?: string;
  followUpNotificationId?: string;
  castingDirector?: string;
  castingCompany?: string;
  submissionType?: SubmissionType;
  linkedTapeId?: string;
  linkedTapeName?: string;
  projectType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditionStats {
  totalAuditions: number;
  submittedCount: number;
  callbackCount: number;
  pinnedCount: number;
  bookedCount: number;
  rejectedCount: number;
  callbackRate: number;
  bookingRate: number;
  conversionRate: number;
  auditionsThisMonth: number;
  auditionsLastMonth: number;
  momentum: 'rising' | 'steady' | 'declining';
}

export interface MonthlyData {
  month: string; // "Jan", "Feb", etc.
  count: number;
  booked: number;
}

const generateId = (): string => {
  return `aud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Migrate old "passed" status to "rejected"
const migrateAudition = (a: any): Audition => {
  if (a.status === 'passed') a.status = 'rejected';
  if (!a.submissionType) a.submissionType = 'other';
  return a as Audition;
};

export const getAuditions = async (): Promise<Audition[]> => {
  try {
    const data = await AsyncStorage.getItem(AUDITIONS_KEY);
    const raw = data ? JSON.parse(data) : [];
    return raw.map(migrateAudition);
  } catch {
    return [];
  }
};

export const getAudition = async (id: string): Promise<Audition | null> => {
  const auditions = await getAuditions();
  return auditions.find(a => a.id === id) || null;
};

export const createAudition = async (audition: Omit<Audition, 'id' | 'createdAt' | 'updatedAt'>): Promise<Audition> => {
  const auditions = await getAuditions();
  const now = new Date().toISOString();

  const newAudition: Audition = {
    ...audition,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };

  if (audition.followUpDate) {
    const notificationId = await scheduleFollowUpNotification(newAudition);
    newAudition.followUpNotificationId = notificationId;
  }

  auditions.unshift(newAudition);
  await AsyncStorage.setItem(AUDITIONS_KEY, JSON.stringify(auditions));
  return newAudition;
};

export const updateAudition = async (id: string, updates: Partial<Audition>): Promise<Audition | null> => {
  const auditions = await getAuditions();
  const index = auditions.findIndex(a => a.id === id);
  if (index === -1) return null;

  const existing = auditions[index];

  if (existing.followUpNotificationId && updates.followUpDate !== existing.followUpDate) {
    await Notifications.cancelScheduledNotificationAsync(existing.followUpNotificationId);
  }

  const updated: Audition = { ...existing, ...updates, updatedAt: new Date().toISOString() };

  if (updates.followUpDate && updates.followUpDate !== existing.followUpDate) {
    const notificationId = await scheduleFollowUpNotification(updated);
    updated.followUpNotificationId = notificationId;
  }

  auditions[index] = updated;
  await AsyncStorage.setItem(AUDITIONS_KEY, JSON.stringify(auditions));
  return updated;
};

export const deleteAudition = async (id: string): Promise<boolean> => {
  const auditions = await getAuditions();
  const audition = auditions.find(a => a.id === id);

  if (audition?.followUpNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(audition.followUpNotificationId);
  }

  const filtered = auditions.filter(a => a.id !== id);
  await AsyncStorage.setItem(AUDITIONS_KEY, JSON.stringify(filtered));
  return filtered.length < auditions.length;
};

export const getAuditionStats = async (): Promise<AuditionStats> => {
  const auditions = await getAuditions();

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

  const submittedCount = auditions.filter(a => a.status === 'submitted').length;
  const callbackCount = auditions.filter(a => a.status === 'callback').length;
  const pinnedCount = auditions.filter(a => a.status === 'pinned').length;
  const bookedCount = auditions.filter(a => a.status === 'booked').length;
  const rejectedCount = auditions.filter(a => a.status === 'rejected').length;

  const auditionsThisMonth = auditions.filter(a => {
    const date = new Date(a.dateSubmitted);
    return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
  }).length;

  const auditionsLastMonth = auditions.filter(a => {
    const date = new Date(a.dateSubmitted);
    return date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear;
  }).length;

  const total = auditions.length;
  const callbackRate = total > 0 ? Math.round(((callbackCount + pinnedCount + bookedCount) / total) * 100) : 0;
  const bookingRate = total > 0 ? Math.round((bookedCount / total) * 100) : 0;
  const conversionRate = total > 0 ? Math.round(((bookedCount + callbackCount + pinnedCount) / total) * 100) : 0;

  let momentum: 'rising' | 'steady' | 'declining' = 'steady';
  if (auditionsThisMonth > auditionsLastMonth * 1.2) momentum = 'rising';
  else if (auditionsThisMonth < auditionsLastMonth * 0.8) momentum = 'declining';

  return {
    totalAuditions: total,
    submittedCount, callbackCount, pinnedCount, bookedCount, rejectedCount,
    callbackRate, bookingRate, conversionRate,
    auditionsThisMonth, auditionsLastMonth, momentum,
  };
};

export const getMonthlyStats = async (): Promise<MonthlyData[]> => {
  const auditions = await getAuditions();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const result: MonthlyData[] = [];

  // Last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    const monthAuditions = auditions.filter(a => {
      const ad = new Date(a.dateSubmitted);
      return ad.getMonth() === m && ad.getFullYear() === y;
    });
    result.push({
      month: months[m],
      count: monthAuditions.length,
      booked: monthAuditions.filter(a => a.status === 'booked').length,
    });
  }
  return result;
};

export const getPendingAuditions = async (): Promise<Audition[]> => {
  const auditions = await getAuditions();
  return auditions.filter(a => a.status === 'submitted' || a.status === 'callback' || a.status === 'pinned');
};

const scheduleFollowUpNotification = async (audition: Audition): Promise<string | undefined> => {
  if (!audition.followUpDate) return undefined;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      if (newStatus !== 'granted') return undefined;
    }
    const followUpDate = new Date(audition.followUpDate);
    if (followUpDate <= new Date()) return undefined;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Audition Follow-Up',
        body: `Time to follow up on "${audition.projectName}" - ${audition.role}`,
        data: { auditionId: audition.id },
      },
      trigger: { date: followUpDate },
    });
    return notificationId;
  } catch {
    return undefined;
  }
};

export interface AuditionFilters {
  status?: AuditionStatus;
  searchQuery?: string;
  sortBy?: 'date' | 'project' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export const getFilteredAuditions = async (filters: AuditionFilters): Promise<Audition[]> => {
  let auditions = await getAuditions();

  if (filters.status) {
    auditions = auditions.filter(a => a.status === filters.status);
  }

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    auditions = auditions.filter(a =>
      a.projectName.toLowerCase().includes(query) ||
      a.role.toLowerCase().includes(query) ||
      (a.castingCompany || '').toLowerCase().includes(query) ||
      a.notes.toLowerCase().includes(query)
    );
  }

  const sortOrder = filters.sortOrder || 'desc';
  const mult = sortOrder === 'asc' ? 1 : -1;

  switch (filters.sortBy) {
    case 'project':
      auditions.sort((a, b) => mult * a.projectName.localeCompare(b.projectName));
      break;
    case 'status':
      const order: Record<AuditionStatus, number> = { submitted: 0, callback: 1, pinned: 2, booked: 3, rejected: 4 };
      auditions.sort((a, b) => mult * (order[a.status] - order[b.status]));
      break;
    case 'date':
    default:
      auditions.sort((a, b) => mult * (new Date(a.dateSubmitted).getTime() - new Date(b.dateSubmitted).getTime()));
      break;
  }

  return auditions;
};

export const hasReachedFreeLimit = async (): Promise<boolean> => {
  const auditions = await getAuditions();
  return auditions.length >= 5;
};

export const getAuditionCount = async (): Promise<number> => {
  const auditions = await getAuditions();
  return auditions.length;
};
