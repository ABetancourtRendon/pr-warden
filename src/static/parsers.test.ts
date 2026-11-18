import { describe, expect, it } from 'vitest';
import { parseEslintReport } from './eslint.js';
import { parseRuffReport } from './ruff.js';

describe('parseEslintReport', () => {
  // Shape of eslint --format json (ESLint 9 flat config).
  const sample = JSON.stringify([
    {
      filePath: '/ws/src/app.js',
      messages: [
        {
          ruleId: 'no-eval',
          severity: 2,
          message: 'eval can be harmful.',
          line: 3,
          endLine: 3,
          column: 1,
        },
        {
          ruleId: 'semi',
          severity: 1,
          message: 'Missing semicolon.',
          line: 7,
          endLine: 7,
          column: 1,
        },
      ],
      errorCount: 1,
      warningCount: 1,
    },
    {
      filePath: '/ws/lib/util.js',
      messages: [
        { ruleId: null, severity: 1, message: 'Parsing error.', line: 2, endLine: 2, column: 1 },
      ],
    },
  ]);

  it('maps rules, severities, and file paths', () => {
    const findings = parseEslintReport(sample, '/ws');
    expect(findings.length).toBe(3);
    const noEval = findings.find((entry) => entry.rule === 'eslint:no-eval');
    expect(noEval?.file).toBe('src/app.js');
    expect(noEval?.severity).toBe('critical');
    expect(noEval?.category).toBe('security');
    expect(noEval?.start_line).toBe(3);
    const semi = findings.find((entry) => entry.rule === 'eslint:semi');
    expect(semi?.category).toBe('style');
    expect(semi?.severity).toBe('minor');
  });

  it('keeps a relative path when the workspace prefix does not match', () => {
    const findings = parseEslintReport(sample, '/other-ws');
    expect(findings[0]?.file).toBe('/ws/src/app.js');
  });

  it('returns empty for invalid payloads', () => {
    expect(parseEslintReport('garbage', '/ws')).toEqual([]);
    expect(parseEslintReport('{"not":"array"}', '/ws')).toEqual([]);
  });
});

describe('parseRuffReport', () => {
  // Shape of ruff check --output-format=json.
  const sample = JSON.stringify([
    {
      code: 'S608',
      message: 'Possible SQL injection vector through string-based query construction.',
      filename: '/ws/db.py',
      location: { row: 12, column: 5 },
      end_location: { row: 12, column: 40 },
    },
    {
      code: 'E501',
      message: 'Line too long (100 > 88).',
      filename: '/ws/util.py',
      location: { row: 3, column: 89 },
      end_location: { row: 3, column: 100 },
    },
  ]);

  it('maps SQL injection to critical security findings', () => {
    const findings = parseRuffReport(sample, '/ws');
    expect(findings.length).toBe(2);
    const s608 = findings.find((entry) => entry.rule === 'ruff:S608');
    expect(s608?.severity).toBe('critical');
    expect(s608?.category).toBe('security');
    expect(s608?.file).toBe('db.py');
    expect(s608?.start_line).toBe(12);
  });

  it('maps style violations to info-level style findings', () => {
    const findings = parseRuffReport(sample, '/ws');
    const e501 = findings.find((entry) => entry.rule === 'ruff:E501');
    expect(e501?.severity).toBe('info');
    expect(e501?.category).toBe('style');
  });

  it('returns empty for invalid payloads', () => {
    expect(parseRuffReport('[]', '/ws')).toEqual([]);
    expect(parseRuffReport('nope', '/ws')).toEqual([]);
  });
});
