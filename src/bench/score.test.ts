import { describe, expect, it } from 'vitest';
import type { Finding } from '../types.js';
import type { ManifestBug } from './manifest.js';
import {
  aggregateMetrics,
  categoryMetrics,
  DEFAULT_SCORE_OPTIONS,
  round4,
  scoreFixture,
} from './score.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    file: 'src/app.js',
    start_line: 10,
    end_line: 12,
    severity: 'major',
    category: 'bug',
    title: 'title',
    detail: 'detail',
    confidence: 0.8,
    source: 'llm',
    ...overrides,
  };
}

function bug(overrides: Partial<ManifestBug> = {}): ManifestBug {
  return {
    file: 'src/app.js',
    start_line: 10,
    end_line: 12,
    category: 'bug',
    description: 'planted bug',
    ...overrides,
  };
}

describe('scoreFixture', () => {
  it('scores a perfect review as precision/recall/F1 of 1', () => {
    const score = scoreFixture(
      [
        finding({ id: 'f1', start_line: 10, end_line: 10 }),
        finding({ id: 'f2', start_line: 11, end_line: 12 }),
      ],
      [bug({ start_line: 10, end_line: 10 }), bug({ start_line: 11, end_line: 12 })],
    );
    expect(score.bugs.every((outcome) => outcome.found)).toBe(true);
    expect(score.matchedFindingIds).toEqual(['f1', 'f2']);
    expect(score.falsePositiveIds).toEqual([]);
  });

  it('counts a category-mismatched finding as a false positive and a missed bug', () => {
    const score = scoreFixture([finding({ category: 'security' })], [bug({ category: 'bug' })]);
    expect(score.bugs[0]?.found).toBe(false);
    expect(score.falsePositiveIds).toEqual(['f1']);
    expect(score.matchedFindingIds).toEqual([]);
  });

  it('applies the line tolerance window', () => {
    const planted = bug({ start_line: 10, end_line: 10 });
    const withinTolerance = scoreFixture([finding({ start_line: 12, end_line: 12 })], [planted]);
    expect(withinTolerance.bugs[0]?.found).toBe(true);
    const outsideTolerance = scoreFixture([finding({ start_line: 13, end_line: 13 })], [planted]);
    expect(outsideTolerance.bugs[0]?.found).toBe(false);
  });

  it('ignores findings below the minimum severity', () => {
    const score = scoreFixture([finding({ severity: 'info' })], [bug()]);
    expect(score.bugs[0]?.found).toBe(false);
    expect(score.falsePositiveIds).toEqual([]);
  });

  it('counts duplicate findings on one bug as true positives, not FPs', () => {
    const score = scoreFixture(
      [finding({ id: 'f1' }), finding({ id: 'f2', severity: 'minor' })],
      [bug()],
    );
    expect(score.matchedFindingIds).toEqual(['f1', 'f2']);
    expect(score.falsePositiveIds).toEqual([]);
    expect(score.bugs[0]?.matchedFindingIds).toEqual(['f1', 'f2']);
  });
});

describe('aggregateMetrics', () => {
  it('computes finding-level precision and bug-level recall', () => {
    const metrics = aggregateMetrics(
      [
        finding({ id: 'a', category: 'security', file: 'src/one.js', start_line: 5, end_line: 5 }),
        finding({ id: 'b', category: 'bug', file: 'src/two.js', start_line: 9, end_line: 9 }),
        finding({ id: 'c', category: 'bug', file: 'src/three.js', start_line: 1, end_line: 1 }),
      ],
      [
        bug({ category: 'security', file: 'src/one.js', start_line: 5, end_line: 5 }),
        bug({ category: 'bug', file: 'src/two.js', start_line: 9, end_line: 9 }),
      ],
      DEFAULT_SCORE_OPTIONS,
    );
    expect(metrics.tp).toBe(2);
    expect(metrics.fp).toBe(1);
    expect(metrics.fn).toBe(0);
    expect(metrics.precision).toBeCloseTo(2 / 3, 5);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBeCloseTo(0.8, 5);
  });

  it('returns zeroed metrics for empty inputs', () => {
    const metrics = aggregateMetrics([], [], DEFAULT_SCORE_OPTIONS);
    expect(metrics).toMatchObject({ tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 });
  });

  it('matches the hand-computed mixed case', () => {
    // 7 TPs, 2 FPs over 10 planted bugs: P = 7/9, R = 7/10, F1 = 2PR/(P+R).
    const bugs: ManifestBug[] = Array.from({ length: 10 }, (_, index) =>
      bug({ file: `src/b${index}.js`, start_line: 5, end_line: 5 }),
    );
    const findings: Finding[] = [
      ...Array.from({ length: 7 }, (_, index) =>
        finding({ id: `tp${index}`, file: `src/b${index}.js`, start_line: 5, end_line: 5 }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        finding({ id: `fp${index}`, file: `src/other${index}.js`, start_line: 5, end_line: 5 }),
      ),
    ];
    const metrics = aggregateMetrics(findings, bugs, DEFAULT_SCORE_OPTIONS);
    expect(metrics.tp).toBe(7);
    expect(metrics.fp).toBe(2);
    expect(metrics.fn).toBe(3);
    expect(metrics.precision).toBeCloseTo(7 / 9, 5);
    expect(metrics.recall).toBeCloseTo(0.7, 5);
    expect(metrics.f1).toBeCloseTo((2 * (7 / 9) * 0.7) / (7 / 9 + 0.7), 5);
  });
});

describe('categoryMetrics', () => {
  it('scopes metrics to one category', () => {
    const findings = [
      finding({ id: 's1', category: 'security', file: 'src/sec.js', start_line: 3, end_line: 3 }),
      finding({ id: 'b1', category: 'bug', file: 'src/bug.js', start_line: 3, end_line: 3 }),
      finding({ id: 'b2', category: 'bug', file: 'src/miss.js', start_line: 3, end_line: 3 }),
    ];
    const bugs = [
      bug({ category: 'security', file: 'src/sec.js', start_line: 3, end_line: 3 }),
      bug({ category: 'bug', file: 'src/bug.js', start_line: 3, end_line: 3 }),
    ];
    expect(categoryMetrics('security', findings, bugs, DEFAULT_SCORE_OPTIONS)).toMatchObject({
      tp: 1,
      fp: 0,
      fn: 0,
    });
    expect(categoryMetrics('bug', findings, bugs, DEFAULT_SCORE_OPTIONS)).toMatchObject({
      tp: 1,
      fp: 1,
      fn: 0,
    });
  });
});

describe('round4', () => {
  it('rounds to four decimals', () => {
    expect(round4(7 / 9)).toBe(0.7778);
    expect(round4(0.7368421052)).toBe(0.7368);
  });
});
