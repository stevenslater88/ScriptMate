// ─── Voice Pipeline Smoke Test ────────────────────────────────────────
// Exercises the SAME pure playback function used by rehearsal
// (playCharacterLinePure) with deterministic stubs for fetch / file
// write / audio load+play. Proves the full lifecycle:
//
//   character → assigned voiceId → ElevenLabs request → arrayBuffer →
//   base64 → file write → Audio.Sound load → play → completion → next
//
// Pure Node; no React Native mocking needed.
//
// Compiled + run the same way as learn_engine_smoketest.js.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const outDir = path.join(__dirname, 'voice_pipeline_smoke_build');
fs.mkdirSync(outDir, { recursive: true });

try {
  execSync(
    `npx tsc --outDir ${outDir} --target ES2019 --module commonjs --esModuleInterop --skipLibCheck --moduleResolution node --isolatedModules --noEmit false frontend/services/elevenLabsPure.ts`,
    { stdio: 'pipe', cwd: ROOT },
  );
} catch (e) {
  // tsc may exit non-zero due to unrelated errors in the wider tree.
  // We only care that our target file was emitted; check below.
}

const outFile = path.join(outDir, 'elevenLabsPure.js');
if (!fs.existsSync(outFile)) {
  console.error(`Compiled pure module not found at ${outFile}`);
  process.exit(1);
}

const pure = require(outFile);
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}\n${e.stack}`); fail++; }
}
async function tAsync(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}\n${e.stack}`); fail++; }
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertTrue(v, msg) { if (!v) throw new Error(msg); }
function assertFalse(v, msg) { if (v) throw new Error(msg); }
function assertIncludes(arr, val, msg) {
  if (!arr.includes(val)) throw new Error(`${msg} — expected to include ${val}, got ${JSON.stringify(arr)}`);
}

// ─── FIXTURES ────────────────────────────────────────────────────────
const ASSIGNMENTS_LOWER = {
  JACK:         { characterName: 'JACK',        voiceKey: 'drew',   voiceId: '29vD33N1CtxCmqQRPOHJ' },
  SARAH:        { characterName: 'SARAH',       voiceKey: 'sarah',  voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'DET. HARRIS':{ characterName: 'DET. HARRIS', voiceKey: 'clyde',  voiceId: '2EiwWnXFnvU5JabPnv8n' },
};
// Also stored in mixed case for the case-insensitive lookup test.
const ASSIGNMENTS_MIXED = {
  Jack: { characterName: 'Jack', voiceKey: 'drew', voiceId: '29vD33N1CtxCmqQRPOHJ' },
  JACK: { characterName: 'Jack', voiceKey: 'drew', voiceId: '29vD33N1CtxCmqQRPOHJ' }, // both keys, like the rehearsal loader does
};

// A "fake" MP3 payload — 512 bytes of non-zero data.
function makeFakeMp3Bytes(size = 512) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 37 + 11) & 0xff;
  return bytes;
}

// Deterministic ok-response factory.
function makeOkResponse(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => '',
  };
}
function makeErrResponse(status, body = '') {
  return {
    ok: false,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => body,
  };
}

// ─── A. RESOLUTION ─────────────────────────────────────────────────
t('A1: JACK resolves to Drew voiceId', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'JACK');
  assertTrue(r.assignmentPresent, 'assignmentPresent');
  assertEq(r.voiceId, '29vD33N1CtxCmqQRPOHJ', 'JACK voiceId');
  assertEq(r.voiceKey, 'drew', 'JACK voiceKey');
});
t('A2: SARAH resolves to Sarah voiceId', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'SARAH');
  assertEq(r.voiceId, 'EXAVITQu4vr4xnSDxMaL', 'SARAH voiceId');
});
t('A3: DET. HARRIS (space + dot) resolves to Clyde voiceId', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'DET. HARRIS');
  assertEq(r.voiceId, '2EiwWnXFnvU5JabPnv8n', 'DET. HARRIS voiceId');
});
t('A4: mixed-case parser lookup falls back to upper', () => {
  // Rehearsal loader stores BOTH cases; verify pure lookup finds it.
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_MIXED, 'JACK');
  assertTrue(r.assignmentPresent, 'assignmentPresent');
  assertEq(r.voiceId, '29vD33N1CtxCmqQRPOHJ', 'JACK voiceId');
});
t('A5: unknown character returns not-present', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'NOBODY');
  assertFalse(r.assignmentPresent, 'assignmentPresent');
  assertEq(r.voiceId, null, 'voiceId');
});
t('A6: null character returns empty', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, null);
  assertFalse(r.assignmentPresent, 'assignmentPresent');
});

// ─── B. PROVIDER SELECTION ─────────────────────────────────────────
t('B1: elevenlabs configured + valid voiceId => elevenlabs', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'JACK');
  assertEq(pure.selectProvider(true, r), 'elevenlabs', 'provider');
});
t('B2: elevenlabs NOT configured => expo-speech even with valid voiceId', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'JACK');
  assertEq(pure.selectProvider(false, r), 'expo-speech', 'provider');
});
t('B3: no assignment => expo-speech', () => {
  const r = pure.resolveVoiceForCharacter(ASSIGNMENTS_LOWER, 'NOBODY');
  assertEq(pure.selectProvider(true, r), 'expo-speech', 'provider');
});
t('B4: assignment present but empty voiceId => expo-speech', () => {
  const r = pure.resolveVoiceForCharacter(
    { JACK: { characterName: 'JACK', voiceKey: 'drew', voiceId: '' } },
    'JACK',
  );
  assertEq(pure.selectProvider(true, r), 'expo-speech', 'provider');
});

// ─── C. BASE64 ENCODER (Hermes-safe, chunked) ─────────────────────
t('C1: empty input encodes to empty string', () => {
  assertEq(pure.uint8ArrayToBase64(new Uint8Array(0)), '', 'empty');
});
t('C2: single byte encodes with two-padding', () => {
  assertEq(pure.uint8ArrayToBase64(new Uint8Array([0x66])), 'Zg==', 'single byte');
});
t('C3: two bytes encodes with one-padding', () => {
  assertEq(pure.uint8ArrayToBase64(new Uint8Array([0x66, 0x6f])), 'Zm8=', 'two bytes');
});
t('C4: three bytes encodes without padding', () => {
  assertEq(pure.uint8ArrayToBase64(new Uint8Array([0x66, 0x6f, 0x6f])), 'Zm9v', 'three bytes');
});
t('C5: matches Node Buffer for a 512-byte MP3-like payload', () => {
  const bytes = makeFakeMp3Bytes(512);
  const ours = pure.uint8ArrayToBase64(bytes);
  const nodeB64 = Buffer.from(bytes).toString('base64');
  assertEq(ours, nodeB64, 'base64 matches Node Buffer');
});
t('C6: matches Node Buffer for a 4KB payload', () => {
  const bytes = makeFakeMp3Bytes(4096);
  const ours = pure.uint8ArrayToBase64(bytes);
  const nodeB64 = Buffer.from(bytes).toString('base64');
  assertEq(ours, nodeB64, 'base64 matches Node Buffer for 4KB');
});

// ─── D. CACHE KEY ─────────────────────────────────────────────────
t('D1: cache key prefixes voiceId', () => {
  const k = pure.makeAudioCacheKey('vabc', 'hello world');
  assertTrue(k.startsWith('vabc:'), `key should start with voiceId — got ${k}`);
});
t('D2: different voice for same text produces different key', () => {
  const k1 = pure.makeAudioCacheKey('rachel', 'hi');
  const k2 = pure.makeAudioCacheKey('domi', 'hi');
  assertTrue(k1 !== k2, 'different voice keys should differ');
});
t('D3: same voice+text is deterministic', () => {
  assertEq(pure.makeAudioCacheKey('r', 'x'), pure.makeAudioCacheKey('r', 'x'), 'stable');
});

// ─── E. FULL MOCKED PLAYBACK LIFECYCLE ────────────────────────────
async function runPlaybackForCharacter(character, opts = {}) {
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });
  const bytes = makeFakeMp3Bytes(opts.byteLen ?? 512);
  const httpStatus = opts.httpStatus ?? 200;
  let fetchCalledWith = null;
  let writeCalledWith = null;
  let audioLoadCalledWith = null;
  let advanceCalled = false;

  const adapters = {
    fetchAudio: async (voiceId, text) => {
      fetchCalledWith = { voiceId, text };
      if (opts.throwOnFetch) throw new Error('network down');
      if (httpStatus !== 200) return makeErrResponse(httpStatus, 'nope');
      if (opts.emptyBody) return makeOkResponse(new Uint8Array(0));
      return makeOkResponse(bytes);
    },
    writeAudioFile: async (voiceId, base64) => {
      writeCalledWith = { voiceId, base64Length: base64.length };
      if (opts.throwOnWrite) throw new Error('disk full');
      return `file:///tmp/el_${voiceId.substring(0, 6)}.mp3`;
    },
    loadAndPlay: async (fileUri, onFinish, onError) => {
      audioLoadCalledWith = { fileUri };
      if (opts.throwOnLoad) throw new Error('ExoPlayer load failed');
      if (opts.audioStartsFalse) return { handle: {}, started: false };
      // Simulate finish tick.
      queueMicrotask(() => onFinish());
      return { handle: { id: 'sound-1' }, started: true };
    },
    emit,
  };
  const result = await pure.playCharacterLinePure(
    'Hello, world.',
    character,
    opts.assignments ?? ASSIGNMENTS_LOWER,
    opts.elevenLabsConfigured ?? true,
    adapters,
    () => { advanceCalled = true; },
  );
  // Let queued microtasks flush so onFinish fires.
  await new Promise(r => setImmediate(r));
  return { result, events, fetchCalledWith, writeCalledWith, audioLoadCalledWith, advanceCalled };
}

tAsync('E1: happy path — JACK plays via ElevenLabs, completes, advances', async () => {
  const r = await runPlaybackForCharacter('JACK');
  assertEq(r.result.provider, 'elevenlabs', 'provider selected');
  assertTrue(r.result.succeeded, 'succeeded');
  assertFalse(r.result.fellBackToExpoSpeech, 'no fallback');
  assertEq(r.fetchCalledWith.voiceId, '29vD33N1CtxCmqQRPOHJ', 'fetch called with JACK voiceId');
  assertTrue(r.writeCalledWith !== null, 'file writer called');
  assertTrue(r.writeCalledWith.base64Length > 0, 'base64 body written');
  assertTrue(r.audioLoadCalledWith !== null, 'audio loader called');
  assertTrue(r.audioLoadCalledWith.fileUri.startsWith('file://'), 'file:// URI passed to audio loader');
  assertTrue(r.advanceCalled, 'advance called on completion');

  const eventNames = r.events.map(e => e.event);
  for (const need of [
    'VOICE_RESOLUTION',
    'VOICE_PROVIDER_SELECTED',
    'ELEVENLABS_REQUEST_START',
    'ELEVENLABS_RESPONSE',
    'ELEVENLABS_AUDIO_READY',
    'AUDIO_LOAD_START',
    'AUDIO_LOAD_SUCCESS',
    'AUDIO_PLAY_START',
    'AUDIO_PLAYING',
    'AUDIO_PLAYBACK_COMPLETE',
  ]) {
    assertIncludes(eventNames, need, 'missing diagnostic');
  }
});

tAsync('E2: SARAH plays with her voiceId', async () => {
  const r = await runPlaybackForCharacter('SARAH');
  assertEq(r.fetchCalledWith.voiceId, 'EXAVITQu4vr4xnSDxMaL', 'SARAH voiceId used');
  assertTrue(r.result.succeeded, 'succeeded');
});

tAsync('E3: DET. HARRIS plays with Clyde voiceId', async () => {
  const r = await runPlaybackForCharacter('DET. HARRIS');
  assertEq(r.fetchCalledWith.voiceId, '2EiwWnXFnvU5JabPnv8n', 'Harris voiceId used');
});

tAsync('E4: no assignment => expo-speech fallback, no fetch', async () => {
  const r = await runPlaybackForCharacter('UNKNOWN');
  assertEq(r.result.provider, 'expo-speech', 'provider');
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
  assertEq(r.fetchCalledWith, null, 'no ElevenLabs fetch when no assignment');
  const events = r.events.map(e => e.event);
  assertIncludes(events, 'FALLBACK_TO_EXPO_SPEECH', 'fallback diagnostic missing');
});

tAsync('E5: elevenlabs not configured => expo-speech fallback', async () => {
  const r = await runPlaybackForCharacter('JACK', { elevenLabsConfigured: false });
  assertEq(r.result.provider, 'expo-speech', 'provider');
  assertEq(r.fetchCalledWith, null, 'no fetch');
});

tAsync('E6: network exception => fallback with error stage=network', async () => {
  const r = await runPlaybackForCharacter('JACK', { throwOnFetch: true });
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
  assertEq(r.result.errorStage, 'network', 'errorStage');
  const events = r.events.map(e => e.event);
  assertIncludes(events, 'FALLBACK_TO_EXPO_SPEECH', 'fallback diagnostic');
});

tAsync('E7: HTTP 401 => fallback with errorStage=http-401', async () => {
  const r = await runPlaybackForCharacter('JACK', { httpStatus: 401 });
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
  assertEq(r.result.errorStage, 'http-401', 'errorStage');
});

tAsync('E8: empty body => fallback with errorStage=empty-body', async () => {
  const r = await runPlaybackForCharacter('JACK', { emptyBody: true });
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
  assertEq(r.result.errorStage, 'empty-body', 'errorStage');
});

tAsync('E9: write-file throw => fallback with errorStage=write-file', async () => {
  const r = await runPlaybackForCharacter('JACK', { throwOnWrite: true });
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
  assertEq(r.result.errorStage, 'write-file', 'errorStage');
});

tAsync('E10: audio load throws => fallback with errorStage=audio-load', async () => {
  const r = await runPlaybackForCharacter('JACK', { throwOnLoad: true });
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
  assertEq(r.result.errorStage, 'audio-load', 'errorStage');
});

tAsync('E11: audio loader reports started=false => fallback', async () => {
  const r = await runPlaybackForCharacter('JACK', { audioStartsFalse: true });
  assertFalse(r.result.succeeded, 'not succeeded');
  assertTrue(r.result.fellBackToExpoSpeech, 'fell back');
});

// ─── SUMMARY ──────────────────────────────────────────────────────
Promise.resolve().then(async () => {
  // Await all async tests scheduled — they use setImmediate flush.
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  console.log(`\nVoice pipeline smoke: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
});
