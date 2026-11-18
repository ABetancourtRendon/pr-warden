import { priceNote } from '../costs.js';
import type { ChangedFile, Finding, ReviewResult } from '../types.js';

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export interface ReviewPayload {
  /** Grouped summary comment body (the review text). */
  summary: string;
  /** Inline comments whose lines are part of the diff (one per finding, before capping). */
  inline: InlineComment[];
  /** Findings whose lines are outside the diff and therefore live in the summary only. */
  deferred: number;
}

const SUMMARY_FINDING_CAP = 100;

/**
 * Build the single grouped review: a severity summary table plus inline comment
 * bodies. Inline comments require the finding's line to be part of the diff;
 * everything else is folded into the summary with a marker.
 */
export function buildReviewPayload(
  result: ReviewResult,
  files: ChangedFile[],
  options: { maxInlineComments: number },
): ReviewPayload {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const inline: InlineComment[] = [];
  let deferred = 0;

  for (const finding of result.findings) {
    const file = byPath.get(finding.file);
    const commentLine = file ? pickCommentLine(finding, file) : null;
    if (commentLine === null) {
      deferred += 1;
      continue;
    }
    inline.push({ path: finding.file, line: commentLine, body: buildInlineCommentBody(finding) });
  }

  const summary = buildSummaryComment(result, {
    inlineCount: Math.min(inline.length, options.maxInlineComments),
    deferredCount: deferred + Math.max(0, inline.length - options.maxInlineComments),
  });
  return { summary, inline, deferred };
}

function pickCommentLine(finding: Finding, file: ChangedFile): number | null {
  for (let line = finding.start_line; line <= finding.end_line; line += 1) {
    if (file.commentableLines.has(line)) {
      return line;
    }
  }
  return null;
}

function buildInlineCommentBody(finding: Finding): string {
  const lines: string[] = [];
  lines.push(
    `**[${finding.severity.toUpperCase()} / ${finding.category}] ${finding.title}** (confidence ${finding.confidence.toFixed(2)})`,
  );
  lines.push('');
  lines.push(finding.detail);
  if (finding.suggested_fix_diff && finding.suggested_fix_diff.trim() !== '') {
    lines.push('');
    lines.push('Suggested fix:');
    lines.push('```diff');
    lines.push(finding.suggested_fix_diff.trim());
    lines.push('```');
  }
  lines.push('');
  lines.push(`_PR-Warden finding \`${finding.id}\` - sources: ${finding.source}_`);
  return lines.join('\n');
}

function buildSummaryComment(
  result: ReviewResult,
  counts: { inlineCount: number; deferredCount: number },
): string {
  const lines: string[] = [];
  lines.push('## PR-Warden review');

  if (result.findings.length === 0) {
    lines.push('');
    lines.push('**No findings** - the change looks clean.');
  } else {
    const countsBySeverity = countSeverities(result.findings);
    const severityText = (['critical', 'major', 'minor', 'info'] as const)
      .map((severity) => `${countsBySeverity[severity]} ${severity}`)
      .join(', ');
    lines.push(`**${result.findings.length} findings** - ${severityText}`);
  }
  lines.push(
    `Provider: ${result.provider} (${result.model})${result.degraded ? ' - degraded to static-only' : ''}`,
  );
  if (result.usage) {
    const tokenLine = `${result.usage.promptTokens.toLocaleString('en-US')} in / ${result.usage.completionTokens.toLocaleString('en-US')} out`;
    const cost = result.costUsd !== null ? ` - est. $${result.costUsd.toFixed(4)}` : '';
    lines.push(`Tokens: ${tokenLine}${cost}`);
  }
  if (counts.inlineCount > 0 || counts.deferredCount > 0) {
    lines.push(
      `Inline comments: ${counts.inlineCount}${counts.deferredCount > 0 ? ` (+${counts.deferredCount} summarized - line not in diff or cap reached)` : ''}`,
    );
  }
  lines.push('');

  if (result.findings.length > 0) {
    lines.push('| # | Severity | Category | Location | Finding |');
    lines.push('|---|----------|----------|----------|---------|');
    const shown = result.findings.slice(0, SUMMARY_FINDING_CAP);
    shown.forEach((finding, index) => {
      const location = `\`${finding.file}#L${finding.start_line}-L${finding.end_line}\``;
      lines.push(
        `| ${index + 1} | ${finding.severity} | ${finding.category} | ${location} | ${escapeTable(finding.title)} |`,
      );
    });
    if (result.findings.length > shown.length) {
      lines.push(
        `| ... | | | | _${result.findings.length - shown.length} more findings omitted from the table_ |`,
      );
    }
    lines.push('');

    lines.push('<details>');
    lines.push('<summary>Finding details</summary>');
    lines.push('');
    for (const finding of shown) {
      lines.push(
        `#### ${finding.severity.toUpperCase()} / ${finding.category} - \`${finding.file}#L${finding.start_line}-L${finding.end_line}\``,
      );
      lines.push('');
      lines.push(finding.detail);
      if (finding.suggested_fix_diff && finding.suggested_fix_diff.trim() !== '') {
        lines.push('');
        lines.push('```diff');
        lines.push(finding.suggested_fix_diff.trim());
        lines.push('```');
      }
      lines.push('');
    }
    lines.push('</details>');
    lines.push('');
  }

  for (const note of result.notes) {
    lines.push(`> note: ${note}`);
  }
  const price =
    result.usage && result.provider !== 'mock' && result.provider !== 'none'
      ? priceNote(result.model)
      : null;
  if (price) {
    lines.push(`> pricing: ${price}`);
  }
  lines.push('');
  lines.push('---');
  lines.push(
    'Generated by [PR-Warden](https://github.com/ABetancourtRendon/pr-warden) - an AI reviewer that measures its own precision and recall (see docs/BENCH.md).',
  );
  return lines.join('\n');
}

function escapeTable(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function countSeverities(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
  }
  return counts;
}
