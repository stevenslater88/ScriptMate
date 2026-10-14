// Loads the real services/elevenLabsService.ts in Node with native modules stubbed.
// Usage: node elevenlabs_foreground_harness.js <scenario>
const Module = require('module');
require('/app/frontend/node_modules/sucrase/register/ts');

const listeners = new Set();
const AppState = {
  currentState: 'active',
  addEventListener: (_t, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
};
const setState = (s) => { AppState.currentState = s; [...listeners].forEach((fn) => fn(s)); };
const logs = [];
const stubs = {
  'react-native': { AppState, Platform: { OS: 'android', select: (o) => o.android ?? o.default } },
  'expo-av': { Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async () => ({}) } } },
  'expo-file-system/legacy': { cacheDirectory: '/tmp/' },
  '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
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
global.fetch = async () => { throw new Error('offline (stub)'); };

const svc = require('/app/frontend/services/elevenLabsService.ts');
const BG_ERR = 'This experience is currently in the background, so audio focus could not be acquired.';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const scenarios = {
  async wait_resolves_on_active() {
    setState('background');
    let done = false;
    svc.waitForForeground().then(() => { done = true; });
    await tick();
    const before = done;
    setState('active');
    await tick();
    return { before, after: done, listenersLeft: listeners.size };
  },
  async wait_immediate_when_active() {
    setState('active');
    let done = false;
    svc.waitForForeground().then(() => { done = true; });
    await tick(5);
    return { done };
  },
  async classifies_errors() {
    return {
      bg: svc.isBackgroundAudioFocusError(new Error(BG_ERR)),
      other: svc.isBackgroundAudioFocusError(new Error('Player error')),
      nullish: svc.isBackgroundAudioFocusError(null),
    };
  },
  async retries_once_after_background_rejection() {
    setState('active');
    let calls = 0;
    const sound = { playAsync: async () => { calls += 1; if (calls === 1) throw new Error(BG_ERR); } };
    let resolved = false; let error = null;
    // JS still says active, then the app goes to background and returns.
    const p = svc.playWhenForeground(sound, 'v1', 10).then(() => { resolved = true; }, (e) => { error = e.message; });
    await tick();
    await p;
    return { calls, resolved, error, retryLogged: logs.includes('AUDIO_FOCUS_RETRY') };
  },
  async waits_for_foreground_before_retry() {
    setState('active');
    let calls = 0;
    const sound = { playAsync: async () => { calls += 1; if (calls === 1) { setState('background'); throw new Error(BG_ERR); } } };
    let resolved = false;
    const p = svc.playWhenForeground(sound, 'v1', 10).then(() => { resolved = true; });
    await tick(60);
    const whileBackground = { calls, resolved };
    setState('active');
    await p;
    return { whileBackground, final: { calls, resolved } };
  },
  async non_background_error_not_retried() {
    setState('active');
    let calls = 0;
    const sound = { playAsync: async () => { calls += 1; throw new Error('Player error'); } };
    let error = null;
    await svc.playWhenForeground(sound, 'v1', 10).catch((e) => { error = e.message; });
    return { calls, error };
  },
};

scenarios[process.argv[2]]().then((r) => {
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}, (e) => { console.error(e); process.exit(1); });
