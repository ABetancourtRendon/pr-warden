import { readFile } from 'node:fs/promises';

// Loads and parses the JSON configuration for the worker.

function readConfigFile(path) {
  return readFile(path, 'utf8');
}

function parseConfig(raw) {
  return JSON.parse(raw);
}

export function load(path) {
  return readConfigFile(path).then(parseConfig);
}
