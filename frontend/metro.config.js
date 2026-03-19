// metro.config.js — Expo default config only.
// No custom cache store. Let Metro use its default in-memory cache.
// This eliminates stale-cache as a potential build failure cause.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.maxWorkers = 2;

module.exports = config;
