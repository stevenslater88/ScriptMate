
const path = require('path');
const Module = require('module');
const FRONTEND_NM = process.env.FRONTEND_NODE_MODULES || '/app/frontend/node_modules';
Module.globalPaths.push(FRONTEND_NM);
let babel, presetTS;
try {
  babel = require(path.join(FRONTEND_NM, '@babel/core'));
  presetTS = require.resolve('@babel/preset-typescript', { paths: [FRONTEND_NM] });
} catch (e) { console.error('BABEL_UNAVAILABLE'); process.exit(2); }
Module._extensions['.ts'] = function (m, f) {
  const src = require('fs').readFileSync(f, 'utf8');
  const { code } = babel.transformSync(src, { filename: f, presets: [[presetTS]], babelrc: false, configFile: false });
  m._compile(code, f);
};
const { parseScript } = require('/app/frontend/services/smartScriptParser.ts');
const fs = require('fs');
const raw = process.argv[2] === '--file' ? fs.readFileSync(process.argv[3], 'utf8') : process.argv[2];
const r = parseScript(raw);
process.stdout.write(JSON.stringify({
  characters: r.detectedCharacters.map(c => c.name),
  parsedLines: r.parsedLines.length,
  dialogue: r.stats.dialogueLines,
  action: r.stats.actionLines,
  heading: r.stats.headingLines,
  parenthetical: r.stats.parentheticalLines,
}));
