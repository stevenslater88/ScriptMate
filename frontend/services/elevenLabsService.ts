/**
 * ElevenLabs Text-to-Speech Service
 * ---------------------------------
 * Client-side TTS generation + Multi-Voice playback for rehearsals.
 *
 * 2026-02 Android voice-pipeline break RCA
 * ----------------------------------------
 * Physical S23 Ultra QA (build 1110) reported NO REHEARSAL AUDIO despite
 * `elevenLabsConfigured=true` and 3 assignments loaded. The break was
 * NOT in assignment lookup — it was in the audio pipeline itself:
 *
 *   1. `generateSpeech()` used `response.blob()` + `FileReader.readAsDataURL()`.
 *      React Native's `fetch` Blob is a native reference, not a browser
 *      Blob. On Android/Hermes, `FileReader.readAsDataURL()` on a fetch
 *      Blob is known to silently return empty / corrupted strings.
 *      (see facebook/react-native#35325 and expo/expo#22916).
 *
 *   2. Even when step 1 returned a usable string, it produced a
 *      `data:audio/mpeg;base64,...` URI. ExoPlayer (the Android backing
 *      engine for `expo-av`'s `Audio.Sound`) is documented to fail on
 *      non-trivial `data:` audio URIs — MP3 payloads over a few KB
 *      routinely fail to load silently.
 *
 * Fix (this file):
 *   - Use `response.arrayBuffer()` and encode bytes → base64 manually
 *     with a Hermes-safe encoder (no `btoa`, no `Buffer`).
 *   - Write the base64 to a temp file via `expo-file-system/legacy`
 *     (SDK 54 legacy import path — same style as voiceStudioStorage.ts).
 *   - Pass the resulting `file://` URI to `Audio.Sound.createAsync`.
 *   - Emit deterministic diagnostics at every stage so a future silent
 *     failure cannot be misdiagnosed as "voice loaded but silent".
 *
 * Diagnostics emitted (source: 'ElevenLabsService'):
 *   VOICE_RESOLUTION            — character → voiceId lookup result
 *   VOICE_PROVIDER_SELECTED     — 'elevenlabs' | 'expo-speech'
 *   ELEVENLABS_REQUEST_START    — POST to /text-to-speech/{voiceId}
 *   ELEVENLABS_RESPONSE         — HTTP status + byte length
 *   ELEVENLABS_AUDIO_READY      — file:// URI written, ready to load
 *   AUDIO_LOAD_START            — Audio.Sound.createAsync begins
 *   AUDIO_LOAD_SUCCESS          — Sound loaded, playback about to start
 *   AUDIO_PLAY_START            — playAsync() called
 *   AUDIO_PLAYING               — first isPlaying=true status observed
 *   AUDIO_PLAYBACK_COMPLETE     — didJustFinish
 *   AUDIO_PLAYBACK_ERROR        — any failure inside the audio lifecycle
 *   FALLBACK_TO_EXPO_SPEECH     — expo-speech fallback taken
 *
 * Never logs API keys, audio contents, or full text bodies.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppConfig } from './appConfig';
import { DebugLog } from './debugLogService';
import {
  resolveVoiceForCharacter as _resolveVoiceForCharacter,
  selectProvider as _selectProvider,
  uint8ArrayToBase64 as _uint8ArrayToBase64,
  makeAudioCacheKey as _makeAudioCacheKey,
  type VoiceResolution,
  type Provider,
} from './elevenLabsPure';

// Re-export the pure helpers so rehearsal (and tests) can keep the
// existing import path.
export const resolveVoiceForCharacter = _resolveVoiceForCharacter;
export const selectProvider = _selectProvider;
export const uint8ArrayToBase64 = _uint8ArrayToBase64;
export const makeAudioCacheKey = _makeAudioCacheKey;
export type { VoiceResolution, Provider };

// 2026-02 SCRIPT M8 (Option A backend-proxy refactor)
// -------------------------------------------------------------------
// The Android app NO LONGER carries an ElevenLabs API credential.
// All rehearsal audio is proxied through the ScriptMate backend at
// POST /api/tts/elevenlabs/generate. The `xi-api-key` header lives
// only in backend/.env and never enters the mobile bundle, the JS,
// the git tree, the diagnostics, or the on-device logs.
const BACKEND_URL = (AppConfig as any).BACKEND_URL || '';
const TTS_ENDPOINT = `${BACKEND_URL}/api/tts/elevenlabs/generate`;
const TTS_HEALTH_ENDPOINT = `${BACKEND_URL}/api/tts/elevenlabs/health`;

// ─── READER STYLE / SPEED → ELEVENLABS PARAMETERS ─────────────────────
// Reader style must actually alter synthesis, not just appear in logs.
// The pre-Feb-2026 code plumbed readerStyle through the store but the
// rehearsal call site `playSpeech(text, voiceId)` passed no options,
// so ElevenLabs always got stability=0.5 / similarity=0.75 / style=0
// regardless of neutral vs emotional vs intense. This map lifts each
// preset to a supported voice_settings tuple:
//
//   neutral   → low style, moderate stability (broadcast delivery)
//   emotional → higher style + slightly lower stability (expressive)
//   intense   → highest style + low stability (peak emotional range)
//
// All values are inside the ElevenLabs 0.0–1.0 range for the
// eleven_multilingual_v2 model.
export type ReaderStyle = 'neutral' | 'emotional' | 'intense' | 'aggressive';

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
  speed: number;
}

export function readerStyleToElevenLabsSettings(
  readerStyle: string | undefined,
  voiceSpeed: number | undefined,
): ElevenLabsVoiceSettings {
  const s = (readerStyle || 'neutral').toLowerCase();
  let stability = 0.5;
  let style = 0.0;
  if (s === 'emotional') {
    stability = 0.35;
    style = 0.55;
  } else if (s === 'intense' || s === 'aggressive') {
    stability = 0.25;
    style = 0.85;
  }
  // ElevenLabs supports 0.7–1.2 for voice_settings.speed on the
  // eleven_multilingual_v2 model. Anything outside that window is
  // clamped so a stale/legacy value cannot make the request fail.
  const rawSpeed = typeof voiceSpeed === 'number' && Number.isFinite(voiceSpeed)
    ? voiceSpeed
    : 1.0;
  const speed = Math.max(0.7, Math.min(1.2, rawSpeed));
  return {
    stability,
    similarity_boost: 0.75,
    style,
    use_speaker_boost: true,
    speed,
  };
}

// ─── BACKEND CONFIG PROBE ─────────────────────────────────────────
// The client no longer holds an ElevenLabs credential. Instead it
// asks the ScriptMate backend once per session whether the server's
// ELEVENLABS_API_KEY is usable. Cached in-memory. Never logs the key.
let _backendConfigured: boolean | null = null;
let _backendClassification: string = 'unknown';

async function probeBackendElevenLabs(): Promise<void> {
  try {
    const res = await fetch(TTS_HEALTH_ENDPOINT, { method: 'GET' });
    if (!res.ok) {
      _backendConfigured = false;
      _backendClassification = `http-${res.status}`;
      DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_CONFIG_INVALID', {
        source: 'backend-health',
        classification: _backendClassification,
      });
      return;
    }
    const body = await res.json();
    _backendConfigured = !!body.configured;
    _backendClassification = String(body.classification ?? 'unknown');
    if (_backendConfigured) {
      DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_CONFIG_VALID', {
        source: 'backend-health',
      });
    } else {
      DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_CONFIG_INVALID', {
        source: 'backend-health',
        classification: _backendClassification,
      });
    }
  } catch (e: any) {
    _backendConfigured = false;
    _backendClassification = 'health-probe-failed';
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_CONFIG_INVALID', {
      source: 'backend-health',
      classification: _backendClassification,
      error: e?.message || String(e),
    });
  }
}

// Fire once at module load — the verdict is available before the
// first rehearsal line by the time playSpeech() is called.
probeBackendElevenLabs();

// ─── READER STYLE / SPEED → ELEVENLABS PARAMETERS ─────────────────────

// ─── PRESET VOICES ─────────────────────────────────────────────────────
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

export const getVoicesByGender = () => ({
  female: PRESET_VOICES.filter(v => v.gender === 'Female'),
  male: PRESET_VOICES.filter(v => v.gender === 'Male'),
});

export const getVoiceByKey = (key: string): PresetVoice | undefined =>
  PRESET_VOICES.find(v => v.key === key);

// ─── ASSIGNMENT PERSISTENCE ────────────────────────────────────────────
export interface CharacterVoiceAssignment {
  characterName: string;
  voiceKey: string;
  voiceId: string;
}

const VOICE_STORAGE_KEY = 'script_voice_settings';

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

// ─── PLAYBACK-SEAM TYPES (moved to elevenLabsPure.ts) ────────────────
// resolveVoiceForCharacter / selectProvider / VoiceResolution /
// Provider are re-exported from elevenLabsPure.ts above.

// ─── ELEVENLABS API ───────────────────────────────────────────────────
export interface ElevenLabsGenerateResult {
  fileUri: string;
  byteLength: number;
  httpStatus: number;
}

/**
 * Generate speech via ElevenLabs and persist to a temp file. Returns
 * the `file://` URI the Android/iOS audio engine can play.
 *
 * IMPORTANT: this function is exported for the automated mocked
 * playback test. Real callers should use `playSpeech()`.
 */
/**
 * Generate speech via the ScriptMate backend proxy and persist to a
 * temp file. Returns the `file://` URI the Android/iOS audio engine
 * can play. The ElevenLabs API key never enters the mobile client.
 *
 * IMPORTANT: this function is exported for the automated mocked
 * playback test. Real callers should use `playSpeech()`.
 */
export const generateSpeechToFile = async (
  text: string,
  voiceId: string,
  options: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
    // 2026-02: reader style + voice speed now actually reach the
    // ElevenLabs request. Previous callers passed no options at all,
    // so neutral vs emotional vs intense produced identical audio.
    readerStyle?: string;
    voiceSpeed?: number;
    // Test hook — do not use in production callers.
    _fetch?: typeof fetch;
    _writeFile?: (uri: string, base64: string) => Promise<void>;
    _tmpDir?: string;
  } = {}
): Promise<ElevenLabsGenerateResult | null> => {
  // Backend-health gate: if the backend reports the ElevenLabs
  // credential unusable, abort BEFORE any /generate round-trip so we
  // never send a request that is guaranteed to 503. The probe fires
  // at module load; if it hasn't resolved yet, we retry it once
  // synchronously (inside a Promise) so the first rehearsal line
  // still has a verdict.
  if (_backendConfigured === null) {
    await probeBackendElevenLabs();
  }
  if (_backendConfigured === false) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_REQUEST_ABORT', {
      reason: 'backend-not-configured',
      classification: _backendClassification,
    });
    return null;
  }

  const settings = readerStyleToElevenLabsSettings(
    options.readerStyle,
    options.voiceSpeed,
  );
  // Explicit overrides for tests / low-level callers still win.
  const stability = options.stability ?? settings.stability;
  const similarityBoost = options.similarityBoost ?? settings.similarity_boost;
  const style = options.style ?? settings.style;
  const useSpeakerBoost = options.useSpeakerBoost ?? settings.use_speaker_boost;
  const speed = settings.speed;
  const fetchFn = options._fetch ?? fetch;

  DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_REQUEST_START', {
    voiceId,
    textLength: text.length,
    // Backend proxy endpoint. The client never contacts ElevenLabs
    // directly anymore.
    endpoint: '/api/tts/elevenlabs/generate',
    readerStyle: options.readerStyle ?? 'neutral',
    voiceSpeed: options.voiceSpeed ?? 1.0,
    settings: { stability, similarity_boost: similarityBoost, style, speed },
  });

  let response: Response;
  try {
    response = await fetchFn(TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: useSpeakerBoost,
        speed,
      }),
    });
  } catch (netErr: any) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_RESPONSE', {
      voiceId,
      success: false,
      httpStatus: 0,
      error: netErr?.message || String(netErr),
      stage: 'network',
    });
    return null;
  }

  if (!response.ok) {
    let bodyPreview = '';
    try {
      bodyPreview = (await response.text()).substring(0, 200);
    } catch { /* ignore */ }
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_RESPONSE', {
      voiceId,
      success: false,
      httpStatus: response.status,
      bodyPreview,
      stage: 'http-status',
    });
    return null;
  }

  let bytes: Uint8Array;
  try {
    const buf = await response.arrayBuffer();
    bytes = new Uint8Array(buf);
  } catch (bufErr: any) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_RESPONSE', {
      voiceId,
      success: false,
      httpStatus: response.status,
      error: bufErr?.message || String(bufErr),
      stage: 'arraybuffer',
    });
    return null;
  }

  if (bytes.length === 0) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_RESPONSE', {
      voiceId,
      success: false,
      httpStatus: response.status,
      byteLength: 0,
      stage: 'empty-body',
    });
    return null;
  }

  DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_RESPONSE', {
    voiceId,
    success: true,
    httpStatus: response.status,
    byteLength: bytes.length,
  });

  // Write to a temp file so Android's ExoPlayer can play a file:// URI
  // (see file header for why we cannot use a data: URI on Android).
  let base64: string;
  try {
    base64 = uint8ArrayToBase64(bytes);
  } catch (encErr: any) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_AUDIO_READY', {
      voiceId,
      success: false,
      error: encErr?.message || String(encErr),
      stage: 'base64',
    });
    return null;
  }

  const tmpDir = options._tmpDir ?? (FileSystem.cacheDirectory ?? FileSystem.documentDirectory);
  if (!tmpDir) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_AUDIO_READY', {
      voiceId,
      success: false,
      stage: 'no-tmp-dir',
    });
    return null;
  }
  // Filename includes voiceId prefix so a stale cache file for a
  // different voice can never be replayed by accident.
  const fileUri = `${tmpDir}el_${voiceId.substring(0, 8)}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mp3`;
  try {
    if (options._writeFile) {
      await options._writeFile(fileUri, base64);
    } else {
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  } catch (writeErr: any) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_AUDIO_READY', {
      voiceId,
      success: false,
      error: writeErr?.message || String(writeErr),
      stage: 'write-file',
    });
    return null;
  }

  DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'ELEVENLABS_AUDIO_READY', {
    voiceId,
    success: true,
    byteLength: bytes.length,
    fileUriSuffix: fileUri.substring(Math.max(0, fileUri.length - 40)),
  });

  return { fileUri, byteLength: bytes.length, httpStatus: response.status };
};

// ─── Deprecated shim ─────────────────────────────────────────────────
// Retained for any external callers that still expect the pre-fix
// signature. Not used by rehearsal anymore.
export const generateSpeech = async (
  text: string,
  voiceId: string,
  options?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
    readerStyle?: string;
    voiceSpeed?: number;
  }
): Promise<{ audioBase64: string; audioUri: string } | null> => {
  const result = await generateSpeechToFile(text, voiceId, options);
  if (!result) return null;
  return { audioBase64: '', audioUri: result.fileUri };
};

// ─── AUDIO CACHE (file-URI based) ────────────────────────────────────
// Keyed by (voiceId, text). Cache stores the on-disk file:// URI so we
// avoid regenerating (and re-billing) the same line twice within a
// session. LRU capped so old files can be gc'd (we let the OS reap
// them from the cache dir).
const AUDIO_CACHE_MAX = 20;
const audioCache = new Map<string, string>();


function cachePut(key: string, uri: string): void {
  if (audioCache.has(key)) audioCache.delete(key);
  audioCache.set(key, uri);
  while (audioCache.size > AUDIO_CACHE_MAX) {
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
    else break;
  }
}

function cacheGet(key: string): string | undefined {
  return audioCache.get(key);
}

export function clearElevenLabsAudioCache(): void {
  audioCache.clear();
}

// ─── AUDIO SESSION (Android + iOS) ────────────────────────────────────
let audioModeConfigured = false;
export async function ensurePlaybackAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  try {
    // Explicit playback config — the previous rehearsal-side call only
    // fired when `isPremium` was true AND used iOS-only fields, so on
    // Android free-tier devices the audio session was never configured
    // for playback of a downloaded MP3. Passing keys that expo-av
    // ignores on the other platform is safe.
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    } as any);
    audioModeConfigured = true;
  } catch (e: any) {
    // Non-fatal — Sound.createAsync will fail loudly if the audio
    // session is actually unusable.
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_MODE_CONFIG_ERROR', {
      error: e?.message || String(e),
    });
  }
}

/**
 * Play a line via ElevenLabs. Returns the `Audio.Sound` if started, or
 * `null` if any stage failed — in which case the caller must fall back
 * to `expo-speech` so the rehearsal never stalls silently.
 */
export const playSpeech = async (
  text: string,
  voiceId: string,
  options?: {
    stability?: number;
    similarityBoost?: number;
    readerStyle?: string;
    voiceSpeed?: number;
  }
): Promise<Audio.Sound | null> => {
  await ensurePlaybackAudioMode();

  // Cache key must include readerStyle + voiceSpeed — otherwise a
  // neutral clip and an emotional clip for the same voice+text would
  // collide and one would silently mask the other.
  const styleKey = (options?.readerStyle ?? 'neutral').toLowerCase();
  const speedKey = typeof options?.voiceSpeed === 'number' ? options!.voiceSpeed : 1.0;
  const cacheKey = `${makeAudioCacheKey(voiceId, text)}|${styleKey}|${speedKey}`;
  let fileUri = cacheGet(cacheKey);
  if (fileUri) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_CACHE_HIT', {
      voiceId,
      textLength: text.length,
    });
  } else {
    const generated = await generateSpeechToFile(text, voiceId, options);
    if (!generated) return null;
    fileUri = generated.fileUri;
    cachePut(cacheKey, fileUri);
  }

  DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_LOAD_START', {
    voiceId,
    fileUriSuffix: fileUri.substring(Math.max(0, fileUri.length - 40)),
  });

  let sound: Audio.Sound;
  try {
    const created = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: false },
    );
    sound = created.sound;
  } catch (loadErr: any) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_PLAYBACK_ERROR', {
      voiceId,
      stage: 'load',
      error: loadErr?.message || String(loadErr),
    });
    return null;
  }

  DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_LOAD_SUCCESS', {
    voiceId,
    fileUriSuffix: fileUri.substring(Math.max(0, fileUri.length - 40)),
  });

  // Attach a status observer BEFORE playAsync so we can prove the
  // audio actually starts and never gets torn down before the first
  // isPlaying frame. The caller may add another observer on top of
  // this one (e.g. rehearsal advance-on-finish); Audio.Sound supports
  // a single observer so we chain by re-wrapping on the caller side.
  let firstPlayingLogged = false;
  sound.setOnPlaybackStatusUpdate((status: any) => {
    if (!status?.isLoaded) return;
    if (status.isPlaying && !firstPlayingLogged) {
      firstPlayingLogged = true;
      DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_PLAYING', {
        voiceId,
        positionMs: status.positionMillis ?? 0,
      });
    }
    if (status.didJustFinish) {
      DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_PLAYBACK_COMPLETE', {
        voiceId,
        durationMs: status.durationMillis ?? null,
      });
    }
    if (status.error) {
      DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_PLAYBACK_ERROR', {
        voiceId,
        stage: 'runtime',
        error: String(status.error),
      });
    }
  });

  DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_PLAY_START', { voiceId });

  try {
    await sound.playAsync();
  } catch (playErr: any) {
    DebugLog.log('DIAGNOSTIC', 'ElevenLabsService', 'AUDIO_PLAYBACK_ERROR', {
      voiceId,
      stage: 'play',
      error: playErr?.message || String(playErr),
    });
    try { await sound.unloadAsync(); } catch { /* ignore */ }
    return null;
  }

  return sound;
};

// ─── CONFIG PROBE ─────────────────────────────────────────────────────
// 2026-02 SCRIPT M8 Option A backend-proxy refactor.
// The mobile client no longer holds an ElevenLabs credential. This
// probe reports the LAST verdict returned by the backend health
// route. The rehearsal screen uses this exactly like before — it
// only asks "is ElevenLabs available?" and never sees the key.
export const isElevenLabsConfigured = (): boolean => _backendConfigured === true;

export const elevenLabsConfigStatus = (): { valid: boolean; classification: string } => ({
  valid: _backendConfigured === true,
  classification: _backendClassification,
});

// Test hook — allows the pre-push verification harness to force a
// re-probe against a specific backend URL without waiting for the
// module-load probe to resolve. Not used in production paths.
export const _refreshElevenLabsConfig = async (): Promise<void> => {
  _backendConfigured = null;
  await probeBackendElevenLabs();
};

export default {
  PRESET_VOICES,
  getVoicesByGender,
  getVoiceByKey,
  saveVoiceAssignments,
  loadVoiceAssignments,
  getCharacterVoiceId,
  generateSpeech,
  generateSpeechToFile,
  playSpeech,
  isElevenLabsConfigured,
  elevenLabsConfigStatus,
  readerStyleToElevenLabsSettings,
  clearElevenLabsAudioCache,
  resolveVoiceForCharacter,
  selectProvider,
  uint8ArrayToBase64,
  makeAudioCacheKey,
  ensurePlaybackAudioMode,
};
