import type { Finding } from '../types.js';
import { SEVERITY_RANK } from '../types.js';

export interface MergeResult {
  findings: Finding[];
  mergedCount: number;
}

function rangesOverlap(a: Finding, b: Finding): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

/**
 * Merge and dedup static and LLM findings. Two findings on the same file with
 * overlapping line ranges collapse into one: the higher-severity finding wins,
 * ties go to the LLM finding (richer explanation), and cross-source merges are
 * marked as corroborated with a small confidence bonus.
 */
export function mergeFindings(staticFindings: Finding[], llmFindings: Finding[]): MergeResult {
  const entries = [...staticFindings, ...llmFindings];
  const sorted = entries.sort(compareFindings);
  const accepted: Finding[] = [];
  let mergedCount = 0;

  for (const candidate of sorted) {
    const colliding = accepted.find(
      (existing) => existing.file === candidate.file && rangesOverlap(existing, candidate),
    );
    if (!colliding) {
      accepted.push(candidate);
      continue;
    }
    mergedCount += 1;
    if (colliding.source !== candidate.source && colliding.source !== 'both') {
      // Static and LLM tools agree on the same code region: corroborated finding.
      colliding.source = 'both';
      colliding.confidence = Math.min(1, Math.round((colliding.confidence + 0.15) * 100) / 100);
      if (!colliding.rule && candidate.rule) {
        colliding.rule = candidate.rule;
      }
    }
  }
  return { findings: accepted, mergedCount };
}

/** Deterministic ordering: severity desc, then file, then start line, then LLM before static. */
export function compareFindings(a: Finding, b: Finding): number {
  const severityDifference = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severityDifference !== 0) {
    return severityDifference;
  }
  if (a.file !== b.file) {
    return a.file < b.file ? -1 : 1;
  }
  if (a.start_line !== b.start_line) {
    return a.start_line - b.start_line;
  }
  const sourceDifference = sourceRank(a) - sourceRank(b);
  if (sourceDifference !== 0) {
    return sourceDifference;
  }
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

function sourceRank(finding: Finding): number {
  return finding.source === 'llm' ? 0 : 1;
}
