import { describe, expect, it } from 'vitest';
import { syntheticChangedFile } from '../diff.js';
import { parseBiomeReport, runBiome } from './biome.js';

describe('runBiome (subprocess)', () => {
  it('detects a loose-equality bug at its exact line', async () => {
    const content = [
      'export function check(value) {',
      '  if (value == 10) {',
      '    return true;',
      '  }',
      '  return false;',
      '}',
      '',
    ].join('\n');
    const file = syntheticChangedFile('src/check.js', content);
    const findings = await runBiome([file]);
    const doubleEquals = findings.find((entry) => entry.rule === 'biome:noDoubleEquals');
    expect(doubleEquals).toBeDefined();
    expect(doubleEquals?.file).toBe('src/check.js');
    expect(doubleEquals?.start_line).toBe(2);
    expect(doubleEquals?.end_line).toBe(2);
    expect(doubleEquals?.severity).toBe('major');
    expect(doubleEquals?.category).toBe('bug');
    expect(doubleEquals?.source).toBe('static');
  });

  it('returns no findings for clean code', async () => {
    const file = syntheticChangedFile('src/clean.js', 'export const add = (a, b) => a + b;\n');
    const findings = await runBiome([file]);
    expect(findings.filter((entry) => entry.category === 'bug')).toEqual([]);
  });
});

describe('parseBiomeReport', () => {
  // Shape frozen from a real `biome lint --reporter=json` run (Biome 2.6).
  const sample = JSON.stringify({
    summary: { errors: 2, warnings: 1 },
    diagnostics: [
      {
        severity: 'warning',
        message: 'This import is unused.',
        category: 'lint/correctness/noUnusedImports',
        location: {
          path: 'src/sample.js',
          start: { line: 1, column: 8 },
          end: { line: 1, column: 20 },
        },
      },
      {
        severity: 'error',
        message: 'Using == may be unsafe if you are relying on type coercion.',
        category: 'lint/suspicious/noDoubleEquals',
        location: {
          path: 'src/sample.js',
          start: { line: 4, column: 13 },
          end: { line: 4, column: 15 },
        },
      },
      {
        severity: 'error',
        message: 'Formatter would have printed the following content:',
        category: 'format',
        location: {
          path: 'src/sample.js',
          start: { line: 0, column: 0 },
          end: { line: 0, column: 0 },
        },
      },
    ],
  });

  it('maps lint diagnostics to findings and skips non-lint categories', () => {
    const findings = parseBiomeReport(sample);
    expect(findings.length).toBe(2);
    expect(findings.map((entry) => entry.file).every((file) => file === 'src/sample.js')).toBe(
      true,
    );
    expect(findings.find((entry) => entry.rule === 'biome:noDoubleEquals')?.start_line).toBe(4);
    expect(findings.find((entry) => entry.rule === 'biome:noUnusedImports')?.category).toBe(
      'maintainability',
    );
  });

  it('returns empty for unparseable payloads', () => {
    expect(parseBiomeReport('not json')).toEqual([]);
    expect(parseBiomeReport('{"diagnostics": "nope"}')).toEqual([]);
  });
});
