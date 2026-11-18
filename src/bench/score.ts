import type { Category, Finding, Severity } from '../types.js';
import { SEVERITY_RANK } from '../types.js';
import type { ManifestBug } from './manifest.js';

export interface ScoreOptions {
  /** Findings below this severity are ignored by the scorer. */
  minSeverity: Severity;
  /** Only findings in these categories are scored. */
  categories: Category[];
  /** Line-number slack when matching a finding range against a planted-bug range. */
  tolerance: number;
}

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = {
  minSeverity: 'minor',
  categories: ['bug', 'security', 'performance'],
  tolerance: 2,
};

export interface Metrics {
  /** Eligible findings that matched at least one planted bug. */
  tp: number;
  /** Eligible findings that matched no planted bug. */
  fp: number;
  /** Planted bugs that no eligible finding matched. */
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface BugOutcome {
  bug: ManifestBug;
  matchedFindingIds: string[];
  found: boolean;
}

export interface CategoryReport {
  category: Category;
  metrics: Metrics;
}

export interface FixtureScore {
  bugs: BugOutcome[];
  matchedFindingIds: string[];
  falsePositiveIds: string[];
}

export interface ScoreReport {
  overall: Metrics;
  perCategory: CategoryReport[];
  perFixture: FixtureScore;
}

function eligible(finding: Finding, options: ScoreOptions): boolean {
  return (
    SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[options.minSeverity] &&
    options.categories.includes(finding.category)
  );
}

function overlapsWithTolerance(finding: Finding, bug: ManifestBug, tolerance: number): boolean {
  return (
    finding.start_line - tolerance <= bug.end_line && bug.start_line - tolerance <= finding.end_line
  );
}

function matchesBug(finding: Finding, bug: ManifestBug, options: ScoreOptions): boolean {
  return (
    finding.file === bug.file &&
    finding.category === bug.category &&
    overlapsWithTolerance(finding, bug, options.tolerance)
  );
}

/**
 * Score findings against a fixture's planted bugs.
 *
 * Matching rule (documented in docs/BENCH.md): a finding matches a bug when the
 * file is identical, the category is identical, and the finding's line range
 * overlaps the bug's range after widening both by the tolerance (default 2 lines,
 * because LLMs are often off by a line or two).
 *
 * - Precision = matched findings / eligible findings (finding-level).
 * - Recall = matched bugs / total planted bugs (bug-level).
 * - F1 is the harmonic mean of the two.
 */
export function scoreFixture(
  findings: Finding[],
  bugs: ManifestBug[],
  options: ScoreOptions = DEFAULT_SCORE_OPTIONS,
): FixtureScore {
  const eligibleFindings = findings.filter((finding) => eligible(finding, options));

  const bugOutcomes: BugOutcome[] = bugs.map((bug) => {
    const matched = eligibleFindings
      .filter((finding) => matchesBug(finding, bug, options))
      .map((finding) => finding.id);
    return { bug, matchedFindingIds: matched, found: matched.length > 0 };
  });

  const matchedIds = eligibleFindings
    .filter((finding) => bugs.some((bug) => matchesBug(finding, bug, options)))
    .map((finding) => finding.id);
  const falsePositiveIds = eligibleFindings
    .filter((finding) => !bugs.some((bug) => matchesBug(finding, bug, options)))
    .map((finding) => finding.id);

  return { bugs: bugOutcomes, matchedFindingIds: matchedIds, falsePositiveIds: falsePositiveIds };
}

export function aggregateMetrics(
  findings: Finding[],
  bugs: ManifestBug[],
  options: ScoreOptions,
): Metrics {
  const score = scoreFixture(findings, bugs, options);
  const eligibleFindings = findings.filter((finding) => eligible(finding, options));
  const tp = score.matchedFindingIds.length;
  const fp = eligibleFindings.length - tp;
  const fn = score.bugs.filter((outcome) => !outcome.found).length;
  const precision = eligibleFindings.length === 0 ? 0 : tp / eligibleFindings.length;
  const recall = bugs.length === 0 ? 0 : (bugs.length - fn) / bugs.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

export function categoryMetrics(
  category: Category,
  findings: Finding[],
  bugs: ManifestBug[],
  options: ScoreOptions,
): Metrics {
  const scopedFindings = findings.filter((finding) => finding.category === category);
  const scopedBugs = bugs.filter((bug) => bug.category === category);
  return aggregateMetrics(scopedFindings, scopedBugs, options);
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
