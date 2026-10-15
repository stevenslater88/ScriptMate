// Runs the real services/elevenLabsService.ts in Node with native modules and the
// backend stubbed, counting /generate requests. Usage: node <this> <scenario>
const Module = require('module');
require('/app/frontend/node_modules/sucrase/register/ts');

const scenario = process.argv[2];
const logs = [];
let generateCalls = 0;
let failNextGenerate = scenario === 'failed_prefetch_is_retried_by_play';
const configured = scenario !== 'prefetch_noop_when_backend_not_configured';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
global.fetch = async (url) => {
  if (url.endsWith('/health')) return okJson({ configured, classification: configured ? 'ok' : 'missing' });
  if (url.endsWith('/device-session')) {
    return okJson({ token: 'tok', expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
  }
  if (url.endsWith('/generate')) {
    generateCalls += 1;
    await new Promise((r) => setTimeout(r, 40));
    if (failNextGenerate) {
      failNextGenerate = false;
      return { ok: false, status: 500, text: async () => '{"detail":"boom"}' };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6]).buffer };
  }
  throw new Error(`unexpected url ${url}`);
};

const sound = () => ({ setOnPlaybackStatusUpdate: () => {}, playAsync: async () => {}, unloadAsync: async () => {} });
const stubs = {
  'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android', select: (o) => o.android ?? o.default } },
  'expo-av': { Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async () => ({ sound: sound() }) } } },
  'expo-file-system/legacy': { cacheDirectory: '/tmp/', writeAsStringAsync: async () => {}, EncodingType: { Base64: 'base64' } },
  '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
  'react-native-purchases': { __esModule: true, default: { getAppUserID: async () => 'rc-user' } },
  'expo-device': {},
  'expo-constants': { default: { expoConfig: { extra: {} } } },
  './appConfig': { AppConfig: { BACKEND_URL: 'http://stub' } },
  './debugLogService': { DebugLog: { log: (...a) => logs.push(a[2]), errorCaught: () => {} } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
  return origLoad.call(this, req, ...rest);
};

const svc = require('/app/frontend/services/elevenLabsService.ts');
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const OPTS = { readerStyle: 'neutral', voiceSpeed: 1.0 };

const scenarios = {
  async prefetch_and_immediate_play_share_one_request() {
    svc.prefetchSpeech('Hello there', 'voiceA', OPTS);
    const s = await svc.playSpeech('Hello there', 'voiceA', OPTS);
    return { generateCalls, played: !!s, joined: logs.includes('TTS_JOINED_IN_FLIGHT') };
  },
  async completed_prefetch_is_a_cache_hit() {
    svc.prefetchSpeech('Hello there', 'voiceA', OPTS);
    await tick();
    const s = await svc.playSpeech('Hello there', 'voiceA', OPTS);
    return { generateCalls, played: !!s, cacheHit: logs.includes('AUDIO_CACHE_HIT') };
  },
  async different_voice_or_style_is_not_shared() {
    svc.prefetchSpeech('Hello there', 'voiceA', OPTS);
    await tick();
    await svc.playSpeech('Hello there', 'voiceA', { readerStyle: 'emotional', voiceSpeed: 0.9 });
    await svc.playSpeech('Hello there', 'voiceB', OPTS);
    return { generateCalls };
  },
  async failed_prefetch_is_retried_by_play() {
    svc.prefetchSpeech('Hello there', 'voiceA', OPTS);
    await tick();
    const s = await svc.playSpeech('Hello there', 'voiceA', OPTS);
    return { generateCalls, played: !!s };
  },
  async prefetch_noop_when_backend_not_configured() {
    await tick();
    svc.prefetchSpeech('Hello there', 'voiceA', OPTS);
    await tick();
    return { generateCalls };
  },
  async generation_timing_is_logged() {
    await svc.playSpeech('Hello there', 'voiceA', OPTS);
    return { started: logs.includes('TTS_REQUEST_STARTED'), ready: logs.includes('TTS_AUDIO_READY') };
  },
};

scenarios[scenario]().then((r) => {
  if (process.env.DBG) console.error(logs.join(" "));
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}, (e) => { console.error(e); process.exit(1); });
