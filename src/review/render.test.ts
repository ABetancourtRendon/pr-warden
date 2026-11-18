import { describe, expect, it } from 'vitest';
import type { Finding, ReviewResult } from '../types.js';
import { renderJson, renderTerminal } from './render.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'llm-1',
    file: 'src/app.js',
    start_line: 12,
    end_line: 14,
    severity: 'critical',
    category: 'security',
    title: 'SQL injection via string concatenation',
    detail: 'The query is built by concatenating user input.',
    suggested_fix_diff: '--- a/src/app.js\n+++ b/src/app.js\n@@ -12,3 +12,3 @@\n-sql\n+sql',
    confidence: 0.9,
    source: 'llm',
    ...overrides,
  };
}

function result(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    repo: 'octocat/example',
    pr: 7,
    title: 'Fix login flow',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    degraded: false,
    findings: [finding()],
    usage: { promptTokens: 1_234_567, completionTokens: 89 },
    costUsd: 0.0398,
    stats: {
      filesAnalyzed: 3,
      filesSkipped: 1,
      staticFindings: 0,
      llmFindings: 1,
      invalidLlmFindingsDropped: 0,
      llmRetries: 0,
    },
    notes: ['ruff pass skipped: ruff binary not on PATH'],
    ...overrides,
  };
}

describe('renderTerminal', () => {
  it('prints the header, counts, table row, and cost footer', () => {
    const text = renderTerminal(result(), { color: false, verbose: false });
    expect(text).toContain('PR-Warden review - octocat/example #7');
    expect(text).toContain('Provider: gemini (gemini-2.5-flash)');
    expect(text).toContain('Findings: 1 (1 critical, 0 major, 0 minor, 0 info)');
    expect(text).toContain('src/app.js:12-14');
    expect(text).toContain('SQL injection via string concatenation');
    expect(text).toContain('tokens: 1,234,567 in / 89 out');
    expect(text).toContain('est. cost $0.0398');
    expect(text).toContain('ruff pass skipped');
  });

  it('prints the degradation warning when the LLM pass failed', () => {
    const text = renderTerminal(result({ degraded: true, findings: [] }), {
      color: false,
      verbose: false,
    });
    expect(text).toContain('LLM pass failed');
    expect(text).toContain('clean review');
  });

  it('prints full details and fix diffs in verbose mode', () => {
    const text = renderTerminal(result(), { color: false, verbose: true });
    expect(text).toContain('--- [llm-1]');
    expect(text).toContain('suggested fix:');
    expect(text).toContain('+++ b/src/app.js');
  });

  it('renders without a usage footer for static-only runs', () => {
    const text = renderTerminal(
      result({ usage: null, costUsd: null, provider: 'none', model: 'none' }),
      { color: false, verbose: false },
    );
    expect(text).not.toContain('tokens:');
  });
});

describe('renderJson', () => {
  it('round-trips the full result', () => {
    const parsed = JSON.parse(renderJson(result())) as { findings: Finding[]; repo: string };
    expect(parsed.repo).toBe('octocat/example');
    expect(parsed.findings.length).toBe(1);
    expect(parsed.findings[0]?.id).toBe('llm-1');
  });
});
