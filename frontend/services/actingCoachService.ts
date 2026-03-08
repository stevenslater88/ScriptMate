/**
 * Acting Coach Service
 * API client for AI-powered acting performance coaching
 */

import { API_BASE_URL } from './apiConfig';

const API_URL = API_BASE_URL;

export interface Scene {
  title: string;
  context: string;
  genre: string;
}

export interface CoachAnalysis {
  performance_score: number;
  score_label: string;
  what_works: string[];
  improvement_tips: string[];
  example_delivery: string;
  director_note: string;
}

export interface CoachResponse {
  success: boolean;
  analysis: CoachAnalysis;
}

export async function getScenes(): Promise<Scene[]> {
  const res = await fetch(`${API_URL}/api/acting-coach/scenes`);
  if (!res.ok) throw new Error('Failed to fetch scenes');
  const data = await res.json();
  return data.scenes;
}

export async function analyzePerformance(params: {
  scene_title: string;
  scene_context: string;
  emotion: string;
  style: string;
  energy: number;
  user_id?: string;
}): Promise<CoachAnalysis> {
  const res = await fetch(`${API_URL}/api/acting-coach/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Analysis failed' }));
    throw new Error(err.detail || 'Analysis failed');
  }
  const data: CoachResponse = await res.json();
  return data.analysis;
}

export async function getHistory(userId: string) {
  const res = await fetch(`${API_URL}/api/acting-coach/history/${userId}`);
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}
