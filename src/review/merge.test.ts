import { describe, expect, it } from 'vitest';
import type { Finding } from '../types.js';
import { mergeFindings } from './merge.js';

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 'x',
    file: 'src/app.js',
    start_line: 1,
    end_line: 3,
    severity: 'minor',
    category: 'bug',
    title: 'title',
    detail: 'detail',
    confidence: 0.5,
    source: 'llm',
    ...overrides,
  };
}

describe('mergeFindings', () => {
  it('keeps disjoint findings separate', () => {
    const result = mergeFindings(
      [finding({ source: 'static', start_line: 1, end_line: 2, id: 's1' })],
      [finding({ source: 'llm', start_line: 10, end_line: 12, id: 'l1' })],
    );
    expect(result.findings.length).toBe(2);
    expect(result.mergedCount).toBe(0);
  });

  it('collapses overlapping findings on the same file, preferring the LLM on ties', () => {
    const result = mergeFindings(
      [finding({ source: 'static', id: 's1', title: 'static title' })],
      [finding({ source: 'llm', id: 'l1', title: 'llm title' })],
    );
    expect(result.findings.length).toBe(1);
    expect(result.mergedCount).toBe(1);
    expect(result.findings[0]?.source).toBe('both');
    expect(result.findings[0]?.title).toBe('llm title');
    expect(result.findings[0]?.confidence).toBeCloseTo(0.65, 2);
  });

  it('keeps the higher severity when sources disagree', () => {
    const result = mergeFindings(
      [finding({ source: 'static', severity: 'major', start_line: 5, end_line: 5, id: 's1' })],
      [finding({ source: 'llm', severity: 'minor', start_line: 5, end_line: 6, id: 'l1' })],
    );
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.severity).toBe('major');
    expect(result.findings[0]?.source).toBe('both');
  });

  it('does not merge findings on different files even with the same lines', () => {
    const result = mergeFindings(
      [finding({ source: 'static', file: 'src/a.js', id: 's1' })],
      [finding({ source: 'llm', file: 'src/b.js', id: 'l1' })],
    );
    expect(result.findings.length).toBe(2);
  });

  it('orders by severity, then file, then line', () => {
    const result = mergeFindings(
      [
        finding({ source: 'static', severity: 'minor', file: 'src/a.js', start_line: 9, id: 's1' }),
        finding({
          source: 'static',
          severity: 'critical',
          file: 'src/z.js',
          start_line: 1,
          id: 's2',
        }),
      ],
      [finding({ source: 'llm', severity: 'major', file: 'src/b.js', start_line: 1, id: 'l1' })],
    );
    expect(result.findings.map((entry) => entry.severity)).toEqual(['critical', 'major', 'minor']);
    expect(result.findings.map((entry) => entry.file)).toEqual([
      'src/z.js',
      'src/b.js',
      'src/a.js',
    ]);
  });

  it('returns an empty list for empty inputs', () => {
    const result = mergeFindings([], []);
    expect(result.findings).toEqual([]);
    expect(result.mergedCount).toBe(0);
  });
});
