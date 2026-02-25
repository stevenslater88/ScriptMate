/**
 * Dialect Coach Service
 * API client for dialect/pronunciation analysis
 */

import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
                process.env.EXPO_PUBLIC_BACKEND_URL;

export interface AccentProfile {
  id: string;
  name: string;
  description: string;
  region: string;
  key_features: string[];
  common_tips?: string[];
  example_words?: Record<string, string>;
}

export interface ProblemWord {
  word: string;
  expected_pronunciation: string;
  user_pronunciation: string;
  tip: string;
  severity: 'minor' | 'moderate' | 'significant';
}

export interface DialectAnalysisResult {
  id: string;
  user_id: string;
  accent_id: string;
  accent_name: string;
  expected_text: string;
  transcribed_text: string;
  pronunciation_score: number;
  pace_assessment: 'too_slow' | 'too_fast' | 'good';
  pace_wpm: number;
  problem_words: ProblemWord[];
  tips: string[];
  overall_feedback: string;
  audio_duration_seconds: number;
  created_at: string;
}

export interface DialectAttempt {
  id: string;
  user_id: string;
  accent_id: string;
  expected_text: string;
  pronunciation_score: number;
  pace_assessment: string;
  problem_word_count: number;
  created_at: string;
}

export interface SampleLine {
  text: string;
  source: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

// Get available accents
export const getAccents = async (): Promise<AccentProfile[]> => {
  try {
    const response = await fetch(`${API_URL}/api/dialect/accents`);
    if (!response.ok) throw new Error('Failed to fetch accents');
    const data = await response.json();
    return data.accents;
  } catch (error) {
    console.error('Error fetching accents:', error);
    throw error;
  }
};

// Get detailed accent profile
export const getAccentProfile = async (accentId: string): Promise<AccentProfile> => {
  try {
    const response = await fetch(`${API_URL}/api/dialect/accents/${accentId}`);
    if (!response.ok) throw new Error('Failed to fetch accent profile');
    return await response.json();
  } catch (error) {
    console.error('Error fetching accent profile:', error);
    throw error;
  }
};

// Analyze pronunciation
export const analyzeDialect = async (
  audioUri: string,
  expectedText: string,
  accentId: string,
  userId: string
): Promise<DialectAnalysisResult> => {
  try {
    const formData = new FormData();
    
    // Add audio file
    const audioFile = {
      uri: audioUri,
      type: 'audio/wav',
      name: 'recording.wav',
    } as any;
    formData.append('audio', audioFile);
    formData.append('expected_text', expectedText);
    formData.append('accent_id', accentId);
    formData.append('user_id', userId);
    
    const response = await fetch(`${API_URL}/api/dialect/analyze`, {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Analysis failed');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error analyzing dialect:', error);
    throw error;
  }
};

// Get practice history
export const getDialectHistory = async (
  userId: string,
  accentId?: string,
  limit: number = 20
): Promise<{
  attempts: DialectAttempt[];
  total: number;
  improvement: number;
  best_score: number;
  average_score: number;
}> => {
  try {
    let url = `${API_URL}/api/dialect/history/${userId}?limit=${limit}`;
    if (accentId) url += `&accent_id=${accentId}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch history');
    return await response.json();
  } catch (error) {
    console.error('Error fetching dialect history:', error);
    throw error;
  }
};

// Get sample practice lines
export const getSampleLines = async (): Promise<SampleLine[]> => {
  try {
    const response = await fetch(`${API_URL}/api/dialect/sample-lines`);
    if (!response.ok) throw new Error('Failed to fetch sample lines');
    const data = await response.json();
    return data.lines;
  } catch (error) {
    console.error('Error fetching sample lines:', error);
    throw error;
  }
};

export default {
  getAccents,
  getAccentProfile,
  analyzeDialect,
  getDialectHistory,
  getSampleLines,
};
