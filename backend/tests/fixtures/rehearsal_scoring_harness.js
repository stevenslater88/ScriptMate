// Runs the real frontend/services/rehearsalScoring.ts in Node.
// Usage: node <this> '<json array of {fn, args}>'  -> prints json array of results.
const path = require('path');
const FRONTEND = path.resolve(__dirname, '..', '..', '..', 'frontend');
require(path.join(FRONTEND, 'node_modules', 'sucrase', 'register', 'ts'));

const m = require(path.join(FRONTEND, 'services', 'rehearsalScoring.ts'));
const calls = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify(calls.map(({ fn, args }) => m[fn](...args))));
