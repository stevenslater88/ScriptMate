
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Resolve frontend/node_modules absolutely so require() finds packages
// regardless of this shim's filesystem location.
const FRONTEND_NM = process.env.FRONTEND_NODE_MODULES
  || path.resolve(__dirname, '..', '..', 'frontend', 'node_modules');
Module.globalPaths.push(FRONTEND_NM);

function requireFromFrontend(name) {
  const p = require.resolve(name, { paths: [FRONTEND_NM] });
  return require(p);
}

// Transpile TypeScript on the fly using @babel/core + preset-typescript
// (both already present in frontend/node_modules via Expo deps).
// No new dependency is added. If babel is unavailable we exit with
// rc=2 and the Python side skips the frontend tests gracefully.
let babel, presetTS;
try {
  babel = requireFromFrontend('@babel/core');
  presetTS = require.resolve('@babel/preset-typescript', { paths: [FRONTEND_NM] });
} catch (e) {
  console.error(JSON.stringify({ error: 'no-babel', detail: e.message, FRONTEND_NM }));
  process.exit(2);
}

// Register a .ts loader that uses babel to strip TypeScript types.
Module._extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = babel.transformSync(source, {
    filename,
    presets: [[presetTS, { allowDeclareFields: true }]],
    babelrc: false,
    configFile: false,
  });
  module._compile(code, filename);
};

const smartParserPath = path.resolve(
  __dirname, '..', '..', 'frontend', 'services', 'smartScriptParser.ts'
);
let parseScript;
try {
  ({ parseScript } = require(smartParserPath));
} catch (e) {
  console.error(JSON.stringify({
    error: 'require-failed',
    detail: e.message || String(e),
    stack: e.stack,
    smartParserPath,
  }));
  process.exit(3);
}

const rawText = process.argv[2];
try {
  const result = parseScript(rawText);
  const chars = result.detectedCharacters.map(c => c.name);
  const dialogueLines = result.parsedLines
    .filter(l => l.type === 'DIALOGUE')
    .map(l => ({ character: l.characterName, text: l.text }));
  console.log(JSON.stringify({
    characters: chars,
    dialogue_count: dialogueLines.length,
    dialogue: dialogueLines,
    stats: result.stats,
  }));
} catch (err) {
  console.error(JSON.stringify({ error: 'parse-failed', detail: err.message || String(err) }));
  process.exit(4);
}
