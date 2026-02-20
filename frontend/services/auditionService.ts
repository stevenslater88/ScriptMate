// Audition Tracker Service - Local storage for auditions with stats
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const AUDITIONS_KEY = '@scriptmate_auditions';

export type AuditionStatus = 'submitted' | 'callback' | 'booked' | 'passed';

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
  projectType?: string; // Film, TV, Commercial, Theater, etc.
  createdAt: string;
  updatedAt: string;
}

export interface AuditionStats {
  totalAuditions: number;
  submittedCount: number;
  callbackCount: number;
  bookedCount: number;
  passedCount: number;
  callbackRate: number; // percentage
  bookingRate: number; // percentage
  auditionsThisMonth: number;
  auditionsLastMonth: number;
  momentum: 'rising' | 'steady' | 'declining';
}

// Generate unique ID
const generateId = (): string => {
  return `aud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Get all auditions
export const getAuditions = async (): Promise<Audition[]> => {
  try {
    const data = await AsyncStorage.getItem(AUDITIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Get a single audition
export const getAudition = async (id: string): Promise<Audition | null> => {
  const auditions = await getAuditions();
  return auditions.find(a => a.id === id) || null;
};

// Create new audition
export const createAudition = async (audition: Omit<Audition, 'id' | 'createdAt' | 'updatedAt'>): Promise<Audition> => {
  const auditions = await getAuditions();
  const now = new Date().toISOString();
  
  const newAudition: Audition = {
    ...audition,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  
  // Schedule follow-up notification if set
  if (audition.followUpDate) {
    const notificationId = await scheduleFollowUpNotification(newAudition);
    newAudition.followUpNotificationId = notificationId;
  }
  
  auditions.unshift(newAudition);
  await AsyncStorage.setItem(AUDITIONS_KEY, JSON.stringify(auditions));
  
  return newAudition;
};

// Update audition
export const updateAudition = async (id: string, updates: Partial<Audition>): Promise<Audition | null> => {
  const auditions = await getAuditions();
  const index = auditions.findIndex(a => a.id === id);
  
  if (index === -1) return null;
  
  const existing = auditions[index];
  
  // Cancel old notification if follow-up date changed
  if (existing.followUpNotificationId && updates.followUpDate !== existing.followUpDate) {
    await Notifications.cancelScheduledNotificationAsync(existing.followUpNotificationId);
  }
  
  const updated: Audition = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  // Schedule new notification if follow-up date set
  if (updates.followUpDate && updates.followUpDate !== existing.followUpDate) {
    const notificationId = await scheduleFollowUpNotification(updated);
    updated.followUpNotificationId = notificationId;
  }
  
  auditions[index] = updated;
  await AsyncStorage.setItem(AUDITIONS_KEY, JSON.stringify(auditions));
  
  return updated;
};

// Delete audition
export const deleteAudition = async (id: string): Promise<boolean> => {
  const auditions = await getAuditions();
  const audition = auditions.find(a => a.id === id);
  
  // Cancel notification if exists
  if (audition?.followUpNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(audition.followUpNotificationId);
  }
  
  const filtered = auditions.filter(a => a.id !== id);
  await AsyncStorage.setItem(AUDITIONS_KEY, JSON.stringify(filtered));
  
  return filtered.length < auditions.length;
};

// Get audition statistics
export const getAuditionStats = async (): Promise<AuditionStats> => {
  const auditions = await getAuditions();
  
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
  
  const submittedCount = auditions.filter(a => a.status === 'submitted').length;
  const callbackCount = auditions.filter(a => a.status === 'callback').length;
  const bookedCount = auditions.filter(a => a.status === 'booked').length;
  const passedCount = auditions.filter(a => a.status === 'passed').length;
  
  const auditionsThisMonth = auditions.filter(a => {
    const date = new Date(a.dateSubmitted);
    return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
  }).length;
  
  const auditionsLastMonth = auditions.filter(a => {
    const date = new Date(a.dateSubmitted);
    return date.getMonth() === lastMonth && date.getFullYear() === lastMonthYear;
  }).length;
  
  // Calculate rates based on completed auditions (callback + booked + passed)
  const completedAuditions = callbackCount + bookedCount + passedCount;
  const callbackRate = completedAuditions > 0 
    ? Math.round(((callbackCount + bookedCount) / auditions.length) * 100) 
    : 0;
  const bookingRate = completedAuditions > 0 
    ? Math.round((bookedCount / auditions.length) * 100) 
    : 0;
  
  // Determine momentum
  let momentum: 'rising' | 'steady' | 'declining' = 'steady';
  if (auditionsThisMonth > auditionsLastMonth * 1.2) {
    momentum = 'rising';
  } else if (auditionsThisMonth < auditionsLastMonth * 0.8) {
    momentum = 'declining';
  }
  
  return {
    totalAuditions: auditions.length,
    submittedCount,
    callbackCount,
    bookedCount,
    passedCount,
    callbackRate,
    bookingRate,
    auditionsThisMonth,
    auditionsLastMonth,
    momentum,
  };
};

// Get pending auditions (submitted or callback)
export const getPendingAuditions = async (): Promise<Audition[]> => {
  const auditions = await getAuditions();
  return auditions.filter(a => a.status === 'submitted' || a.status === 'callback');
};

// Schedule follow-up notification
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
      trigger: {
        date: followUpDate,
      },
    });
    
    return notificationId;
  } catch {
    return undefined;
  }
};

// Get auditions sorted/filtered
export interface AuditionFilters {
  status?: AuditionStatus;
  searchQuery?: string;
  sortBy?: 'date' | 'project' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export const getFilteredAuditions = async (filters: AuditionFilters): Promise<Audition[]> => {
  let auditions = await getAuditions();
  
  // Filter by status
  if (filters.status) {
    auditions = auditions.filter(a => a.status === filters.status);
  }
  
  // Filter by search query
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    auditions = auditions.filter(a => 
      a.projectName.toLowerCase().includes(query) ||
      a.role.toLowerCase().includes(query) ||
      a.notes.toLowerCase().includes(query)
    );
  }
  
  // Sort
  const sortOrder = filters.sortOrder || 'desc';
  const sortMultiplier = sortOrder === 'asc' ? 1 : -1;
  
  switch (filters.sortBy) {
    case 'project':
      auditions.sort((a, b) => sortMultiplier * a.projectName.localeCompare(b.projectName));
      break;
    case 'status':
      const statusOrder = { submitted: 0, callback: 1, booked: 2, passed: 3 };
      auditions.sort((a, b) => sortMultiplier * (statusOrder[a.status] - statusOrder[b.status]));
      break;
    case 'date':
    default:
      auditions.sort((a, b) => sortMultiplier * (new Date(a.dateSubmitted).getTime() - new Date(b.dateSubmitted).getTime()));
      break;
  }
  
  return auditions;
};

// Check if user has reached free limit (5 auditions)
export const hasReachedFreeLimit = async (): Promise<boolean> => {
  const auditions = await getAuditions();
  return auditions.length >= 5;
};

// Get count of auditions
export const getAuditionCount = async (): Promise<number> => {
  const auditions = await getAuditions();
  return auditions.length;
};
