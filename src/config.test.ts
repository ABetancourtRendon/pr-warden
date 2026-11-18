import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET,
  globToRegExp,
  loadDotEnv,
  loadWardenFile,
  matchesIgnorePath,
  PROVIDER_PRESETS,
  parseWardenFile,
  resolveConfig,
  WardenConfigError,
} from './config.js';

describe('globToRegExp / matchesIgnorePath', () => {
  it('matches directory subtree patterns', () => {
    expect(matchesIgnorePath('dist/app.js', ['dist/**'])).toBe(true);
    expect(matchesIgnorePath('dist/nested/app.js', ['dist/**'])).toBe(true);
    expect(matchesIgnorePath('distx/app.js', ['dist/**'])).toBe(false);
  });

  it('matches slash-less patterns by basename at any depth', () => {
    expect(matchesIgnorePath('src/a.js', ['*.js'])).toBe(true);
    expect(matchesIgnorePath('a.js', ['*.js'])).toBe(true);
    expect(matchesIgnorePath('src/a.ts', ['*.js'])).toBe(false);
  });

  it('anchors slash patterns to the path root', () => {
    expect(matchesIgnorePath('src/a.js', ['src/*.js'])).toBe(true);
    expect(matchesIgnorePath('src/nested/a.js', ['src/*.js'])).toBe(false);
  });

  it('handles double-star prefixes', () => {
    expect(matchesIgnorePath('a/b/c/generated.ts', ['**/generated/**'])).toBe(false);
    expect(matchesIgnorePath('a/b/generated/c.ts', ['**/generated/**'])).toBe(true);
  });

  it('matches exact path patterns', () => {
    expect(matchesIgnorePath('docs/BENCH.md', ['docs/BENCH.md'])).toBe(true);
    expect(matchesIgnorePath('docs/other.md', ['docs/BENCH.md'])).toBe(false);
  });

  it('normalizes windows separators', () => {
    expect(matchesIgnorePath('dist\\app.js', ['dist/**'])).toBe(true);
  });

  it('compiles working regexes', () => {
    expect(globToRegExp('dist/**').test('dist/nested/app.js')).toBe(true);
    expect(globToRegExp('dist/**').test('distx/app.js')).toBe(false);
  });
});

describe('parseWardenFile', () => {
  it('parses a full config file', () => {
    const text = [
      'categories: [bug, security]',
      'min_severity: minor',
      'ignore_paths:',
      '  - "dist/**"',
      'custom_rules:',
      '  - Never suggest renaming public exports.',
      'provider:',
      '  preset: openrouter',
      '  model: meta-llama/llama-3.3-70b-instruct:free',
    ].join('\n');
    const parsed = parseWardenFile(text);
    expect(parsed.categories).toEqual(['bug', 'security']);
    expect(parsed.min_severity).toBe('minor');
    expect(parsed.ignore_paths).toEqual(['dist/**']);
    expect(parsed.custom_rules).toEqual(['Never suggest renaming public exports.']);
    expect(parsed.provider?.preset).toBe('openrouter');
  });

  it('parses an empty document into defaults material', () => {
    const parsed = parseWardenFile('');
    expect(parsed.categories).toBeUndefined();
  });

  it('rejects invalid YAML', () => {
    expect(() => parseWardenFile('categories: [bug,,\n  - broken')).toThrow(WardenConfigError);
  });

  it('rejects unknown categories', () => {
    expect(() => parseWardenFile('categories: [chore]')).toThrow(WardenConfigError);
  });

  it('rejects an invalid min_severity', () => {
    expect(() => parseWardenFile('min_severity: catastrophic')).toThrow(WardenConfigError);
  });
});

describe('loadWardenFile', () => {
  it('returns null when the file does not exist', () => {
    expect(loadWardenFile('/definitely/not/here/.warden.yml')).toBeNull();
  });

  it('loads a file from disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'warden-cfg-'));
    try {
      const file = path.join(dir, '.warden.yml');
      await writeFile(file, 'min_severity: major\n', 'utf8');
      expect(loadWardenFile(file)?.min_severity).toBe('major');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveConfig', () => {
  it('defaults to the gemini preset', () => {
    const resolved = resolveConfig({ file: null, env: { LLM_API_KEY: 'k' } });
    expect(resolved.provider?.preset).toBe(DEFAULT_PRESET);
    expect(resolved.provider?.baseUrl).toBe(PROVIDER_PRESETS.gemini.baseUrl);
    expect(resolved.provider?.model).toBe(PROVIDER_PRESETS.gemini.model);
  });

  it('disables the LLM without an API key', () => {
    const resolved = resolveConfig({ file: null, env: {} });
    expect(resolved.provider).toBeNull();
    expect(resolved.providerNote).toContain('LLM disabled');
  });

  it('lets environment variables beat the warden file', () => {
    const resolved = resolveConfig({
      file: { provider: { preset: 'openai', model: 'gpt-4o-mini' } },
      env: { LLM_API_KEY: 'k', LLM_BASE_URL: 'https://example.com/v1', LLM_MODEL: 'custom-model' },
    });
    expect(resolved.provider?.baseUrl).toBe('https://example.com/v1');
    expect(resolved.provider?.model).toBe('custom-model');
    expect(resolved.provider?.preset).toBe('openai');
  });

  it('honors a file preset when the environment is silent', () => {
    const resolved = resolveConfig({
      file: { provider: { preset: 'groq' } },
      env: { LLM_API_KEY: 'k' },
    });
    expect(resolved.provider?.baseUrl).toBe(PROVIDER_PRESETS.groq.baseUrl);
    expect(resolved.provider?.model).toBe(PROVIDER_PRESETS.groq.model);
  });

  it('applies a CLI provider override on top of everything', () => {
    const resolved = resolveConfig({
      file: { provider: { preset: 'openai' } },
      env: { LLM_API_KEY: 'k' },
      providerOverride: 'openrouter',
    });
    expect(resolved.provider?.baseUrl).toBe(PROVIDER_PRESETS.openrouter.baseUrl);
  });
});

describe('loadDotEnv', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'warden-env-'));
  });
  afterEach(async () => {
    delete process.env.WARDEN_TEST_KEY;
    delete process.env.WARDEN_TEST_QUOTED;
    delete process.env.WARDEN_TEST_EXISTING;
    await rm(dir, { recursive: true, force: true });
  });

  it('loads plain and quoted values without clobbering existing env', async () => {
    const file = path.join(dir, '.env');
    await writeFile(
      file,
      ['# comment', 'WARDEN_TEST_KEY=plain', 'WARDEN_TEST_QUOTED="quoted value"', ''].join('\n'),
      'utf8',
    );
    process.env.WARDEN_TEST_EXISTING = 'original';
    await writeFile(file, 'WARDEN_TEST_EXISTING=overwritten\n', { flag: 'a' });
    const loaded = loadDotEnv(file);
    expect(loaded).toBe(2);
    expect(process.env.WARDEN_TEST_KEY).toBe('plain');
    expect(process.env.WARDEN_TEST_QUOTED).toBe('quoted value');
    expect(process.env.WARDEN_TEST_EXISTING).toBe('original');
  });

  it('returns zero for a missing file', () => {
    expect(loadDotEnv(path.join(dir, 'nope.env'))).toBe(0);
  });
});
