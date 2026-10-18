// Runs the real frontend/services/devTestMode.ts in Node with a stubbed AsyncStorage.
// Usage: node <this> <dev|release>   (sets the React Native __DEV__ global)
const Module = require('module');
require('/app/frontend/node_modules/sucrase/register/ts');

global.__DEV__ = process.argv[2] === 'dev';
const store = { SCRIPTM8_DEV_TEST_MODE: 'true' }; // a previously enabled toggle
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: {
      getItem: async (k) => store[k] ?? null,
      setItem: async (k, v) => { store[k] = v; },
    } };
  }
  return origLoad.call(this, req, ...rest);
};

const m = require('/app/frontend/services/devTestMode.ts');
(async () => {
  const stored = await m.isDevTestMode();
  await m.setDevTestMode(true);
  const afterEnable = await m.isDevTestMode();
  process.stdout.write(JSON.stringify({ stored, afterEnable, cached: m.getCachedDevTestMode() }));
})().catch((e) => { console.error(e); process.exit(1); });
