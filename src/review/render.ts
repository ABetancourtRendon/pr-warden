import { priceNote } from '../costs.js';
import type { Finding, ReviewResult, Severity } from '../types.js';

const SEVERITY_LABEL_WIDTH = 8;
const CATEGORY_WIDTH = 13;
const LOCATION_WIDTH = 30;
const TOTAL_WIDTH = 100;

const ANSI_RESET = '\u001B[0m';

function wrap(text: string, startCode: string, enabled: boolean): string {
  return enabled ? `${startCode}${text}${ANSI_RESET}` : text;
}

function severityColor(finding: Finding, enabled: boolean): string {
  if (!enabled) {
    return finding.severity.toUpperCase().padEnd(SEVERITY_LABEL_WIDTH);
  }
  const label = finding.severity.toUpperCase().padEnd(SEVERITY_LABEL_WIDTH);
  if (finding.severity === 'critical') {
    return wrap(label, '\u001B[1;31m', true);
  }
  if (finding.severity === 'major') {
    return wrap(label, '\u001B[31m', true);
  }
  if (finding.severity === 'minor') {
    return wrap(label, '\u001B[33m', true);
  }
  return wrap(label, '\u001B[2m', true);
}

function locationOf(finding: Finding): string {
  const range =
    finding.start_line === finding.end_line
      ? `${finding.start_line}`
      : `${finding.start_line}-${finding.end_line}`;
  return truncate(`${finding.file}:${range}`, LOCATION_WIDTH).padEnd(LOCATION_WIDTH);
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export interface RenderOptions {
  color: boolean;
  verbose: boolean;
}

/** Human-readable terminal report with a findings table and token/cost footer. */
export function renderTerminal(result: ReviewResult, options: RenderOptions): string {
  const lines: string[] = [];
  const title = `${result.repo}${result.pr !== null ? ` #${result.pr}` : ''}`;
  lines.push(`PR-Warden review - ${title}`);
  lines.push(`Provider: ${result.provider} (${result.model})`);

  const counts = countSeverities(result.findings);
  const countText = (['critical', 'major', 'minor', 'info'] as Severity[])
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(', ');
  lines.push(
    result.findings.length === 0
      ? 'Findings: none - clean review'
      : `Findings: ${result.findings.length} (${countText})`,
  );
  lines.push(
    `Files analyzed: ${result.stats.filesAnalyzed} (skipped ${result.stats.filesSkipped})`,
  );
  lines.push('');

  if (result.degraded) {
    lines.push(
      wrap('LLM pass failed - showing static findings only.', '\u001B[33m', options.color),
    );
    lines.push('');
  }
  for (const note of result.notes) {
    lines.push(`note: ${note}`);
  }
  if (result.notes.length > 0) {
    lines.push('');
  }

  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      const confidence = finding.confidence.toFixed(2);
      const titleWidth = TOTAL_WIDTH - SEVERITY_LABEL_WIDTH - CATEGORY_WIDTH - LOCATION_WIDTH - 6;
      lines.push(
        [
          severityColor(finding, options.color),
          finding.category.padEnd(CATEGORY_WIDTH),
          locationOf(finding),
          confidence,
          truncate(finding.title, Math.max(10, titleWidth)),
        ].join(' '),
      );
    }
    lines.push('');
  }

  if (options.verbose) {
    for (const finding of result.findings) {
      lines.push(
        `--- [${finding.id}] ${finding.severity.toUpperCase()} ${finding.category} ${finding.file}:${finding.start_line}-${finding.end_line} (confidence ${finding.confidence.toFixed(2)})`,
      );
      for (const detailLine of wrapText(finding.detail, 96)) {
        lines.push(`    ${detailLine}`);
      }
      if (finding.suggested_fix_diff && finding.suggested_fix_diff.trim() !== '') {
        lines.push('    suggested fix:');
        for (const diffLine of finding.suggested_fix_diff.split('\n')) {
          lines.push(`    ${diffLine}`);
        }
      }
      lines.push('');
    }
  }

  const footer = usageFooter(result);
  if (footer) {
    lines.push(footer);
  }
  return lines.join('\n');
}

function usageFooter(result: ReviewResult): string | null {
  if (!result.usage) {
    return null;
  }
  const parts = [
    `tokens: ${result.usage.promptTokens.toLocaleString('en-US')} in / ${result.usage.completionTokens.toLocaleString('en-US')} out`,
  ];
  if (result.costUsd !== null) {
    parts.push(`est. cost $${result.costUsd.toFixed(4)}`);
    const note = priceNote(result.model);
    if (note) {
      parts.push(note);
    }
  } else if (result.provider !== 'mock') {
    parts.push('cost: unknown (no price entry for this model)');
  }
  return parts.join(' - ');
}

function wrapText(text: string, width: number): string[] {
  const source = text.split('\n');
  const output: string[] = [];
  for (const line of source) {
    if (line.length <= width) {
      output.push(line);
      continue;
    }
    let remainder = line;
    while (remainder.length > width) {
      const cut = remainder.lastIndexOf(' ', width);
      output.push(remainder.slice(0, cut === -1 ? width : cut));
      remainder = remainder.slice(cut === -1 ? width : cut).trimStart();
    }
    if (remainder !== '') {
      output.push(remainder);
    }
  }
  return output;
}

function countSeverities(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/** Stable JSON serialization for --json output. */
export function renderJson(result: ReviewResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
