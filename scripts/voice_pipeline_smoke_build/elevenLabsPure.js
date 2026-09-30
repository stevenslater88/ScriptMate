"use strict";
/**
 * ElevenLabs pure playback helpers
 * ---------------------------------
 * RN-free primitives used by both the real elevenLabsService (which
 * wires them to expo-av / expo-file-system / fetch) and the Node
 * smoke test (which wires them to stubs). Keeping these split out is
 * what makes the required end-to-end mocked playback test possible
 * without bootstrapping React Native inside the Pytest gate.
 *
 * Nothing in this file may import from expo-*, react-native, or any
 * platform-only module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readerStyleToElevenLabsSettingsPure = readerStyleToElevenLabsSettingsPure;
exports.isValidElevenLabsApiKeyPure = isValidElevenLabsApiKeyPure;
exports.classifyElevenLabsKeyPure = classifyElevenLabsKeyPure;
exports.resolveVoiceForCharacter = resolveVoiceForCharacter;
exports.selectProvider = selectProvider;
exports.uint8ArrayToBase64 = uint8ArrayToBase64;
exports.makeAudioCacheKey = makeAudioCacheKey;
exports.playCharacterLinePure = playCharacterLinePure;
function readerStyleToElevenLabsSettingsPure(readerStyle, voiceSpeed) {
    const s = (readerStyle || 'neutral').toLowerCase();
    let stability = 0.5;
    let style = 0.0;
    if (s === 'emotional') {
        stability = 0.35;
        style = 0.55;
    }
    else if (s === 'intense' || s === 'aggressive') {
        stability = 0.25;
        style = 0.85;
    }
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
// ─── API KEY VALIDATOR (pure) ─────────────────────────────────────
// Mirrors appConfig.isValidElevenLabsApiKey — kept pure so the smoke
// test can prove the classification without booting Expo Constants.
function isValidElevenLabsApiKeyPure(key) {
    if (typeof key !== 'string')
        return false;
    const trimmed = key.trim();
    if (!trimmed)
        return false;
    if (!trimmed.startsWith('sk_'))
        return false;
    if (trimmed.length < 20)
        return false;
    return true;
}
function classifyElevenLabsKeyPure(key) {
    if (key === undefined || key === null || key === '')
        return 'missing';
    if (typeof key !== 'string')
        return 'not-a-string';
    const trimmed = key.trim();
    if (!trimmed)
        return 'missing';
    if (/^[0-9a-fA-F]{64}$/.test(trimmed))
        return 'looks-like-api-key-id';
    if (!trimmed.startsWith('sk_'))
        return 'wrong-prefix';
    if (trimmed.length < 20)
        return 'too-short';
    return 'valid';
}
/**
 * Resolve a line's character to a voice assignment. Tries the exact
 * key first, then the upper-cased key — matches the two forms the
 * rehearsal screen stores at load time.
 */
function resolveVoiceForCharacter(assignments, character) {
    var _a, _b, _c;
    if (!character) {
        return { character: '', assignmentPresent: false, voiceKey: null, voiceId: null };
    }
    const a = (_a = assignments[character]) !== null && _a !== void 0 ? _a : assignments[character.toUpperCase()];
    if (!a) {
        return { character, assignmentPresent: false, voiceKey: null, voiceId: null };
    }
    return {
        character,
        assignmentPresent: true,
        voiceKey: (_b = a.voiceKey) !== null && _b !== void 0 ? _b : null,
        voiceId: (_c = a.voiceId) !== null && _c !== void 0 ? _c : null,
    };
}
/**
 * Provider-selection rule: ElevenLabs only when it's configured AND
 * we have both an assignment and a non-empty voiceId. Every other
 * case falls back to expo-speech so the rehearsal never stalls.
 */
function selectProvider(elevenLabsConfigured, resolution) {
    if (elevenLabsConfigured && resolution.assignmentPresent && !!resolution.voiceId) {
        return 'elevenlabs';
    }
    return 'expo-speech';
}
// ─── HERMES-SAFE BASE64 ENCODER ──────────────────────────────────────
// btoa is not stable across Expo/Hermes; String.fromCharCode(...bytes)
// blows the JS stack on large audio. Chunked encoder, zero deps.
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function uint8ArrayToBase64(bytes) {
    let output = '';
    const len = bytes.length;
    const remainder = len % 3;
    const fullChunks = len - remainder;
    for (let i = 0; i < fullChunks; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        output +=
            B64_CHARS[(n >> 18) & 63] +
                B64_CHARS[(n >> 12) & 63] +
                B64_CHARS[(n >> 6) & 63] +
                B64_CHARS[n & 63];
    }
    if (remainder === 1) {
        const n = bytes[fullChunks];
        output += B64_CHARS[(n >> 2) & 63] + B64_CHARS[(n << 4) & 63] + '==';
    }
    else if (remainder === 2) {
        const n = (bytes[fullChunks] << 8) | bytes[fullChunks + 1];
        output +=
            B64_CHARS[(n >> 10) & 63] +
                B64_CHARS[(n >> 4) & 63] +
                B64_CHARS[(n << 2) & 63] +
                '=';
    }
    return output;
}
// ─── CACHE KEY ───────────────────────────────────────────────────────
function makeAudioCacheKey(voiceId, text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
        h = (h << 5) - h + text.charCodeAt(i);
        h |= 0;
    }
    return `${voiceId}:${text.length}:${h}`;
}
/**
 * Executes the FULL ElevenLabs → file → load → play pipeline for a
 * single character line, or falls back to expo-speech. The caller is
 * responsible for wiring `onFinish` to the "advance-to-next-line"
 * behaviour — the pure function only reports success/failure.
 */
async function playCharacterLinePure(text, character, assignments, elevenLabsConfigured, adapters, onFinish) {
    var _a;
    const emit = (_a = adapters.emit) !== null && _a !== void 0 ? _a : (() => { });
    const resolution = resolveVoiceForCharacter(assignments, character);
    emit('VOICE_RESOLUTION', {
        character: resolution.character || '(unknown)',
        assignmentPresent: resolution.assignmentPresent,
        voiceKey: resolution.voiceKey,
        voiceIdPresent: !!resolution.voiceId,
    });
    const provider = selectProvider(elevenLabsConfigured, resolution);
    emit('VOICE_PROVIDER_SELECTED', {
        character: resolution.character || '(unknown)',
        provider,
        elevenLabsConfigured,
    });
    const result = {
        provider,
        succeeded: false,
        fileUri: null,
        byteLength: 0,
        fellBackToExpoSpeech: false,
        errorStage: null,
    };
    if (provider !== 'elevenlabs' || !resolution.voiceId) {
        // No ElevenLabs path — caller must invoke expo-speech.
        result.fellBackToExpoSpeech = true;
        emit('FALLBACK_TO_EXPO_SPEECH', {
            character: resolution.character || '(unknown)',
            reason: !elevenLabsConfigured
                ? 'not-configured'
                : (resolution.assignmentPresent ? 'no-voiceId' : 'no-assignment'),
        });
        return result;
    }
    const voiceId = resolution.voiceId;
    emit('ELEVENLABS_REQUEST_START', { voiceId, textLength: text.length });
    let response;
    try {
        response = await adapters.fetchAudio(voiceId, text);
    }
    catch (e) {
        emit('ELEVENLABS_RESPONSE', {
            voiceId, success: false, httpStatus: 0,
            error: (e === null || e === void 0 ? void 0 : e.message) || String(e), stage: 'network',
        });
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'network' });
        result.fellBackToExpoSpeech = true;
        result.errorStage = 'network';
        return result;
    }
    if (!response.ok) {
        let bodyPreview = '';
        if (response.text) {
            try {
                bodyPreview = (await response.text()).substring(0, 200);
            }
            catch { /* ignore */ }
        }
        emit('ELEVENLABS_RESPONSE', {
            voiceId, success: false, httpStatus: response.status,
            bodyPreview, stage: 'http-status',
        });
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: `http-${response.status}` });
        result.fellBackToExpoSpeech = true;
        result.errorStage = `http-${response.status}`;
        return result;
    }
    let bytes;
    try {
        const buf = await response.arrayBuffer();
        bytes = new Uint8Array(buf);
    }
    catch (e) {
        emit('ELEVENLABS_RESPONSE', {
            voiceId, success: false, httpStatus: response.status,
            error: (e === null || e === void 0 ? void 0 : e.message) || String(e), stage: 'arraybuffer',
        });
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'arraybuffer' });
        result.fellBackToExpoSpeech = true;
        result.errorStage = 'arraybuffer';
        return result;
    }
    if (bytes.length === 0) {
        emit('ELEVENLABS_RESPONSE', {
            voiceId, success: false, httpStatus: response.status,
            byteLength: 0, stage: 'empty-body',
        });
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'empty-body' });
        result.fellBackToExpoSpeech = true;
        result.errorStage = 'empty-body';
        return result;
    }
    result.byteLength = bytes.length;
    emit('ELEVENLABS_RESPONSE', {
        voiceId, success: true, httpStatus: response.status, byteLength: bytes.length,
    });
    const base64 = uint8ArrayToBase64(bytes);
    let fileUri;
    try {
        fileUri = await adapters.writeAudioFile(voiceId, base64);
    }
    catch (e) {
        emit('ELEVENLABS_AUDIO_READY', {
            voiceId, success: false, error: (e === null || e === void 0 ? void 0 : e.message) || String(e), stage: 'write-file',
        });
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'write-file' });
        result.fellBackToExpoSpeech = true;
        result.errorStage = 'write-file';
        return result;
    }
    result.fileUri = fileUri;
    emit('ELEVENLABS_AUDIO_READY', {
        voiceId, success: true, byteLength: bytes.length,
    });
    emit('AUDIO_LOAD_START', { voiceId, fileUri });
    let started;
    try {
        const played = await adapters.loadAndPlay(fileUri, () => { emit('AUDIO_PLAYBACK_COMPLETE', { voiceId }); onFinish(); }, (err) => {
            emit('AUDIO_PLAYBACK_ERROR', { voiceId, stage: 'runtime', error: err });
        });
        started = played.started;
    }
    catch (e) {
        emit('AUDIO_PLAYBACK_ERROR', {
            voiceId, stage: 'load', error: (e === null || e === void 0 ? void 0 : e.message) || String(e),
        });
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'audio-load' });
        result.fellBackToExpoSpeech = true;
        result.errorStage = 'audio-load';
        return result;
    }
    emit('AUDIO_LOAD_SUCCESS', { voiceId, fileUri });
    emit('AUDIO_PLAY_START', { voiceId });
    if (started) {
        emit('AUDIO_PLAYING', { voiceId });
    }
    result.succeeded = started;
    if (!started) {
        emit('FALLBACK_TO_EXPO_SPEECH', { voiceId, reason: 'audio-not-started' });
        result.fellBackToExpoSpeech = true;
        result.errorStage = 'audio-not-started';
    }
    return result;
}
