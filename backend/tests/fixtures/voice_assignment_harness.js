// Runs the real elevenLabsService.ts + elevenLabsPure.ts in Node with native modules and the
// backend stubbed. Records the voice_id of every /generate request. Usage: node <this> <scenario>
const Module = require('module');
require('/app/frontend/node_modules/sucrase/register/ts');

const scenario = process.argv[2];
const logs = [];
const generated = [];
let healthMode = scenario.startsWith('probe_') ? 'fail' : 'ok';
let healthCalls = 0;

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
global.fetch = async (url, init) => {
  if (url.endsWith('/health')) {
    healthCalls += 1;
    if (healthMode === 'fail') throw new Error('Network request failed');
    if (healthMode === 'hang') return new Promise(() => {});
    return okJson({ configured: true, classification: 'ok' });
  }
  if (url.endsWith('/device-session')) {
    return okJson({ token: 'tok', expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
  }
  if (url.endsWith('/generate')) {
    generated.push(JSON.parse(init.body).voice_id);
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6]).buffer };
  }
  throw new Error(`unexpected url ${url}`);
};

const store = {};
const sound = () => ({ setOnPlaybackStatusUpdate: () => {}, playAsync: async () => {}, unloadAsync: async () => {} });
const stubs = {
  'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android', select: (o) => o.android ?? o.default } },
  'expo-av': { Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async () => ({ sound: sound() }) } } },
  'expo-file-system/legacy': { cacheDirectory: '/tmp/', writeAsStringAsync: async () => {}, EncodingType: { Base64: 'base64' } },
  '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async (k) => (k in store ? store[k] : null),
    setItem: async (k, v) => { store[k] = v; },
    removeItem: async (k) => { delete store[k]; },
  } },
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
const pure = require('/app/frontend/services/elevenLabsPure.ts');
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const OPTS = { readerStyle: 'neutral', voiceSpeed: 1.0 };
const id = (key) => svc.getVoiceByKey(key).id;
const entry = (characterName, key) => ({ characterName, voiceKey: key, voiceId: id(key) });

// Mirrors the rehearsal screen: load -> map -> per-line resolve/select -> playSpeech(voiceId).
async function rehearse(scriptId, lines) {
  const map = pure.buildVoiceAssignmentMap(await svc.loadVoiceAssignments(scriptId), (k) => svc.getVoiceByKey(k)?.id);
  const out = [];
  for (const [character, text] of lines) {
    const configured = await svc.ensureElevenLabsConfigured(2500);
    const res = pure.resolveVoiceForCharacter(map, character);
    const provider = pure.selectProvider(configured, res);
    const before = generated.length;
    if (provider === 'elevenlabs') await svc.playSpeech(text, res.voiceId, OPTS);
    out.push({ character, provider, voiceIdSent: generated.length > before ? generated[generated.length - 1] : null });
  }
  return out;
}

const scenarios = {
  async distinct_characters_use_own_voice() {
    await tick();
    await svc.saveVoiceAssignments('scriptA', [entry('JOHN', 'drew'), entry('MARY', 'rachel'), entry('DET. HARRIS', 'george')]);
    const lines = [['JOHN', 'Where were you?'], ['MARY', 'Out.'], ['DET. HARRIS', 'Sit down.'], ['MARY', 'Where were you?'], ['JOHN', 'Out.']];
    return { lines: await rehearse('scriptA', lines), ids: { drew: id('drew'), rachel: id('rachel'), george: id('george') } };
  },
  async case_drift_resolves_same_voice() {
    await tick();
    await svc.saveVoiceAssignments('scriptA', [entry('Det. Harris', 'george'), entry('MARY', 'rachel')]);
    return { lines: await rehearse('scriptA', [['DET. HARRIS', 'Sit.'], ['MARY', 'No.']]), george: id('george'), rachel: id('rachel') };
  },
  async scripts_are_isolated_and_reassignment_persists() {
    await tick();
    await svc.saveVoiceAssignments('scriptA', [entry('JOHN', 'drew')]);
    await svc.saveVoiceAssignments('scriptB', [entry('JOHN', 'josh')]);
    const a1 = await rehearse('scriptA', [['JOHN', 'One.']]);
    const b = await rehearse('scriptB', [['JOHN', 'One.']]);
    await svc.saveVoiceAssignments('scriptA', [entry('JOHN', 'callum')]);
    const a2 = await rehearse('scriptA', [['JOHN', 'One.']]);
    return { a1, b, a2, drew: id('drew'), josh: id('josh'), callum: id('callum') };
  },
  async empty_voice_id_rederived_from_key() {
    await tick();
    await svc.saveVoiceAssignments('scriptA', [{ characterName: 'JOHN', voiceKey: 'thomas', voiceId: '' }]);
    return { lines: await rehearse('scriptA', [['JOHN', 'Hi.']]), thomas: id('thomas') };
  },
  async unassigned_character_falls_back_without_borrowing_a_voice() {
    await tick();
    await svc.saveVoiceAssignments('scriptA', [entry('JOHN', 'drew')]);
    return { lines: await rehearse('scriptA', [['STRANGER', 'Hey.'], ['JOHN', 'Hi.']]), drew: id('drew') };
  },
  async probe_failure_recovers_after_retry_window() {
    await tick();
    const startConfigured = svc.isElevenLabsConfigured();
    await svc.saveVoiceAssignments('scriptA', [entry('JOHN', 'drew')]);
    const withinWindow = await rehearse('scriptA', [['JOHN', 'First.']]);
    healthMode = 'ok';
    const realNow = Date.now;
    Date.now = () => realNow() + 16000;
    const afterWindow = await rehearse('scriptA', [['JOHN', 'Second.']]);
    Date.now = realNow;
    return { startConfigured, withinWindow, afterWindow, drew: id('drew'), healthCalls };
  },
  async probe_hang_is_bounded() {
    await tick();
    healthMode = 'hang';
    const realNow = Date.now;
    Date.now = () => realNow() + 16000;
    const t0 = realNow();
    const configured = await svc.ensureElevenLabsConfigured(100);
    Date.now = realNow;
    return { configured, waitedMs: realNow() - t0 };
  },
};

scenarios[scenario]().then((r) => {
  if (process.env.DBG) console.error(logs.join(' '));
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}, (e) => { console.error(e); process.exit(1); });
