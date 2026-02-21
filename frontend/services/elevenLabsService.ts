/**
 * ElevenLabs Text-to-Speech Service
 * Client-side TTS generation for Multi-Voice feature
 */

import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Preset voices with different accents and genders
export interface PresetVoice {
  key: string;
  id: string;
  name: string;
  accent: string;
  gender: 'Male' | 'Female';
  description: string;
}

export const PRESET_VOICES: PresetVoice[] = [
  // Female voices
  { key: 'rachel', id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', accent: 'American', gender: 'Female', description: 'Calm, young female' },
  { key: 'domi', id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', accent: 'American', gender: 'Female', description: 'Strong, confident' },
  { key: 'sarah', id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', accent: 'American', gender: 'Female', description: 'Soft, expressive' },
  { key: 'emily', id: 'LcfcDJNUP1GQjkzn1xUU', name: 'Emily', accent: 'American', gender: 'Female', description: 'Calm, warm' },
  { key: 'elli', id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', accent: 'American', gender: 'Female', description: 'Emotional, expressive' },
  { key: 'dorothy', id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', accent: 'British', gender: 'Female', description: 'Pleasant British' },
  { key: 'charlotte', id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', accent: 'Swedish', gender: 'Female', description: 'Seductive Swedish' },
  { key: 'matilda', id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', accent: 'American', gender: 'Female', description: 'Warm, friendly' },
  { key: 'freya', id: 'jsCqWAovK2LkecY7zXl4', name: 'Freya', accent: 'American', gender: 'Female', description: 'Confident, expressive' },
  { key: 'gigi', id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', accent: 'American', gender: 'Female', description: 'Childish, animated' },
  // Male voices
  { key: 'drew', id: '29vD33N1CtxCmqQRPOHJ', name: 'Drew', accent: 'American', gender: 'Male', description: 'Well-rounded, confident' },
  { key: 'clyde', id: '2EiwWnXFnvU5JabPnv8n', name: 'Clyde', accent: 'American', gender: 'Male', description: 'War veteran, deep gravelly' },
  { key: 'paul', id: '5Q0t7uMcjvnagumLfvZi', name: 'Paul', accent: 'American', gender: 'Male', description: 'Ground reporter, authoritative' },
  { key: 'dave', id: 'CYw3kZ02Hs0563khs1Fj', name: 'Dave', accent: 'British', gender: 'Male', description: 'Conversational British' },
  { key: 'fin', id: 'D38z5RcWu1voky8WS1ja', name: 'Fin', accent: 'Irish', gender: 'Male', description: 'Sailor, older Irish' },
  { key: 'antoni', id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', accent: 'American', gender: 'Male', description: 'Well-rounded, crisp' },
  { key: 'thomas', id: 'GBv7mTt0atIp3Br8iCZE', name: 'Thomas', accent: 'American', gender: 'Male', description: 'Calm, mature' },
  { key: 'charlie', id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', accent: 'Australian', gender: 'Male', description: 'Casual Australian' },
  { key: 'callum', id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', accent: 'Transatlantic', gender: 'Male', description: 'Hoarse, intense' },
  { key: 'liam', id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', accent: 'American', gender: 'Male', description: 'Articulate, confident' },
  { key: 'josh', id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', accent: 'American', gender: 'Male', description: 'Deep, young' },
  { key: 'arnold', id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', accent: 'American', gender: 'Male', description: 'Crisp, older' },
  { key: 'james', id: 'ZQe5CZNOzWyzPSCn5a3c', name: 'James', accent: 'Australian', gender: 'Male', description: 'Deep, calm Australian' },
  { key: 'joseph', id: 'Zlb1dXrM653N07WRdFW3', name: 'Joseph', accent: 'British', gender: 'Male', description: 'British, articulate' },
  { key: 'george', id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', accent: 'British', gender: 'Male', description: 'Warm British' },
  { key: 'ethan', id: 'g5CIjZEefAph4nQFvHAz', name: 'Ethan', accent: 'American', gender: 'Male', description: 'Bright, young' },
];

// Get voices grouped by gender
export const getVoicesByGender = () => {
  return {
    female: PRESET_VOICES.filter(v => v.gender === 'Female'),
    male: PRESET_VOICES.filter(v => v.gender === 'Male'),
  };
};

// Get a specific voice by key
export const getVoiceByKey = (key: string): PresetVoice | undefined => {
  return PRESET_VOICES.find(v => v.key === key);
};

// Character voice assignment storage
export interface CharacterVoiceAssignment {
  characterName: string;
  voiceKey: string;
  voiceId: string;
}

const VOICE_STORAGE_KEY = 'script_voice_settings';

// Save voice assignments for a script
export const saveVoiceAssignments = async (
  scriptId: string, 
  assignments: CharacterVoiceAssignment[]
): Promise<void> => {
  try {
    const allSettings = await AsyncStorage.getItem(VOICE_STORAGE_KEY);
    const settings = allSettings ? JSON.parse(allSettings) : {};
    settings[scriptId] = {
      assignments,
      updatedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving voice assignments:', error);
  }
};

// Load voice assignments for a script
export const loadVoiceAssignments = async (
  scriptId: string
): Promise<CharacterVoiceAssignment[]> => {
  try {
    const allSettings = await AsyncStorage.getItem(VOICE_STORAGE_KEY);
    if (!allSettings) return [];
    const settings = JSON.parse(allSettings);
    return settings[scriptId]?.assignments || [];
  } catch (error) {
    console.error('Error loading voice assignments:', error);
    return [];
  }
};

// Get voice ID for a character in a script
export const getCharacterVoiceId = async (
  scriptId: string,
  characterName: string
): Promise<string | null> => {
  const assignments = await loadVoiceAssignments(scriptId);
  const assignment = assignments.find(
    a => a.characterName.toLowerCase() === characterName.toLowerCase()
  );
  return assignment?.voiceId || null;
};

// Generate speech using ElevenLabs API
export const generateSpeech = async (
  text: string,
  voiceId: string,
  options: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
  } = {}
): Promise<{ audioBase64: string; audioUri: string } | null> => {
  if (!ELEVENLABS_API_KEY) {
    console.error('ElevenLabs API key not configured');
    return null;
  }

  const {
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0.0,
    useSpeakerBoost = true,
  } = options;

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            use_speaker_boost: useSpeakerBoost,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('ElevenLabs API error:', response.status, errorData);
      throw new Error(errorData?.detail?.message || `API error: ${response.status}`);
    }

    // Get audio as blob and convert to base64
    const audioBlob = await response.blob();
    const reader = new FileReader();
    
    return new Promise((resolve, reject) => {
      reader.onloadend = () => {
        const base64 = reader.result as string;
        const audioBase64 = base64.split(',')[1]; // Remove data URL prefix
        const audioUri = `data:audio/mpeg;base64,${audioBase64}`;
        resolve({ audioBase64, audioUri });
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });
  } catch (error) {
    console.error('Error generating speech:', error);
    throw error;
  }
};

// Play speech using Expo AV
export const playSpeech = async (
  text: string,
  voiceId: string,
  options?: {
    stability?: number;
    similarityBoost?: number;
  }
): Promise<Audio.Sound | null> => {
  try {
    const result = await generateSpeech(text, voiceId, options);
    if (!result) return null;

    const { sound } = await Audio.Sound.createAsync(
      { uri: result.audioUri },
      { shouldPlay: true }
    );

    return sound;
  } catch (error) {
    console.error('Error playing speech:', error);
    return null;
  }
};

// Check if ElevenLabs is configured
export const isElevenLabsConfigured = (): boolean => {
  return !!ELEVENLABS_API_KEY;
};

export default {
  PRESET_VOICES,
  getVoicesByGender,
  getVoiceByKey,
  saveVoiceAssignments,
  loadVoiceAssignments,
  getCharacterVoiceId,
  generateSpeech,
  playSpeech,
  isElevenLabsConfigured,
};
