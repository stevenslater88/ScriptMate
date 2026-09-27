// Progress Tracking Service - Local storage for practice progress, streaks, and mastery levels
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROGRESS_KEY = '@scriptmate_progress';
const STREAK_KEY = '@scriptmate_streak';
const PRACTICE_TIME_KEY = '@scriptmate_practice_time';

// Mastery levels with XP thresholds
export const MASTERY_LEVELS = {
  ROOKIE: { name: 'Rookie', minXP: 0, icon: 'star-outline', color: '#6b7280' },
  WORKING_ACTOR: { name: 'Working Actor', minXP: 100, icon: 'star-half', color: '#10b981' },
  SERIES_REGULAR: { name: 'Series Regular', minXP: 300, icon: 'star', color: '#3b82f6' },
  LEAD: { name: 'Lead', minXP: 600, icon: 'trophy', color: '#8b5cf6' },
  MASTER: { name: 'Master', minXP: 1000, icon: 'medal', color: '#f59e0b' },
};

export interface SceneProgress {
  sceneId: string;
  scriptId: string;
  sceneName: string;
  xp: number;
  masteryLevel: keyof typeof MASTERY_LEVELS;
  sessionsCompleted: number;
  bestAccuracy: number;
  bestTime: number; // seconds
  lastPracticed: string;
  difficultyReached: number; // 10-100
}

export interface GlobalProgress {
  totalXP: number;
  globalMasteryLevel: keyof typeof MASTERY_LEVELS;
  totalSessions: number;
  totalPracticeTime: number; // minutes
  scenesCompleted: number;
  averageAccuracy: number;
}

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastPracticeDate: string;
  streakStartDate: string;
}

export interface DailyPracticeTime {
  date: string;
  minutes: number;
}

export interface RecallSessionResult {
  sceneId: string;
  scriptId: string;
  sceneName: string;
  accuracy: number; // 0-100
  timeSpent: number; // seconds
  difficulty: number; // 10-100
  wordsHidden: number;
  totalWords: number;
  xpEarned: number;
  timestamp: string;
}

// Calculate XP based on session performance
export const calculateXP = (accuracy: number, difficulty: number, timeBonus: boolean): number => {
  const baseXP = Math.round((accuracy / 100) * 10);
  const difficultyMultiplier = difficulty / 50; // 0.2 - 2.0
  const timeBonusXP = timeBonus ? 5 : 0;
  return Math.round(baseXP * difficultyMultiplier + timeBonusXP);
};

// Get mastery level from XP
export const getMasteryLevel = (xp: number): keyof typeof MASTERY_LEVELS => {
  if (xp >= MASTERY_LEVELS.MASTER.minXP) return 'MASTER';
  if (xp >= MASTERY_LEVELS.LEAD.minXP) return 'LEAD';
  if (xp >= MASTERY_LEVELS.SERIES_REGULAR.minXP) return 'SERIES_REGULAR';
  if (xp >= MASTERY_LEVELS.WORKING_ACTOR.minXP) return 'WORKING_ACTOR';
  return 'ROOKIE';
};

// Get all scene progress
export const getAllSceneProgress = async (): Promise<SceneProgress[]> => {
  try {
    const data = await AsyncStorage.getItem(PROGRESS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Get progress for a specific scene
export const getSceneProgress = async (sceneId: string): Promise<SceneProgress | null> => {
  const allProgress = await getAllSceneProgress();
  return allProgress.find(p => p.sceneId === sceneId) || null;
};

// Save session result and update progress
export const saveSessionResult = async (result: RecallSessionResult): Promise<SceneProgress> => {
  const allProgress = await getAllSceneProgress();
  const existingIndex = allProgress.findIndex(p => p.sceneId === result.sceneId);
  
  let sceneProgress: SceneProgress;
  
  if (existingIndex >= 0) {
    // Update existing progress
    const existing = allProgress[existingIndex];
    const newXP = existing.xp + result.xpEarned;
    sceneProgress = {
      ...existing,
      xp: newXP,
      masteryLevel: getMasteryLevel(newXP),
      sessionsCompleted: existing.sessionsCompleted + 1,
      bestAccuracy: Math.max(existing.bestAccuracy, result.accuracy),
      bestTime: existing.bestTime > 0 ? Math.min(existing.bestTime, result.timeSpent) : result.timeSpent,
      lastPracticed: result.timestamp,
      difficultyReached: Math.max(existing.difficultyReached, result.difficulty),
    };
    allProgress[existingIndex] = sceneProgress;
  } else {
    // Create new progress
    sceneProgress = {
      sceneId: result.sceneId,
      scriptId: result.scriptId,
      sceneName: result.sceneName,
      xp: result.xpEarned,
      masteryLevel: getMasteryLevel(result.xpEarned),
      sessionsCompleted: 1,
      bestAccuracy: result.accuracy,
      bestTime: result.timeSpent,
      lastPracticed: result.timestamp,
      difficultyReached: result.difficulty,
    };
    allProgress.push(sceneProgress);
  }
  
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(allProgress));
  
  // Update practice time
  await addPracticeTime(Math.round(result.timeSpent / 60));
  
  // Update streak
  await updateStreak();
  
  return sceneProgress;
};

// Get global progress across all scenes
export const getGlobalProgress = async (): Promise<GlobalProgress> => {
  const allProgress = await getAllSceneProgress();
  
  if (allProgress.length === 0) {
    return {
      totalXP: 0,
      globalMasteryLevel: 'ROOKIE',
      totalSessions: 0,
      totalPracticeTime: 0,
      scenesCompleted: 0,
      averageAccuracy: 0,
    };
  }
  
  const totalXP = allProgress.reduce((sum, p) => sum + p.xp, 0);
  const totalSessions = allProgress.reduce((sum, p) => sum + p.sessionsCompleted, 0);
  const avgAccuracy = allProgress.reduce((sum, p) => sum + p.bestAccuracy, 0) / allProgress.length;
  const practiceTime = await getTotalPracticeTime();
  
  return {
    totalXP,
    globalMasteryLevel: getMasteryLevel(totalXP),
    totalSessions,
    totalPracticeTime: practiceTime,
    scenesCompleted: allProgress.filter(p => p.masteryLevel !== 'ROOKIE').length,
    averageAccuracy: Math.round(avgAccuracy),
  };
};

// Streak management
export const getStreak = async (): Promise<StreakData> => {
  try {
    const data = await AsyncStorage.getItem(STREAK_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch {}
  
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastPracticeDate: '',
    streakStartDate: '',
  };
};

export const updateStreak = async (): Promise<StreakData> => {
  const streak = await getStreak();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  if (streak.lastPracticeDate === today) {
    // Already practiced today
    return streak;
  }
  
  let newStreak: StreakData;
  
  if (streak.lastPracticeDate === yesterday) {
    // Consecutive day
    newStreak = {
      currentStreak: streak.currentStreak + 1,
      longestStreak: Math.max(streak.longestStreak, streak.currentStreak + 1),
      lastPracticeDate: today,
      streakStartDate: streak.streakStartDate,
    };
  } else {
    // Streak broken or first practice
    newStreak = {
      currentStreak: 1,
      longestStreak: Math.max(streak.longestStreak, 1),
      lastPracticeDate: today,
      streakStartDate: today,
    };
  }
  
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(newStreak));
  return newStreak;
};

// Practice time tracking
export const getTodayPracticeTime = async (): Promise<number> => {
  try {
    const data = await AsyncStorage.getItem(PRACTICE_TIME_KEY);
    if (data) {
      const times: DailyPracticeTime[] = JSON.parse(data);
      const today = new Date().toISOString().split('T')[0];
      const todayEntry = times.find(t => t.date === today);
      return todayEntry?.minutes || 0;
    }
  } catch {}
  return 0;
};

export const getTotalPracticeTime = async (): Promise<number> => {
  try {
    const data = await AsyncStorage.getItem(PRACTICE_TIME_KEY);
    if (data) {
      const times: DailyPracticeTime[] = JSON.parse(data);
      return times.reduce((sum, t) => sum + t.minutes, 0);
    }
  } catch {}
  return 0;
};

export const addPracticeTime = async (minutes: number): Promise<void> => {
  try {
    const data = await AsyncStorage.getItem(PRACTICE_TIME_KEY);
    let times: DailyPracticeTime[] = data ? JSON.parse(data) : [];
    
    const today = new Date().toISOString().split('T')[0];
    const existingIndex = times.findIndex(t => t.date === today);
    
    if (existingIndex >= 0) {
      times[existingIndex].minutes += minutes;
    } else {
      times.push({ date: today, minutes });
      // Keep only last 90 days
      if (times.length > 90) {
        times = times.slice(-90);
      }
    }
    
    await AsyncStorage.setItem(PRACTICE_TIME_KEY, JSON.stringify(times));
  } catch {}
};

// Clear all progress (for testing/reset)
export const clearAllProgress = async (): Promise<void> => {
  await AsyncStorage.multiRemove([PROGRESS_KEY, STREAK_KEY, PRACTICE_TIME_KEY]);
};
